export type Provider =
  | "youtube"
  | "soundcloud"
  | "spotify"
  | "deezer"
  | "apple_music"
  | "suno"
  | "amazon_music"
  | "search";

export type PermissionMode = "everyone" | "dj" | "admins";

export interface ResolvedTrack {
  id: string;
  title: string;
  artist?: string;
  url: string;
  artwork?: string;
  durationInSeconds?: number;
  requestedBy: string;
  requestedById: string;
  sourceProvider: Provider;
  playbackProvider: "youtube" | "soundcloud";
  playbackUrl: string;
  addedAt: string;
}

export interface GuildSettings {
  guildId: string;
  prefix: string;
  autoplay: boolean;
  voteSkipEnabled: boolean;
  permissionMode: PermissionMode;
  djRoleId?: string;
}

export interface Playlist {
  name: string;
  tracks: ResolvedTrack[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredGuildPlayerState {
  guildId: string;
  guildName: string;
  voiceChannelId?: string;
  textChannelId?: string;
  volume: number;
  current?: ResolvedTrack;
  queue: ResolvedTrack[];
  history: ResolvedTrack[];
}

export interface QueueSnapshot {
  guildId: string;
  guildName: string;
  voiceChannelId?: string;
  textChannelId?: string;
  isPlaying: boolean;
  isPaused: boolean;
  volume: number;
  autoplay: boolean;
  voteSkipEnabled: boolean;
  permissionMode: PermissionMode;
  current?: ResolvedTrack;
  previous?: ResolvedTrack;
  upcoming: ResolvedTrack[];
}

export interface AppState {
  guildSettings: Record<string, GuildSettings>;
  guildPlayers: Record<string, StoredGuildPlayerState>;
  playlists: Record<string, Record<string, Playlist>>;
}
