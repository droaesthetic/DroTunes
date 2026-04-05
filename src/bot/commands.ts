import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { appConfig } from "../config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Queue a track from a URL or search query.")
    .addStringOption((option) =>
      option.setName("query").setDescription("A song URL or search terms").setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track."),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback."),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback."),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue."),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue."),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track."),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume.")
    .addIntegerOption((option) =>
      option
        .setName("percent")
        .setDescription("Volume from 1 to 150")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(150)
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
