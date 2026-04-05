export type Provider =
  | "youtube"
  | "soundcloud"
  | "spotify"
  | "deezer"
  | "apple_music"
  | "suno"
  | "amazon_music"
  | "search";

export interface ResolvedTrack {
  title: string;
  artist?: string;
  url: string;
  artwork?: string;
  durationInSeconds?: number;
  requestedBy: string;
  sourceProvider: Provider;
  playbackProvider: "youtube" | "soundcloud";
  playbackUrl: string;
}

export interface QueueSnapshot {
  guildId: string;
  guildName: string;
  voiceChannelId?: string;
  textChannelId?: string;
  isPlaying: boolean;
  isPaused: boolean;
  volume: number;
  current?: ResolvedTrack;
  upcoming: ResolvedTrack[];
}
