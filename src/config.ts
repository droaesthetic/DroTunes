import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  PORT: z.coerce.number().optional(),
  DASHBOARD_PORT: z.coerce.number().optional(),
  DASHBOARD_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  DASHBOARD_AUTH_TOKEN: z.string().min(16),
  BOT_OWNERS: z.string().default(""),
  DEFAULT_VOLUME: z.coerce.number().min(1).max(150).default(75),
  MAX_QUEUE_SIZE: z.coerce.number().min(1).max(500).default(100)
});

const parsed = schema.parse(process.env);

export const appConfig = {
  discordToken: parsed.DISCORD_TOKEN,
  discordClientId: parsed.DISCORD_CLIENT_ID,
  discordGuildId: parsed.DISCORD_GUILD_ID,
  dashboardPort: parsed.PORT ?? parsed.DASHBOARD_PORT ?? 3000,
  dashboardPublicUrl: parsed.DASHBOARD_PUBLIC_URL,
  dashboardAuthToken: parsed.DASHBOARD_AUTH_TOKEN,
  botOwners: parsed.BOT_OWNERS.split(",").map((value) => value.trim()).filter(Boolean),
  defaultVolume: parsed.DEFAULT_VOLUME,
  maxQueueSize: parsed.MAX_QUEUE_SIZE
};
