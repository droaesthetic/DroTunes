import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MusicManager } from "../music/musicManager.js";
import { appConfig } from "../config.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const publicDir = path.resolve(currentDir, "../../static");

export function createDashboardServer(getMusic: () => MusicManager | null) {
  const app = express();
  app.use(express.json());
  const guildId = (request: express.Request) => String(request.params.guildId ?? "");

  const withMusic = (handler: (music: MusicManager, request: express.Request, response: express.Response) => void) =>
    (request: express.Request, response: express.Response) => {
      const music = getMusic();
      if (!music) {
        response.status(503).json({ error: "Bot is still starting up." });
        return;
      }

      handler(music, request, response);
    };

  app.use((request, response, next) => {
    if (
      request.path === "/" ||
      request.path === "/health" ||
      request.path.startsWith("/assets")
    ) {
      next();
      return;
    }

    const authHeader = request.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "") || request.query.token;
    if (token !== appConfig.dashboardAuthToken) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/players", withMusic((music, _request, response) => {
    response.json({
      publicUrl: appConfig.dashboardPublicUrl,
      players: music.listSnapshots()
    });
  }));

  app.post("/api/players/:guildId/pause", withMusic((music, request, response) => {
    music.pause(guildId(request));
    response.json({ ok: true });
  }));

  app.post("/api/players/:guildId/resume", withMusic((music, request, response) => {
    music.resume(guildId(request));
    response.json({ ok: true });
  }));

  app.post("/api/players/:guildId/skip", withMusic((music, request, response) => {
    music.skip(guildId(request));
    response.json({ ok: true });
  }));

  app.post("/api/players/:guildId/stop", withMusic((music, request, response) => {
    music.stop(guildId(request));
    response.json({ ok: true });
  }));

  app.post("/api/players/:guildId/volume", withMusic((music, request, response) => {
    const { percent } = request.body as { percent?: number };
    if (typeof percent !== "number") {
      response.status(400).json({ error: "percent is required" });
      return;
    }

    music.setVolume(guildId(request), percent);
    response.json({ ok: true });
  }));

  app.use("/assets", express.static(path.join(publicDir, "assets")));

  app.get("/", (_request, response) => {
    response.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
