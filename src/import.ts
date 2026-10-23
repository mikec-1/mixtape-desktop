import { fetch } from "@tauri-apps/plugin-http";
import { searchKind, searchYouTube, parseSecs, SEP, type Track } from "./yt";
import { likeAll, newPlaylist, notify, open, plural, useStore, type Dialog, type View } from "./store";
import { playlist as dzPlaylist } from "./deezer";

// A song the import wasn't sure of (pick: the guess it added) or didn't find, with the next best results to choose from.
export type Review = { row: CsvTrack; pick?: Track; options: Track[] };

export type CsvTrack = { title: string; artist: string; album?: string; secs?: number; isrc?: string };

// RFC 4180: quoted fields, "" escapes, CRLF or LF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

// Exportify, TuneMyMusic and most generic exports.
export function parsePlaylistCsv(text: string): CsvTrack[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const title = col("track name", "title", "song", "name");
  const artist = col("artist name(s)", "artist name", "artist", "artists");
  const album = col("album name", "album");
  const dur = col("duration (ms)", "duration (s)", "duration", "length");
  const isrc = col("isrc");
  if (title < 0 || artist < 0) return [];
  return rows.flatMap((r) => {
    const t = r[title]?.trim(), a = r[artist]?.trim();
    if (!t || !a) return [];
    const d = r[dur]?.trim() ?? "", n = Number(d);
    const secs = n > 0 ? Math.round(n > 1000 ? n / 1000 : n) : parseSecs(d);
    return [{ title: t, artist: a, album: r[album]?.trim() || undefined, secs, isrc: r[isrc]?.trim() || undefined }];
  });
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", є: "ye", і: "i", ї: "yi", ґ: "g",
};

// Accents off, plus the stylings artists love: !ce → ice, mon€ → mone, rmx → remix.
const norm = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/€/g, "e").replace(/(^|\s)!([a-z])/g, "$1i$2").replace(/\brmx\b/g, "remix");
const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");

// Words of 2+ letters, unless that leaves nothing ("A", "4").
function words(s: string) {
  const all = norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const long = all.filter((w) => w.length > 1);
  return long.length ? long : all;
}

const TAG = "(?:extended|radio|club|original|album|single|acoustic|instrumental|vocal|dub|bonus|\\d{4})?\\s*(?:mix|version|edit|cut|remaster(?:ed)?|deluxe|anniversary|live|session|track|bonus)";
// Drops feature credits and version tags but keeps titles like "Stay With Me".
export const bareTitle = (t: string) =>
  t
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, " ")
    .replace(/\s+(?:feat|ft|featuring)\b\.?\s+[^()[\]-]+/gi, " ")
    .replace(new RegExp(`\\s*[([]\\s*${TAG}[^)\\]]*[)\\]]`, "gi"), " ")
    .replace(new RegExp(`\\s+-\\s+${TAG}.*$`, "i"), "")
    .replace(/\s+/g, " ")
    .trim() || t;

const rowArtists = (s: string) => s.split(/[;/]/).flatMap((p) => p.split(SEP)).map((a) => a.trim()).filter(Boolean);

const EXTRA = new Set("remix mix edit version vip flip bootleg sped speed up slowed reverb tiktok tik tok nightcore extended radio club original remaster remastered live acoustic instrumental deluxe explicit clean bonus single prod feat ft featuring with lofi lo fi bass boosted 8d".split(" "));

// The wrong song is worse than no song: the title must be there, and one of the artists.
function matches(row: CsvTrack, c: Track) {
  const hay = norm(`${c.title} ${c.artists.map((a) => a.name).join(" ")} ${c.album ?? ""}`);
  const plain = squash(hay), latin = squash([...hay].map((ch) => CYRILLIC[ch] ?? ch).join(""));
  const has = (w: string) => plain.includes(w) || latin.includes(w);

  // Mixtape's rule too: an upload called just "Popular" by the right artist is "Popular - TikTok Remix".
  // Only when what the row has over it is version talk or the artists' names: "Love" isn't "Love Me Like You Do".
  const theirs = words(bareTitle(c.title)), mine = words(bareTitle(row.title)), by = squash(norm(c.artists.map((a) => a.name).join(" ")));
  const names = rowArtists(row.artist), named = new Set(names.flatMap(words));
  if (theirs.length && theirs.every((w) => mine.includes(w)) && mine.every((w) => theirs.includes(w) || named.has(w) || EXTRA.has(w) || /^\d{4}$/.test(w)) && names.some((a) => words(a).every((w) => by.includes(w)))) return true;

  const title = words(bareTitle(row.title));
  const need = title.length <= 2 ? title.length : Math.ceil(title.length * 0.7);
  if (title.filter(has).length < need) return false;

  if (rowArtists(row.artist).some((a) => words(a).every(has))) return true;
  // Viral sounds and mashups often sit on random channels; trust a long title if the length lines up.
  const secs = parseSecs(c.duration);
  return title.length >= 4 && (!row.secs || !secs || Math.abs(secs - row.secs) <= 15);
}

const NOISE = ["official video", "music video", "lyric video", "live", "cover", "remix", "sped up", "slowed", "reverb", "mashup", "intro", "trailer", "8d", "extended"];
const BOOTLEG = ["ai cover", "ai verse", "leak", "unreleased", "snippet", "bootleg", "fan made", "fanmade", "concept", "remake", "reimagined", "open verse", "added verse"];

// Lower is better: search rank and length difference, Topic channels and audio uploads first, covers and bootlegs last.
function score(row: CsvTrack, c: Track, rank: number) {
  const title = c.title.toLowerCase(), wanted = row.title.toLowerCase();
  const off = row.secs && Math.abs((parseSecs(c.duration) ?? row.secs) - row.secs);
  let s = rank * 2 + (off ? off + (off > 20 ? 60 : 0) : 0);
  if (c.artists.some((a) => a.name.endsWith("- Topic"))) s -= 120;
  if (/official audio|[([]audio[)\]]/.test(title)) s -= 40;
  for (const w of NOISE) if (title.includes(w) && !wanted.includes(w)) s += 40;
  for (const w of BOOTLEG) if (title.includes(w) && !wanted.includes(w)) s += 100;
  return s;
}

const best = (row: CsvTrack, cs: Track[]) =>
  cs.map((c, i) => [c, score(row, c, i)] as const).filter(([c]) => matches(row, c)).sort((a, b) => a[1] - b[1])[0]?.[0];

// Keeps the spreadsheet's names; uses YouTube's artists only when they're the same people, so the artist links work.
function toTrack(row: CsvTrack, c: Track): Track {
  const theirs = norm(c.artists.map((a) => a.name).join(" "));
  const names = rowArtists(row.artist);
  const same = c.artists.some((a) => a.id) && names.every((a) => words(a).every((w) => theirs.includes(w)));
  return { ...c, title: row.title, album: row.album ?? c.album, artists: same ? c.artists : names.map((name) => ({ name })) };
}

const SEARCH = { song: (q: string) => searchKind(q, "song"), video: (q: string) => searchKind(q, "video"), youtube: searchYouTube };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A failed search is YouTube throttling, not a missing song: wait and try again rather than count it as not found.
async function retry<T>(run: () => Promise<T>, waits = [2000, 6000, 15000]): Promise<T> {
  for (const ms of waits) {
    try {
      return await run();
    } catch {
      await sleep(ms);
    }
  }
  return run();
}

// Cheapest search first: ISRC, songs, music videos, the second credited artist, then all of YouTube.
async function find(row: CsvTrack, cache: Map<string, Promise<Track[]>>) {
  const artists = rowArtists(row.artist);
  const q = (a = artists[0] ?? row.artist) => `${bareTitle(row.title)} ${a}`;
  const steps: [keyof typeof SEARCH, string | undefined][] = [["song", row.isrc], ["song", q()], ["video", q()], ["song", artists[1] && q(artists[1])], ["youtube", q()]];
  const get = ([kind, query]: (typeof steps)[number]) => {
    const key = `${kind}:${query!.toLowerCase()}`;
    if (!cache.has(key)) cache.set(key, retry(() => SEARCH[kind](query!)).catch(() => []));
    return cache.get(key)!;
  };
  // The ISRC and the plain song search go out together, as one or the other almost always hits.
  if (row.isrc) void get(steps[1]);
  const seen = new Map<string, Track>();
  let guess: Track | undefined;
  for (const step of steps) {
    if (!step[1]) continue;
    const results = await get(step);
    for (const c of results) seen.set(c.id, c);
    const hit = best(row, results);
    // Found by its artist: done. Found by a long title alone: keep it, but look on for the artist's own.
    if (hit && byArtist(row, hit)) return { hit: toTrack(row, hit), sure: true, options: [] };
    guess ??= hit;
  }
  const options = [...seen.values()]
    .filter((c) => c.id !== guess?.id)
    .map((c, i) => [c, score(row, c, i) + (matches(row, c) ? 0 : 200)] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([c]) => toTrack(row, c));
  return { hit: guess && toTrack(row, guess), sure: false, options };
}
// One song's YouTube copy, for songs from Deezer (deezer.ts youtubeId).
export const findSong = (row: CsvTrack) => find(row, new Map()).then((r) => r.hit);
const byArtist = (row: CsvTrack, c: Track) => {
  const hay = squash(norm(`${c.title} ${c.artists.map((a) => a.name).join(" ")}`));
  return rowArtists(row.artist).some((a) => words(a).every((w) => hay.includes(w)));
};

// Runs fn over items a few at a time, saying how many are done.
export async function pool<T, R>(items: T[], fn: (x: T) => Promise<R>, each: (done: number, got: R) => void, stopped = () => false) {
  const out: R[] = [];
  let next = 0, done = 0;
  // ponytail: 6 at once; at 12 YouTube started refusing searches.
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (next < items.length && !stopped()) {
        const i = next++;
        out[i] = await fn(items[i]);
        each(++done, out[i]);
      }
    }),
  );
  return out;
}
// Matches rows; throttled searches are retried in find, so a miss is a real miss.
function matchAll(rows: CsvTrack[], each: (done: number, got?: { hit?: Track }) => void, stopped = () => false) {
  const cache = new Map<string, Promise<Track[]>>();
  return pool(rows, (row) => find(row, cache).catch(() => ({ hit: undefined, sure: false, options: [] as Track[] })), each, stopped);
}

// Search again for the ones still not found, e.g. after YouTube stopped throttling.
export async function rematch(items: Review[]): Promise<(Review & { found: boolean })[]> {
  const got = await matchAll(items.map((r) => r.row), () => {});
  return items.map((r, i) => {
    const { hit, options = [] } = got[i] ?? {};
    return { row: r.row, found: !!hit, options: hit ? [hit, ...options].slice(0, 3) : options.length ? options : r.options };
  });
}

let cancel: (() => void) | undefined;

export async function importPlaylistFile(file: File) {
  const rows = parsePlaylistCsv(await file.text());
  if (!rows.length) return notify({ text: "Couldn’t Import Playlist", detail: `${file.name} has no title and artist columns` });
  return importRows(file.name.replace(/\.[^.]+$/, "") || "Imported Playlist", rows);
}

// Playlists and albums from a link. Spotify's and Apple Music's own pages list the songs (Spotify's embed only
// the first 100), which are then matched like a CSV; Deezer's come as they are, and YouTube Music's just open.
export const isLink = (text: string) => /^https:\/\/(open\.spotify\.com|spotify\.link|music\.apple\.com|(www\.)?deezer\.com|link\.deezer\.com|deezer\.page\.link|(music|www)\.youtube\.com)\//.test(text.trim());
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" };
const page = (url: string) => fetch(url, { headers: UA }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`The page answered ${r.status}`))));
const script = (html: string, id: string) => JSON.parse(html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`))?.[1] ?? "null");

// What a link holds: a page to open, songs to match, or (from Deezer) songs as they are.
export type Linked = { view: View } | { name: string; cover?: string; rows: CsvTrack[] } | { name: string; cover?: string; tracks: Track[] };
export async function readLink(text: string): Promise<Linked | undefined> {
  let url = new URL(text.trim());
  // Share links (spotify.link, link.deezer.com) go to the real page, by a redirect or from the page itself.
  if (/^(spotify\.link|link\.deezer\.com|deezer\.page\.link)$/.test(url.host)) {
    const r = await fetch(url, { headers: UA });
    url = new URL(/spotify\.com|deezer\.com\/(?!s\/)/.test(r.url) ? r.url : ((await r.text()).match(/https:\/\/(open\.spotify\.com|www\.deezer\.com)\/[^"'\s<>]+/)?.[0] ?? r.url));
  }
  const [kind, id] = url.pathname.replace(/^\/(intl-[\w-]+|[a-z]{2})(?=\/)/, "").split("/").filter(Boolean);
  const list = url.searchParams.get("list");
  if (url.host.endsWith("youtube.com")) {
    if (list) return { view: { name: "collection", id: list.startsWith("VL") ? list : `VL${list}` } };
    if (kind === "browse" && id) return { view: { name: "collection", id } };
  } else if (url.host.endsWith("deezer.com") && id) {
    if (kind === "album") return { view: { name: "collection", id: `dz:album:${id}` } };
    if (kind === "playlist") return dzPlaylist(id);
  } else if (url.host === "open.spotify.com" && id && (kind === "playlist" || kind === "album")) {
    const e = script(await page(`https://open.spotify.com/embed/${kind}/${id}`), "__NEXT_DATA__")?.props?.pageProps?.state?.data?.entity;
    if (e?.trackList?.length) return { name: e.name, cover: e.coverArt?.sources?.[0]?.url ?? e.visualIdentity?.image?.reduce((a: { maxWidth: number }, b: { maxWidth: number }) => (b.maxWidth > a.maxWidth ? b : a))?.url, rows: e.trackList.map((t: { title: string; subtitle: string; duration: number }) => ({ title: t.title, artist: t.subtitle, album: kind === "album" ? e.name : undefined, secs: Math.round(t.duration / 1000) })) };
  } else if (url.host === "music.apple.com" && /^(playlist|album)$/.test(kind)) {
    type Link = { title: string };
    const sections: { itemKind: string; items: any[] }[] = script(await page(url.href), "serialized-server-data")?.data?.[0]?.data?.sections ?? [];
    const head = sections[0]?.items[0], by = head?.subtitleLinks?.map((l: Link) => l.title).join(", ");
    const rows = sections.filter((s) => s.itemKind === "trackLockup").flatMap((s) => s.items).map((t) => ({ title: t.title, artist: t.subtitleLinks?.map((l: Link) => l.title).join(", ") || by, album: t.tertiaryLinks?.[0]?.title ?? (kind === "album" ? head.title : undefined), secs: Math.round(t.duration / 1000) }));
    if (rows.length) return { name: head.title, cover: head.artwork?.dictionary?.url?.replace("{w}x{h}bb.{f}", "600x600bb.jpg"), rows };
  }
}

export async function importLink(text: string) {
  notify({ text: "Reading Link…", sticky: true });
  try {
    const got = await readLink(text);
    if (!got) return notify({ text: "Couldn’t Import That Link", detail: "Paste a playlist or album link from Spotify, Apple Music, Deezer or YouTube Music" });
    if ("view" in got) return useStore.setState({ toast: undefined }), open(got.view);
    if ("tracks" in got) return open({ name: "playlist", id: newPlaylist(got.tracks, undefined, got.name, got.cover) });
    return importRows(got.name, got.rows, got.cover);
  } catch (e) {
    notify({ text: "Couldn’t Import That Link", detail: String(e instanceof Error ? e.message : e) });
  }
}

// Reviews wait their turn (several playlists from Spotify): the next opens when the last one closes.
// Watched from the first one on, not at load: store.ts reaches this file (through deezer.ts) before it's done.
const waiting: Dialog[] = [];
let watching: (() => void) | undefined;
const later = (d: Dialog) => (waiting.push(d), (watching ??= useStore.subscribe((s) => !s.dialog && waiting.length && useStore.setState({ dialog: waiting.shift() }))));

// Matches rows into a new playlist, or with liked into Liked Songs (cover is then only the toast's). Resolves true if it was cancelled.
export async function importRows(name: string, rows: CsvTrack[], cover?: string, liked = false) {
  cancel?.();
  let stopped = false;
  const stop = (cancel = () => (stopped = true));
  const action = { label: "Cancel", run: stop };
  let shown = 0;
  const progress = (done: number, got?: { hit?: Track }) => Date.now() - shown > 250 && !stopped && ((shown = Date.now()), notify({ text: `Importing ${name}…`, detail: `${done} of ${rows.length} songs`, action, sticky: true, thumb: cover ?? got?.hit?.thumb }));
  progress(0);
  const found = await matchAll(rows, progress, () => stopped);
  if (cancel === stop) cancel = undefined;

  const tracks = found.flatMap((f) => (f?.hit ? [f.hit] : []));
  const review: Review[] = found.flatMap((f, i) => (f && !f.sure ? [{ row: rows[i], pick: f.hit, options: f.options }] : []));
  if (liked && tracks.length) likeAll(tracks, true);
  const id = liked ? undefined : tracks.length ? newPlaylist(tracks, undefined, name, cover) : undefined;
  if (stopped) return notify({ text: "Import Cancelled", detail: tracks.length ? `Saved ${tracks.length} songs to ${name}` : "No songs were imported", thumb: cover ?? tracks[0]?.thumb }), true;
  if (!review.length) return notify({ text: `Imported ${name}`, detail: plural(tracks.length, "song"), thumb: cover ?? tracks[0]?.thumb }), false;
  const d: Dialog = { kind: "import", playlist: liked ? undefined : (id ?? newPlaylist([], undefined, name, cover)), name, added: tracks.length, items: review };
  useStore.setState({ toast: undefined });
  if (useStore.getState().dialog) later(d);
  else useStore.setState({ dialog: d });
  return false;
}

export function demo() {
  const rows = parsePlaylistCsv(
    [
      `Track Name,Artist Name(s),Album Name,Duration (ms),ISRC`,
      `"The Less I Know, The Better",Tame Impala,Currents,216000,AUUM71500303`,
      `!ce Cream Sped Up,Ysl Pierre,Album,120000,`,
      `Blame (feat. John Newman) - Extended Version,Calvin Harris;John Newman,Motion,329000,`,
      `2019 (justbars rmx),Pashanim,Single,104000,`,
      `WIEN LEBT,mon€;paqay,wienbra,115000,`,
      `Навернопотомучто,Vremya i Steklo,Album,204000,`,
      `Boss Orange feat. RB030 (Bonus),Pashanim;RB030,Album,150000,`,
      `Verstappen Garten,Akh;Can;keyblade;Tony Hilfiger,Single,130000,`,
      `Popular - TikTok Remix,TommyMuzzic;ZeddMusique,Single,150000,`,
    ].join("\n"),
  );
  const t = (title: string, artist: string, duration = "3:00"): Track => ({ id: title, title, artists: [{ name: artist }], duration });
  const ok = (c: boolean, what: string) => { if (!c) throw new Error(what); };
  ok(rows.length === 9 && rows[0].title === "The Less I Know, The Better" && rows[0].secs === 216 && rows[0].isrc === "AUUM71500303", "csv");
  ok(bareTitle(rows[6].title) === "Boss Orange", "bareTitle");
  ok(!best(rows[1], [t("Tyga - Ice Cream (Official Music Video)", "Tyga")]), "rejects the wrong Ice Cream");
  ok(!!best(rows[2], [t("Blame (feat. John Newman)", "Calvin Harris", "3:32")]), "Blame");
  ok(!!best(rows[3], [t("Pashanim - 2019 (justbars rmx)", "Pashanim Nulldreinull", "1:44")]), "2019");
  ok(!!best(rows[4], [t("WIEN LEBT", "mon€ - Topic", "1:55")]), "WIEN LEBT");
  ok(!!best(rows[5], [t("Время и Стекло - Навернопотомучто", "Время и Стекло", "3:24")]), "Cyrillic");
  ok(!!best(rows[7], [t("Verstappen Garten", "keyblade", "2:10")]), "collab");
  ok(!!best(rows[8], [t("Popular", "TommyMuzzic - Topic", "2:31")]), "upload with a shorter title");
  ok(!best(rows[8], [t("Popular", "The Weeknd", "3:35")]), "same name, other artist");
  ok(!best({ title: "Love Me Like You Do", artist: "Ellie Goulding" }, [t("Love", "Ellie Goulding")]), "a shorter title that's another song");
  ok(!!best({ title: "Save Your Tears (Remix) (with Ariana Grande)", artist: "The Weeknd;Ariana Grande" }, [t("Save Your Tears", "The Weeknd")]), "the original for a remix");
  return "ok";
}
