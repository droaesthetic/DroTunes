import {
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioResource,
  type VoiceConnection
} from "@discordjs/voice";
import type { Guild, VoiceBasedChannel } from "discord.js";
import play from "play-dl";
import { appConfig } from "../config.js";
import type { QueueSnapshot, ResolvedTrack, StoredGuildPlayerState } from "../types.js";

export class GuildPlayer {
  private readonly queue: ResolvedTrack[];
  private readonly history: ResolvedTrack[];
  private readonly player: AudioPlayer;
  private connection?: VoiceConnection;
  private current?: ResolvedTrack;
  private currentResource?: AudioResource;
  private textChannelId?: string;
  private voiceChannelId?: string;
  private isAdvancing = false;
  private volume: number;
  private currentSeekSeconds = 0;
  private currentStartedAt = 0;
  private readonly onStateChange: (state: StoredGuildPlayerState | null) => Promise<void>;
  private readonly onTrackFinished: (track: ResolvedTrack) => Promise<ResolvedTrack | null>;
  autoplayEnabled = false;
  voteSkipEnabled = false;
  permissionMode: QueueSnapshot["permissionMode"] = "everyone";

  constructor(
    private readonly guild: Guild,
    options: {
      onStateChange: (state: StoredGuildPlayerState | null) => Promise<void>;
      onTrackFinished: (track: ResolvedTrack) => Promise<ResolvedTrack | null>;
      restoredState?: StoredGuildPlayerState;
    }
  ) {
    this.onStateChange = options.onStateChange;
    this.onTrackFinished = options.onTrackFinished;
    this.queue = [...(options.restoredState?.queue ?? [])];
    this.history = [...(options.restoredState?.history ?? [])];
    this.current = options.restoredState?.current;
    this.textChannelId = options.restoredState?.textChannelId;
    this.voiceChannelId = options.restoredState?.voiceChannelId;
    this.volume = options.restoredState?.volume ?? appConfig.defaultVolume;
    this.player = createAudioPlayer();
    this.player.on(AudioPlayerStatus.Idle, async () => {
      if (!this.isAdvancing) {
        await this.playNext();
      }
    });
  }

  async connect(voiceChannel: VoiceBasedChannel, textChannelId: string) {
    this.voiceChannelId = voiceChannel.id;
    this.textChannelId = textChannelId;

    if (this.connection && this.connection.joinConfig.channelId === voiceChannel.id) {
      this.connection.subscribe(this.player);
      return;
    }

    if (this.connection) {
      this.connection.destroy();
      this.connection = undefined;
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true
    });

    this.connection.on("error", (error) => {
      console.error(`[voice:${this.guild.id}] connection error`, error);
    });

    this.connection.subscribe(this.player);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      console.error(`[voice:${this.guild.id}] initial connect failed`, error);
      this.connection.rejoin();
      try {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
      } catch (retryError) {
        console.error(`[voice:${this.guild.id}] retry connect failed`, retryError);
        const detail = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(
          `Voice connection failed while joining Discord. This is often a hosting-network issue with Discord voice UDP. Details: ${detail}`
        );
      }
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

    if (!this.current && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    }
  }

  async enqueueMany(tracks: ResolvedTrack[]) {
    for (const track of tracks) {
      await this.enqueue(track);
    }
  }

  pause() {
    this.player.pause(true);
  }

  resume() {
    this.player.unpause();
  }

  async stop() {
    this.queue.length = 0;
    this.current = undefined;
    this.currentResource = undefined;
    this.currentSeekSeconds = 0;
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = undefined;
    this.voiceChannelId = undefined;
    await this.persist();
  }

  skip() {
    this.player.stop(true);
  }

  async skipTo(index: number) {
    if (index < 1 || index > this.queue.length) {
      throw new Error("That queue position does not exist.");
    }

    this.queue.splice(0, index - 1);
    await this.persist();
    this.player.stop(true);
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
    this.player.stop(true);
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
    this.currentResource?.volume?.setVolume(this.volume / 100);
    void this.persist();
  }

  getCurrentPositionSeconds() {
    if (!this.currentStartedAt) {
      return this.currentSeekSeconds;
    }

    const elapsed = Math.floor((Date.now() - this.currentStartedAt) / 1000);
    return this.currentSeekSeconds + elapsed;
  }

  async seekTo(seconds: number) {
    if (!this.current) {
      throw new Error("Nothing is playing right now.");
    }

    const bounded = Math.max(0, seconds);
    await this.startTrack(this.current, bounded, false);
  }

  snapshot(): QueueSnapshot {
    return {
      guildId: this.guild.id,
      guildName: this.guild.name,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      isPlaying: this.player.state.status === AudioPlayerStatus.Playing,
      isPaused: this.player.state.status === AudioPlayerStatus.Paused,
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
      this.currentResource = undefined;
      this.currentSeekSeconds = 0;
      this.currentStartedAt = 0;
      await this.persist();
      return;
    }

    await this.startTrack(next, 0, true);
  }

  private async startTrack(track: ResolvedTrack, seekSeconds: number, persistBeforePlay: boolean) {
    this.isAdvancing = true;

    try {
      const stream = await play.stream(track.playbackUrl, {
        discordPlayerCompatibility: true,
        quality: 2,
        seek: seekSeconds
      });

      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true
      });

      resource.volume?.setVolume(this.volume / 100);
      this.current = track;
      this.currentResource = resource;
      this.currentSeekSeconds = seekSeconds;
      this.currentStartedAt = Date.now();

      if (persistBeforePlay) {
        await this.persist();
      } else {
        await this.persist();
      }

      this.player.play(resource);
    } catch (error) {
      console.error(`[voice:${this.guild.id}] failed to start track ${track.title}`, error);
      throw error;
    } finally {
      this.isAdvancing = false;
    }
  }

  private async persist() {
    await this.onStateChange(this.serialize());
  }
}
