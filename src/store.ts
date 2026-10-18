import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { art, fetchAudio, playAudio, type Album, type Track } from "./yt";

// "playlist" is one of yours; id "liked" is Liked Songs. "collection" is an album or playlist on YouTube Music.
export type View = { name: "home" | "search" | "library" } | { name: "artist" | "collection" | "playlist"; id: string };

type State = {
  stack: View[];
  nowPlaying: boolean;
  queue: Track[];
  index: number;
  loading: boolean;
  error: string;
  toast?: Toast;
};
// Feedback for a library change: what happened, to what, and a way back.
export type Toast = { id: number; text: string; detail?: string; thumb?: string; undo?: () => void };

export const useStore = create<State>(() => ({
  stack: [{ name: "home" }],
  nowPlaying: false,
  queue: [],
  index: -1,
  loading: false,
  error: "",
}));
const { setState: set, getState: get } = useStore;

export const open = (view: View) => set((s) => ({ stack: [...s.stack, view], nowPlaying: false }));
export const back = () => set((s) => ({ stack: s.stack.slice(0, Math.max(1, s.stack.length - 1)) }));
export const go = (name: "home" | "search" | "library") => set({ stack: [{ name }], nowPlaying: false });
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
const notify = (t: Omit<Toast, "id">) => set({ toast: { ...t, id: ++toasts } });

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
// An empty one opens straight onto its page, which says enough; one made from a song gets a toast.
export function newPlaylist(tracks: Track[] = []) {
  const p = { id: crypto.randomUUID(), name: `Playlist ${useLibrary.getState().playlists.length + 1}`, tracks };
  if (tracks.length) change(`Added to ${p.name}`, tracks[0], (s) => ({ playlists: [...s.playlists, p] }), false);
  else lib((s) => ({ playlists: [...s.playlists, p] }));
  return p.id;
}

const onlineChange = (cb: () => void) => (addEventListener("online", cb), addEventListener("offline", cb), () => (removeEventListener("online", cb), removeEventListener("offline", cb)));
export const useOnline = () => useSyncExternalStore(onlineChange, () => navigator.onLine);

export const audio = new Audio();

// Live <audio> state, snapshotted on each media event. useSyncExternalStore needs a stable snapshot:
// reading audio.currentTime directly changes between calls and loops React.
const read = () => ({ paused: audio.paused, time: audio.currentTime, duration: audio.duration, volume: audio.volume, muted: audio.muted });
let snapshot = read();
const listeners = new Set<() => void>();
for (const e of ["timeupdate", "durationchange", "play", "pause", "volumechange", "emptied"])
  audio.addEventListener(e, () => ((snapshot = read()), listeners.forEach((l) => l())));
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
export const useAudio = () => useSyncExternalStore(subscribe, () => snapshot);

let latest = 0;

export async function play(queue: Track[], index: number) {
  const track = queue[index];
  if (!track) return;
  const me = ++latest;
  set({ queue, index, loading: true, error: "" });
  audio.pause();
  setMediaSession(track);
  setAccent(art(track.thumb, 64));
  try {
    const data = await fetchAudio(track.id);
    if (me === latest) await playAudio(audio, data);
  } catch (e) {
    if (me === latest) report(e);
  } finally {
    if (me === latest) set({ loading: false });
  }
}

export const toggle = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
export const next = () => play(get().queue, get().index + 1);
export const prev = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : play(get().queue, get().index - 1));
audio.addEventListener("ended", next);

// The UI's one colour: the artwork's most prominent vivid hue, by chroma-weighted 30° hue buckets.
// Grey artwork leaves it at ink. index.css clamps it to a readable lightness and fades between tracks.
let accentSrc: string | undefined;
function setAccent(src?: string) {
  accentSrc = src;
  if (!src) return;
  const img = new Image();
  img.crossOrigin = "anonymous"; // googleusercontent and ytimg allow it; a tainted canvas can't be read
  img.onload = () => {
    if (src !== accentSrc) return;
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      if (d < 40) continue;
      const h = (max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d) * 60;
      const k = buckets[Math.floor(((h + 360) % 360) / 30)], w = (d / 255) ** 2;
      k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
    }
    const k = buckets.reduce((a, b) => (b.w > a.w ? b : a));
    const root = document.documentElement.style;
    if (k.w > 3) root.setProperty("--accent-raw", `rgb(${k.r / k.w} ${k.g / k.w} ${k.b / k.w})`);
    else root.removeProperty("--accent-raw");
  };
  img.src = src;
}

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
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("nexttrack", next);
  ms.setActionHandler("previoustrack", prev);
  ms.setActionHandler("seekto", (d) => (audio.currentTime = d.seekTime ?? 0));
}
