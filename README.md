# Mixtape

A free music player for Mac, Windows and the web. Bring the library you already have and keep listening.

**[Download](https://github.com/mikec-1/mixtape-desktop/releases/latest)** · **[Open in your browser](https://mixtaped.tech)**

## What it does

- **Imports your library.** Sign in to Spotify and pull in everything, or drop in a CSV export from Spotify, Apple Music or Deezer. Songs are matched and stream through YouTube Music.
- **Plays your own files.** Drag audio files onto the window. Tags and artwork are filled in from Apple Music, and you can edit anything.
- **Synced lyrics**, a mini player, offline downloads, Last.fm scrobbling and Discord status.
- **Listening history**, charts, new releases and a yearly recap.
- **A Mixtape account** (optional) keeps your library and history in sync across devices.

## Installing

**Mac (Apple silicon):** open the `.dmg` and drag Mixtape to Applications. The app isn't notarized yet, so the first time, right-click it and choose **Open**, or allow it in System Settings → Privacy & Security.

**Windows:** run the `-setup.exe`. If SmartScreen appears, choose **More info → Run anyway**.

The app updates itself: it asks before downloading a new version.

There's no Intel Mac build yet.

## Building it yourself

You need Node 22, pnpm and Rust.

```bash
pnpm install
pnpm tauri dev
```

Some features need keys in a `.env` file: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for accounts, `VITE_LASTFM_KEY` and `VITE_LASTFM_SECRET` for scrobbling, and `DISCORD_CLIENT_ID` for Discord status. The player works without them.

`pnpm tauri build` makes an installer for the platform you're on. Releases are built by GitHub Actions when a `v*` tag is pushed.

Built with Tauri 2, React, TypeScript and Rust.

## License

All rights reserved. The code is here to read, not to reuse. See [LICENSE](LICENSE).
