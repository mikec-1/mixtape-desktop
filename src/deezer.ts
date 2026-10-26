import { fetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { findSong, latin, rowOf } from "./import";
import { heard } from "./recognize";
import { patch, patchAll, replay } from "./store";
import { parseSecs, type Artist, type Collection, type Track } from "./yt";

// Albums saved from Deezer (when artist pages came from there) still open from it, as in Mixtape. A song
// from here only goes to YouTube when it's played (youtubeId).
// Calls go out ~9 a second, under Deezer's 50 per 5 s; the same call within a minute is answered from
// memory (or waits on the one already out), and one turned away for the quota goes again a little later.
let slot = 0;
const cache = new Map<string, { at: number; body: Promise<any> }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// lang: the language to ask in; Deezer titles a song in it where the label gave one (see topSongs).
// soon: a cover on screen, which goes in its own line rather than behind an artist page's album lists
// (a burst over the quota is turned away and goes again).
let soonSlot = 0;
async function get(path: string, tries = 0, lang?: string, soon = false): Promise<any> {
  const key = `${lang ?? ""}${path}`, hit = cache.get(key);
  if (!hit || Date.now() - hit.at > 60_000) {
    if (cache.size >= 240) cache.clear();
    const wait = Math.max(0, (soon ? soonSlot : slot) - Date.now());
    if (soon) soonSlot = Date.now() + wait + 110;
    else slot = Date.now() + wait + 110;
    cache.set(key, { at: Date.now(), body: sleep(wait).then(() => fetch(`https://api.deezer.com/${path}`, lang ? { headers: { "accept-language": lang } } : undefined)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Deezer ${r.status}`)))) });
  }
  const data = await cache.get(key)!.body.catch((e) => (cache.delete(key), Promise.reject(e)));
  if (!data?.error) return data;
  cache.delete(key);
  // Deezer answers errors with a 200: code 4 is the quota, 700 is busy. Anything else fails the same again.
  const { code, message = "" } = data.error;
  if ((code === 4 || code === 700 || /quota/i.test(message)) && tries < 3) return sleep(2 ** tries * 700 + Math.random() * 300).then(() => get(path, tries + 1, lang, soon));
  throw new Error(message || "Deezer couldn’t answer");
}

type DzArtist = { id: number; name: string };
type DzAlbum = { id: number; title: string; cover_xl?: string; release_date?: string; record_type?: string; artist?: DzArtist; contributors?: DzArtist[] };
type DzTrack = { id: number; title: string; duration?: number; rank?: number; explicit_lyrics?: boolean; artist: DzArtist; album?: DzAlbum; contributors?: DzArtist[] };

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

// An artist's ten most played songs, as Mixtape's artist pages have them: ranked by streams rather than
// YouTube views. Deezer's own top is its plays of late, so its 100 are ranked again by its all-time score,
// which comes close to Spotify's Popular (8 of ANNA ASTI's 10). The artist is the one with this exact name
// and the most fans. Labels give Russian songs a
// Latin title for every other language, so asked in Russian they come back as released ("Лампочки", not
// "Lampochki"); other songs read the same either way.
// ponytail: Russian only; other scripts' originals need Apple Music (it keeps them whatever the country).
const bare = (s: string) => latin(s).replace(/[^\p{L}\p{N}]+/gu, "");
// Titles come back as soon as the top is in, and covers (with album lists to read) after, as albums.
export async function topSongs(name: string): Promise<{ songs: Track[]; albums: Promise<Track[]> }> {
  const found = ((await get(`search/artist?q=${encodeURIComponent(name)}&limit=25`)).data ?? []) as (DzArtist & { nb_fan?: number })[];
  const a = found.filter((x) => bare(x.name) === bare(name)).sort((x, y) => (y.nb_fan ?? 0) - (x.nb_fan ?? 0))[0];
  if (!a) return { songs: [], albums: Promise.resolve([]) };
  const albumsOf = get(`artist/${a.id}/albums?limit=100`).then((r): DzAlbum[] => (r.data ?? []).filter((x: DzAlbum) => x.record_type === "album").reverse());
  const top = explicitFirst(((await get(`artist/${a.id}/top?limit=100`, 0, "ru")).data ?? [] as DzTrack[]).sort((x: DzTrack, y: DzTrack) => (y.rank ?? 0) - (x.rank ?? 0))).slice(0, 10) as DzTrack[];
  // Like Spotify, a single that later made an album shows that album (its first, if several).
  const albums = albumsOf.then(async (albums) => {
    const lists = await Promise.all(albums.map((al) => get(`album/${al.id}/tracks?limit=100`, 0, "ru").then((r): DzTrack[] => r.data ?? [], () => [])));
    const on = new Map<string, DzAlbum>();
    lists.forEach((ts, i) => ts.forEach((t) => on.has(t.title.toLowerCase()) || on.set(t.title.toLowerCase(), albums[i])));
    return top.map((t) => toTrack(t, on.get(t.title.toLowerCase())));
  });
  return { songs: top.map((t) => ({ ...toTrack(t), album: "", albumId: undefined, thumb: undefined })), albums };
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
// The recording a song plays: its YouTube upload once found, else itself (a file of yours is its own). What
// per-recording things are kept under (lyrics, timings, where the sound starts), so a song saved twice shares them.
export const recording = (t: Track) => (t.file ? t.id : (found[t.id] ?? t.id));
export const foundWhenPlayed = (id: string) => /^(dz|sp|csv):/.test(id);
// A song from your files is looked up the same way, for its radio.
export function youtubeId(t: Track): Promise<string> {
  if (!(foundWhenPlayed(t.id) || t.file) || found[t.id]) return Promise.resolve(found[t.id] ?? t.id);
  if (!finding.has(t.id))
    finding.set(
      t.id,
      // A file is heard, then looked for as what it is: first if it has no artist (its name could be any
      // song), else only when its tags don't find it.
      (t.file && !t.artists.length ? hear(t).then((hit) => hit ?? findSong(rowOf(t))) : findSong(rowOf(t)).then((hit) => hit ?? (t.file ? hear(t) : undefined)))
        .then((hit) => (hit ? (keep(t.id, hit.id), !t.thumb && !t.file && hit.thumb && patch(t.id, { thumb: hit.thumb }), hit.id) : Promise.reject(new Error(`Couldn’t find “${t.title}” on YouTube`))))
        .finally(() => finding.delete(t.id)),
    );
  return finding.get(t.id)!;
}
const hear = (t: Track) => heard(t.file!, { title: t.title, artist: t.artists.map((a) => a.name).join(", "), feat: "", album: t.album ?? "" }).then((f) => f && findSong({ ...rowOf(t), title: f.edit.title, artist: [f.edit.artist, f.edit.feat].filter(Boolean).join(", "), album: f.edit.album, isrc: f.edit.isrc }), () => undefined);
export const pin = (t: Track, yt: string) => (keep(t.id, yt), replay(t.id));
// A YouTube song whose sound runs well over or under its listed length is another cut of it: YouTube Music's
// albums sometimes point a song at its music video ("Isterichka": listed 3:42, heard 4:09). Its released
// copy is looked up as an imported song's would be, and played from then on.
export async function releasedCut(t: Track, heard: number) {
  const listed = parseSecs(t.duration);
  if (!listed || found[t.id] || Math.abs(heard - listed) <= 10) return;
  const hit = await findSong(rowOf(t)).catch(() => undefined);
  if (!hit || hit.id === t.id || Math.abs((parseSecs(hit.duration) ?? heard) - listed) > 5) return;
  keep(t.id, hit.id);
  return hit.id;
}
// Lets these be looked for again next time they play.
export const findAgain = (ids: string[]) => (ids.forEach((id) => delete found[id]), (localStorage.youtubeIds = JSON.stringify(found)));

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
    // A call that failed (offline, the quota) is tried again next time the song is on screen.
    const d: DzTrack | undefined = await get(`track/isrc:${t.isrc}`, 0, undefined, soon).catch(() => void tried.delete(t.id));
    if (d?.album?.cover_xl) got.set(t.id, { thumb: d.album.cover_xl, ...(!t.duration && d.duration && { duration: length(d.duration) }) }), save(soon ? 150 : 5000);
  }
  workers--;
}
export function covers(tracks: Track[], onScreen = false) {
  const need = tracks.filter((t) => !t.thumb && !t.file && t.isrc && !tried.has(t.id));
  if (onScreen) screen = need;
  else rest.push(...need);
  while (workers < 3 && (screen.length || rest.length)) void coverNext();
}

// Songs titled in Latin letters that were released in another script ("Lampochki" for "Лампочки"): labels
// give YouTube Music and Deezer those for English. Apple Music keeps the original, so a song you play or
// save is looked for among its artist's songs there, by how its title sounds and how long it is, and
// renamed everywhere. Each song is looked up once, each artist once a launch, and Apple is asked every 3 s
// at most, under its ~20 a minute. Spotify's and your own files' titles are already as released.
// ponytail: Cyrillic and Greek only (what latin() spells); Japanese or Korean would need romanising.
export const sound = (s: string) => latin(s).replace(/[^a-z0-9]+/g, "").replace(/shch/g, "s").replace(/[sc]h/g, (m) => m[0]).replace(/zh/g, "z").replace(/kh|x/g, "h").replace(/ts/g, "c").replace(/[jy]/g, "i");
let appleNext: Promise<unknown> = Promise.resolve();
function itunes(path: string, q: Record<string, string>): Promise<any[]> {
  const r = appleNext.then(() => fetch(`https://itunes.apple.com/${path}?${new URLSearchParams({ country: "gb", ...q })}`)).then((r) => r.json()).then((d) => d.results ?? []);
  appleNext = r.then(() => sleep(3000), () => sleep(3000));
  return r;
}
type AppleSong = { wrapperType?: string; trackName: string; trackTimeMillis?: number };
const catalogues = new Map<string, Promise<AppleSong[]>>();
function songsBy(name: string) {
  const k = bare(name);
  if (!catalogues.has(k)) {
    const p = itunes("search", { term: name, entity: "musicArtist", limit: "5" }).then((as) => as.find((a) => bare(a.artistName) === k)).then((a) => (a ? itunes("lookup", { id: String(a.artistId), entity: "song", limit: "200" }) : [])).then((r: AppleSong[]) => r.filter((x) => x.wrapperType === "track"));
    catalogues.set(k, p);
    p.catch(() => catalogues.delete(k));
  }
  return catalogues.get(k)!;
}
const OTHER = /(?!\p{Script=Latin})\p{L}/u;
// What lists show a song as, whether or not it's in your library (search results, albums).
export const useOriginals = create<Record<string, string>>(() => JSON.parse(localStorage.originals ?? "{}"));
export async function original(ts: Track[]) {
  for (const t of ts) {
    if (t.file || /^(sp|csv):/.test(t.id) || OTHER.test(t.title) || !t.artists[0]) continue;
    const had = useOriginals.getState()[t.id];
    if (had !== undefined) {
      if (had) patch(t.id, { title: had });
      continue;
    }
    const songs = await songsBy(t.artists[0].name).catch(() => undefined), secs = parseSecs(t.duration), heard = sound(t.title);
    if (!songs) continue;
    const x = songs.find((x) => OTHER.test(x.trackName) && sound(x.trackName) === heard && (!secs || !x.trackTimeMillis || Math.abs(x.trackTimeMillis / 1000 - secs) <= 3));
    useOriginals.setState({ [t.id]: x?.trackName ?? "" });
    localStorage.originals = JSON.stringify(useOriginals.getState());
    if (x) patch(t.id, { title: x.trackName });
  }
}
