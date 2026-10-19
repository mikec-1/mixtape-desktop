# Sleeve roadmap

Goal: everything Spotify does, free, on macOS, Windows and the web first (mobile after), plus ideas Spotify doesn't have. Snappiness and the look (v1's colour and big display headers in a compact frame: a resizable sidebar that collapses to an icon rail, one rounded content card, player bar; colour pulled from the artwork; fun and familiar, not sterile) come first in every phase.

Size: **S** ≈ a day · **M** ≈ a few days · **L** ≈ a week or more.

## Where it stands (Oct 2026)

Done: compact layout (sidebar with Home, Search, Library and Settings that collapses to an icon rail (⌘B) and resizes by dragging its edge; one rounded content card with a Back pill; player bar with an artwork-colour wash; system font, SF Pro on Mac), search (songs + top artist, Browse All genres), Home (YT Music shelves), artist, album and playlist pages, Now Playing sheet, docked player bar with artwork accent colour, queue panel with drag to reorder, shuffle and Smart Shuffle, repeat, song, artist and playlist radio, autoplay radio, gapless playback and crossfade, volume normalisation, audio quality, equalizer, mini player, sleep timer, playback that resumes where it left off, likes, saved albums, your own playlists (create, rename, delete, add and remove tracks), undoable toasts, media keys, accessibility pass, lyrics (synced and word by word, in Now Playing, full screen and on the player bar, with translation and romanisation).

Missing: everything below. Notable gaps today: the macOS window buttons don't sit inside the sidebar card yet, macOS only tested, no web build.

---

## Phase 1: Foundations
Done first, because everything else builds on them.

- [x] **Library to IndexedDB.** No 5 MB cap, no new dependency, and it works in the web build. Existing libraries migrate on their first write. Move to per-row SQLite if imports reach ~100k tracks. **M**
- [x] **Dark mode** following the system, or forced light/dark in Settings. **M**
- [x] **Offline and error states.** Offline banner; Home and Search retry on reconnect; Home has a Try Again button and draws last launch's feed instantly. **S**
- [x] **Keyboard shortcuts:** ⌘K/⌘F search, ⌘1–3 tabs, ⌘N new playlist, ⌘L like, ⌘←/→ previous/next, ⌘↑/↓ volume, ←/→ seek 5 s, Space, Esc. A full command palette waits until there are enough commands to need one. **S**
- [x] **Settings page** (in the rail, ⌘,): panes like System Settings; theme and colour picked from live previews, library counts with export and restore, shortcut list, version. Later phases add their sections to it (Phase 7). **S**
- [x] **Smoke test:** `node scripts/yt-check.mjs` checks search, Home, Explore, an artist page, an album and a full stream download. **S**

## Phase 2: Playback (Spotify parity)
- [x] Queue: Play Next, Add to Queue, view, drag to reorder, clear. **M**
- [x] Shuffle (⌘S), repeat all and repeat one (⌘R). **S**
- [x] Smart Shuffle (press Shuffle again): one recommended track after every three of yours, marked with a sparkle. **S**
- [x] **Instant skip:** fetch the next track's stream while this one plays, and cache stream URLs. **M**
- [x] Gapless playback and crossfade (0–12 s): the next track buffers in a second player. **M**
- [x] Volume normalisation and an audio quality setting. **S**
- [x] Autoplay radio when the queue ends, and Start Radio from any song (YT Music "watch next"). **M**
- [x] Artist, album and playlist radio (the Radio button by Shuffle). **S**
- [x] Remember the queue, position and volume between launches. **S**
- [x] Sleep timer: 15–60 minutes or end of track. **S**
- [x] Equalizer (Web Audio, with presets). **M**
- [x] Mini player window (always-on-top Tauri window). **M**

## Phase 3: Lyrics
- [x] **Synced lyrics** in Now Playing: the current line is highlighted and auto-scrolls, and clicking a line seeks to it. Source: LRCLIB (free, synced), falling back to YT Music's plain lyrics. **M**
- [x] A full-screen lyrics view with the artwork-colour background. **S**
- [x] A lyrics peek line on the player bar. **S**
- [x] *Ours:* translation and romanisation toggles for non-English lyrics (Google Translate's free endpoints). **M**
- [x] *Ours:* word-by-word karaoke highlighting: real timings where enhanced LRC or LRCLIB's word-synced Lyricsfile has them, and on every other synced song an estimate from each line's timing, weighted by syllables (Settings can limit it to real timings). **M**
- [ ] *Ours:* real word timings for any song by aligning the lyrics to the audio on device, so the estimate is only a fallback. **L**

## Phase 4: Library and playlists (Spotify parity)
- [ ] Library filters (~~Playlists / Albums~~ done; Artists / Songs), sort, search inside, grid and list views, pinning. **M**
- [ ] Follow artists. Followed artists drive Release Radar. **S**
- [ ] Playlist editing: drag to reorder, description, custom cover image, sort, duplicate, folders. **M**
- [ ] Recently played and listening history (stored locally). **S**
- [ ] Hide a song, and "don't play this artist". **S**
- [ ] Local files: add folders, read tags, play them alongside streamed tracks. **L**
- [ ] Offline downloads for playlists and albums (encrypted cache in app data). **L**

## Phase 5: Importing
- [ ] **Stable track identity:** store ISRC, title, artists and duration seconds with each track for matching. **S**
- [ ] **Matching engine:** source track → YT Music search, scored on ISRC, title, artist and duration. Low-confidence matches go to review. **L**
- [ ] Import review screen: matched, unsure (choose from the top 3), not found. Re-run matching anytime. **M**
- [ ] Spotify: sign in with OAuth (PKCE), then import playlists, Liked Songs, saved albums and followed artists. Public playlist links work without signing in. **M**
- [ ] Apple Music: share links, plus Library.xml / exported playlists. **M**
- [ ] Deezer: public API with playlist links, plus OAuth for the user's library. **S**
- [ ] YouTube Music: sign in and pull the user's own library and history. **M**
- [ ] CSV / Exportify / TuneMyMusic files. **S**
- [ ] *Ours:* **live sync**, so a linked Spotify playlist keeps updating in Sleeve. **M**

## Phase 6: Accounts and sync
- [ ] Sleeve accounts. Recommended backend: **Supabase** (auth + Postgres + realtime, free tier). **M**
- [ ] Sign up and log in: email magic link, Google, Apple. "Continue without an account" stays fully usable. **M**
- [ ] Onboarding: sign in or skip, pick a few artists, offer an import. **M**
- [ ] Library sync across Mac, Windows and web: local-first, synced in the background, with merge rules for edits made offline. **L**
- [ ] Profile: name, avatar, public playlists, a share link. **S**
- [ ] Delete account and export data. **S**

## Phase 7: Settings
The page and its first sections exist (Phase 1). These fill it in as each feature lands.

- [ ] **Account:** profile, linked services (Spotify, YT Music, Deezer, Last.fm), sign out, delete. **M**
- [ ] **Playback:** ~~quality, crossfade, normalisation, EQ~~ (done); autoplay on or off. **S**
- [ ] **Appearance:** ~~light, dark or system; accent from artwork on or off~~ (done); reduce motion; UI zoom. **S**
- [ ] **Library:** ~~export, restore~~ (done); local folders, storage and cache size, import history. **S**
- [ ] **Lyrics:** ~~translation language, the player bar line, word by word on every song~~ (done); source. **S**
- [ ] **Privacy:** private session, listening history on or off, crash reports on or off. **S**
- [ ] **Shortcuts:** ~~list~~ (done); remap. **S**
- [ ] **Startup:** launch at login, open minimised, close to tray. **S**
- [ ] **About:** ~~version~~ (done); check for updates, licences. **S**

## Phase 8: Discovery (Spotify parity)
- [ ] Search: tabs for Songs, Albums, Artists, Playlists and Videos; recent searches; suggestions as you type. **M**
- [ ] Artist pages: full discography, singles and EPs, "Fans also like", about/bio, appears on. **M**
- [ ] Made-for-you mixes, built from history and likes plus YT Music recommendations: Daily Mixes, Discover Weekly, Release Radar, On Repeat, Time Capsule. **L**
- [ ] Charts and new releases per country. **S**
- [ ] Notifications for new releases from followed artists. **S**

## Phase 9: Social (Spotify parity)
- [ ] Share a track, album or playlist as a link that opens in the web app. **M**
- [ ] Collaborative playlists. Needs accounts. **M**
- [ ] Friends and friend activity. **M**
- [ ] **Jam:** a shared live queue that friends join with a link. **L**
- [ ] Blend: a combined playlist from two people's tastes. **M**
- [ ] Connect-style remote: control the desktop app from the web or phone. **L**

## Phase 10: Our own ideas
Things Spotify doesn't do, or does behind a paywall.

- [ ] **Video mode:** YouTube has the music video for most songs. Flip Now Playing between artwork and video, like Canvas but real. **M**
- [ ] **Liner notes:** credits (writers, producers), samples, and the story of the song (Wikipedia / Genius), shown as a scrolling editorial page next to the artwork. **M**
- [ ] **Wrapped anytime:** your stats for any week, month or year, as shareable cards. **M**
- [ ] **Mixtape links:** share a playlist as a designed web page with a cover, notes and playable tracks. **M**
- [ ] **Smart transitions:** crossfade length chosen from the songs' BPM and key, DJ-style. **L**
- [ ] **Time machine:** "what you were listening to on this day" a year ago. **S**
- [ ] **Scrobbling** to Last.fm / ListenBrainz, and Discord Rich Presence. **S**
- [ ] **Mood and focus sessions:** endless radio seeded by a vibe, with no repeats inside a session. **M**
- [ ] **Everything Premium has, free:** no ads, unlimited skips, any track on demand, downloads, lyrics.

## Phase 11: Shipping
- [ ] Windows build and polish (Mica/acrylic instead of macOS glass, its own titlebar controls). **M**
- [ ] **Web app.** The browser can't call YouTube directly (CORS, PO tokens), so it needs a small proxy server. This is the biggest open question for web. **L**
- [ ] Auto-updates (`tauri-plugin-updater`) with a release channel. **S**
- [ ] Code signing: Apple Developer ID and notarisation ($99/yr), Windows signing certificate. **S**
- [ ] App icon, DMG and installer art, landing page at sleeve.fun. **M**
- [ ] Crash reporting (opt-in) and a feedback button. **S**
- [ ] Performance budget: cold start under 1 s, view switch under 100 ms, skip under 300 ms. Measure every release. **S**
- [ ] Localisation (start with English plus 3–4 languages). **M**

## Later: mobile
- [ ] iOS and Android via Tauri mobile: background audio, lock-screen controls, CarPlay / Android Auto. **L**

---

## Decisions to make
1. **Account backend:** Supabase (recommended) or our own server. This also hosts the web proxy and share pages.
2. **Web app in v1, or desktop first?** Web needs the proxy server running and paid for.
3. **What v1 means:** suggested cut is phases 1–3 + 5 + 6 + 7 + Windows. Social, mixes and our own ideas follow in 1.x releases.
4. **Podcasts and audiobooks:** skip (suggested). YouTube has podcasts, so this can come later.
