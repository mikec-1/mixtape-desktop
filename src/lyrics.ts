import { useEffect, useMemo, useReducer, useSyncExternalStore } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { audio, useAudio, useOnline, useSettings, useStore } from "./store";
import { lyrics as ytLyrics, type Track } from "./yt";
import { version } from "../package.json";

// A line starts at time (seconds) and, where the source says, ends at end. Text "" is a break (♪).
// Word-synced lyrics time each word too, and the words make up the line's text.
export type Word = { time: number; end?: number; text: string };
export type Line = { time: number; end?: number; text: string; words?: Word[] };
// Unsynced lyrics have time 0 on every line, and "" between verses.
export type Lyrics = { lines: Line[]; synced: boolean; source: string; credit?: string; instrumental?: boolean };

// In the app requests go through Rust like YouTube's (yt.ts), so CORS never matters; a browser uses its own.
const http: typeof fetch = "__TAURI_INTERNALS__" in window ? tauriFetch : (input, init) => fetch(input, init);
const timeout = (ms = 10_000) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

// LRCLIB: free, community-made, mostly synced, some word by word (its Lyricsfile YAML).
type Hit = { trackName: string; artistName: string; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null; lyricsfile?: string | null; hasWordSync?: boolean };
// LRCLIB asks apps to say who they are; this header is its browser-friendly User-Agent.
const LRCLIB = { "Lrclib-Client": `Sleeve v${version} (https://github.com/mikec-1/Sleeve)` };

const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const alike = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
};
const seconds = (d?: string) => d?.split(":").reduce((s, n) => s * 60 + +n, 0) || undefined;

// The song's name alone: no "(feat. …)", "[Official Video]" or "- 2011 Remaster", and for a music
// video titled "Artist - Song", just the song.
function title(t: Track) {
  let s = t.title
    .replace(/\s*[([][^)\]]*\b(feat|ft|with|prod|official|lyrics?|audio|video|visuali[sz]er|remaster(ed)?|explicit|version|edit)\b[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+[^-]*\b(remaster(ed)?|version|edit)\b.*$/i, "");
  const by = /^(.+?)\s+[-–—]\s+(.+)$/.exec(s);
  if (by && t.artists.some((a) => alike(a.name, by[1]))) s = by[2];
  return s.trim() || t.title;
}

// The richest lyrics (word sync, then line sync, then plain) whose length matches the song's.
// LRCLIB's own tolerance is ±2 s; YouTube's durations are rounded, so 3.
const rank = (r: Hit) => (r.hasWordSync && r.lyricsfile ? 0 : r.syncedLyrics ? 1 : r.plainLyrics ? 2 : r.instrumental ? 3 : 4);
function pick(list: Hit[], secs?: number) {
  const off = (r: Hit) => (secs ? Math.abs(r.duration - secs) : 0);
  return list.filter((r) => rank(r) < 4 && off(r) <= 3).sort((a, b) => rank(a) - rank(b) || off(a) - off(b))[0];
}

async function lrclib(t: Track): Promise<Lyrics | undefined> {
  const name = title(t);
  const artist = t.artists[0]?.name ?? "";
  const secs = seconds(t.duration);
  const search = async (q: Record<string, string>) => {
    const get = () => http(`https://lrclib.net/api/search?${new URLSearchParams(q)}`, { headers: LRCLIB, signal: timeout() });
    let r = await get();
    if (r.status === 503) r = await new Promise((ok) => setTimeout(ok, 1000)).then(get); // busy, and it says Retry-After: 1
    if (!r.ok) throw new Error(`LRCLIB: ${r.status}`);
    return (await r.json()) as Hit[];
  };
  // By title and artist; failing that as free text, which forgives credits written differently.
  const best = pick(await search(artist ? { track_name: name, artist_name: artist } : { track_name: name }), secs)
    ?? pick((await search({ q: `${name} ${artist}`.trim() })).filter((r) => alike(r.trackName, name) && (!artist || alike(r.artistName, artist))), secs);
  if (!best) return;
  const source = "LRCLIB";
  if (rank(best) === 0) {
    const lines = await lyricsfile(best.lyricsfile!).catch(() => undefined);
    if (lines?.length) return { lines: tidy(lines), synced: true, source };
  }
  if (best.syncedLyrics) {
    const lines = parseLrc(best.syncedLyrics);
    if (lines.length) return { lines: tidy(lines), synced: true, source };
  }
  if (best.plainLyrics) return { lines: plain(best.plainLyrics), synced: false, source };
  return { lines: [], synced: false, source, instrumental: true };
}

const plain = (text: string): Line[] => text.trim().split(/\r?\n/).map((l) => ({ time: 0, text: l.trim() }));

const stamp = (m: string, s: string) => +m * 60 + +s.replace(":", ".");
const STAMP = /^\s*\[(\d+):(\d+(?:[.:]\d+)?)\]/;

// LRC: "[mm:ss.xx]line"; a line sung more than once has several stamps; [offset:ms] moves them all.
// Enhanced LRC also times the words inside a line: "[00:12.00]<00:12.00>Word <00:12.50>by <00:12.90>word<00:13.40>".
export function parseLrc(lrc: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (let row of lrc.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(row);
    if (off) offset = +off[1] / 1000;
    const times: number[] = [];
    for (let m; (m = STAMP.exec(row)); row = row.slice(m[0].length)) times.push(stamp(m[1], m[2]));
    const line = words(row);
    // Word times belong to one singing of the line, so a repeated line keeps only its text.
    for (const time of times) lines.push(times.length > 1 ? { time, text: line.text } : { ...line, time });
  }
  // A positive offset makes lyrics appear sooner.
  return offset ? lines.map((l) => shift(l, -offset)) : lines;
}

function words(row: string): Omit<Line, "time"> {
  const parts = row.split(/<(\d+):(\d+(?:[.:]\d+)?)>/); // text, then (minutes, seconds, text) per word
  if (parts.length < 4) return { text: row.trim() };
  const ws: Word[] = [];
  let end: number | undefined;
  for (let i = 1; i < parts.length; i += 3) {
    const time = stamp(parts[i], parts[i + 1]);
    if (parts[i + 2]) ws.push({ time, text: parts[i + 2] });
    else end = time; // a closing stamp: when the last word stops
  }
  if (!ws.length) return { text: parts[0].trim() };
  ws[0].text = parts[0].trimStart() + ws[0].text;
  ws[ws.length - 1].text = ws[ws.length - 1].text.trimEnd();
  if (end !== undefined) ws[ws.length - 1].end = end;
  return { text: ws.map((w) => w.text).join("").trim(), words: ws, end };
}

const shift = (l: Line, by: number): Line => ({
  ...l,
  time: l.time + by,
  end: l.end === undefined ? undefined : l.end + by,
  words: l.words?.map((w) => ({ ...w, time: w.time + by, end: w.end === undefined ? undefined : w.end + by })),
});

// LRCLIB's Lyricsfile: YAML with times in ms. Words carry their own trailing space. The parser loads
// only for word-synced songs.
type LyricsfileDoc = {
  metadata?: { offset_ms?: number };
  lines?: { text?: unknown; start_ms?: unknown; end_ms?: unknown; words?: { text?: unknown; start_ms?: unknown; end_ms?: unknown }[] }[];
};
async function lyricsfile(yaml: string): Promise<Line[]> {
  const doc = (await import("yaml")).parse(yaml) as LyricsfileDoc;
  const s = (ms: unknown) => (typeof ms === "number" ? ms / 1000 : undefined);
  const offset = s(doc.metadata?.offset_ms) ?? 0;
  return (doc.lines ?? []).flatMap((l) => {
    const time = s(l.start_ms);
    if (time === undefined) return [];
    const ws = (l.words ?? []).flatMap((w) => (s(w.start_ms) === undefined || w.text == null ? [] : [{ time: s(w.start_ms)!, end: s(w.end_ms), text: String(w.text) }]));
    const line: Line = ws.length ? { time, end: s(l.end_ms), text: ws.map((w) => w.text).join("").trim(), words: ws } : { time, end: s(l.end_ms), text: String(l.text ?? "").trim() };
    return [offset ? shift(line, -offset) : line];
  });
}

// In time order, with a ♪ for a long intro and for gaps the source marks with an end time.
function tidy(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (const l of [...lines].sort((a, b) => a.time - b.time)) {
    const last = out.at(-1);
    if (last?.end !== undefined && l.time - last.end > 4) out.push({ time: last.end, text: "" });
    if (!(l.text === "" && out.at(-1)?.text === "")) out.push(l);
  }
  if (out[0] && out[0].time > 3 && out[0].text) out.unshift({ time: 0, text: "" });
  return out;
}

// LRCLIB first, then YouTube Music's plain lyrics. null: neither has any for this song.
async function find(t: Track): Promise<Lyrics | null> {
  let down = false;
  const found = await lrclib(t).catch(() => void (down = true));
  if (found) return found;
  const yt = await ytLyrics(t.id).catch(() => undefined);
  if (yt) return { lines: plain(yt.text), synced: false, source: "YouTube Music", credit: yt.credit };
  if (down) throw new Error("LRCLIB didn't answer"); // try again later rather than say there are none
  return null;
}

// Each song's lyrics, translation and romanisation, fetched once and shared by every view showing them.
// A result with neither value nor failed is still loading.
type Result<T> = { value?: T; failed?: true };
const results = new Map<string, Result<unknown>>();
const listeners = new Set<() => void>();
function put(key: string, r: Result<unknown>) {
  results.delete(key);
  results.set(key, r);
  if (results.size > 60) results.delete(results.keys().next().value!);
  listeners.forEach((l) => l());
}
function fetchOnce(key: string, fn: () => Promise<unknown>) {
  const r = results.get(key);
  if (r && !r.failed) return;
  put(key, {});
  fn().then((value) => put(key, { value }), () => put(key, { failed: true }));
}
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
function useResult<T>(key: string | undefined, fn: () => Promise<T>) {
  const online = useOnline(); // what failed offline goes again on reconnect
  useEffect(() => void (key && fetchOnce(key, fn)), [key, online]);
  const r = useSyncExternalStore(subscribe, () => (key ? results.get(key) : undefined)) as Result<T> | undefined;
  return { ...r, loading: !!key && !r?.failed && r?.value === undefined, retry: () => key && fetchOnce(key, fn) };
}

export const useLyrics = (t?: Track) => useResult(t && `lyrics:${t.id}`, () => find(t!));

// The next song's lyrics load while this one plays, so they're there the moment it starts.
useStore.subscribe((s, was) => {
  const t = s.queue[s.index + 1];
  if (t && (s.index !== was.index || s.queue !== was.queue)) fetchOnce(`lyrics:${t.id}`, () => find(t));
});

const lineAt = (lines: Line[], now: number) => {
  let i = -1;
  while (lines[i + 1] && lines[i + 1].time <= now) i++;
  return i;
};

// The line being sung (-1 before the first), read live from the player. Timeupdate only comes about
// four times a second, so a timer lands each change on the beat.
export function useLine(lyrics?: Lyrics | null) {
  const { time, paused } = useAudio();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const lines = lyrics?.synced ? lyrics.lines : undefined;
  const at = lines ? lineAt(lines, audio.currentTime) : -1;
  useEffect(() => {
    const next = lines?.[at + 1];
    if (!next || paused) return;
    const t = setTimeout(bump, (next.time - audio.currentTime) * 1000 + 5);
    return () => clearTimeout(t);
  }, [lines, at, time, paused]);
  return at;
}

// How far through each of a line's words the song is, 0 to 1. A last word with no end of its own
// is held for a second at most, so a gap after it doesn't stretch it out.
export function wordProgress(lines: Line[], i: number, now: number) {
  const line = lines[i];
  return (line.words ?? []).map((w, j, ws) => {
    const end = w.end ?? ws[j + 1]?.time ?? line.end ?? Math.min(lines[i + 1]?.time ?? Infinity, w.time + 1);
    return Math.min(1, Math.max(0, (now - w.time) / Math.max(0.05, end - w.time)));
  });
}

// Google Translate's free endpoints, the ones its Chrome extension calls: t translates each line on its
// own and says what language it was in; single with dt=rm romanises. ponytail: unofficial, like InnerTube.
async function google(path: string, body: URLSearchParams) {
  const r = await http(`https://translate.googleapis.com/translate_a/${path}`, { method: "POST", body, signal: timeout() });
  if (!r.ok) throw new Error(`Google Translate: ${r.status}`);
  return r.json();
}
const sameLanguage = (a: string, b: string) => a.split("-")[0].toLowerCase() === b.split("-")[0].toLowerCase();

// Each line's translation; undefined for breaks and for lines already in your language.
async function translate(lines: string[], to: string) {
  const want = lines.flatMap((l, i) => (l ? [i] : []));
  const res: (string | [string, string?])[] = await google(`t?client=dict-chrome-ex&sl=auto&tl=${to}`, new URLSearchParams(want.map((i) => ["q", lines[i]])));
  const out: (string | undefined)[] = lines.map(() => undefined);
  want.forEach((i, k) => {
    const [text, from] = typeof res[k] === "string" ? [res[k]] : res[k] ?? [];
    if (text && !(from && sameLanguage(from, to)) && norm(text) !== norm(lines[i])) out[i] = text;
  });
  return out;
}

// A letter in some script other than Latin: the lines romanisation is for.
const OTHER = /(?!\p{Script=Latin})\p{L}/u;
// One request for the whole song: "¶" between lines comes back intact. Lines already in Latin
// letters stay out of it, or Google reads English as Japanese ("haro maifurendo").
async function romanise(lines: string[]) {
  const want = lines.flatMap((l, i) => (OTHER.test(l) ? [i] : []));
  const res = await google("single?client=dict-chrome-ex&sl=auto&tl=en&dt=rm", new URLSearchParams({ q: want.map((i) => lines[i]).join("\n¶\n") }));
  const all = (res?.[0] as unknown[][] | undefined)?.find((s) => s?.[0] == null && typeof s[3] === "string")?.[3] as string | undefined;
  const parts = all?.split(/\s*¶\s*/);
  if (parts?.length !== want.length) throw new Error("Romanisation came back misaligned");
  const out: (string | undefined)[] = lines.map(() => undefined);
  want.forEach((i, k) => (out[i] = parts[k]));
  return out;
}

// Your language unless Settings picks one. Google wants zh-CN or zh-TW for Chinese, a bare code otherwise.
export function translateTarget(pick = useSettings.getState().translateTo) {
  const l = pick || navigator.language || "en";
  return /^zh/i.test(l) ? (/TW|HK|MO|Hant/i.test(l) ? "zh-TW" : "zh-CN") : l.split("-")[0].toLowerCase();
}

// The script each language is written in, for the ones that aren't Latin.
const SCRIPTS: Record<string, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  el: /\p{Script=Greek}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  hi: /\p{Script=Devanagari}/u,
  th: /\p{Script=Thai}/u,
};
const ENGLISH = new Set("the you your and that with what this don't i'm it's just know like love when we be for of is are it my to i in on all can".split(" "));

// Which switches a song gets. Romanise: some lines are in a non-Latin script. Translate: the lyrics
// don't look like your language. For lyrics in Latin letters only English can be told apart (by its
// commonest words), so speakers of other Latin-script languages get Translate on all of them.
function inspect(lines: Line[], to: string) {
  const text = lines.map((l) => l.text).join("\n");
  const lang = to.split("-")[0];
  const romanise = lines.some((l) => OTHER.test(l.text));
  const letters = [...text.matchAll(/\p{L}/gu)].map((m) => m[0]);
  const own = SCRIPTS[lang];
  let translate: boolean;
  if (own) translate = letters.filter((c) => own.test(c)).length < letters.length / 2;
  else if (lang !== "en") translate = true;
  else {
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    translate = romanise || words.filter((w) => ENGLISH.has(w)).length < words.length * 0.15;
  }
  return { translate: translate && letters.length > 0, romanise };
}

// Translation and romanisation for a song's lyrics, fetched when their switch is on (Settings keeps
// the switches, so they stay on for the next song that has them).
export function useExtras(t: Track | undefined, lyrics: Lyrics | null | undefined) {
  const on = { translate: useSettings((s) => s.lyricsTranslate), romanise: useSettings((s) => s.lyricsRomanise) };
  const to = translateTarget(useSettings((s) => s.translateTo));
  const can = useMemo(() => (lyrics?.lines.length ? inspect(lyrics.lines, to) : { translate: false, romanise: false }), [lyrics, to]);
  const texts = () => lyrics!.lines.map((l) => l.text);
  const tr = useResult(t && can.translate && on.translate ? `translate:${t.id}:${to}` : undefined, () => translate(texts(), to));
  const rm = useResult(t && can.romanise && on.romanise ? `romanise:${t.id}` : undefined, () => romanise(texts()));
  return { can, on, to, translation: tr.value, romanised: rm.value, loading: tr.loading || rm.loading, failed: tr.failed || rm.failed, retry: () => (tr.retry(), rm.retry()) };
}
