import { fetch } from "@tauri-apps/plugin-http";
import { findSong } from "./import";
import { parseSecs, type Artist, type Collection, type Track } from "./yt";

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
const length = (s = 0) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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

// An album's songs with their guests, from each song's own entry, as in Mixtape. One request a song, so
// the page shows the album first and these a moment later; a song with no guests, or one that fails,
// stays as it was.
export const withGuests = (tracks: Track[]) =>
  Promise.all(tracks.map((t) => (isDeezer(t.id) ? get(`track/${t.id.slice(3)}`).then((d: DzTrack) => (d.contributors && d.contributors.length > 1 ? { ...t, artists: d.contributors.map(who) } : t), () => t) : t)));

// A song from Deezer plays from its copy on YouTube, found the way a CSV import finds songs, the first time
// it's played or queued up next, and remembered.
const found: Record<string, string> = JSON.parse(localStorage.youtubeIds ?? "{}");
const finding = new Map<string, Promise<string>>();
export function youtubeId(t: Track): Promise<string> {
  if (!isDeezer(t.id) || found[t.id]) return Promise.resolve(found[t.id] ?? t.id);
  if (!finding.has(t.id))
    finding.set(
      t.id,
      findSong({ title: t.title, artist: t.artists.map((a) => a.name).join(", "), album: t.album, secs: parseSecs(t.duration) })
        .then((hit) => (hit ? ((found[t.id] = hit.id), (localStorage.youtubeIds = JSON.stringify(found)), hit.id) : Promise.reject(new Error(`Couldn’t find “${t.title}” on YouTube`))))
        .finally(() => finding.delete(t.id)),
    );
  return finding.get(t.id)!;
}
