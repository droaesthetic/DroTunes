import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ChatInputCommandInteraction
} from "discord.js";
import { appConfig } from "../config.js";
import { registerCommands } from "./commands.js";
import { MusicManager } from "../music/musicManager.js";

function formatQueue(snapshot: ReturnType<MusicManager["getSnapshot"]>) {
  const lines = snapshot.upcoming.slice(0, 10).map((track, index) => {
    const by = track.artist ? ` by ${track.artist}` : "";
    return `${index + 1}. ${track.title}${by}`;
  });

  if (!lines.length) {
    return "Queue is empty.";
  }

  return lines.join("\n");
}

export async function createBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel]
  });

  const music = new MusicManager(client);

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
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  });

  await client.login(appConfig.discordToken);
  return { client, music };
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  music: MusicManager
) {
  const guildId = interaction.guildId;

  switch (interaction.commandName) {
    case "play": {
      await interaction.deferReply();
      const query = interaction.options.getString("query", true);
      const track = await music.play(interaction, query);
      await interaction.editReply(
        `Queued: **${track.title}**${track.artist ? ` by ${track.artist}` : ""}`
      );
      return;
    }

    case "skip": {
      if (!guildId) throw new Error("This command must be used in a server.");
      music.skip(guildId);
      await interaction.reply("Skipped the current track.");
      return;
    }

    case "pause": {
      if (!guildId) throw new Error("This command must be used in a server.");
      music.pause(guildId);
      await interaction.reply("Playback paused.");
      return;
    }

    case "resume": {
      if (!guildId) throw new Error("This command must be used in a server.");
      music.resume(guildId);
      await interaction.reply("Playback resumed.");
      return;
    }

    case "stop": {
      if (!guildId) throw new Error("This command must be used in a server.");
      music.stop(guildId);
      await interaction.reply("Stopped playback and cleared the queue.");
      return;
    }

    case "queue": {
      if (!guildId) throw new Error("This command must be used in a server.");
      const snapshot = music.getSnapshot(guildId);
      await interaction.reply(formatQueue(snapshot));
      return;
    }

    case "nowplaying": {
      if (!guildId) throw new Error("This command must be used in a server.");
      const snapshot = music.getSnapshot(guildId);
      if (!snapshot.current) {
        await interaction.reply("Nothing is playing right now.");
        return;
      }

      await interaction.reply(
        `Now playing: **${snapshot.current.title}**${
          snapshot.current.artist ? ` by ${snapshot.current.artist}` : ""
        }`
      );
      return;
    }

    case "volume": {
      if (!guildId) throw new Error("This command must be used in a server.");
      const percent = interaction.options.getInteger("percent", true);
      music.setVolume(guildId, percent);
      await interaction.reply(`Volume set to ${percent}%.`);
      return;
    }
  }
}
