import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { appConfig } from "../config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Queue a track from a URL or search query.")
    .addStringOption((option) =>
      option.setName("query").setDescription("A song URL or search terms").setRequired(true)
    ),
  new SlashCommandBuilder().setName("join").setDescription("Join your current voice channel."),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback."),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback."),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and disconnect."),
  new SlashCommandBuilder().setName("clear").setDescription("Clear the queue."),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue."),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track."),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume.")
    .addIntegerOption((option) =>
      option.setName("percent").setDescription("Volume from 1 to 150").setRequired(true).setMinValue(1).setMaxValue(150)
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track or vote skip.")
    .addIntegerOption((option) =>
      option.setName("to").setDescription("Skip directly to this queue position").setRequired(false).setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue.")
    .addIntegerOption((option) =>
      option.setName("index").setDescription("Queue position to remove").setRequired(true).setMinValue(1)
    ),
  new SlashCommandBuilder().setName("removelast").setDescription("Remove the last track in the queue."),
  new SlashCommandBuilder().setName("removeduplicates").setDescription("Remove duplicate tracks from the queue."),
  new SlashCommandBuilder().setName("removeabsent").setDescription("Remove queued tracks from users no longer in voice."),
  new SlashCommandBuilder()
    .setName("massremove")
    .setDescription("Remove a block of tracks from the queue.")
    .addIntegerOption((option) =>
      option.setName("start").setDescription("First queue position to remove").setRequired(true).setMinValue(1)
    )
    .addIntegerOption((option) =>
      option.setName("count").setDescription("How many tracks to remove").setRequired(true).setMinValue(1)
    ),
  new SlashCommandBuilder().setName("previous").setDescription("Play the previous track again."),
  new SlashCommandBuilder()
    .setName("fastforward")
    .setDescription("Jump forward in the current track.")
    .addIntegerOption((option) =>
      option.setName("seconds").setDescription("Seconds to jump").setRequired(true).setMinValue(1).setMaxValue(600)
    ),
  new SlashCommandBuilder()
    .setName("rewind")
    .setDescription("Jump backward in the current track.")
    .addIntegerOption((option) =>
      option.setName("seconds").setDescription("Seconds to jump").setRequired(true).setMinValue(1).setMaxValue(600)
    ),
  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Toggle autoplay for this guild.")
    .addBooleanOption((option) =>
      option.setName("enabled").setDescription("Whether autoplay should be enabled").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("voteskip")
    .setDescription("Toggle vote skip mode for this guild.")
    .addBooleanOption((option) =>
      option.setName("enabled").setDescription("Whether vote skip should be enabled").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("Show or update the guild prefix.")
    .addSubcommand((subcommand) =>
      subcommand.setName("show").setDescription("Show the current prefix.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set the text-command prefix.")
        .addStringOption((option) =>
          option.setName("value").setDescription("New prefix").setRequired(true).setMaxLength(5)
        )
    ),
  new SlashCommandBuilder()
    .setName("permissions")
    .setDescription("Guild-level music permissions.")
    .addSubcommand((subcommand) =>
      subcommand.setName("show").setDescription("Show current guild music permissions.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("mode")
        .setDescription("Set who can manage the player.")
        .addStringOption((option) =>
          option
            .setName("value")
            .setDescription("Permission mode")
            .setRequired(true)
            .addChoices(
              { name: "everyone", value: "everyone" },
              { name: "dj", value: "dj" },
              { name: "admins", value: "admins" }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("djrole")
        .setDescription("Set or clear the DJ role.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role allowed to control the player").setRequired(false)
        )
    ),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Manage saved playlists.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("save")
        .setDescription("Save the current queue as a playlist.")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setMaxLength(50)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("load")
        .setDescription("Load a saved playlist into the queue.")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setMaxLength(50)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("addcurrent")
        .setDescription("Add the current track to a playlist.")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setMaxLength(50)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List saved playlists for this guild.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete a saved playlist.")
        .addStringOption((option) =>
          option.setName("name").setDescription("Playlist name").setRequired(true).setMaxLength(50)
        )
    ),
  new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Delete the bot's recent messages in this channel.")
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("How many recent messages to inspect").setRequired(false).setMinValue(1).setMaxValue(100)
    )
].map((command) => command.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(appConfig.discordToken);

  if (appConfig.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(appConfig.discordClientId, appConfig.discordGuildId),
      { body: commands }
    );
    return;
  }

  await rest.put(Routes.applicationCommands(appConfig.discordClientId), { body: commands });
}
