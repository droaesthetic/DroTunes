import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  Message,
  VoiceBasedChannel
} from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { ProviderResolver } from "./providerResolver.js";
import { GuildPlayer } from "./guildPlayer.js";
import { StateStore } from "../storage/stateStore.js";
import type {
  GuildSettings,
  PermissionMode,
  Playlist,
  QueueSnapshot,
  ResolvedTrack
} from "../types.js";

type CommandContext = ChatInputCommandInteraction | Message;

const defaultPrefix = "!";

export class MusicManager {
  private readonly resolver = new ProviderResolver();
  private readonly players = new Map<string, GuildPlayer>();
  private readonly voteSkipVoters = new Map<string, Set<string>>();

  constructor(
    private readonly client: Client,
    private readonly store: StateStore
  ) {}

  async init() {
    await this.store.init();
  }

  getPrefix(guildId: string) {
    return this.getGuildSettings(guildId).prefix;
  }

  getGuildSettings(guildId: string): GuildSettings {
    return this.store.getGuildSettings(guildId) ?? {
      guildId,
      prefix: defaultPrefix,
      autoplay: false,
      voteSkipEnabled: false,
      permissionMode: "everyone"
    };
  }

  async updateGuildSettings(guildId: string, patch: Partial<GuildSettings>) {
    const next = { ...this.getGuildSettings(guildId), ...patch, guildId };
    await this.store.setGuildSettings(next);
    const player = this.players.get(guildId);
    if (player) {
      player.autoplayEnabled = next.autoplay;
      player.voteSkipEnabled = next.voteSkipEnabled;
      player.permissionMode = next.permissionMode;
    }
    return next;
  }

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

    await this.assertCanControl(member, guild.id);

    const player = await this.ensurePlayer(guild, voiceChannel, interaction.channelId);
    const track = await this.resolver.resolve({
      query,
      requestedBy: interaction.user.username,
      requestedById: interaction.user.id
    });

    await player.enqueue(track);
    return track;
  }

  async playMany(interaction: ChatInputCommandInteraction, queries: string[]) {
    const tracks: ResolvedTrack[] = [];
    for (const query of queries) {
      tracks.push(await this.play(interaction, query));
    }
    return tracks;
  }

  async playFromMessage(message: Message, query: string) {
    const guild = message.guild;
    if (!guild) {
      throw new Error("This command can only be used in a server.");
    }

    const member = await guild.members.fetch(message.author.id);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      throw new Error("Join a voice channel first.");
    }

    await this.assertCanControl(member, guild.id);

    const player = await this.ensurePlayer(guild, voiceChannel, message.channelId);
    const track = await this.resolver.resolve({
      query,
      requestedBy: message.author.username,
      requestedById: message.author.id
    });

    await player.enqueue(track);
    return track;
  }

  async pause(guildId: string) {
    this.getPlayerOrThrow(guildId).pause();
  }

  async resume(guildId: string) {
    this.getPlayerOrThrow(guildId).resume();
  }

  async stop(guildId: string) {
    await this.getPlayerOrThrow(guildId).stop();
    this.voteSkipVoters.delete(guildId);
  }

  async skip(guildId: string) {
    this.getPlayerOrThrow(guildId).skip();
    this.voteSkipVoters.delete(guildId);
  }

  async skipTo(guildId: string, index: number) {
    await this.getPlayerOrThrow(guildId).skipTo(index);
    this.voteSkipVoters.delete(guildId);
  }

  async playPrevious(guildId: string) {
    await this.getPlayerOrThrow(guildId).playPrevious();
  }

  async setVolume(guildId: string, percent: number) {
    this.getPlayerOrThrow(guildId).setVolume(percent);
  }

  async remove(guildId: string, index: number) {
    return this.getPlayerOrThrow(guildId).remove(index);
  }

  async removeLast(guildId: string) {
    return this.getPlayerOrThrow(guildId).removeLast();
  }

  async removeDuplicates(guildId: string) {
    return this.getPlayerOrThrow(guildId).removeDuplicates();
  }

  async removeAbsent(guildId: string) {
    const player = this.getPlayerOrThrow(guildId);
    const channelId = player.snapshot().voiceChannelId;
    if (!channelId) {
      throw new Error("The bot is not connected to a voice channel.");
    }

    const guild = await this.client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !("members" in channel)) {
      throw new Error("Unable to read the current voice channel.");
    }

    if (!("filter" in channel.members)) {
      throw new Error("Unable to inspect the current voice channel members.");
    }

    const activeMemberIds = new Set(channel.members.filter(() => true).map((member) => member.id));
    return player.removeAbsentMembers(activeMemberIds);
  }

  async massRemove(guildId: string, start: number, count: number) {
    return this.getPlayerOrThrow(guildId).massRemove(start, count);
  }

  async clearQueue(guildId: string) {
    return this.getPlayerOrThrow(guildId).clearQueue();
  }

  async seekRelative(guildId: string, deltaSeconds: number) {
    const player = this.getPlayerOrThrow(guildId);
    const target = player.getCurrentPositionSeconds() + deltaSeconds;
    await player.seekTo(target);
    return player.getCurrentPositionSeconds();
  }

  async toggleVoteSkip(guildId: string, enabled?: boolean) {
    const settings = await this.updateGuildSettings(guildId, {
      voteSkipEnabled: enabled ?? !this.getGuildSettings(guildId).voteSkipEnabled
    });
    return settings.voteSkipEnabled;
  }

  async handleVoteSkip(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    const guildId = interaction.guildId;
    if (!guild || !guildId) {
      throw new Error("This command must be used in a server.");
    }

    const settings = this.getGuildSettings(guildId);
    if (!settings.voteSkipEnabled) {
      await this.skip(guildId);
      return { skipped: true, needed: 0, votes: 0 };
    }

    const player = this.getPlayerOrThrow(guildId);
    const channelId = player.snapshot().voiceChannelId;
    if (!channelId) {
      throw new Error("The bot is not connected to a voice channel.");
    }

    const member = await guild.members.fetch(interaction.user.id);
    if (member.voice.channelId !== channelId) {
      throw new Error("Join the bot's voice channel to vote skip.");
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel || !("members" in channel)) {
      throw new Error("Unable to inspect the voice channel for vote skip.");
    }

    if (!("filter" in channel.members)) {
      throw new Error("Unable to inspect the voice channel for vote skip.");
    }

    const listeners = channel.members.filter((entry) => !entry.user.bot);
    const needed = Math.max(1, Math.ceil(listeners.size / 2));
    const voters = this.voteSkipVoters.get(guildId) ?? new Set<string>();
    voters.add(interaction.user.id);
    this.voteSkipVoters.set(guildId, voters);

    if (voters.size >= needed) {
      await this.skip(guildId);
      return { skipped: true, needed, votes: voters.size };
    }

    return { skipped: false, needed, votes: voters.size };
  }

  async createOrReplacePlaylist(guildId: string, name: string, createdById: string) {
    const snapshot = this.getSnapshot(guildId);
    const playlist: Playlist = {
      name,
      createdById,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tracks: [snapshot.current, ...snapshot.upcoming].filter(Boolean) as ResolvedTrack[]
    };
    await this.store.setPlaylist(guildId, playlist);
    return playlist;
  }

  async addCurrentToPlaylist(guildId: string, name: string, createdById: string) {
    const snapshot = this.getSnapshot(guildId);
    if (!snapshot.current) {
      throw new Error("Nothing is playing right now.");
    }

    const existing = this.store.getPlaylist(guildId, name);
    const playlist: Playlist = existing ?? {
      name,
      createdById,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tracks: []
    };

    playlist.tracks.push(snapshot.current);
    playlist.updatedAt = new Date().toISOString();
    await this.store.setPlaylist(guildId, playlist);
    return playlist;
  }

  async loadPlaylist(interaction: ChatInputCommandInteraction, name: string) {
    const guildId = interaction.guildId;
    if (!guildId) {
      throw new Error("This command must be used in a server.");
    }

    const playlist = this.store.getPlaylist(guildId, name);
    if (!playlist) {
      throw new Error("That playlist does not exist.");
    }

    const guild = interaction.guild;
    if (!guild) {
      throw new Error("This command must be used in a server.");
    }

    const member = await guild.members.fetch(interaction.user.id);
    const voiceChannel = member.voice.channel;
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      throw new Error("Join a voice channel first.");
    }

    await this.assertCanControl(member, guildId);
    const player = await this.ensurePlayer(guild, voiceChannel, interaction.channelId);
    await player.enqueueMany(playlist.tracks.map((track) => ({
      ...track,
      id: `${track.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      addedAt: new Date().toISOString(),
      requestedBy: interaction.user.username,
      requestedById: interaction.user.id
    })));

    return playlist.tracks.length;
  }

  listPlaylists(guildId: string) {
    return this.store.getPlaylists(guildId);
  }

  async deletePlaylist(guildId: string, name: string) {
    await this.store.deletePlaylist(guildId, name);
  }

  getSnapshot(guildId: string): QueueSnapshot {
    const player = this.players.get(guildId);
    if (player) {
      return player.snapshot();
    }

    const settings = this.getGuildSettings(guildId);
    const persisted = this.store.getGuildPlayer(guildId);
    return {
      guildId,
      guildName: persisted?.guildName ?? this.client.guilds.cache.get(guildId)?.name ?? guildId,
      voiceChannelId: persisted?.voiceChannelId,
      textChannelId: persisted?.textChannelId,
      isPlaying: false,
      isPaused: false,
      volume: persisted?.volume ?? 75,
      autoplay: settings.autoplay,
      voteSkipEnabled: settings.voteSkipEnabled,
      permissionMode: settings.permissionMode,
      current: persisted?.current,
      previous: persisted?.history.at(-1),
      upcoming: persisted?.queue ?? []
    };
  }

  listSnapshots(): QueueSnapshot[] {
    const live = new Set(this.players.keys());
    const snapshots = [...this.players.values()].map((player) => player.snapshot());

    for (const guildId of this.client.guilds.cache.keys()) {
      if (!live.has(guildId)) {
        snapshots.push(this.getSnapshot(guildId));
      }
    }

    return snapshots;
  }

  async assertCanControl(member: GuildMember, guildId: string) {
    const settings = this.getGuildSettings(guildId);
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.guild.ownerId === member.id) {
      return;
    }

    if (settings.permissionMode === "everyone") {
      return;
    }

    if (settings.permissionMode === "admins") {
      if (member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return;
      }
      throw new Error("Only server managers can run that command here.");
    }

    if (settings.djRoleId && member.roles.cache.has(settings.djRoleId)) {
      return;
    }

    throw new Error("You need the configured DJ role to run that command.");
  }

  private async ensurePlayer(guild: Guild, voiceChannel: VoiceBasedChannel, textChannelId: string) {
    let player = this.players.get(guild.id);
    if (!player) {
      player = new GuildPlayer(guild, {
        restoredState: this.store.getGuildPlayer(guild.id),
        onStateChange: async (state) => {
          if (state) {
            await this.store.setGuildPlayer(state);
          } else {
            await this.store.deleteGuildPlayer(guild.id);
          }
        },
        onTrackFinished: async (track) => {
          const settings = this.getGuildSettings(guild.id);
          if (!settings.autoplay) {
            return null;
          }

          const seed = [track.artist, track.title].filter(Boolean).join(" - ");
          return this.resolver.resolve({
            query: `${seed} audio`,
            requestedBy: "Autoplay",
            requestedById: this.client.user?.id ?? "autoplay"
          });
        }
      });
      const settings = this.getGuildSettings(guild.id);
      player.autoplayEnabled = settings.autoplay;
      player.voteSkipEnabled = settings.voteSkipEnabled;
      player.permissionMode = settings.permissionMode;
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
