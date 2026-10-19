import { useSyncExternalStore } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { art, fetchAudio, playAudio, radio, type Album, type Quality, type Track } from "./yt";

type Root = "home" | "search" | "library" | "settings";
// "playlist" is one of yours; id "liked" is Liked Songs. "collection" is an album or playlist on YouTube Music.
export type View = { name: Root } | { name: "artist" | "collection" | "playlist"; id: string };

type State = {
  stack: View[];
  ahead: View[]; // what Back left, for Forward
  sheet?: "playing" | "lyrics"; // the full-screen sheet over everything but the player bar: Now Playing, or just the lyrics
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

export const open = (view: View) => set((s) => ({ stack: [...s.stack, view], ahead: [], sheet: undefined }));
export const back = () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1), ahead: [s.stack.at(-1)!, ...s.ahead] } : s));
export const forward = () => set((s) => (s.ahead.length ? { stack: [...s.stack, s.ahead[0]], ahead: s.ahead.slice(1) } : s));
export const go = (name: Root) => set({ stack: [{ name }], ahead: [], sheet: undefined });
// Opens that sheet, or closes it if it's the one showing.
export const toggleSheet = (sheet: State["sheet"]) => set((s) => ({ sheet: s.sheet === sheet ? undefined : sheet }));
export const report = (e: unknown) => set({ error: e instanceof Error ? e.message : String(e), loading: false });

// Your library, in IndexedDB: no 5 MB cap like localStorage, and the same code runs in the web build.
// ponytail: the whole library is rewritten on every change; per-row SQLite if imports reach ~100k tracks.
const db = new Promise<IDBDatabase>((ok, fail) => {
  const r = indexedDB.open("sleeve", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const kv = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
  db.then((d) => new Promise<T>((ok, fail) => {
    const r = fn(d.transaction("kv", mode).objectStore("kv"));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }));
const idb: StateStorage = {
  // Libraries saved before the move are still in localStorage until their first write here.
  getItem: async (k) => (await kv<string | undefined>("readonly", (s) => s.get(k))) ?? localStorage.getItem(k),
  setItem: (k, v) => kv("readwrite", (s) => s.put(v, k)).then(() => localStorage.removeItem(k)),
  removeItem: (k) => kv("readwrite", (s) => s.delete(k)).then(() => {}),
};

export type Playlist = { id: string; name: string; tracks: Track[] };
type Library = { liked: Track[]; saved: Album[]; playlists: Playlist[] };
export const useLibrary = create<Library>()(
  persist((): Library => ({ liked: [], saved: [], playlists: [] }), { name: "library", storage: createJSONStorage(() => idb) }),
);
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
const toggleIn = <T extends { id: string }>(list: T[], x: T) => (has(list, x.id) ? list.filter((y) => y.id !== x.id) : [x, ...list]);
const playlist = (id: string) => useLibrary.getState().playlists.find((p) => p.id === id);
const edit = (id: string, fn: (p: Playlist) => Partial<Playlist>) => (s: Library) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, ...fn(p) } : p)) });

export const toggleLike = (t: Track) =>
  change(has(useLibrary.getState().liked, t.id) ? "Removed from Liked Songs" : "Added to Liked Songs", t, (s) => ({ liked: toggleIn(s.liked, t) }));
export const toggleSave = (a: Album) =>
  change(has(useLibrary.getState().saved, a.id) ? "Removed from Library" : "Saved to Library", a, (s) => ({ saved: toggleIn(s.saved, a) }));
export const addToPlaylist = (id: string, tracks: Track[]) =>
  change(`Added to ${playlist(id)?.name}`, tracks[0], edit(id, (p) => ({ tracks: [...p.tracks, ...tracks] })));
export const removeFromPlaylist = (id: string, index: number) =>
  change(`Removed from ${playlist(id)?.name}`, playlist(id)?.tracks[index], edit(id, (p) => ({ tracks: p.tracks.filter((_, i) => i !== index) })));
export const renamePlaylist = (id: string, name: string) => lib(edit(id, () => ({ name })));
export function deletePlaylist(id: string) {
  const p = playlist(id);
  if (p) change("Playlist Deleted", { title: p.name, thumb: p.tracks[0]?.thumb }, (s) => ({ playlists: s.playlists.filter((x) => x.id !== id) }));
}
// Replaces the whole library from an export file; Undo brings the old one back.
export const restoreLibrary = (l: Library) =>
  change("Library Restored", { title: `${plural(l.liked.length, "liked song")}, ${plural(l.playlists.length, "playlist")}, ${plural(l.saved.length, "album")}` }, () => l);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// An empty one opens straight onto its page, which says enough; one made from a song gets a toast.
export function newPlaylist(tracks: Track[] = []) {
  const p = { id: crypto.randomUUID(), name: `Playlist ${useLibrary.getState().playlists.length + 1}`, tracks };
  if (tracks.length) change(`Added to ${p.name}`, tracks[0], (s) => ({ playlists: [...s.playlists, p] }), false);
  else lib((s) => ({ playlists: [...s.playlists, p] }));
  return p.id;
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

export const shuffled = <T,>(list: T[]) => list.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

// Instant skip: the next track's audio is fetched while this one plays, and recent ones are kept.
// ponytail: last 4 tracks in memory (~20 MB); a disk cache comes with offline downloads.
const cache = new Map<string, ReturnType<typeof fetchAudio>>();
function fetchCached(id: string) {
  const p = cache.get(id) ?? fetchAudio(id, useSettings.getState().quality);
  cache.delete(id);
  cache.set(id, p);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  p.catch(() => cache.delete(id));
  return p;
}
const prefetch = () => {
  const t = get().queue[get().index + 1];
  if (t) fetchCached(t.id).catch(() => {});
};

// Start playing a list (an album, a playlist, search results) from one of its tracks.
export function play(queue: Track[], index: number) {
  if (!queue[index]) return;
  const original = get().shuffle ? queue : undefined;
  if (original) (queue = [queue[index], ...shuffled(queue.filter((_, i) => i !== index))]), (index = 0);
  set({ queue, original, added: 0 });
  const loading = load(index); // sets index before its first await, which recommend() reads
  if (get().shuffle === "smart") void recommend();
  return loading;
}
export function shufflePlay(tracks: Track[]) {
  set({ shuffle: true });
  return play(tracks, Math.floor(Math.random() * tracks.length));
}
// A song's radio: it plays now and its "watch next" mix fills Up Next.
export function startRadio(t: Track) {
  play([t], 0);
  if (get().repeat !== "off") extend(t); // load() only does it when the queue would otherwise stop
}

// An artist's or playlist's radio: the "watch next" mixes of a few of its songs, taken in turn.
async function mix(seeds: Track[], skip = new Set<string>()) {
  const mixes = await Promise.all(seeds.map((t) => radio(t.id).catch(() => [])));
  return mixes.flatMap((m) => m.map((t, i) => [i, t] as const)).sort((a, b) => a[0] - b[0]).flatMap(([, t]) => (skip.has(t.id) ? [] : (skip.add(t.id), [t])));
}
export async function radioFrom(tracks: Track[]) {
  const list = await mix(shuffled(tracks).slice(0, 3));
  if (!list.length) return report(new Error("No radio for this one"));
  set({ shuffle: false });
  play(list, 0);
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
  if (index === get().queue.length - 1 && get().repeat === "off") extend(track); // autoplay
  try {
    if (buffered) await audio.play();
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
  const t = queue[index + 1] ?? (repeat === "all" ? queue[0] : undefined);
  if (!t || loading || repeat === "one" || sleep === "track") return;
  const left = audio.duration - audio.currentTime;
  const fade = useSettings.getState().crossfade;
  if (left < fade + 20 && ready?.id !== t.id) void preload(t);
  if (fade && left <= fade) advance(fade); // load() swaps audio, so this fires once
});
on("playing", () => set({ loading: false }));

// The queue ran out: carry on with the last track's radio, minus anything already in it.
async function extend(seed: Track) {
  const more = await radio(seed.id).catch(() => []);
  const { queue } = get();
  if (queue.at(-1)?.id !== seed.id) return; // you queued or played something else meanwhile
  const ids = new Set(queue.map((t) => t.id));
  set({ queue: [...queue, ...more.filter((t) => !ids.has(t.id))] });
  prefetch();
}

export const jump = (index: number) => load(index);
const advance = (fade = 0) => {
  const { index, queue, repeat } = get();
  return load(index + 1 < queue.length || repeat !== "all" ? index + 1 : 0, 0, fade);
};
export const next = () => advance();
export const prev = () => (audio.currentTime > 3 || get().index < 1 ? (audio.currentTime = 0) : load(get().index - 1));
on("ended", () => {
  const { sleep, repeat } = get();
  if (sleep === "track") return sleepIn();
  if (repeat === "one") (audio.currentTime = 0), audio.play();
  else next();
});

// Pausing mid-crossfade stops both tracks and leaves the new one at full level.
export function pause() {
  clearInterval(ramp);
  players.forEach((p) => p.pause());
  fades.set(audio, 1), level(audio);
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
  const recs = seed ? await mix([seed, ...shuffled(queue.slice(index + 1)).slice(0, 2)], new Set(queue.map((t) => t.id))) : [];
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
// translateTo is a language code, "" for the system's (lyrics.ts translateTarget).
type Settings = {
  theme: "system" | "light" | "dark"; artworkAccent: boolean; sidebar: boolean; sidebarWidth: number; queue: boolean; queueWidth: number;
  quality: Quality; normalize: boolean; crossfade: number; eq: number[];
  lyricsPeek: boolean; lyricsTranslate: boolean; lyricsRomanise: boolean; translateTo: string;
};
export const useSettings = create<Settings>()(
  persist(
    (): Settings => ({
      theme: "system", artworkAccent: true, sidebar: true, sidebarWidth: 220, queue: false, queueWidth: 320,
      quality: "high", normalize: true, crossfade: 0, eq: EQ_BANDS.map(() => 0),
      lyricsPeek: true, lyricsTranslate: false, lyricsRomanise: false, translateTo: "",
    }),
    { name: "settings" },
  ),
);
const applySettings = (s: Settings, was?: Settings) => {
  document.documentElement.dataset.theme = s.theme; // index.css: color-scheme picks every token's light or dark value
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
export type MiniState = ReturnType<typeof read> & { track?: Track; loading: boolean; accent: string };
if ("__TAURI_INTERNALS__" in window) {
  const share = () => {
    const { queue, index, loading } = get();
    void emitTo("mini", "player", { ...snapshot, track: queue[index], loading, accent: document.documentElement.style.getPropertyValue("--accent-raw") } satisfies MiniState);
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
