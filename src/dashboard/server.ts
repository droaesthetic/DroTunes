import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MusicManager } from "../music/musicManager.js";
import { appConfig } from "../config.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const publicDir = path.resolve(currentDir, "../../static");

export function createDashboardServer(music: MusicManager) {
  const app = express();
  app.use(express.json());

  app.use((request, response, next) => {
    if (request.path === "/health" || request.path.startsWith("/assets")) {
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

  app.get("/api/players", (_request, response) => {
    response.json({
      publicUrl: appConfig.dashboardPublicUrl,
      players: music.listSnapshots()
    });
  });

  app.post("/api/players/:guildId/pause", (request, response) => {
    music.pause(request.params.guildId);
    response.json({ ok: true });
  });

  app.post("/api/players/:guildId/resume", (request, response) => {
    music.resume(request.params.guildId);
    response.json({ ok: true });
  });

  app.post("/api/players/:guildId/skip", (request, response) => {
    music.skip(request.params.guildId);
    response.json({ ok: true });
  });

  app.post("/api/players/:guildId/stop", (request, response) => {
    music.stop(request.params.guildId);
    response.json({ ok: true });
  });

  app.post("/api/players/:guildId/volume", (request, response) => {
    const { percent } = request.body as { percent?: number };
    if (typeof percent !== "number") {
      response.status(400).json({ error: "percent is required" });
      return;
    }

    music.setVolume(request.params.guildId, percent);
    response.json({ ok: true });
  });

  app.use("/assets", express.static(path.join(publicDir, "assets")));

  app.get("/", (_request, response) => {
    response.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
