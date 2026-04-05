# Dro Tunes

Dro Tunes is a Discord music bot starter with:

- Discord slash commands
- high-quality voice playback via `@discordjs/voice`
- URL intake for YouTube, SoundCloud, Spotify, Deezer, Apple Music, Suno, and Amazon Music
- a password-protected web dashboard you can host on your own `.xyz` domain

## What "supports these links" means

- YouTube and SoundCloud links can be streamed directly.
- Spotify links are resolved to track metadata, then matched to a playable audio source.
- Deezer, Apple Music, Suno, and Amazon Music links are parsed for metadata and then matched to a playable source.

That approach keeps the bot practical while avoiding brittle direct streaming integrations for providers that do not expose stable public audio streams.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy the example env file and fill it in:

```bash
cp .env.example .env
```

3. Start in development:

```bash
npm run dev
```

4. Open the dashboard:

`http://localhost:3000`

## Slash commands

- `/play query:<url or search>`
- `/skip`
- `/pause`
- `/resume`
- `/stop`
- `/queue`
- `/nowplaying`
- `/volume percent:<1-150>`

## Dashboard hosting

Point your `.xyz` domain to the machine or host running this app, then set:

- `DASHBOARD_PUBLIC_URL=https://your-domain.xyz`
- `DASHBOARD_AUTH_TOKEN` to a long random secret

The dashboard uses a bearer token for control. Put it behind Cloudflare Access, Tailscale Funnel, Caddy basic auth, or another gate if you want an extra security layer.

## Notes on audio quality

Playback uses Discord voice at 48 kHz with Opus output from `play-dl` and `@discordjs/voice`. Final quality still depends on the source platform and Discord's own voice transport.
