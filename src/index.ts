import { createBot } from "./bot/createBot.js";
import { createDashboardServer } from "./dashboard/server.js";
import { appConfig } from "./config.js";
import type { MusicManager } from "./music/musicManager.js";

async function main() {
  let music: MusicManager | null = null;
  const app = createDashboardServer(() => music);

  app.listen(appConfig.dashboardPort, () => {
    console.log(`Dashboard listening on ${appConfig.dashboardPublicUrl}`);
  });

  const bot = await createBot();
  music = bot.music;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
