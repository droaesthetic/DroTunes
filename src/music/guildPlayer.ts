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
import type { QueueSnapshot, ResolvedTrack } from "../types.js";

export class GuildPlayer {
  private readonly queue: ResolvedTrack[] = [];
  private readonly player: AudioPlayer;
  private connection?: VoiceConnection;
  private current?: ResolvedTrack;
  private currentResource?: AudioResource;
  private textChannelId?: string;
  private voiceChannelId?: string;
  private isAdvancing = false;
  private volume = appConfig.defaultVolume;

  constructor(private readonly guild: Guild) {
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

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });

    this.connection.subscribe(this.player);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  async enqueue(track: ResolvedTrack) {
    if (this.queue.length >= appConfig.maxQueueSize) {
      throw new Error(`Queue limit reached (${appConfig.maxQueueSize} tracks).`);
    }

    this.queue.push(track);

    if (!this.current && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    }
  }

  pause() {
    this.player.pause(true);
  }

  resume() {
    this.player.unpause();
  }

  stop() {
    this.queue.length = 0;
    this.current = undefined;
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = undefined;
    this.voiceChannelId = undefined;
  }

  skip() {
    this.player.stop(true);
  }

  setVolume(percent: number) {
    this.volume = Math.max(1, Math.min(150, percent));
    this.currentResource?.volume?.setVolume(this.volume / 100);
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
      current: this.current,
      upcoming: [...this.queue]
    };
  }

  private async playNext() {
    const next = this.queue.shift();
    if (!next) {
      this.current = undefined;
      return;
    }

    this.isAdvancing = true;

    try {
      const stream = await play.stream(next.playbackUrl, {
        discordPlayerCompatibility: true,
        quality: 2
      });

      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true
      });

      resource.volume?.setVolume(this.volume / 100);
      this.current = next;
      this.currentResource = resource;
      this.player.play(resource);
    } finally {
      this.isAdvancing = false;
    }
  }
}
