import { fetch } from "@tauri-apps/plugin-http";
import { findSong, rowOf } from "./import";
import { patch, patchAll, replay } from "./store";
import type { Artist, Collection, Track } from "./yt";

// Albums saved from Deezer (when artist pages came from there) still open from it, as in Mixtape. A song
// from here only goes to YouTube when it's played (youtubeId).
// Calls go out ~9 a second, under Deezer's 50 per 5 s; the same call within a minute is answered from
// memory (or waits on the one already out), and one turned away for the quota goes again a little later.
let slot = 0;
const cache = new Map<string, { at: number; body: Promise<any> }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string, tries = 0): Promise<any> {
  const hit = cache.get(path);
  if (!hit || Date.now() - hit.at > 60_000) {
    if (cache.size >= 240) cache.clear();
    const wait = Math.max(0, slot - Date.now());
    slot = Date.now() + wait + 110;
    cache.set(path, { at: Date.now(), body: sleep(wait).then(() => fetch(`https://api.deezer.com/${path}`)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Deezer ${r.status}`)))) });
  }
  const data = await cache.get(path)!.body.catch((e) => (cache.delete(path), Promise.reject(e)));
  if (!data?.error) return data;
  cache.delete(path);
  // Deezer answers errors with a 200: code 4 is the quota, 700 is busy. Anything else fails the same again.
  const { code, message = "" } = data.error;
  if ((code === 4 || code === 700 || /quota/i.test(message)) && tries < 3) return sleep(2 ** tries * 700 + Math.random() * 300).then(() => get(path, tries + 1));
  throw new Error(message || "Deezer couldn’t answer");
}

type DzArtist = { id: number; name: string };
type DzAlbum = { id: number; title: string; cover_xl?: string; release_date?: string; record_type?: string; artist?: DzArtist; contributors?: DzArtist[] };
type DzTrack = { id: number; title: string; duration?: number; explicit_lyrics?: boolean; artist: DzArtist; album?: DzAlbum; contributors?: DzArtist[] };

export const isDeezer = (id: string) => id.startsWith("dz:");
const who = (a: DzArtist): Artist => ({ id: `dz:artist:${a.id}`, name: a.name });
export const length = (s = 0) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const toTrack = (t: DzTrack, album = t.album): Track => ({
  id: `dz:${t.id}`,
  title: t.title,
  artists: (t.contributors?.length ? t.contributors : [t.artist]).map(who),
  album: album?.title ?? "",
  ...(album && { albumId: `dz:album:${album.id}`, thumb: album.cover_xl }),
  duration: length(t.duration),
  ...(t.explicit_lyrics && { explicit: true as const }),
});
const KIND: Record<string, string> = { album: "Album", ep: "EP", single: "Single", compile: "Compilation" };

// One of each song, the explicit version where there are both.
function explicitFirst(tracks: DzTrack[]) {
  const best = new Map<string, DzTrack>();
  for (const t of tracks) {
    const key = `${t.title}|${t.artist?.name}`.toLowerCase(), had = best.get(key);
    if (!had || (!had.explicit_lyrics && t.explicit_lyrics)) best.set(key, t);
  }
  return [...best.values()];
}

// Its songs name only the lead artist; withGuests adds the rest.
export async function album(id: string): Promise<Collection> {
  const n = id.slice(9);
  const [a, list] = await Promise.all([get(`album/${n}`) as Promise<DzAlbum & { duration?: number }>, get(`album/${n}/tracks?limit=100`).then((r): DzTrack[] => r.data ?? [])]);
  const tracks = explicitFirst(list).map((t) => toTrack(t, a));
  const mins = Math.round((a.duration ?? 0) / 60);
  return {
    title: a.title,
    by: (a.contributors?.length ? a.contributors : a.artist ? [a.artist] : []).map(who),
    kind: KIND[a.record_type ?? ""],
    meta: [a.release_date?.slice(0, 4), `${tracks.length} ${tracks.length === 1 ? "song" : "songs"}`, mins ? `${mins} min` : ""].filter((x): x is string => !!x),
    thumb: a.cover_xl,
    tracks,
  };
}

// A playlist from a link: all its songs, 100 to a call, imported as they are (each finds its YouTube copy when played).
export async function playlist(id: string) {
  const p = await get(`playlist/${id}`), list: DzTrack[] = [];
  for (let i = 0; i < p.nb_tracks; i += 100) list.push(...((await get(`playlist/${id}/tracks?index=${i}&limit=100`)).data ?? []));
  return { name: p.title as string, cover: p.picture_xl as string | undefined, tracks: list.map((t) => toTrack(t)) };
}

// An album's songs with their guests, from each song's own entry, as in Mixtape. One request a song, so
// the page shows the album first and these a moment later; a song with no guests, or one that fails,
// stays as it was.
export const withGuests = (tracks: Track[]) =>
  Promise.all(tracks.map((t) => (isDeezer(t.id) ? get(`track/${t.id.slice(3)}`).then((d: DzTrack) => (d.contributors && d.contributors.length > 1 ? { ...t, artists: d.contributors.map(who) } : t), () => t) : t)));

// A song from Deezer, Spotify or a CSV plays from its copy on YouTube, found the first time it's played or
// queued up next, and remembered; one without a cover takes the copy's. Any song can be pinned to another
// version (Wrong Version…).
const found: Record<string, string> = JSON.parse(localStorage.youtubeIds ?? "{}");
const finding = new Map<string, Promise<string>>();
const keep = (id: string, yt: string) => ((found[id] = yt), (localStorage.youtubeIds = JSON.stringify(found)));
// The YouTube song an imported one was found as, if it has been.
export const known = (id: string): string | undefined => found[id];
export const foundWhenPlayed = (id: string) => /^(dz|sp|csv):/.test(id);
// A song from your files is looked up the same way, for its radio.
export function youtubeId(t: Track): Promise<string> {
  if (!(foundWhenPlayed(t.id) || t.file) || found[t.id]) return Promise.resolve(found[t.id] ?? t.id);
  if (!finding.has(t.id))
    finding.set(
      t.id,
      findSong(rowOf(t))
        .then((hit) => (hit ? (keep(t.id, hit.id), !t.thumb && !t.file && hit.thumb && patch(t.id, { thumb: hit.thumb }), hit.id) : Promise.reject(new Error(`Couldn’t find “${t.title}” on YouTube`))))
        .finally(() => finding.delete(t.id)),
    );
  return finding.get(t.id)!;
}
export const pin = (t: Track, yt: string) => (keep(t.id, yt), replay(t.id));

// Covers (and lengths) for songs that came without them (a CSV), by ISRC, three calls out at a time so
// others still get in. The songs on screen go first (onScreen: replacing the last screen's) and are drawn
// as soon as they're in; the rest are written a few seconds' worth at a time, so a big list isn't redrawn
// and saved for every song.
let screen: Track[] = [], workers = 0, flush: ReturnType<typeof setTimeout> | undefined, due = Infinity;
const rest: Track[] = [], tried = new Set<string>(), got = new Map<string, Partial<Track>>();
const save = (ms: number) => {
  if (Date.now() + ms >= due) return;
  clearTimeout(flush), (due = Date.now() + ms);
  flush = setTimeout(() => (patchAll(new Map(got)), got.clear(), (due = Infinity)), ms);
};
async function coverNext() {
  workers++;
  for (;;) {
    const soon = screen.length > 0, t = screen.shift() ?? rest.shift();
    if (!t) break;
    if (tried.has(t.id)) continue;
    tried.add(t.id);
    const d: DzTrack | undefined = await get(`track/isrc:${t.isrc}`).catch(() => undefined);
    if (d?.album?.cover_xl) got.set(t.id, { thumb: d.album.cover_xl, ...(!t.duration && d.duration && { duration: length(d.duration) }) }), save(soon ? 150 : 5000);
  }
  workers--;
}
export function covers(tracks: Track[], onScreen = false) {
  const need = tracks.filter((t) => !t.thumb && t.isrc && !tried.has(t.id));
  if (onScreen) screen = need;
  else rest.push(...need);
  while (workers < 3 && (screen.length || rest.length)) void coverNext();
}
