import play from "play-dl";
import { fetch } from "undici";
import type { Provider, ResolvedTrack } from "../types.js";

interface ResolveOptions {
  query: string;
  requestedBy: string;
}

const providerMatchers: Array<{ provider: Provider; regex: RegExp }> = [
  { provider: "youtube", regex: /(?:youtube\.com|youtu\.be)/i },
  { provider: "soundcloud", regex: /soundcloud\.com/i },
  { provider: "spotify", regex: /spotify\.com/i },
  { provider: "deezer", regex: /deezer\.com/i },
  { provider: "apple_music", regex: /music\.apple\.com/i },
  { provider: "suno", regex: /suno\.com/i },
  { provider: "amazon_music", regex: /music\.amazon\./i }
];

export class ProviderResolver {
  async resolve({ query, requestedBy }: ResolveOptions): Promise<ResolvedTrack> {
    const provider = this.detectProvider(query);

    if (provider === "search") {
      return this.resolveSearch(query, requestedBy);
    }

    if (provider === "youtube") {
      return this.resolveYouTube(query, requestedBy);
    }

    if (provider === "soundcloud") {
      return this.resolveSoundCloud(query, requestedBy);
    }

    const metadata = await this.resolveMetadataFromUrl(query, provider);
    const searchQuery = [metadata.artist, metadata.title].filter(Boolean).join(" - ");
    const playback = await this.findPlayableAlternative(searchQuery || query);

    return {
      title: metadata.title ?? playback.title ?? "Unknown title",
      artist: metadata.artist,
      url: query,
      artwork: metadata.artwork ?? playback.artwork,
      durationInSeconds: metadata.durationInSeconds ?? playback.durationInSeconds,
      requestedBy,
      sourceProvider: provider,
      playbackProvider: playback.playbackProvider,
      playbackUrl: playback.playbackUrl
    };
  }

  detectProvider(query: string): Provider {
    for (const matcher of providerMatchers) {
      if (matcher.regex.test(query)) {
        return matcher.provider;
      }
    }

    return "search";
  }

  private async resolveSearch(query: string, requestedBy: string): Promise<ResolvedTrack> {
    const playback = await this.findPlayableAlternative(query);
    return {
      ...playback,
      url: query,
      requestedBy,
      sourceProvider: "search"
    };
  }

  private async resolveYouTube(url: string, requestedBy: string): Promise<ResolvedTrack> {
    const video = await play.video_info(url);
    return {
      title: video.video_details.title ?? "Unknown title",
      artist: video.video_details.channel?.name,
      url,
      artwork: video.video_details.thumbnails?.at(-1)?.url,
      durationInSeconds: Number(video.video_details.durationInSec) || undefined,
      requestedBy,
      sourceProvider: "youtube",
      playbackProvider: "youtube",
      playbackUrl: url
    };
  }

  private async resolveSoundCloud(url: string, requestedBy: string): Promise<ResolvedTrack> {
    const track = await play.soundcloud(url);
    return {
      title: track.name,
      artist: track.user?.name,
      url,
      artwork: "thumbnail" in track ? track.thumbnail : undefined,
      durationInSeconds: track.durationInSec,
      requestedBy,
      sourceProvider: "soundcloud",
      playbackProvider: "soundcloud",
      playbackUrl: url
    };
  }

  private async resolveMetadataFromUrl(url: string, provider: Provider) {
    const response = await fetch(url, {
      headers: {
        "user-agent": "DroTunesBot/0.1 (+dashboard resolver)"
      }
    });

    const html = await response.text();
    const title = this.readMeta(html, "og:title") ?? this.readTitleTag(html);
    const artwork = this.readMeta(html, "og:image");
    const durationText = this.readMeta(html, "music:duration");
    const artist = this.guessArtist(title);

    return {
      title: this.cleanProviderDecorations(title, provider),
      artist,
      artwork,
      durationInSeconds: durationText ? Number(durationText) || undefined : undefined
    };
  }

  private async findPlayableAlternative(query: string) {
    const [video] = await play.search(query, { limit: 1 });
    if (video) {
      return {
        title: video.title ?? "Unknown title",
        artist: video.channel?.name,
        artwork: video.thumbnails?.at(-1)?.url,
        durationInSeconds: video.durationInSec,
        playbackProvider: "youtube" as const,
        playbackUrl: video.url
      };
    }

    const soundCloudResults = await play.search(query, { source: { soundcloud: "tracks" }, limit: 1 });
    const first = soundCloudResults[0];

    if (!first) {
      throw new Error("No playable match found for that link.");
    }

    return {
      title: first.name ?? "Unknown title",
      artist: first.user?.name,
      artwork: first.thumbnail,
      durationInSeconds: first.durationInSec,
      playbackProvider: "soundcloud" as const,
      playbackUrl: first.url
    };
  }

  private readMeta(html: string, property: string): string | undefined {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
      new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.decodeEntities(match[1].trim());
      }
    }

    return undefined;
  }

  private readTitleTag(html: string): string | undefined {
    const match = html.match(/<title>([^<]+)<\/title>/i);
    return match?.[1] ? this.decodeEntities(match[1].trim()) : undefined;
  }

  private cleanProviderDecorations(value: string | undefined, provider: Provider): string | undefined {
    if (!value) {
      return value;
    }

    const cleaned = value
      .replace(/\s*\|\s*Spotify.*$/i, "")
      .replace(/\s*\|\s*Deezer.*$/i, "")
      .replace(/\s*\|\s*Amazon Music.*$/i, "")
      .replace(/\s*on Apple Music$/i, "")
      .replace(/\s*-\s*Suno$/i, "")
      .replace(/\s*-\s*YouTube$/i, "");

    if (provider === "suno") {
      return cleaned.replace(/^Listen to\s+/i, "");
    }

    return cleaned;
  }

  private guessArtist(title: string | undefined): string | undefined {
    if (!title) {
      return undefined;
    }

    const parts = title.split(" - ");
    return parts.length > 1 ? parts[0].trim() : undefined;
  }

  private decodeEntities(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
}
