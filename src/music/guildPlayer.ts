import type { Guild, VoiceBasedChannel } from "discord.js";
import type { Player } from "shoukaku";
import { appConfig } from "../config.js";
import type { QueueSnapshot, ResolvedTrack, StoredGuildPlayerState } from "../types.js";
import type { LavalinkService } from "./lavalinkService.js";

export class GuildPlayer {
  private readonly queue: ResolvedTrack[];
  private readonly history: ResolvedTrack[];
  private lavalinkPlayer?: Player;
  private current?: ResolvedTrack;
  private textChannelId?: string;
  private voiceChannelId?: string;
  private isAdvancing = false;
  private isPaused = false;
  private volume: number;
  private readonly onStateChange: (state: StoredGuildPlayerState | null) => Promise<void>;
  private readonly onTrackFinished: (track: ResolvedTrack) => Promise<ResolvedTrack | null>;
  private readonly resolvePlaybackTrack: (track: ResolvedTrack) => Promise<string>;
  autoplayEnabled = false;
  voteSkipEnabled = false;
  permissionMode: QueueSnapshot["permissionMode"] = "everyone";

  constructor(
    private readonly guild: Guild,
    private readonly lavalink: LavalinkService,
    options: {
      onStateChange: (state: StoredGuildPlayerState | null) => Promise<void>;
      onTrackFinished: (track: ResolvedTrack) => Promise<ResolvedTrack | null>;
      resolvePlaybackTrack: (track: ResolvedTrack) => Promise<string>;
      restoredState?: StoredGuildPlayerState;
    }
  ) {
    this.onStateChange = options.onStateChange;
    this.onTrackFinished = options.onTrackFinished;
    this.resolvePlaybackTrack = options.resolvePlaybackTrack;
    this.queue = [...(options.restoredState?.queue ?? [])];
    this.history = [...(options.restoredState?.history ?? [])];
    this.current = options.restoredState?.current;
    this.textChannelId = options.restoredState?.textChannelId;
    this.voiceChannelId = options.restoredState?.voiceChannelId;
    this.volume = options.restoredState?.volume ?? appConfig.defaultVolume;
  }

  async connect(voiceChannel: VoiceBasedChannel, textChannelId: string) {
    this.voiceChannelId = voiceChannel.id;
    this.textChannelId = textChannelId;

    if (!this.lavalinkPlayer || this.voiceChannelId !== voiceChannel.id) {
      this.lavalinkPlayer = await this.lavalink.join(
        voiceChannel.guild.id,
        voiceChannel.id,
        voiceChannel.guild.shardId
      );
      this.attachPlayerListeners(this.lavalinkPlayer);
      await this.lavalinkPlayer.setGlobalVolume(this.volume);
    }

    await this.persist();
  }

  async enqueue(track: ResolvedTrack, position?: number) {
    if (this.queue.length >= appConfig.maxQueueSize) {
      throw new Error(`Queue limit reached (${appConfig.maxQueueSize} tracks).`);
    }

    if (typeof position === "number" && position >= 0 && position < this.queue.length) {
      this.queue.splice(position, 0, track);
    } else {
      this.queue.push(track);
    }

    await this.persist();

    if (!this.current) {
      await this.playNext();
    }
  }

  async enqueueMany(tracks: ResolvedTrack[]) {
    for (const track of tracks) {
      await this.enqueue(track);
    }
  }

  pause() {
    this.isPaused = true;
    void this.lavalinkPlayer?.setPaused(true);
  }

  resume() {
    this.isPaused = false;
    void this.lavalinkPlayer?.setPaused(false);
  }

  async stop() {
    this.queue.length = 0;
    this.current = undefined;
    this.isPaused = false;

    if (this.lavalinkPlayer) {
      await this.lavalinkPlayer.stopTrack().catch(() => undefined);
      await this.lavalink.leave(this.guild.id).catch(() => undefined);
      this.lavalinkPlayer = undefined;
    }

    this.voiceChannelId = undefined;
    await this.persist();
  }

  skip() {
    void this.lavalinkPlayer?.stopTrack();
  }

  async skipTo(index: number) {
    if (index < 1 || index > this.queue.length) {
      throw new Error("That queue position does not exist.");
    }

    this.queue.splice(0, index - 1);
    await this.persist();
    await this.lavalinkPlayer?.stopTrack();
  }

  async playPrevious() {
    const previous = this.history.pop();
    if (!previous) {
      throw new Error("There is no previous track to play.");
    }

    if (this.current) {
      this.queue.unshift(this.current);
    }

    this.queue.unshift(previous);
    await this.persist();
    await this.lavalinkPlayer?.stopTrack();
  }

  async remove(index: number) {
    if (index < 1 || index > this.queue.length) {
      throw new Error("That queue position does not exist.");
    }

    const [removed] = this.queue.splice(index - 1, 1);
    await this.persist();
    return removed;
  }

  async removeLast() {
    const removed = this.queue.pop();
    await this.persist();
    return removed;
  }

  async removeDuplicates() {
    const seen = new Set<string>();
    const before = this.queue.length;
    const filtered = this.queue.filter((track) => {
      const key = `${track.title.toLowerCase()}::${track.artist?.toLowerCase() ?? ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    this.queue.splice(0, this.queue.length, ...filtered);
    await this.persist();
    return before - this.queue.length;
  }

  async removeAbsentMembers(activeMemberIds: Set<string>) {
    const before = this.queue.length;
    const filtered = this.queue.filter((track) => activeMemberIds.has(track.requestedById));
    this.queue.splice(0, this.queue.length, ...filtered);
    await this.persist();
    return before - this.queue.length;
  }

  async massRemove(start: number, count: number) {
    if (start < 1 || count < 1) {
      throw new Error("Start and count must both be at least 1.");
    }

    const removed = this.queue.splice(start - 1, count);
    await this.persist();
    return removed.length;
  }

  async clearQueue() {
    const count = this.queue.length;
    this.queue.length = 0;
    await this.persist();
    return count;
  }

  setVolume(percent: number) {
    this.volume = Math.max(1, Math.min(150, percent));
    void this.lavalinkPlayer?.setGlobalVolume(this.volume);
    void this.persist();
  }

  getCurrentPositionSeconds() {
    return this.lavalinkPlayer ? Math.floor(this.lavalinkPlayer.position / 1000) : 0;
  }

  async seekTo(seconds: number) {
    if (!this.current || !this.lavalinkPlayer) {
      throw new Error("Nothing is playing right now.");
    }

    await this.lavalinkPlayer.seekTo(Math.max(0, seconds) * 1000);
  }

  snapshot(): QueueSnapshot {
    return {
      guildId: this.guild.id,
      guildName: this.guild.name,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      isPlaying: Boolean(this.current) && !this.isPaused,
      isPaused: this.isPaused,
      volume: this.volume,
      autoplay: this.autoplayEnabled,
      voteSkipEnabled: this.voteSkipEnabled,
      permissionMode: this.permissionMode,
      current: this.current,
      previous: this.history.at(-1),
      upcoming: [...this.queue]
    };
  }

  serialize(): StoredGuildPlayerState {
    return {
      guildId: this.guild.id,
      guildName: this.guild.name,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      volume: this.volume,
      current: this.current,
      queue: [...this.queue],
      history: [...this.history]
    };
  }

  private attachPlayerListeners(player: Player) {
    player.removeAllListeners("end");
    player.removeAllListeners("exception");
    player.removeAllListeners("closed");

    player.on("end", async () => {
      if (!this.isAdvancing) {
        await this.playNext();
      }
    });

    player.on("exception", (reason) => {
      console.error(`[lavalink:${this.guild.id}] track exception`, reason);
    });

    player.on("closed", (reason) => {
      console.error(`[lavalink:${this.guild.id}] websocket closed`, reason);
    });
  }

  private async playNext() {
    const finished = this.current;
    if (finished) {
      this.history.push(finished);
      if (this.history.length > 25) {
        this.history.shift();
      }
    }

    let next = this.queue.shift();
    if (!next && finished) {
      next = (await this.onTrackFinished(finished)) ?? undefined;
    }

    if (!next) {
      this.current = undefined;
      this.isPaused = false;
      await this.persist();
      return;
    }

    await this.startTrack(next, 0);
  }

  private async startTrack(track: ResolvedTrack, seekSeconds: number) {
    this.isAdvancing = true;

    try {
      if (!this.lavalinkPlayer) {
        throw new Error("The bot is not connected to a Lavalink player.");
      }

      const encoded = await this.resolvePlaybackTrack(track);
      this.current = track;
      this.isPaused = false;
      await this.persist();
      await this.lavalink.play(this.lavalinkPlayer, encoded, this.volume, seekSeconds * 1000);
    } finally {
      this.isAdvancing = false;
    }
  }

  private async persist() {
    await this.onStateChange(this.serialize());
  }
}
