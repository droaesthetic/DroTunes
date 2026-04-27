import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message
} from "discord.js";
import { registerCommands } from "./commands.js";
import { MusicManager } from "../music/musicManager.js";
import { LavalinkService } from "../music/lavalinkService.js";
import { StateStore } from "../storage/stateStore.js";

function describeTrack(index: number, track: { title: string; artist?: string }) {
  return `${index}. ${track.title}${track.artist ? ` by ${track.artist}` : ""}`;
}

function formatQueue(snapshot: ReturnType<MusicManager["getSnapshot"]>) {
  const lines = [];

  if (snapshot.current) {
    lines.push(`Now: ${snapshot.current.title}${snapshot.current.artist ? ` by ${snapshot.current.artist}` : ""}`);
  }

  snapshot.upcoming.slice(0, 12).forEach((track, index) => {
    lines.push(describeTrack(index + 1, track));
  });

  if (!lines.length) {
    return "Queue is empty.";
  }

  return [
    `Autoplay: ${snapshot.autoplay ? "on" : "off"} | Vote skip: ${snapshot.voteSkipEnabled ? "on" : "off"} | Volume: ${snapshot.volume}%`,
    ...lines
  ].join("\n");
}

async function requireGuildMember(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.guild) {
    throw new Error("This command must be used in a server.");
  }

  return interaction.guild.members.fetch(interaction.user.id);
}

async function ensureControlAccess(interaction: ChatInputCommandInteraction, music: MusicManager) {
  const member = await requireGuildMember(interaction);
  await music.assertCanControl(member, interaction.guildId!);
  return member;
}

async function cleanBotMessages(message: Message | ChatInputCommandInteraction, amount = 50) {
  const channel = message.channel;
  if (!channel || !("messages" in channel) || channel.type !== ChannelType.GuildText) {
    throw new Error("Clean only works in text channels.");
  }

  const fetched = await channel.messages.fetch({ limit: Math.min(100, amount) });
  const botMessages = fetched.filter((entry) => entry.author.bot).first(100);

  if (!botMessages.length) {
    return 0;
  }

  await channel.bulkDelete(botMessages, true);
  return botMessages.length;
}

export async function createBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  const store = new StateStore();
  const lavalink = new LavalinkService(client);
  const music = new MusicManager(client, store, lavalink);
  await music.init();

  client.once(Events.ClientReady, async (readyClient) => {
    await registerCommands();
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      await handleSlashCommand(interaction, music);
    } catch (error) {
      console.error(`[slash:${interaction.commandName}]`, error);
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild || message.author.bot) {
      return;
    }

    const prefix = music.getPrefix(message.guild.id);
    if (!message.content.startsWith(prefix)) {
      return;
    }

    const [rawCommand, ...rest] = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase();
    const query = rest.join(" ").trim();

    try {
      switch (command) {
        case "play": {
          if (!query) throw new Error("Provide a song URL or search query.");
          const track = await music.playFromMessage(message, query);
          await message.reply(`Queued: **${track.title}**`);
          return;
        }
        case "skip":
          await music.assertCanControl(await message.guild.members.fetch(message.author.id), message.guild.id);
          await music.skip(message.guild.id);
          await message.reply("Skipped.");
          return;
        case "queue":
          await message.reply(formatQueue(music.getSnapshot(message.guild.id)));
          return;
        case "nowplaying":
        case "np": {
          const current = music.getSnapshot(message.guild.id).current;
          await message.reply(current ? `Now playing: **${current.title}**` : "Nothing is playing.");
          return;
        }
        case "pause":
          await music.assertCanControl(await message.guild.members.fetch(message.author.id), message.guild.id);
          await music.pause(message.guild.id);
          await message.reply("Paused.");
          return;
        case "resume":
          await music.assertCanControl(await message.guild.members.fetch(message.author.id), message.guild.id);
          await music.resume(message.guild.id);
          await message.reply("Resumed.");
          return;
        case "clear":
          await music.assertCanControl(await message.guild.members.fetch(message.author.id), message.guild.id);
          await music.clearQueue(message.guild.id);
          await message.reply("Queue cleared.");
          return;
      }
    } catch (error) {
      console.error(`[prefix:${command ?? "unknown"}]`, error);
      await message.reply(error instanceof Error ? error.message : "Something went wrong.");
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
  return { client, music };
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  music: MusicManager
) {
  const guildId = interaction.guildId;

  switch (interaction.commandName) {
    case "join": {
      await interaction.deferReply({ ephemeral: true });
      const voiceChannel = await music.join(interaction);
      await interaction.editReply(`Joined **${voiceChannel.name}**.`);
      return;
    }

    case "play": {
      await interaction.deferReply();
      const query = interaction.options.getString("query", true);
      const track = await music.play(interaction, query);
      await interaction.editReply(`Queued: **${track.title}**${track.artist ? ` by ${track.artist}` : ""}`);
      return;
    }

    case "pause":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.pause(guildId);
      await interaction.reply("Playback paused.");
      return;

    case "resume":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.resume(guildId);
      await interaction.reply("Playback resumed.");
      return;

    case "stop":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.stop(guildId);
      await interaction.reply("Stopped playback and disconnected.");
      return;

    case "clear":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.clearQueue(guildId);
      await interaction.reply("Queue cleared.");
      return;

    case "queue":
      if (!guildId) throw new Error("This command must be used in a server.");
      await interaction.reply(formatQueue(music.getSnapshot(guildId)));
      return;

    case "nowplaying":
      if (!guildId) throw new Error("This command must be used in a server.");
      const snapshot = music.getSnapshot(guildId);
      await interaction.reply(snapshot.current
        ? `Now playing: **${snapshot.current.title}**${snapshot.current.artist ? ` by ${snapshot.current.artist}` : ""}`
        : "Nothing is playing right now.");
      return;

    case "volume":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.setVolume(guildId, interaction.options.getInteger("percent", true));
      await interaction.reply(`Volume set to ${interaction.options.getInteger("percent", true)}%.`);
      return;

    case "skip":
      if (!guildId) throw new Error("This command must be used in a server.");
      const skipTo = interaction.options.getInteger("to", false);
      if (skipTo) {
        await ensureControlAccess(interaction, music);
        await music.skipTo(guildId, skipTo);
        await interaction.reply(`Skipping to queue position ${skipTo}.`);
        return;
      }

      const voteResult = await music.handleVoteSkip(interaction);
      await interaction.reply(voteResult.skipped
        ? "Track skipped."
        : `Vote recorded: ${voteResult.votes}/${voteResult.needed} votes.`);
      return;

    case "remove":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const removed = await music.remove(guildId, interaction.options.getInteger("index", true));
      await interaction.reply(`Removed **${removed.title}**.`);
      return;

    case "removelast":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const removedLast = await music.removeLast(guildId);
      await interaction.reply(removedLast ? `Removed **${removedLast.title}**.` : "The queue is already empty.");
      return;

    case "removeduplicates":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const duplicateCount = await music.removeDuplicates(guildId);
      await interaction.reply(`Removed ${duplicateCount} duplicate ${duplicateCount === 1 ? "track" : "tracks"}.`);
      return;

    case "removeabsent":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const absentCount = await music.removeAbsent(guildId);
      await interaction.reply(`Removed ${absentCount} queue entries from absent users.`);
      return;

    case "massremove":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const removedCount = await music.massRemove(
        guildId,
        interaction.options.getInteger("start", true),
        interaction.options.getInteger("count", true)
      );
      await interaction.reply(`Removed ${removedCount} track${removedCount === 1 ? "" : "s"} from the queue.`);
      return;

    case "previous":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.playPrevious(guildId);
      await interaction.reply("Playing the previous track.");
      return;

    case "fastforward":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.seekRelative(guildId, interaction.options.getInteger("seconds", true));
      await interaction.reply("Jumped forward.");
      return;

    case "rewind":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      await music.seekRelative(guildId, -interaction.options.getInteger("seconds", true));
      await interaction.reply("Jumped backward.");
      return;

    case "autoplay":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const autoplay = await music.updateGuildSettings(guildId, {
        autoplay: interaction.options.getBoolean("enabled", true)
      });
      await interaction.reply(`Autoplay is now ${autoplay.autoplay ? "on" : "off"}.`);
      return;

    case "voteskip":
      if (!guildId) throw new Error("This command must be used in a server.");
      await ensureControlAccess(interaction, music);
      const voteSkipEnabled = await music.toggleVoteSkip(
        guildId,
        interaction.options.getBoolean("enabled", false) ?? undefined
      );
      await interaction.reply(`Vote skip is now ${voteSkipEnabled ? "on" : "off"}.`);
      return;

    case "prefix":
      if (!guildId) throw new Error("This command must be used in a server.");
      const prefixSubcommand = interaction.options.getSubcommand();
      if (prefixSubcommand === "show") {
        await interaction.reply(`Current prefix: \`${music.getPrefix(guildId)}\``);
        return;
      }
      await ensureControlAccess(interaction, music);
      const newPrefix = interaction.options.getString("value", true);
      await music.updateGuildSettings(guildId, { prefix: newPrefix });
      await interaction.reply(`Prefix updated to \`${newPrefix}\`.`);
      return;

    case "permissions":
      if (!guildId) throw new Error("This command must be used in a server.");
      await handlePermissionsCommand(interaction, music);
      return;

    case "playlist":
      if (!guildId) throw new Error("This command must be used in a server.");
      await handlePlaylistCommand(interaction, music);
      return;

    case "clean": {
      const member = await requireGuildMember(interaction);
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        throw new Error("You need Manage Messages to clean the bot's messages.");
      }

      await interaction.deferReply({ ephemeral: true });
      const cleaned = await cleanBotMessages(interaction, interaction.options.getInteger("amount", false) ?? 50);
      await interaction.editReply(`Deleted ${cleaned} bot message${cleaned === 1 ? "" : "s"}.`);
      return;
    }
  }
}

async function handlePermissionsCommand(interaction: ChatInputCommandInteraction, music: MusicManager) {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    throw new Error("This command must be used in a server.");
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error("You need Manage Server to update music permissions.");
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "show") {
    const settings = music.getGuildSettings(guildId);
    await interaction.reply(
      `Mode: **${settings.permissionMode}**\nDJ role: ${settings.djRoleId ? `<@&${settings.djRoleId}>` : "not set"}`
    );
    return;
  }

  if (subcommand === "mode") {
    const value = interaction.options.getString("value", true) as "everyone" | "dj" | "admins";
    await music.updateGuildSettings(guildId, { permissionMode: value });
    await interaction.reply(`Permission mode set to **${value}**.`);
    return;
  }

  const role = interaction.options.getRole("role", false);
  await music.updateGuildSettings(guildId, { djRoleId: role?.id });
  await interaction.reply(role ? `DJ role set to ${role}.` : "DJ role cleared.");
}

async function handlePlaylistCommand(interaction: ChatInputCommandInteraction, music: MusicManager) {
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error("This command must be used in a server.");
  }

  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case "save": {
      await ensureControlAccess(interaction, music);
      const playlist = await music.createOrReplacePlaylist(
        guildId,
        interaction.options.getString("name", true),
        interaction.user.id
      );
      await interaction.reply(`Saved playlist **${playlist.name}** with ${playlist.tracks.length} tracks.`);
      return;
    }
    case "load": {
      await ensureControlAccess(interaction, music);
      const count = await music.loadPlaylist(interaction, interaction.options.getString("name", true));
      await interaction.reply(`Loaded ${count} track${count === 1 ? "" : "s"} into the queue.`);
      return;
    }
    case "addcurrent": {
      await ensureControlAccess(interaction, music);
      const playlist = await music.addCurrentToPlaylist(
        guildId,
        interaction.options.getString("name", true),
        interaction.user.id
      );
      await interaction.reply(`Playlist **${playlist.name}** now has ${playlist.tracks.length} tracks.`);
      return;
    }
    case "list": {
      const playlists = music.listPlaylists(guildId);
      await interaction.reply(
        playlists.length
          ? playlists.map((playlist) => `• ${playlist.name} (${playlist.tracks.length})`).join("\n")
          : "No saved playlists yet."
      );
      return;
    }
    case "delete":
      await ensureControlAccess(interaction, music);
      await music.deletePlaylist(guildId, interaction.options.getString("name", true));
      await interaction.reply("Playlist deleted.");
      return;
  }
}
