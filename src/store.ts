import { useSyncExternalStore } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { art, details, fetchAudio, playAudio, radio, SEP, type Album, type Artist, type Quality, type Track } from "./yt";
import { clearDiscordRpc, sendNowPlaying, sendScrobble } from "./scrobble";

type Root = "home" | "search" | "library" | "settings";
// "playlist" is one of yours; id "liked" is Liked Songs. "collection" is an album or playlist on YouTube Music.
// "shared" is someone's public playlist (id "<owner>/<playlist>"), "profile" someone's profile (account.ts).
export type View =
  | { name: Root | "history" | "local" | "charts" | "releases" | "wrapped" }
  | { name: "artist" | "collection" | "playlist" | "folder" | "shared" | "profile"; id: string }
  | { name: "discography"; id: string; params?: string; artist?: string };

type State = {
  stack: View[];
  ahead: View[]; // what Back left, for Forward
  sheet?: "playing" | "lyrics"; // the full-screen sheet over everything but the player bar: Now Playing, or just the lyrics
  dialog?: Dialog;
  pane?: string; // the Settings pane showing
  query: string; // the search field
  queue: Track[]; // what's been played, the current track, then Up Next
  index: number;
  added: number; // how many after the current track you queued yourself; Add to Queue goes after them
  original?: Track[]; // the queue's order before Shuffle, to put back
  shuffle: boolean | "smart"; // Smart Shuffle mixes recommended tracks (rec) into Up Next
  repeat: "off" | "all" | "one";
  sleep?: number | "track"; // when the sleep timer pauses: a time, or the end of this track
  loading: boolean;
  error: string;
  toast?: Toast;
};
// A modal over everything: the lyrics editor (for a song, by its key in lyrics.ts useMine; track when it's
// one Sleeve knows, to stamp times with while it plays), or a lyric card of the playing song.
export type Dialog = { kind: "edit"; key: string; title: string; artist: string; text: string; track?: Track } | { kind: "card"; track: Track; pick: number[] };
// Feedback for a library change: what happened, to what, and a way back.
export type Toast = { id: number; text: string; detail?: string; thumb?: string; undo?: () => void };

// The queue and modes survive a relaunch; where you were in the track is in localStorage.resume.
export const useStore = create<State>()(
  persist(
    (): State => ({ stack: [{ name: "home" }], ahead: [], query: "", queue: [], index: -1, added: 0, shuffle: false, repeat: "off", loading: false, error: "" }),
    { name: "player", partialize: ({ queue, index, added, original, shuffle, repeat }) => ({ queue, index, added, original, shuffle, repeat }) },
  ),
);
const { setState: set, getState: get } = useStore;

export const open = (view: View) => {
  const key = viewKey(view);
  if (key) touch(key); // opening something counts as using it, for the Library's Recents order
  set((s) => ({ stack: [...s.stack, view], ahead: [], sheet: undefined }));
};
// The library key of a page's subject (libraryKey), if it can be in your library.
export const viewKey = (v: View) =>
  !("id" in v) ? (v.name === "local" ? libraryKey("local") : undefined)
  : v.name === "shared" || v.name === "profile" || v.name === "discography" ? undefined
  : v.name === "collection" ? libraryKey("album", v.id) : v.id === "liked" ? libraryKey("liked") : libraryKey(v.name, v.id);
export const back = () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1), ahead: [s.stack.at(-1)!, ...s.ahead] } : s));
export const forward = () => set((s) => (s.ahead.length ? { stack: [...s.stack, s.ahead[0]], ahead: s.ahead.slice(1) } : s));
export const go = (name: Root) => set({ stack: [{ name }], ahead: [], sheet: undefined });
// Opens that sheet, or closes it if it's the one showing.
export const toggleSheet = (sheet: State["sheet"]) => set((s) => ({ sheet: s.sheet === sheet ? undefined : sheet }));
export const report = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Playback error:", e);
  notify({ text: "Playback Error", detail: msg });
  set({ error: msg, loading: false });
};

// Your library, in IndexedDB: no 5 MB cap like localStorage, and the same code runs in the web build.
// ponytail: the whole library is rewritten on every change; per-row SQLite if imports reach ~100k tracks.
// plays is the listening history, one row a play (keys count up, so newest last), appended without
// rewriting the rest.
const db = new Promise<IDBDatabase>((ok, fail) => {
  const r = indexedDB.open("sleeve", 2);
  r.onupgradeneeded = () => {
    if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv");
    if (!r.result.objectStoreNames.contains("plays")) r.result.createObjectStore("plays", { autoIncrement: true });
  };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const kv = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = "kv") =>
  db.then((d) => new Promise<T>((ok, fail) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }));
// Lyrics found online are kept here too (lyrics.ts), one entry a song.
export const idbGet = <T,>(key: string) => kv<T | undefined>("readonly", (s) => s.get(key));
export const idbPut = (key: string, value: unknown) => kv("readwrite", (s) => s.put(value, key));
const range = (prefix: string) => IDBKeyRange.bound(prefix, prefix + "\uffff");
export const idbKeys = (prefix: string) => kv<IDBValidKey[]>("readonly", (s) => s.getAllKeys(range(prefix)));
export const idbDelete = (prefix: string) => kv("readwrite", (s) => s.delete(range(prefix)));
export const idb: StateStorage = {
  // Libraries saved before the move are still in localStorage until their first write here.
  getItem: async (k) => (await kv<string | undefined>("readonly", (s) => s.get(k))) ?? localStorage.getItem(k),
  setItem: (k, v) => kv("readwrite", (s) => s.put(v, k)).then(() => localStorage.removeItem(k)),
  removeItem: (k) => kv("readwrite", (s) => s.delete(k)).then(() => {}),
};

// about, cover (a data URL, the image you picked) and sort (how its page lists the songs) are yours to
// set; folder is the folder it's in. public: anyone with its link can see it (account.ts).
export type Playlist = { id: string; name: string; tracks: Track[]; about?: string; cover?: string; folder?: string; sort?: TrackSort; public?: boolean; at?: number };
export type TrackSort = "custom" | "title" | "artist" | "album" | "added" | "duration";
export type Folder = { id: string; name: string; at?: number };
export type Followed = { id: string; name: string; thumb?: string; at?: number };
// pinned holds library keys (libraryKey), newest pin first. hidden songs and blocked artists are
// skipped wherever a queue moves on by itself, and left out of radio.
export type Library = { liked: Track[]; saved: Album[]; playlists: Playlist[]; followed: Followed[]; folders: Folder[]; pinned: string[]; hidden: Track[]; blocked: (Artist & { at?: number })[] };
const empty = (): Library => ({ liked: [], saved: [], playlists: [], followed: [], folders: [], pinned: [], hidden: [], blocked: [] });
export const useLibrary = create<Library>()(persist(empty, { name: "library", storage: createJSONStorage(() => idb) }));
const lib = useLibrary.setState;
let toasts = 0;
export const notify = (t: Omit<Toast, "id">) => set({ toast: { ...t, id: ++toasts } });

// Every library change goes through here: apply it, say so, offer Undo. Undo puts back only the
// lists this change touched. ponytail: an edit to the same list in between (a rename) is undone with it.
function change(text: string, about: { title?: string; thumb?: string } | undefined, fn: (s: Library) => Partial<Library>, undoable = true) {
  const before = useLibrary.getState();
  const patch = fn(before);
  lib(patch);
  const restore = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Library]]));
  notify({ text, detail: about?.title, thumb: about?.thumb, undo: undoable ? () => (lib(restore), set({ toast: undefined })) : undefined });
}

const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id);
const toggleIn = <T extends { id: string }>(list: T[], x: T) => (has(list, x.id) ? list.filter((y) => y.id !== x.id) : [{ ...x, at: Date.now() }, ...list]);
const playlist = (id: string) => useLibrary.getState().playlists.find((p) => p.id === id);
const edit = (id: string, fn: (p: Playlist) => Partial<Playlist>) => (s: Library) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, ...fn(p) } : p)) });
// A song as a list keeps it: without what only the queue cares about.
const entry = ({ rec: _, ...t }: Track): Track => ({ ...t, at: Date.now() });

export const toggleLike = (t: Track) =>
  change(has(useLibrary.getState().liked, t.id) ? "Removed from Liked Songs" : "Added to Liked Songs", t, (s) => ({ liked: toggleIn(s.liked, entry(t)) }));
export const toggleSave = (a: Album) =>
  change(has(useLibrary.getState().saved, a.id) ? "Removed from Library" : "Saved to Library", a, (s) => ({ saved: toggleIn(s.saved, a) }));
// Several at once, quietly (the artists picked when you first open Sleeve).
export const follow = (artists: Followed[]) =>
  lib((s) => ({ followed: [...artists.filter((a) => !has(s.followed, a.id)).map((a) => ({ ...a, at: Date.now() })), ...s.followed] }));
export const toggleFollow = (a: Followed) =>
  change(has(useLibrary.getState().followed, a.id) ? "Unfollowed" : "Following", { title: a.name, thumb: a.thumb }, (s) => ({ followed: toggleIn(s.followed, a) }));
export const addToPlaylist = (id: string, tracks: Track[]) =>
  change(`Added to ${playlist(id)?.name}`, tracks[0], edit(id, (p) => ({ tracks: [...p.tracks, ...tracks.map(entry)] })));
export const removeFromPlaylist = (id: string, index: number) =>
  change(`Removed from ${playlist(id)?.name}`, playlist(id)?.tracks[index], edit(id, (p) => ({ tracks: p.tracks.filter((_, i) => i !== index) })));
export const movePlaylistTrack = (id: string, from: number, to: number) =>
  lib(edit(id, (p) => {
    const tracks = [...p.tracks];
    tracks.splice(to, 0, ...tracks.splice(from, 1));
    return { tracks };
  }));
export const renamePlaylist = (id: string, name: string) => lib(edit(id, () => ({ name })));
export const describePlaylist = (id: string, about: string) => lib(edit(id, () => ({ about })));
export const sortPlaylist = (id: string, sort: TrackSort) => lib(edit(id, () => ({ sort })));
export const setCover = (id: string, cover?: string) => change(cover ? "Cover Changed" : "Cover Removed", { title: playlist(id)?.name, thumb: cover }, edit(id, () => ({ cover })));
export function deletePlaylist(id: string) {
  const p = playlist(id);
  if (p) change("Playlist Deleted", { title: p.name, thumb: p.cover ?? p.tracks[0]?.thumb }, (s) => ({ playlists: s.playlists.filter((x) => x.id !== id), pinned: s.pinned.filter((k) => k !== libraryKey("playlist", id)) }));
}
// Its copy goes straight after it, in the same folder.
export function duplicatePlaylist(id: string) {
  const p = playlist(id);
  if (!p) return;
  const copy = { ...p, id: crypto.randomUUID(), name: `${p.name} Copy`, at: Date.now() };
  change("Playlist Duplicated", { title: copy.name, thumb: p.cover ?? p.tracks[0]?.thumb }, (s) => {
    const at = s.playlists.findIndex((x) => x.id === id);
    return { playlists: [...s.playlists.slice(0, at + 1), copy, ...s.playlists.slice(at + 1)] };
  });
  return copy.id;
}
// An empty one opens straight onto its page, which says enough; one made from a song gets a toast.
export function newPlaylist(tracks: Track[] = [], folder?: string) {
  const p: Playlist = { id: crypto.randomUUID(), name: `Playlist ${useLibrary.getState().playlists.length + 1}`, tracks: tracks.map(entry), at: Date.now(), ...(folder && { folder }) };
  if (tracks.length) change(`Added to ${p.name}`, tracks[0], (s) => ({ playlists: [...s.playlists, p] }), false);
  else lib((s) => ({ playlists: [...s.playlists, p] }));
  return p.id;
}

// Public: anyone with its link can see it and play it (account.ts playlistLink).
export const setPublic = (id: string, on: boolean) =>
  change(on ? "Playlist Is Public" : "Playlist Is Private", { title: on ? "Anyone with its link can see it" : playlist(id)?.name }, edit(id, () => ({ public: on || undefined })));
// Someone's shared playlist, as one of yours.
export function copyPlaylist({ public: _, folder: __, ...p }: Playlist) {
  const copy = { ...p, id: crypto.randomUUID(), at: Date.now() };
  change("Saved to Your Library", { title: p.name, thumb: p.cover ?? p.tracks[0]?.thumb }, (s) => ({ playlists: [...s.playlists, copy] }));
  return copy.id;
}

// Folders hold playlists (one level, as in Spotify's sidebar). Deleting one keeps its playlists.
export function newFolder(playlists: string[] = []) {
  const f = { id: crypto.randomUUID(), name: `Folder ${useLibrary.getState().folders.length + 1}`, at: Date.now() };
  lib((s) => ({ folders: [...s.folders, f], playlists: s.playlists.map((p) => (playlists.includes(p.id) ? { ...p, folder: f.id } : p)) }));
  return f.id;
}
export const renameFolder = (id: string, name: string) => lib((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }));
export function deleteFolder(id: string) {
  const f = useLibrary.getState().folders.find((x) => x.id === id);
  if (f) change("Folder Deleted", { title: f.name }, (s) => ({ folders: s.folders.filter((x) => x.id !== id), playlists: s.playlists.map((p) => (p.folder === id ? { ...p, folder: undefined } : p)), pinned: s.pinned.filter((k) => k !== libraryKey("folder", id)) }));
}
export function moveToFolder(id: string, folder?: string) {
  const name = folder ? useLibrary.getState().folders.find((f) => f.id === folder)?.name : undefined;
  change(name ? `Moved to ${name}` : "Moved out of Folder", { title: playlist(id)?.name, thumb: playlist(id)?.cover ?? playlist(id)?.tracks[0]?.thumb }, edit(id, () => ({ folder })));
}

// What the Library page lists, by kind and id: "liked" and "local" are one of a kind.
export type LibraryKind = "liked" | "local" | "playlist" | "folder" | "album" | "artist";
export const libraryKey = (kind: LibraryKind, id = "") => (id ? `${kind}:${id}` : kind);
export const togglePin = (key: string) => lib((s) => ({ pinned: s.pinned.includes(key) ? s.pinned.filter((k) => k !== key) : [key, ...s.pinned] }));

// Hiding a song, or every song by an artist. They stay where they are, dimmed, and play when you pick
// them yourself; a queue moving on by itself passes over them.
export const toggleHide = (t: Track) =>
  change(has(useLibrary.getState().hidden, t.id) ? "Song Unhidden" : "Song Hidden", t, (s) => ({ hidden: toggleIn(s.hidden, entry(t)) }));
export const artistKey = (a: Artist) => a.id ?? a.name.toLowerCase();
export function toggleBlock(a: Artist) {
  const on = useLibrary.getState().blocked.some((b) => artistKey(b) === artistKey(a));
  change(on ? `You’ll hear ${a.name} again` : `You won’t hear ${a.name}`, { title: on ? undefined : "Their songs are skipped and left out of radio" }, (s) => ({
    blocked: on ? s.blocked.filter((b) => artistKey(b) !== artistKey(a)) : [{ id: a.id, name: a.name, at: Date.now() }, ...s.blocked],
  }));
}
let off: { hidden: Track[]; blocked: Artist[]; ids: Set<string>; artists: Set<string> } | undefined;
export function skipped(t: Track) {
  const { hidden, blocked } = useLibrary.getState();
  if (off?.hidden !== hidden || off.blocked !== blocked)
    off = { hidden, blocked, ids: new Set(hidden.map((x) => x.id)), artists: new Set(blocked.flatMap((b) => [b.name.toLowerCase(), ...(b.id ? [b.id] : [])])) };
  return off.ids.has(t.id) || t.artists.some((a) => off!.artists.has(a.name.toLowerCase()) || (!!a.id && off!.artists.has(a.id)));
}

// Replaces the whole library from an export file; Undo brings the old one back.
export const restoreLibrary = (l: Partial<Library> & Pick<Library, "liked" | "saved" | "playlists">) =>
  change("Library Restored", { title: `${plural(l.liked.length, "liked song")}, ${plural(l.playlists.length, "playlist")}, ${plural(l.saved.length, "album")}` }, () => ({ ...empty(), ...l }));
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Songs from some lists come without an album or a length (a music video has neither), and ones kept
// before artists were read properly can have two in one ("Jazeek & Luciano"). Each is looked up once a
// launch, two at a time, from its own entry on YT Music, and the answer written back wherever it's kept.
const needsFill = (t: Track) => !t.file && (t.album === undefined || !t.duration || (!t.albumId && t.artists.some((a) => SEP.test(a.name))));
const asked = new Set<string>();
const toFill: Track[] = [];
let filling = 0;
export function fill(tracks: Track[]) {
  for (const t of tracks) if (needsFill(t) && !asked.has(t.id)) asked.add(t.id), toFill.push(t);
  while (filling < 2 && toFill.length) void fillNext();
}
async function fillNext() {
  filling++;
  for (let t; (t = toFill.shift()); ) {
    const d = await details(t.id).catch(() => undefined);
    if (d) patch(t.id, { album: d.album ?? t.album ?? "", ...(d.albumId && { albumId: d.albumId }), ...(!t.duration && d.duration && { duration: d.duration }), ...(d.artists.length && { artists: d.artists }) });
  }
  filling--;
}
// Changes a song wherever it's kept: your lists, the queue, recently played.
export function patch(id: string, p: Partial<Track>) {
  const fix = (list: Track[]) => (list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? { ...x, ...p } : x)) : list);
  const l = useLibrary.getState();
  const liked = fix(l.liked), hidden = fix(l.hidden), playlists = l.playlists.map((pl) => ((t) => (t === pl.tracks ? pl : { ...pl, tracks: t }))(fix(pl.tracks)));
  if (liked !== l.liked || hidden !== l.hidden || playlists.some((pl, i) => pl !== l.playlists[i])) lib({ liked, hidden, playlists });
  set((s) => ({ queue: fix(s.queue) }));
  useHistory.setState((s) => ({ recent: fix(s.recent) }));
}

// When each thing in your library was last opened or played from, for the Library's Recents order.
export const useRecents = create<Record<string, number>>()(persist(() => ({}), { name: "recents", storage: createJSONStorage(() => idb) }));
export const touch = (key: string) => useRecents.setState({ [key]: Date.now() });

// Recent searches: queries and opened items, kept up to 10. Persisted the same way as useRecents.
export type RecentSearch = {
  id: string;
  kind: "query" | "artist" | "album" | "track";
  title: string;
  subtitle?: string;
  thumb?: string;
  track?: Track;
};
export const useRecentSearches = create<{ items: RecentSearch[] }>()(
  persist((): { items: RecentSearch[] } => ({ items: [] }), { name: "recent_searches", storage: createJSONStorage(() => idb) }),
);
export function addRecentSearch(item: RecentSearch) {
  if (usePrivate.getState().on || !useSettings.getState().history) return;
  useRecentSearches.setState((s) => ({
    items: [item, ...s.items.filter((x) => x.id !== item.id)].slice(0, 10),
  }));
}
export function recordRecentQuery(query: string) {
  const q = query.trim();
  if (!q) return;
  addRecentSearch({ id: q.toLowerCase(), kind: "query", title: q });
}
export function removeRecentSearch(id: string) {
  useRecentSearches.setState((s) => ({
    items: s.items.filter((x) => x.id !== id),
  }));
}
export function clearRecentSearches() {
  useRecentSearches.setState({ items: [] });
}

// Listening history. A play counts after 30 s of listening (all of a shorter song), as on Spotify. recent
// is the last 50 songs, newest first, one entry each, read once at launch and kept up to date here.
export type Play = { t: Track; at: number };
export const useHistory = create<{ recent: Track[] }>()(() => ({ recent: [] }));
const RECENT = 50;
const remember = (t: Track, list: Track[]) => [t, ...list.filter((x) => x.id !== t.id)].slice(0, RECENT);
void (async () => {
  const seen: Track[] = [];
  await plays((p) => (seen.length < RECENT && !seen.some((x) => x.id === p.t.id) && seen.push(p.t), seen.length < RECENT)).catch(() => {});
  useHistory.setState((s) => ({ recent: [...s.recent, ...seen.filter((t) => !s.recent.some((x) => x.id === t.id))].slice(0, RECENT) }));
})();
// A private session (Settings → Privacy, until Sleeve quits) or history switched off: plays aren't kept.
export const usePrivate = create<{ on: boolean }>()(() => ({ on: false }));
function logPlay(t: Track) {
  if (usePrivate.getState().on || !useSettings.getState().history) return;
  const { rec: _, at: __, ...track } = t;
  void kv("readwrite", (s) => s.add({ t: track, at: Date.now() } satisfies Play), "plays").catch(() => {});
  useHistory.setState((s) => ({ recent: remember(track, s.recent) }));
}
// Plays newest first, each handed to each until it returns false; before: a key to carry on from.
export async function plays(each: (p: Play, key: number) => boolean, before?: number) {
  const d = await db;
  return new Promise<void>((ok, fail) => {
    const r = d.transaction("plays").objectStore("plays").openCursor(before === undefined ? null : IDBKeyRange.upperBound(before, true), "prev");
    r.onsuccess = () => {
      const c = r.result;
      if (c && each(c.value as Play, c.key as number)) c.continue();
      else ok();
    };
    r.onerror = () => fail(r.error);
  });
}
export function clearHistory() {
  void kv("readwrite", (s) => s.clear(), "plays");
  useHistory.setState({ recent: [] });
  notify({ text: "History Cleared" });
}

const onlineChange = (cb: () => void) => (addEventListener("online", cb), addEventListener("offline", cb), () => (removeEventListener("online", cb), removeEventListener("offline", cb)));
export const useOnline = () => useSyncExternalStore(onlineChange, () => navigator.onLine);

// Two players, so the next track can buffer under this one (gapless) and fade in over it (crossfade).
// audio is whichever is playing now; the other is idle, buffering, or fading out.
const players = [new Audio(), new Audio()];
export let audio = players[0];
const other = () => (audio === players[0] ? players[1] : players[0]);

// After a relaunch nothing is loaded yet: Play picks up where you left off.
const resume: { time?: number; volume?: number; muted?: boolean } = JSON.parse(localStorage.resume ?? "{}");
// Your volume is vol; each player plays at vol × its track's normalisation × its crossfade.
let vol = resume.volume ?? 1;
let muted = !!resume.muted;
const loudness = new Map<HTMLAudioElement, number>(); // dB over YouTube's reference level
const fades = new Map<HTMLAudioElement, number>();
const gains = new Map<HTMLAudioElement, GainNode>(); // once the EQ routes the players through Web Audio
function level(p: HTMLAudioElement) {
  // YouTube's own rule: loud tracks come down to the reference, quiet ones aren't boosted (no clipping).
  const db = useSettings.getState().normalize ? Math.max(0, loudness.get(p) ?? 0) : 0;
  const v = muted ? 0 : Math.min(1, vol * 10 ** (-db / 20) * (fades.get(p) ?? 1));
  const g = gains.get(p);
  if (g) (g.gain.value = v), (p.volume = 1);
  else p.volume = v;
}
export function setVolume(v: number) {
  vol = Math.min(1, Math.max(0, v));
  muted = false;
  players.forEach(level);
  emit();
  save();
}
export const nudgeVolume = (by: number) => setVolume(vol + by);
export const setMuted = (m: boolean) => ((muted = m), players.forEach(level), emit(), save());

// Live player state, snapshotted on each media event. useSyncExternalStore needs a stable snapshot:
// reading audio.currentTime directly changes between calls and loops React.
const read = () => ({ paused: audio.paused, time: audio.currentTime, duration: audio.duration, volume: vol, muted });
let snapshot = read();
const listeners = new Set<() => void>();
const emit = () => ((snapshot = read()), listeners.forEach((l) => l()));
const on = (e: string, fn: () => void) => players.forEach((p) => p.addEventListener(e, () => p === audio && fn()));
for (const e of ["timeupdate", "durationchange", "play", "pause", "emptied"]) on(e, emit);
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
export const useAudio = () => useSyncExternalStore(subscribe, () => snapshot);
// For what needs the player's events without re-rendering on each (lyrics.ts useLine, the karaoke fill).
export const subscribeAudio = subscribe;

export const shuffled = <T,>(list: T[]) => list.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

// Downloaded songs (offline.ts sets these) play from disk, and while offline they and your own files are
// all that can play: a queue moving on by itself passes over the rest, and lists dim them. A song file
// that isn't on this computer (synced from another) can't play either; local.ts says which are.
export const downloads: { read?: (id: string) => ReturnType<typeof fetchAudio> | undefined; has?: (id: string) => boolean } = {};
export const files: { has?: (path: string) => boolean } = {};
export const unavailable = (t: Track) => (t.file ? files.has?.(t.file) === false : !navigator.onLine && !downloads.has?.(t.id));
const playable = (t: Track) => !skipped(t) && !unavailable(t);

// Instant skip: the next track's audio is fetched while this one plays, and recent ones are kept.
// ponytail: last 4 tracks in memory (~20 MB).
const cache = new Map<string, ReturnType<typeof fetchAudio>>();
function fetchCached(id: string) {
  const dl = downloads.read?.(id);
  const p = cache.get(id) ?? (dl ? dl.catch(() => fetchAudio(id, useSettings.getState().quality)) : fetchAudio(id, useSettings.getState().quality));
  cache.delete(id);
  cache.set(id, p);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  p.catch(() => cache.delete(id));
  return p;
}
const prefetch = () => {
  const t = get().queue[nextIndex(get().index)];
  if (t && !t.file) fetchCached(t.id).catch(() => {});
};
// A song file on this computer plays from disk through the asset protocol: no stream to fetch, and it
// seeks like any file. A webview that won't stream that into a player (WebKitGTK, on Linux) gets the file
// read whole and played from memory instead. start resumes partway in; autoplay false only loads it.
async function playFile(el: HTMLAudioElement, path: string, start = 0, autoplay = true) {
  URL.revokeObjectURL(el.src);
  el.src = convertFileSrc(path);
  const loads = await new Promise<boolean>((ok) => {
    const done = (e: Event) => (el.removeEventListener("loadedmetadata", done), el.removeEventListener("error", done), ok(e.type === "loadedmetadata"));
    el.addEventListener("loadedmetadata", done), el.addEventListener("error", done);
  });
  if (!loads) el.src = URL.createObjectURL(await (await fetch(convertFileSrc(path))).blob());
  if (start) el.currentTime = start;
  if (autoplay) await el.play();
}

// Start playing a list (an album, a playlist, search results) from one of its tracks. from: the library
// key of what it's from, for the Library's Recents order. A song you pick plays even if it's hidden.
export function play(queue: Track[], index: number, from?: string) {
  if (!queue[index]) return;
  if (from) touch(from);
  const original = get().shuffle ? queue : undefined;
  if (original) (queue = [queue[index], ...shuffled(queue.filter((_, i) => i !== index))]), (index = 0);
  set({ queue, original, added: 0 });
  const loading = load(index); // sets index before its first await, which recommend() reads
  if (get().shuffle === "smart") void recommend();
  return loading;
}
export function shufflePlay(tracks: Track[], from?: string) {
  const ok = tracks.flatMap((t, i) => (playable(t) ? [i] : []));
  set({ shuffle: true });
  return play(tracks, ok.length ? ok[Math.floor(Math.random() * ok.length)] : 0, from);
}
// Where a list starts when you press its Play: its first song you haven't hidden.
export const firstPlayable = (tracks: Track[]) => Math.max(0, tracks.findIndex(playable));
// A song's radio: it plays now and its "watch next" mix fills Up Next.
export function startRadio(t: Track) {
  play([t], 0);
  if (get().repeat !== "off") extend(t); // load() only does it when the queue would otherwise stop
}

// An artist's or playlist's radio: the "watch next" mixes of a few of its songs, taken in turn.
async function mix(seeds: Track[], skip = new Set<string>()) {
  const mixes = await Promise.all(seeds.filter((t) => !t.file).map((t) => radio(t.id).catch(() => [])));
  return mixes.flatMap((m) => m.map((t, i) => [i, t] as const)).sort((a, b) => a[0] - b[0]).flatMap(([, t]) => (skip.has(t.id) || skipped(t) ? [] : (skip.add(t.id), [t])));
}
export async function radioFrom(tracks: Track[], from?: string) {
  const list = await mix(shuffled(tracks.filter((t) => !skipped(t))).slice(0, 3));
  if (!list.length) return report(new Error("No radio for this one"));
  set({ shuffle: false });
  play(list, 0, from);
}

// The next song a queue moves on to by itself, passing over hidden songs, blocked artists, and offline
// what isn't downloaded: an index
// into the queue, or queue.length when there's none. Repeat All goes round to the start.
function nextIndex(from: number, wrap = get().repeat === "all") {
  const { queue } = get();
  for (let i = from + 1; i < queue.length; i++) if (playable(queue[i])) return i;
  if (wrap) for (let i = 0; i <= from && i < queue.length; i++) if (playable(queue[i])) return i;
  return queue.length;
}

let latest = 0;
let ramp = 0; // the crossfade's timer
let ready: { id: string; el: HTMLAudioElement } | undefined; // the next track, buffered in the idle player
async function load(index: number, start = 0, fade = 0) {
  const track = get().queue[index];
  if (!track) return;
  const me = ++latest;
  // Skipping forward uses up the tracks you queued; going back leaves them to the old order. ponytail: added resets.
  set((s) => ({ index, added: index > s.index ? Math.max(0, s.added - (index - s.index)) : 0, loading: true, error: "" }));
  const old = audio;
  const buffered = ready?.id === track.id && !start;
  audio = buffered ? ready!.el : other();
  ready = undefined;
  clearInterval(ramp);
  for (const p of players) if (!(fade && p === old)) p.pause(); // a crossfade lets the old track play out
  fades.set(audio, fade ? 0 : 1);
  level(audio);
  emit();
  setMediaSession(track);
  setAccent(art(track.thumb, 64));
  listened(start);
  fill([track]);
  if (nextIndex(index, false) === get().queue.length && get().repeat === "off" && useSettings.getState().autoplay) extend(track); // autoplay
  try {
    if (buffered) await audio.play();
    else if (track.file) loudness.set(audio, 0), level(audio), await playFile(audio, track.file, start);
    else {
      const data = await fetchCached(track.id);
      if (me !== latest) return;
      loudness.set(audio, data.loudness), level(audio);
      await playAudio(audio, data, start);
    }
    if (me !== latest) return;
    prefetch();
    if (fade) crossfade(old, audio, fade);
  } catch (e) {
    cache.delete(track.id);
    if (me === latest) report(e);
  } finally {
    if (me === latest) set({ loading: false });
  }
}
// Equal-power curves, so the overlap doesn't dip in the middle.
function crossfade(from: HTMLAudioElement, to: HTMLAudioElement, seconds: number) {
  const t0 = performance.now();
  ramp = setInterval(() => {
    const x = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    fades.set(to, Math.sin((x * Math.PI) / 2)), fades.set(from, Math.cos((x * Math.PI) / 2));
    level(to), level(from);
    if (x === 1) clearInterval(ramp), from.pause();
  }, 50);
}
// Gapless: the next track buffers in the idle player in the last 20 s, so ended can start it at once.
async function preload(t: Track) {
  const el = other();
  if (!el.paused) return; // still fading out
  ready = { id: t.id, el };
  try {
    if (t.file) return loudness.set(el, 0), await playFile(el, t.file, 0, false);
    const data = await fetchCached(t.id);
    if (ready?.el !== el || ready.id !== t.id) return;
    loudness.set(el, data.loudness);
    await playAudio(el, data, 0, false);
  } catch {
    if (ready?.el === el) ready = undefined;
  }
}
on("timeupdate", () => {
  const { queue, index, repeat, sleep, loading } = get();
  const t = queue[nextIndex(index)];
  if (!t || loading || repeat === "one" || sleep === "track") return;
  const left = audio.duration - audio.currentTime;
  const fade = useSettings.getState().crossfade;
  if (left < fade + 20 && ready?.id !== t.id) void preload(t);
  if (fade && left <= fade) advance(fade); // load() swaps audio, so this fires once
});
on("playing", () => set({ loading: false }));
// A song that came without a length gets the one its stream says.
on("durationchange", () => {
  const t = get().queue[get().index];
  if (t && !t.duration && Number.isFinite(audio.duration) && audio.duration > 0) patch(t.id, { duration: `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, "0")}` });
});

// The queue ran out: carry on with the last track's radio, minus anything already in it.
async function extend(seed: Track) {
  if (seed.file) return; // not on YouTube, so no radio
  const more = await radio(seed.id).catch(() => []);
  const { queue } = get();
  if (queue.at(-1)?.id !== seed.id) return; // you queued or played something else meanwhile
  const ids = new Set(queue.map((t) => t.id));
  set({ queue: [...queue, ...more.filter((t) => !ids.has(t.id) && !skipped(t))] });
  prefetch();
}

export const jump = (index: number) => load(index);
const advance = (fade = 0) => load(nextIndex(get().index), 0, fade);
export const next = () => advance();
export function prev() {
  const { queue, index } = get();
  let i = index - 1;
  while (i >= 0 && !playable(queue[i])) i--;
  return audio.currentTime > 3 || i < 0 ? (audio.currentTime = 0) : load(i);
}
on("ended", () => {
  const { sleep, repeat } = get();
  if (sleep === "track") return sleepIn();
  if (repeat === "one") (audio.currentTime = 0), listened(0), audio.play();
  else next();
});

// The listening history counts a play once it's been listened to for 30 s, or all of a shorter song
// (playing time, so seeking past doesn't count). listened restarts the count for a song starting at.
let heard = 0, was = 0, logged = false, scrobbled = false, startedAt = Date.now();
const listened = (at: number) => {
  heard = 0;
  was = at;
  logged = false;
  scrobbled = false;
  startedAt = Date.now();
};
on("timeupdate", () => {
  const step = audio.currentTime - was;
  was = audio.currentTime;
  if (step <= 0 || step > 2) return;
  heard += step;
  const t = get().queue[get().index];
  if (!t) return;
  if (!logged && heard >= Math.min(30, (audio.duration || 31) - 1)) {
    logged = true;
    logPlay(t);
  }
  const dur = audio.duration || 0;
  if (!scrobbled && dur > 30 && heard >= Math.min(dur / 2, 240)) {
    scrobbled = true;
    sendScrobble(t, startedAt, dur);
  }
});

on("play", () => {
  const t = get().queue[get().index];
  if (t) sendNowPlaying(t, audio.duration || undefined);
});
on("pause", () => clearDiscordRpc());
usePrivate.subscribe((s) => s.on && clearDiscordRpc());

// Pausing mid-crossfade stops both tracks and leaves the new one at full level.
export function pause() {
  clearInterval(ramp);
  players.forEach((p) => p.pause());
  fades.set(audio, 1), level(audio);
  clearDiscordRpc();
}
export const toggle = () => (!audio.src && !get().loading ? load(get().index, resume.time) : audio.paused ? audio.play().catch(() => {}) : pause());
let saved = 0;
const save = () => {
  saved = audio.currentTime;
  localStorage.resume = JSON.stringify({ time: audio.src ? audio.currentTime : resume.time, volume: vol, muted });
};
on("timeupdate", () => Math.abs(audio.currentTime - saved) > 5 && save());
on("pause", save);
addEventListener("pagehide", save);

// Smart Shuffle: radio from the current track and two upcoming ones, mixed into Up Next (Spotify's
// pattern). Several seeds, because a queue that is itself a radio already holds its seed's mix.
async function recommend() {
  const { queue, index } = get();
  const seed = queue[index];
  const recs = seed ? await mix([seed, ...shuffled(queue.slice(index + 1).filter((t) => !skipped(t))).slice(0, 2)], new Set(queue.map((t) => t.id))) : [];
  if (!recs.length) return notify({ text: "No recommendations for this queue" });
  const now = get();
  if (now.shuffle !== "smart" || now.queue[now.index]?.id !== seed?.id) return; // you moved on meanwhile
  const at = now.index + 1 + now.added;
  // A recommendation after your second track, then after every third. Leaving Smart Shuffle drops them: they aren't in original.
  const rest = now.queue.slice(at).flatMap((t, i) => (i % 3 === 1 && recs.length ? [t, { ...recs.shift()!, rec: true as const }] : [t]));
  set({ queue: [...now.queue.slice(0, at), ...rest] });
}

// Off, Shuffle, Smart Shuffle, as in Spotify.
export const toggleShuffle = () => {
  const { shuffle, queue, index, added, original } = get();
  const keep = queue.slice(0, index + 1 + added); // played, current, and what you queued stay put
  if (!shuffle) set({ shuffle: true, original: queue, queue: [...keep, ...shuffled(queue.slice(keep.length))] });
  else if (shuffle === true) set({ shuffle: "smart" }), void recommend();
  else {
    const ids = new Set(keep.map((t) => t.id));
    const at = keep.filter((t) => !t.rec).at(-1)?.id; // a recommendation isn't in original
    const rest = original ? original.slice(original.findIndex((t) => t.id === at) + 1) : queue.slice(keep.length);
    set({ shuffle: false, original: undefined, queue: [...keep, ...rest.filter((t) => !ids.has(t.id) && !t.rec)] });
  }
  prefetch();
};
export const cycleRepeat = () => set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" }));

// Play Next goes straight after the current track; Add to Queue after what you've already queued.
export function enqueue(tracks: Track[], soon: boolean) {
  const { queue, index, added } = get();
  if (!queue[index]) return play(tracks, 0);
  const at = index + 1 + (soon ? 0 : added);
  set({ queue: [...queue.slice(0, at), ...tracks, ...queue.slice(at)], added: added + tracks.length });
  notify({ text: soon ? "Playing Next" : "Added to Queue", detail: tracks.length > 1 ? plural(tracks.length, "song") : tracks[0]?.title, thumb: tracks[0]?.thumb });
  prefetch();
}
// Indexes are into the whole queue; Up Next only offers ones after the current track.
export const moveInQueue = (from: number, to: number) =>
  set((s) => {
    const queue = [...s.queue];
    queue.splice(to, 0, ...queue.splice(from, 1));
    return { queue };
  });
export const removeFromQueue = (i: number) => set((s) => ({ queue: s.queue.filter((_, j) => j !== i), added: i <= s.index + s.added ? Math.max(0, s.added - 1) : s.added }));
export function clearQueue() {
  const { queue, added, original } = get();
  set((s) => ({ queue: s.queue.slice(0, s.index + 1), added: 0, original: undefined }));
  notify({ text: "Queue Cleared", undo: () => set({ queue, added, original, toast: undefined }) });
}

let sleepTimer = 0;
export function sleepIn(minutes?: number | "track") {
  clearTimeout(sleepTimer);
  if (typeof minutes === "number") sleepTimer = setTimeout(() => (pause(), set({ sleep: undefined })), minutes * 60_000);
  set({ sleep: typeof minutes === "number" ? Date.now() + minutes * 60_000 : minutes });
  if (minutes) notify({ text: "Sleep Timer Set", detail: minutes === "track" ? "Stops at the end of this track" : `Stops in ${minutes} minutes` });
  else if (get().toast?.text === "Sleep Timer Set") set({ toast: undefined });
}

// The UI's one colour: the artwork's most prominent vivid hue, by chroma-weighted 30° hue buckets.
// Grey or dark artwork, with no hue to speak of, gives its average colour. index.css clamps it to a readable lightness and fades between tracks.
let accentSrc: string | undefined;
function setAccent(src?: string) {
  accentSrc = src;
  if (!useSettings.getState().artworkAccent) return document.documentElement.style.removeProperty("--accent-raw");
  if (!src) return;
  const img = new Image();
  img.crossOrigin = "anonymous"; // googleusercontent and ytimg allow it; a tainted canvas can't be read
  img.onload = () => {
    if (src !== accentSrc) return;
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    const avg = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      avg[0] += r; avg[1] += g; avg[2] += b;
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      if (d < 40) continue;
      const h = (max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d) * 60;
      const k = buckets[Math.floor(((h + 360) % 360) / 30)], w = (d / 255) ** 2;
      k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
    }
    const k = buckets.reduce((a, b) => (b.w > a.w ? b : a));
    const root = document.documentElement.style;
    const n = px.length / 4;
    root.setProperty("--accent-raw", k.w > 1.5 ? `rgb(${k.r / k.w} ${k.g / k.w} ${k.b / k.w})` : `rgb(${avg[0] / n} ${avg[1] / n} ${avg[2] / n})`);
  };
  img.src = src;
}

export const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000];

// Small and read synchronously at startup, so the theme is right on the first frame: localStorage.
// sidebarWidth is the expanded width; closed, the sidebar is the icon rail. queue is the Queue panel, queueWidth its width.
// crossfade is in seconds (0 is gapless); eq is dB per EQ_BANDS band. lyricsPeek is the line on the player bar;
// lyricsWords estimates word timings for lyrics that only time lines; translateTo is a language code, "" for
// the system's (lyrics.ts translateTarget). lyricsStill keeps the lyrics from moving: they don't follow the
// system's Reduce Motion, so they look the same for everyone unless this is on. The Library page keeps
// its view, order and filter; likedSort is how Liked Songs lists its songs (a playlist keeps its own).
export type LibrarySort = "recents" | "added" | "name" | "creator";
// trackCols: how song lists share their width between Title, Album and Date Added (views.tsx TrackList).
export const TRACK_COLS: [number, number, number] = [5, 3, 2];
export type LibraryFilter = "playlists" | "albums" | "artists" | "songs" | "downloaded";
type Settings = {
  theme: "system" | "light" | "dark"; artworkAccent: boolean; sidebar: boolean; sidebarWidth: number; queue: boolean; queueWidth: number;
  quality: Quality; normalize: boolean; crossfade: number; eq: number[];
  lyricsPeek: boolean; lyricsWords: boolean; lyricsTranslate: boolean; lyricsRomanise: boolean; translateTo: string; lyricsStill: boolean;
  libraryView: "grid" | "list"; librarySort: LibrarySort; libraryFilter?: LibraryFilter; likedSort: TrackSort; localSort: TrackSort; trackCols: [number, number, number];
  autoplay: boolean; reduceMotion: boolean; zoom: number; lyricsOff: LyricsSource[]; history: boolean;
  keymap: Record<string, string>; loginHidden: boolean; closeToTray: boolean; country: string;
  listenBrainzToken: string; lastfmSessionKey: string; lastfmUsername: string; discordRpc: boolean;
};
export type LyricsSource = "apple" | "lrclib" | "netease";
const defaultCountry = () => {
  try {
    const code = typeof navigator !== "undefined" ? navigator.language?.split("-")?.[1] : undefined;
    return (code && code.length === 2 ? code : "US").toUpperCase();
  } catch {
    return "US";
  }
};

export const useSettings = create<Settings>()(
  persist(
    (): Settings => ({
      theme: "system", artworkAccent: true, sidebar: true, sidebarWidth: 220, queue: false, queueWidth: 320,
      quality: "high", normalize: true, crossfade: 0, eq: EQ_BANDS.map(() => 0),
      lyricsPeek: true, lyricsWords: true, lyricsTranslate: false, lyricsRomanise: false, translateTo: "", lyricsStill: false,
      libraryView: "grid", librarySort: "recents", likedSort: "custom", localSort: "custom", trackCols: TRACK_COLS,
      autoplay: true, reduceMotion: false, zoom: 1, lyricsOff: [], history: true, keymap: {}, loginHidden: false, closeToTray: false,
      country: defaultCountry(),
      listenBrainzToken: "", lastfmSessionKey: "", lastfmUsername: "", discordRpc: false,
    }),
    { name: "settings" },
  ),
);
useSettings.subscribe((s, was) => {
  if (was?.discordRpc && !s.discordRpc) clearDiscordRpc();
});
const applySettings = (s: Settings, was?: Settings) => {
  document.documentElement.dataset.theme = s.theme; // index.css: color-scheme picks every token's light or dark value
  document.documentElement.dataset.motion = s.reduceMotion ? "reduce" : ""; // index.css, like the system's Reduce Motion
  if (s.zoom !== was?.zoom && "__TAURI_INTERNALS__" in window) void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(s.zoom));
  if (s.artworkAccent !== was?.artworkAccent) setAccent(accentSrc);
  if (s.normalize !== was?.normalize) players.forEach(level);
  if (s.eq !== was?.eq) equalize(s.eq);
};

// The equalizer is the only Web Audio in the app, built the first time a band moves off 0: routing
// a media element through Web Audio is permanent, and plain <audio> is the safest path on WebKit.
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0],
  "Bass Boost": [6, 4, 1, 0, 0, 0],
  "Treble Boost": [0, 0, 0, 1, 4, 6],
  Vocal: [-2, -1, 2, 4, 3, 0],
  Rock: [4, 2, -1, 0, 2, 4],
  Electronic: [5, 3, 0, -1, 2, 4],
  Acoustic: [3, 2, 1, 2, 2, 2],
  "Late Night": [-2, -1, 0, 1, 1, -3],
};
let bands: BiquadFilterNode[] | undefined;
function equalize(eq: number[]) {
  if (!bands && eq.every((g) => !g)) return;
  if (!bands) {
    const ctx = new AudioContext();
    bands = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      return b;
    });
    bands.reduce((a, b) => (a.connect(b), b)).connect(ctx.destination);
    for (const p of players) {
      const g = ctx.createGain();
      ctx.createMediaElementSource(p).connect(g).connect(bands[0]);
      gains.set(p, g), level(p);
    }
    on("play", () => void ctx.resume()); // a context made before any click starts suspended
    if (!audio.paused) void ctx.resume();
  }
  bands.forEach((b, i) => (b.gain.value = eq[i] ?? 0));
}
applySettings(useSettings.getState());
useSettings.subscribe(applySettings);

// Media keys, Control Center / taskbar controls.
function setMediaSession(t: Track) {
  if (!("mediaSession" in navigator)) return;
  const src = art(t.thumb, 512);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album,
    artwork: src ? [{ src, sizes: "512x512" }] : [],
  });
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => void toggle());
  ms.setActionHandler("pause", pause);
  ms.setActionHandler("nexttrack", next);
  ms.setActionHandler("previoustrack", prev);
  ms.setActionHandler("seekto", (d) => (audio.currentTime = d.seekTime ?? 0));
}

// The restored queue's track shows (and colours the app) before anything plays.
const restored = get().queue[get().index];
if (restored) setMediaSession(restored), setAccent(art(restored.thumb, 64));

// The mini player (mini.tsx) is its own always-on-top window with no audio of its own: this window
// sends it what's playing and runs the buttons it presses.
// line is the lyric being sung, when lyrics.ts has one (it sets lyricLine).
export type MiniState = ReturnType<typeof read> & { track?: Track; loading: boolean; accent: string; line?: string };
let lyricLine: () => string | undefined = () => undefined;
export const setLyricLine = (fn: typeof lyricLine) => void (lyricLine = fn);
if ("__TAURI_INTERNALS__" in window) {
  const share = () => {
    const { queue, index, loading } = get();
    void emitTo("mini", "player", { ...snapshot, track: queue[index], loading, accent: document.documentElement.style.getPropertyValue("--accent-raw"), line: lyricLine() } satisfies MiniState);
  };
  listeners.add(share);
  useStore.subscribe(share);
  const commands: Record<string, () => unknown> = { ready: share, toggle, next, prev };
  void listen<string>("mini", (e) => commands[e.payload]?.());
}
export async function toggleMini() {
  const mini = await WebviewWindow.getByLabel("mini");
  if (mini) return mini.close();
  // Borderless and transparent: mini.tsx draws the rounded card and its own close button.
  new WebviewWindow("mini", { title: "Sleeve", width: 380, height: 140, resizable: false, alwaysOnTop: true, visibleOnAllWorkspaces: true, decorations: false, transparent: true, shadow: true });
}
