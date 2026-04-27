import type { Client } from "discord.js";
import { Connectors, LoadType, Shoukaku, type NodeOption, type Player, type Track } from "shoukaku";
import { appConfig } from "../config.js";

export class LavalinkService {
  readonly manager: Shoukaku;

  constructor(client: Client) {
    const nodes: NodeOption[] = [{
      ...appConfig.lavalink,
      // Force plain HTTP/WS for this node unless you intentionally change the code.
      secure: false
    }];
    this.manager = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
      resume: true,
      resumeTimeout: 30,
      reconnectTries: 3,
      reconnectInterval: 5_000,
      restTimeout: 10_000
    });

    this.manager.on("ready", (name, resumed) => {
      console.log(`[lavalink:${name}] ready resumed=${resumed}`);
    });

    this.manager.on("error", (name, error) => {
      console.error(`[lavalink:${name}] error`, error);
    });

    this.manager.on("close", (name, code, reason) => {
      console.error(`[lavalink:${name}] closed code=${code} reason=${reason}`);
    });
  }

  async join(guildId: string, channelId: string, shardId: number) {
    return this.manager.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: true
    });
  }

  async leave(guildId: string) {
    await this.manager.leaveVoiceChannel(guildId);
  }

  async resolve(identifier: string): Promise<Track> {
    const node = this.manager.getIdealNode();
    if (!node) {
      throw new Error("No Lavalink node is currently available.");
    }

    const response = await node.rest.resolve(identifier);
    if (!response) {
      throw new Error("Lavalink did not return a track response.");
    }

    switch (response.loadType) {
      case LoadType.TRACK:
        return response.data;
      case LoadType.SEARCH:
        if (!response.data.length) {
          throw new Error("Lavalink search returned no tracks.");
        }
        return response.data[0];
      case LoadType.PLAYLIST:
        if (!response.data.tracks.length) {
          throw new Error("Lavalink playlist returned no tracks.");
        }
        return response.data.tracks[
          response.data.info.selectedTrack >= 0 ? response.data.info.selectedTrack : 0
        ];
      default:
        throw new Error("Lavalink could not resolve a playable track for that input.");
    }
  }

  async play(player: Player, encoded: string, volume: number, positionMs = 0) {
    await player.playTrack({
      track: { encoded },
      volume,
      position: positionMs
    });
  }
}
