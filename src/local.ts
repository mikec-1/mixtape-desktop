import { useMemo } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { files, idb, notify, plural } from "./store";
import type { Track } from "./yt";

// Your own music: folders on this computer, read by src-tauri/src/local.rs. What a scan found is kept,
// so Local Files is there at once on launch; a scan in the background then picks up what changed.
// Only in the app: a browser can't read your folders.
export const canHaveFiles = "__TAURI_INTERNALS__" in window;
type LocalFile = { path: string; mtime: number; title: string; artist: string; album: string; albumArtist: string; track: number; disc: number; duration: number; cover?: string };
type Local = { folders: string[]; files: Record<string, LocalFile>; scanning: boolean };
export const useLocal = create<Local>()(
  persist((): Local => ({ folders: [], files: {}, scanning: false }), { name: "local", storage: createJSONStorage(() => idb), partialize: ({ folders, files }) => ({ folders, files }) }),
);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
// "A; B" and "A / B" are two artists; "A, B" may be one band, so it stays one.
const artists = (s: string) => (s ? s.split(/\s*;\s*|\s+\/\s+/).filter(Boolean).map((name) => ({ name })) : []);
const fileTrack = (f: LocalFile): Track => ({
  id: `file:${f.path}`,
  file: f.path,
  title: f.title,
  artists: artists(f.artist || f.albumArtist),
  album: f.album || undefined,
  thumb: f.cover && convertFileSrc(f.cover),
  duration: clock(f.duration),
});
// Songs with no artist go last.
const by = (a: LocalFile, b: LocalFile) =>
  (a.albumArtist || a.artist || "\uffff").localeCompare(b.albumArtist || b.artist || "\uffff", undefined, { sensitivity: "base" }) ||
  a.album.localeCompare(b.album, undefined, { sensitivity: "base" }) ||
  a.disc - b.disc ||
  a.track - b.track ||
  a.title.localeCompare(b.title);
// Your files as songs, by artist, album and track number.
export function useLocalTracks() {
  const files = useLocal((s) => s.files);
  return useMemo(() => Object.values(files).sort(by).map(fileTrack), [files]);
}
export const localTracks = () => Object.values(useLocal.getState().files).sort(by).map(fileTrack);
files.has = (path) => !!useLocal.getState().files[path];

export async function addFolder() {
  const picked = await open({ directory: true, multiple: true, title: "Add Music Folder" }).catch(() => null);
  const add = [picked ?? []].flat().filter((f) => !useLocal.getState().folders.includes(f));
  if (!add.length) return;
  useLocal.setState((s) => ({ folders: [...s.folders, ...add] }));
  await rescan();
  notify({ text: "Folder Added", detail: `${plural(localTracks().length, "song")} in your Local Files` });
}
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
export const removeFolder = (folder: string) =>
  useLocal.setState((s) => {
    const folders = s.folders.filter((f) => f !== folder);
    return { folders, files: Object.fromEntries(Object.entries(s.files).filter(([p]) => folders.some((f) => inside(p, f)))) };
  });

// Reads the folders again: only files whose modified time changed are read for tags. One at a time.
let running: Promise<void> | undefined;
export const rescan = () =>
  (running ??= (async () => {
    const { folders, files } = useLocal.getState();
    useLocal.setState({ scanning: true });
    try {
      const known = Object.fromEntries(Object.values(files).map((f) => [f.path, f.mtime]));
      const r = await invoke<{ files: LocalFile[]; unchanged: string[] }>("scan_music", { folders, known });
      const next: Record<string, LocalFile> = {};
      for (const p of r.unchanged) if (files[p]) next[p] = files[p];
      for (const f of r.files) next[f.path] = f;
      useLocal.setState({ files: next });
    } catch (e) {
      notify({ text: "Couldn’t Read Your Music", detail: String(e) });
    } finally {
      useLocal.setState({ scanning: false });
      running = undefined;
    }
  })());

// At launch: let the webview play from the folders (permission doesn't outlive the app), then look again.
const boot = () => {
  const { folders } = useLocal.getState();
  if (canHaveFiles && folders.length) void invoke("allow_music", { folders }).then(rescan, () => {});
};
if (useLocal.persist.hasHydrated()) boot();
else useLocal.persist.onFinishHydration(boot);
