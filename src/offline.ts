import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { downloads, idb, idbGet, idbPut, libraryKey, notify, plural, useLibrary, useSettings } from "./store";
import { keepLyrics } from "./lyrics";
import { artBase, covers, fetchAudio, sizedArt, type Collection, type Track } from "./yt";

// Offline downloads: Liked Songs, playlists and albums kept on this computer, so they play with no
// connection (and start at once with one). Each song's stream is encrypted (AES-CTR, with a key made on
// this computer and kept in its IndexedDB, so the files are no use anywhere else) and written to the
// app's data folder by src-tauri/src/offline.rs; to play, it's read back through the asset protocol and
// decrypted. A downloaded playlist keeps up: songs added download, songs taken out are deleted. Each
// song's cover and lyrics are kept too. Only in the app.
export const canDownload = "__TAURI_INTERNALS__" in window;

type Saved = { mime: string; duration: number; loudness: number; size: number };
// A downloaded list, by library key. An album keeps its page, to open offline.
type List = { title: string; thumb?: string; at: number; collection?: Collection };
// art: kept pictures, by their address without a size (yt.ts artBase), to their file's name.
type Offline = { songs: Record<string, Saved>; lists: Record<string, List>; art: Record<string, string>; waiting: string[]; failed: string[] };
export const useOffline = create<Offline>()(
  persist((): Offline => ({ songs: {}, lists: {}, art: {}, waiting: [], failed: [] }), { name: "offline", storage: createJSONStorage(() => idb), partialize: ({ songs, lists, art }) => ({ songs, lists, art }) }),
);
const set = useOffline.setState, get = useOffline.getState;

// A list's songs: yours from the library, an album's from the page it was downloaded with.
export function listTracks(key: string): Track[] {
  const l = useLibrary.getState();
  if (key === "liked") return l.liked;
  if (key.startsWith("playlist:")) return l.playlists.find((p) => libraryKey("playlist", p.id) === key)?.tracks ?? [];
  return get().lists[key]?.collection?.tracks ?? [];
}
const wanted = () => {
  const songs = new Map<string, Track>();
  for (const key of Object.keys(get().lists)) for (const t of listTracks(key)) if (!t.file) songs.set(t.id, t);
  return songs;
};

export function download(key: string, about: Omit<List, "at">) {
  set((s) => ({ lists: { ...s.lists, [key]: { ...about, at: Date.now() } }, failed: [] }));
  sync();
}
export function removeDownload(key: string) {
  const { title } = get().lists[key] ?? {};
  set((s) => ({ lists: Object.fromEntries(Object.entries(s.lists).filter(([k]) => k !== key)) }));
  sync();
  notify({ text: "Download Removed", detail: title });
}
export function removeAllDownloads() {
  set({ lists: {} });
  sync();
  notify({ text: "Downloads Removed" });
}

// Brings the files in line with the downloaded lists: queues what's missing, deletes what's no longer
// in any. Runs when a list is downloaded or removed, when the library changes, and back online.
function sync() {
  const need = wanted();
  const { songs, waiting, lists, art } = get();
  const extra = Object.keys(songs).filter((id) => !need.has(id));
  if (extra.length) {
    void invoke("delete_downloads", { names: extra }).catch(() => {});
    set((s) => ({ songs: Object.fromEntries(Object.entries(s.songs).filter(([id]) => need.has(id))) }));
  }
  // Pictures no downloaded song or list shows any more go too.
  const shown = new Set([...need.values()].map((t) => t.thumb).concat(Object.values(lists).map((l) => l.thumb)).flatMap((u) => (u ? [artBase(u)] : [])));
  const unshown = Object.keys(art).filter((b) => !shown.has(b));
  if (unshown.length) {
    void invoke("delete_downloads", { names: unshown.flatMap((b) => SIZES.map(([x]) => `${art[b]}-${x}`)) }).catch(() => {});
    set((s) => ({ art: Object.fromEntries(Object.entries(s.art).filter(([b]) => shown.has(b))) }));
  }
  // Covers and lyrics for what's downloaded, songs from before they were kept included; lists' covers.
  keepExtras([...need.values()].filter((t) => songs[t.id]));
  for (const l of Object.values(lists)) void keepArt(l.thumb).catch(() => {});
  const missing = [...need.keys()].filter((id) => !songs[id] && !waiting.includes(id));
  set((s) => ({ waiting: [...s.waiting.filter((id) => need.has(id)), ...missing] }));
  for (let i = working; i < 2; i++) void work();
}
let working = 0;
// Two songs at a time, each fetched whole (fetchAudio's ranges, all at once), encrypted, written.
async function work() {
  working++;
  try {
    for (let id: string | undefined; (id = get().waiting.find((x) => !busy.has(x))) && navigator.onLine; ) {
      busy.add(id);
      try {
        const { chunks, mime, duration, loudness } = await fetchAudio(id, useSettings.getState().quality);
        const parts = await Promise.all(chunks);
        const plain = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
        parts.reduce((at, p) => (plain.set(new Uint8Array(p), at), at + p.byteLength), 0);
        const data = await seal(plain);
        await invoke("save_download", data, { headers: { "x-name": id } });
        const t = wanted().get(id);
        if (t) set((s) => ({ songs: { ...s.songs, [id!]: { mime, duration: duration ?? 0, loudness, size: data.byteLength } } })), keepExtras([t]);
        else void invoke("delete_downloads", { names: [id] }); // taken out while it downloaded
      } catch {
        set((s) => ({ failed: [...s.failed, id!] }));
      } finally {
        busy.delete(id);
        set((s) => ({ waiting: s.waiting.filter((x) => x !== id) }));
      }
    }
  } finally {
    working--;
    const { failed, waiting } = get();
    if (!working && !waiting.length && failed.length) notify({ text: "Some Songs Didn’t Download", detail: `${plural(failed.length, "song")} will try again later` });
  }
}
const busy = new Set<string>();

// Artwork, kept so covers show offline: each picture once (an album's songs share one), small for lists
// and large for Now Playing. art() in yt.ts then draws it from disk, offline or not.
const SIZES = [["s", 160], ["l", 1000]] as const;
const fnv = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0, 0x811c9dc5).toString(16).padStart(8, "0");
async function keepArt(url?: string) {
  if (!url || !/^https?:/.test(url) || get().art[artBase(url)]) return;
  const name = `art-${fnv(artBase(url))}`;
  for (const [x, w] of SIZES) {
    const r = await fetch(sizedArt(url, w));
    if (!r.ok) throw new Error(`Artwork: ${r.status}`);
    await invoke("save_download", new Uint8Array(await r.arrayBuffer()), { headers: { "x-name": `${name}-${x}` } });
  }
  set((s) => ({ art: { ...s.art, [artBase(url)]: name } }));
}
let dir: string | undefined; // the downloads folder, once Rust says where (folder, below)
covers.local = (url, w) => {
  const name = get().art[artBase(url)];
  return name && dir ? convertFileSrc(`${dir}/${name}-${w <= 160 ? "s" : "l"}`) : undefined;
};

// A downloaded song's cover and lyrics, two songs at a time, each asked for once a launch.
const asked = new Set<string>();
const extras: Track[] = [];
let fetching = 0;
function keepExtras(tracks: Track[]) {
  for (const t of tracks) if (!asked.has(t.id)) asked.add(t.id), extras.push(t);
  while (fetching < 2 && extras.length && navigator.onLine) void nextExtras();
}
async function nextExtras() {
  fetching++;
  for (let t; navigator.onLine && (t = extras.shift()); ) await Promise.all([keepArt(t.thumb).catch(() => asked.delete(t!.id)), keepLyrics(t)]);
  fetching--;
}

// The key: made once, kept in IndexedDB as raw bytes and imported into a non-extractable CryptoKey in memory,
// avoiding macOS Keychain prompts on each build. Each file starts with its own 16-byte counter block.
const key = (async () => {
  let raw = await idbGet<Uint8Array>("offline-key-raw").catch(() => undefined);
  if (!raw || !(raw instanceof Uint8Array) || raw.byteLength !== 32) {
    raw = crypto.getRandomValues(new Uint8Array(32));
    await idbPut("offline-key-raw", raw).catch(() => {});
  }
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "AES-CTR" }, false, ["encrypt", "decrypt"]);
})();
async function seal(plain: Uint8Array<ArrayBuffer>) {
  const counter = crypto.getRandomValues(new Uint8Array(16));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter, length: 64 }, await key, plain));
  const out = new Uint8Array(16 + sealed.byteLength);
  out.set(counter), out.set(sealed, 16);
  return out;
}
async function open(data: ArrayBuffer) {
  return crypto.subtle.decrypt({ name: "AES-CTR", counter: new Uint8Array(data, 0, 16), length: 64 }, await key, new Uint8Array(data, 16));
}

const timeout = <T>(p: Promise<T>, ms: number, err: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(err)), ms))]);

const folder = canDownload ? invoke<string>("downloads_dir") : Promise.reject(new Error("Downloads need the app"));
export const ready = folder.then((d) => void (dir = d), () => {});
const CHUNK = 1 << 20;
function isValidAudio(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 8) return false;
  const u8 = new Uint8Array(buf, 0, 8);
  const tag = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
  const isEbml = u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3;
  return tag === "ftyp" || tag === "moof" || tag === "styp" || tag === "moov" || isEbml;
}

// A downloaded song, read back in the shape store.ts plays (fetchAudio's): its bytes in 1 MB pieces.
async function read(id: string, saved: Saved) {
  const dir = await folder;
  const r = await fetch(convertFileSrc(`${dir}/${id}`));
  if (!r.ok) throw new Error(`Download missing: ${r.status}`);
  const plain = await timeout(open(await r.arrayBuffer()), 1500, "Decryption timed out");
  if (!isValidAudio(plain)) throw new Error("Corrupted offline download (key mismatch)");
  const chunks: Promise<ArrayBuffer>[] = [];
  for (let at = 0; at < plain.byteLength; at += CHUNK) chunks.push(Promise.resolve(plain.slice(at, at + CHUNK)));
  return { chunks, mime: saved.mime, duration: saved.duration, loudness: saved.loudness };
}
downloads.has = (id) => !!get().songs[id];
downloads.read = (id) => {
  const saved = get().songs[id];
  if (!saved) return undefined;
  return read(id, saved).catch(async (e) => {
    console.warn(`Failed to read offline download ${id}, streaming online instead:`, e);
    // Remove the incompatible/corrupt download and trigger a fresh re-download
    set((s) => {
      const songs = { ...s.songs };
      delete songs[id];
      return { songs };
    });
    void invoke("delete_downloads", { names: [id] }).catch(() => {});
    return fetchAudio(id, useSettings.getState().quality);
  });
};

// How far along a list is: songs saved of its songs. done when all of them are.
export function progress(key: string, s: Offline) {
  if (!s.lists[key]) return undefined;
  const tracks = listTracks(key).filter((t) => !t.file);
  const saved = tracks.filter((t) => s.songs[t.id]).length;
  return { saved, total: tracks.length, done: saved === tracks.length };
}
export const downloadedSize = () => (canDownload ? invoke<number>("downloads_size") : Promise.resolve(0));

// Keeping up: a change to a downloaded list (or getting back online) syncs, a beat later, once.
let soon = 0;
const later = () => (clearTimeout(soon), (soon = setTimeout(() => (set({ failed: [] }), sync()), 800)));
useLibrary.subscribe((l, was) => {
  const { lists } = get();
  if ((lists.liked && l.liked !== was.liked) || (l.playlists !== was.playlists && Object.keys(lists).some((k) => k.startsWith("playlist:")))) later();
});
addEventListener("online", later);
const boot = () => canDownload && Object.keys(get().lists).length && later();
if (useOffline.persist.hasHydrated()) boot();
else useOffline.persist.onFinishHydration(boot);
