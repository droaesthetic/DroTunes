import { createBot } from "./bot/createBot.js";
import { createDashboardServer } from "./dashboard/server.js";
import { appConfig } from "./config.js";

async function main() {
  const { music } = await createBot();
  const app = createDashboardServer(music);

  app.listen(appConfig.dashboardPort, () => {
    console.log(`Dashboard listening on ${appConfig.dashboardPublicUrl}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
