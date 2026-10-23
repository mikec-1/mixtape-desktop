import { useMemo } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { fetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { files, forget, idb, notify, plural, useStore } from "./store";
import { searchKind, type Track } from "./yt";

// Your own music: folders on this computer, read by src-tauri/src/local.rs. What a scan found is kept,
// so Local Files is there at once on launch; a scan in the background then picks up what changed.
// Only in the app: a browser can't read your folders.
export const canHaveFiles = "__TAURI_INTERNALS__" in window;
type LocalFile = { path: string; mtime: number; title: string; artist: string; album: string; albumArtist: string; track: number; disc: number; duration: number; cover?: string };
// What you typed over a song's own tags when it was dropped in (SongImport in views.tsx). cover: a picture URL.
export type SongEdit = { title: string; artist: string; feat: string; album: string; year?: string; genre?: string; cover?: string };
type Local = { folders: string[]; files: Record<string, LocalFile>; edits: Record<string, SongEdit>; skip: string[]; scanning: boolean };
export const useLocal = create<Local>()(
  persist((): Local => ({ folders: [], files: {}, edits: {}, skip: [], scanning: false }), { name: "local", storage: createJSONStorage(() => idb), partialize: ({ folders, files, edits, skip }) => ({ folders, files, edits, skip }) }),
);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
// "A; B" and "A / B" are two artists; "A, B" may be one band, so it stays one.
const artists = (s: string) => (s ? s.split(/\s*;\s*|\s+\/\s+/).filter(Boolean).map((name) => ({ name })) : []);
export const fileTrack = (f: LocalFile): Track => {
  const e = useLocal.getState().edits?.[f.path];
  return {
    id: `file:${f.path}`,
    file: f.path,
    title: e?.title || f.title,
    artists: e ? [e.artist, ...e.feat.split(/\s*[,&]\s*/)].filter(Boolean).map((name) => ({ name })) : artists(f.artist || f.albumArtist),
    album: (e ? e.album : f.album) || undefined,
    thumb: e?.cover ?? (f.cover && convertFileSrc(f.cover)),
    duration: clock(f.duration),
  };
};

// A song's tags read the way you'd write them: "Artist - Song (feat. X) [Official Audio]" from a bare
// file name split up, the feature taken out of either field, the upload junk dropped.
const FEAT = /(?<=\S)\s+[([]?\s*\b(?:feat|ft|featuring)\b\.?\s+([^)\]]+?)\s*[)\]]?\s*$/i;
export function guessTags(f: Pick<LocalFile, "title" | "artist" | "album">): SongEdit {
  let title = f.title.replace(/_/g, " ").replace(/\s*[([](?:official\s*)?(?:music\s*)?(?:audio|video|lyrics?|visuali[sz]er|hq|hd)[^)\]]*[)\]]/gi, "").trim();
  let artist = f.artist;
  if (!artist && title.includes(" - ")) [artist, title] = [title.slice(0, title.indexOf(" - ")), title.slice(title.indexOf(" - ") + 3)];
  const feats: string[] = [];
  const take = (s: string) => s.replace(FEAT, (_, who: string) => (feats.push(who.trim()), ""));
  title = take(title).trim();
  artist = take(artist).trim();
  return { title, artist, feat: feats.join(", "), album: f.album };
}
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
  const edits = useLocal((s) => s.edits);
  return useMemo(() => Object.values(files).sort(by).map(fileTrack), [files, edits]); // eslint-disable-line react-hooks/exhaustive-deps
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
// Songs dropped on the window: kept in Local Files like a folder of one.
export async function addFiles(paths: string[]) {
  useLocal.setState((s) => ({ folders: [...s.folders, ...paths.filter((p) => !s.folders.includes(p))], skip: s.skip.filter((p) => !paths.includes(p)) }));
  await rescan();
  const songs = paths.filter((p) => useLocal.getState().files[p]);
  // A folder goes straight in; songs on their own get a look over first.
  if (songs.length < paths.length) notify({ text: "Folder Added", detail: `${plural(localTracks().length, "song")} in your Local Files` });
  // More dropped while still looking over the last ones: they join the end of that list.
  if (songs.length) useStore.setState(({ dialog: d }) => ({ dialog: { kind: "songs", paths: [...new Set([...(d?.kind === "songs" && !d.editing ? d.paths : []), ...songs])] } }));
}
// The song an edit is of, from Apple's catalogue (as Mixtape does it): searched without "slowed", "sped up"
// and the like, then kept only when the title's words are all in the result's and either artist's name
// holds the other's. The title stays as yours ("ОТПУСТИ МЕНЯ slowed"); artist, album, year, genre and
// cover come from the original, so the edit sits with that artist.
const VERSION = /[([]?\s*\b(?:slowed(?:\s*(?:\+|&|and)?\s*(?:reverb|down))?|sped\s*up|speed\s*up|reverb|nightcore|lo-?fi|bass\s*boost(?:ed)?|8d(?:\s*audio)?|chopped(?:\s*(?:and|&)\s*screwed)?|super\s*slowed|ultra\s*slowed|tik\s*tok(?:\s*(?:edit|remix|version))?|(?:hardstyle|phonk|jersey|drill|techno)(?:\s*(?:edit|remix|version))?|(?:extended|radio|official)?\s*(?:edit|remix|version|mix)|remaster(?:ed)?|acoustic|instrumental)\b\s*[)\]]?/gi;
export const stripVersion = (t: string) => t.replace(VERSION, " ").replace(/\s*[-–|]\s*$|\(\s*\)|\[\s*\]/g, "").replace(/\s+/g, " ").trim() || t;
const words = (s: string) => new Set(s.toLowerCase().replace(/\(\s*(?:feat|ft|with)\b[^)]*\)/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
const within = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((w) => b.has(w));
const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length / (new Set([...a, ...b]).size || 1);
type Apple = { trackName: string; artistName: string; collectionName: string; releaseDate?: string; primaryGenreName?: string; artworkUrl100?: string };
export type Found = { edit: SongEdit; source: "Apple Music" | "YouTube Music"; sure: boolean };
// The best of Apple's results for the song read this way round, if any is it.
function apple(e: SongEdit, results: Apple[]): Found | undefined {
  const t = words(stripVersion(e.title)), a = words(e.artist);
  const best = results
    .filter((x) => !/karaoke|tribute|made famous|instrumental/i.test(x.trackName) && within(t, words(stripVersion(x.trackName))) && (!a.size || within(a, words(x.artistName)) || within(words(x.artistName), a)))
    .map((x) => ({ x, score: jaccard(t, words(stripVersion(x.trackName))) * 0.65 + (a.size ? jaccard(a, words(x.artistName)) : 0.5) * 0.35 }))
    .sort((p, q) => q.score - p.score)[0];
  if (!best || best.score < 0.25) return;
  const x = best.x;
  const [artist, ...feat] = x.artistName.split(SPLIT).filter(Boolean);
  return {
    edit: { ...e, artist, feat: e.feat || feat.join(", "), album: x.collectionName.replace(/\s*-\s*(Single|EP)$/i, ""), year: x.releaseDate?.slice(0, 4), genre: x.primaryGenreName, cover: x.artworkUrl100?.replace("100x100bb", "1000x1000bb") },
    source: "Apple Music",
    sure: best.score >= 0.6,
  };
}
// The first of YouTube Music's top songs with all the title's words and the artist (a lot of edits, and
// some whole artists, are only there): its artwork and album.
function youtube(e: SongEdit, results: Track[]): Found | undefined {
  const t = words(stripVersion(e.title)), a = words(e.artist);
  const y = results.slice(0, 5).find((y) => within(t, words(stripVersion(y.title))) && (!a.size || y.artists.some((n) => within(a, words(n.name)) || within(words(n.name), a))));
  return y && { edit: { ...e, album: e.album || y.album || "", cover: y.thumb }, source: "YouTube Music", sure: false };
}
const SPLIT = /\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i;
const key = (s: string) => s.trim().toLowerCase();
// A search that fails or takes over 6 s counts as finding nothing, so the sheet never waits on it.
const capped = <T,>(p: Promise<T>, none: T) => Promise.race([p.catch(() => none), new Promise<T>((ok) => setTimeout(() => ok(none), 6000))]);
type Row = Apple & { wrapperType?: string; artistId?: number };
const STORES = ["gb", "us", "au", "ca"];
const itunes = (path: string, q: Record<string, string>) => capped(fetch(`https://itunes.apple.com/${path}?${new URLSearchParams(q)}`).then((r) => r.json() as Promise<{ results: Row[] }>).then((r) => r.results), []);
const stores = async (q: (country: string) => Promise<Row[]>) => (await Promise.all(STORES.map(q))).flat();
// Mixtape's search: the title in all four stores, plus every song the artist has (found in GB first, then
// US, AU, CA). Apple's text search leaves a lot out ("Mist" by EsDeeKid); the artist's catalogue has it.
async function catalogue(e: SongEdit) {
  const title = stripVersion(e.title), artist = e.artist.trim() || title;
  const [named, ids] = await Promise.all([
    stores((country) => itunes("search", { term: title, media: "music", entity: "song", limit: "25", country })),
    Promise.all(STORES.map((country) => itunes("search", { term: artist, entity: "musicArtist", limit: "5", country }))),
  ]);
  const id = ids.find((r) => r[0]?.artistId)?.[0].artistId;
  const theirs = id ? await stores((country) => itunes("lookup", { id: String(id), entity: "song", limit: "200", country })) : [];
  const seen = new Set<string>();
  return [...named, ...theirs].filter((x) => x.wrapperType === "track" && !seen.has(key(`${x.trackName}|${x.artistName}`)) && !!seen.add(key(`${x.trackName}|${x.artistName}`)));
}
export async function lookUp(e: SongEdit): Promise<Found | undefined> {
  const [songs, ys] = await Promise.all([catalogue(e), capped(searchKind(`${stripVersion(e.artist)} ${stripVersion(e.title)}`.trim(), "song"), [])]);
  // "Song - Artist" is as common as "Artist - Song": a miss is looked up again the other way round.
  const flip = { ...e, title: e.artist, artist: e.title };
  const flipped = !apple(e, songs) && e.artist ? await catalogue(flip) : [];
  songs.push(...flipped);
  const hit = apple(e, songs) ?? (e.artist ? apple(flip, flipped) : undefined) ?? youtube(e, ys) ?? (e.artist ? youtube(flip, ys) : undefined);
  if (hit) return hit;
  // Found in neither (unreleased, say): the artists the searches did turn up still say which way round it is.
  const apples = new Set(songs.flatMap((x) => x.artistName.split(SPLIT).map(key))), yts = new Set(ys.flatMap((y) => y.artists.map((n) => key(n.name))));
  const named = (s: string) => apples.has(key(s)) || yts.has(key(s));
  const way = named(e.artist) ? e : e.artist && named(e.title) ? flip : undefined;
  if (way) return { edit: way, source: apples.has(key(way.artist)) ? "Apple Music" : "YouTube Music", sure: false };
}
export const addedFiles = (paths: string[]) => {
  const t = fileTrack(useLocal.getState().files[paths[0]]);
  notify({ text: paths.length > 1 ? `Added ${paths.length} Songs` : `Added ${t.title}`, detail: "In your Local Files", thumb: t.thumb });
};
// Takes songs out of Sleeve, not off the disk: songs dropped on their own go, ones in a folder are passed
// over by later scans. Gone from your playlists and the queue too.
export function removeFiles(paths: string[]) {
  const out = new Set(paths);
  const t = paths.length === 1 && useLocal.getState().files[paths[0]] && fileTrack(useLocal.getState().files[paths[0]]);
  useLocal.setState((s) => {
    const folders = s.folders.filter((f) => !out.has(f));
    const drop = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([p]) => !out.has(p)));
    return { folders, files: drop(s.files), edits: drop(s.edits), skip: [...s.skip, ...paths.filter((p) => folders.some((f) => inside(p, f)))] };
  });
  forget(paths.map((p) => `file:${p}`));
  notify({ text: "Removed from Local Files", detail: t ? t.title : plural(paths.length, "song"), thumb: t ? t.thumb : undefined });
}
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
export function removeFolder(folder: string) {
  const before = Object.keys(useLocal.getState().files);
  useLocal.setState((s) => {
    const folders = s.folders.filter((f) => f !== folder);
    return { folders, files: Object.fromEntries(Object.entries(s.files).filter(([p]) => folders.some((f) => inside(p, f)))) };
  });
  const files = useLocal.getState().files;
  forget(before.filter((p) => !files[p]).map((p) => `file:${p}`));
}

// Reads the folders again: only files whose modified time changed are read for tags. One at a time: asked
// for while one runs, it runs once more after, so a folder added or removed meanwhile is seen.
let last = Promise.resolve();
let waiting: Promise<void> | undefined;
export const rescan = () => (waiting ??= last.then(() => ((waiting = undefined), (last = scan()))));
async function scan() {
  const { folders, files } = useLocal.getState();
  useLocal.setState({ scanning: true });
  try {
    const known = Object.fromEntries(Object.values(files).map((f) => [f.path, f.mtime]));
    const r = await invoke<{ files: LocalFile[]; unchanged: string[] }>("scan_music", { folders, known });
    const next: Record<string, LocalFile> = {};
    for (const p of r.unchanged) if (files[p]) next[p] = files[p];
    for (const f of r.files) next[f.path] = f;
    const now = useLocal.getState();
    const skip = new Set(now.skip);
    useLocal.setState({ files: Object.fromEntries(Object.entries(next).filter(([p]) => !skip.has(p) && now.folders.some((f) => inside(p, f)))) });
  } catch (e) {
    notify({ text: "Couldn’t Read Your Music", detail: String(e) });
  } finally {
    useLocal.setState({ scanning: false });
  }
}

// At launch: let the webview play from the folders (permission doesn't outlive the app), then look again.
const boot = () => {
  const { folders } = useLocal.getState();
  if (canHaveFiles && folders.length) void invoke("allow_music", { folders }).then(rescan, () => {});
};
if (useLocal.persist.hasHydrated()) boot();
else useLocal.persist.onFinishHydration(boot);
