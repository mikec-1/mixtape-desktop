import { searchKind, searchYouTube, parseSecs, SEP, type Track } from "./yt";
import { newPlaylist, notify, useStore } from "./store";

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

// The wrong song is worse than no song: the title must be there, and one of the artists.
function matches(row: CsvTrack, c: Track) {
  const hay = norm(`${c.title} ${c.artists.map((a) => a.name).join(" ")} ${c.album ?? ""}`);
  const plain = squash(hay), latin = squash([...hay].map((ch) => CYRILLIC[ch] ?? ch).join(""));
  const has = (w: string) => plain.includes(w) || latin.includes(w);

  // Mixtape's rule too: an upload called just "Popular" by the right artist is "Popular - TikTok Remix".
  const theirs = words(bareTitle(c.title)), mine = new Set(words(row.title)), by = norm(c.artists.map((a) => a.name).join(" "));
  if (theirs.every((w) => mine.has(w)) && rowArtists(row.artist).some((a) => words(a).every((w) => squash(by).includes(w)))) return true;

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
const byArtist = (row: CsvTrack, c: Track) => {
  const hay = squash(norm(`${c.title} ${c.artists.map((a) => a.name).join(" ")}`));
  return rowArtists(row.artist).some((a) => words(a).every((w) => hay.includes(w)));
};

// Matches rows a few at a time; throttled searches are retried in find, so a miss is a real miss.
async function matchAll(rows: CsvTrack[], each: (done: number) => void, stopped = () => false) {
  const out: Awaited<ReturnType<typeof find>>[] = [];
  const cache = new Map<string, Promise<Track[]>>();
  let next = 0, done = 0;
  // ponytail: 6 songs at once; at 12 YouTube started refusing searches.
  await Promise.all(
    Array.from({ length: Math.min(6, rows.length) }, async () => {
      while (next < rows.length && !stopped()) {
        const i = next++;
        out[i] = await find(rows[i], cache).catch(() => ({ hit: undefined, sure: false, options: [] }));
        each(++done);
      }
    }),
  );
  return out;
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
  cancel?.();
  let stopped = false;
  const stop = (cancel = () => (stopped = true));
  const name = file.name.replace(/\.[^.]+$/, "") || "Imported Playlist";
  const rows = parsePlaylistCsv(await file.text());
  if (!rows.length) return notify({ text: "Couldn’t Import Playlist", detail: `${file.name} has no title and artist columns` });

  const action = { label: "Cancel", run: stop };
  let shown = 0;
  const progress = (done: number) => Date.now() - shown > 250 && !stopped && ((shown = Date.now()), notify({ text: `Importing ${name}…`, detail: `${done} of ${rows.length} songs`, action, sticky: true }));
  progress(0);
  const found = await matchAll(rows, progress, () => stopped);
  if (cancel === stop) cancel = undefined;

  const tracks = found.flatMap((f) => (f?.hit ? [f.hit] : []));
  const review: Review[] = found.flatMap((f, i) => (f && !f.sure ? [{ row: rows[i], pick: f.hit, options: f.options }] : []));
  const id = tracks.length ? newPlaylist(tracks, undefined, name) : undefined;
  if (stopped) return notify({ text: "Import Cancelled", detail: tracks.length ? `Saved ${tracks.length} songs to ${name}` : "No songs were imported", thumb: tracks[0]?.thumb });
  useStore.setState({ toast: undefined, dialog: { kind: "import", playlist: id ?? newPlaylist([], undefined, name), name, added: tracks.length, items: review } });
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
  return "ok";
}
