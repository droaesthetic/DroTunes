import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  VoiceBasedChannel
} from "discord.js";
import { ChannelType } from "discord.js";
import { ProviderResolver } from "./providerResolver.js";
import { GuildPlayer } from "./guildPlayer.js";
import type { QueueSnapshot } from "../types.js";

export class MusicManager {
  private readonly resolver = new ProviderResolver();
  private readonly players = new Map<string, GuildPlayer>();

  constructor(private readonly client: Client) {}

  async play(interaction: ChatInputCommandInteraction, query: string) {
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("This command can only be used in a server.");
    }

    const member = await guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      throw new Error("Join a voice channel first.");
    }

    const player = await this.ensurePlayer(guild, voiceChannel, interaction.channelId);
    const track = await this.resolver.resolve({
      query,
      requestedBy: interaction.user.username
    });

    await player.enqueue(track);
    return track;
  }

  pause(guildId: string) {
    this.getPlayerOrThrow(guildId).pause();
  }

  resume(guildId: string) {
    this.getPlayerOrThrow(guildId).resume();
  }

  skip(guildId: string) {
    this.getPlayerOrThrow(guildId).skip();
  }

  stop(guildId: string) {
    this.getPlayerOrThrow(guildId).stop();
  }

  setVolume(guildId: string, percent: number) {
    this.getPlayerOrThrow(guildId).setVolume(percent);
  }

  getSnapshot(guildId: string): QueueSnapshot {
    return this.getPlayerOrThrow(guildId).snapshot();
  }

  listSnapshots(): QueueSnapshot[] {
    return [...this.players.values()].map((player) => player.snapshot());
  }

  private async ensurePlayer(guild: Guild, voiceChannel: VoiceBasedChannel, textChannelId: string) {
    let player = this.players.get(guild.id);
    if (!player) {
      player = new GuildPlayer(guild);
      this.players.set(guild.id, player);
    }

    await player.connect(voiceChannel, textChannelId);
    return player;
  }

  private getPlayerOrThrow(guildId: string) {
    const player = this.players.get(guildId);
    if (!player) {
      throw new Error("Nothing is playing in that server right now.");
    }

    return player;
  }
}
