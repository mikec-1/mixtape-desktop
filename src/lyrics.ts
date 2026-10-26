import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { audio, idb, idbDelete, idbGet, idbKeys, idbPut, notify, setLyricLine, songBytes, subscribeAudio, useOnline, useSettings, useStore } from "./store";
import { latin } from "./import";
import { recording as heard } from "./deezer";
import type { Track } from "./yt";
import { version } from "../package.json";

// A line starts at time (seconds) and, where the source says, ends at end. Text "" is a break (♪).
// Word-synced lyrics time each word (Apple's, each syllable) too, and the words make up the line's text.
// bg is backing vocals; roman the source's own romanisation of the line.
export type Word = { time: number; end?: number; text: string };
// bgWords times the backing vocals the same way; side "end" puts a duet's other singer on the right.
export type Line = { time: number; end?: number; text: string; words?: Word[]; bg?: string; bgWords?: Word[]; roman?: string; side?: "end" };
// Unsynced lyrics have time 0 on every line, and "" between verses. source "you": your own (useMine).
// slid: how far (s) the source's times were moved to fit this song (align). alt: another copy LRCLIB's
// uploads disagreed with, which the song itself picks between (align).
export type Lyrics = { lines: Line[]; synced: boolean; source: string; instrumental?: boolean; writers?: string; slid?: number; alt?: Line[] };

// In the app requests go through Rust like YouTube's (yt.ts), so CORS never matters; a browser uses its own.
const http: typeof fetch = "__TAURI_INTERNALS__" in window ? tauriFetch : (input, init) => fetch(input, init);
const timeout = (ms = 10_000) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

// LRCLIB: free, community-made, mostly synced, some word by word (its Lyricsfile YAML).
type Hit = { id: number; trackName: string; artistName: string; albumName?: string | null; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null; lyricsfile?: string | null; hasWordSync?: boolean };
// LRCLIB asks apps to say who they are; this header is its browser-friendly User-Agent.
const LRCLIB = { "Lrclib-Client": `Sleeve v${version} (https://github.com/mikec-1/Sleeve)` };

const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
// Across scripts too, so a Cyrillic title finds lyrics filed under its Latin spelling (norm stays as it was: it keys your lyrics).
const alike = (a: string, b: string) => {
  const x = norm(latin(a)), y = norm(latin(b));
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

// Mixtape's test for "the same song": the bare titles contain one another, both are the same version
// (a remix, live, acoustic or sped-up take only matches the same take), one of the song's artists
// matches, and the length is within 20 s. Closest length wins after that.
const VERSION = /\b(remix|mix|version|edit|live|acoustic|instrumental|demo|reprise|cover|bootleg|dub|radio|extended|sped|slowed|vip|flip|rework|unplugged|session|karaoke)\b/;
const versionKey = (s: string) => [...s.toLowerCase().matchAll(/[([]([^)\]]*)[)\]]|\s[-–—]\s(.*)$/g)].map((m) => (m[1] ?? m[2]).trim()).filter((g) => g && !/^(feat|ft|with)\b/.test(g) && !g.includes("remaster") && VERSION.test(g)).map((g) => g.replace(/[^\p{L}\p{N}]/gu, "")).sort().join("|");
const sameVersion = (a: string, b: string) => { const x = versionKey(a), y = versionKey(b); return !x === !y && (!x || x.includes(y) || y.includes(x)); };
const matches = (t: Track, name: string, artists: string[], secs?: number) =>
  alike(name, title(t)) && sameVersion(name, t.title) && (!artists.length || !t.artists.length || artists.some((a) => t.artists.some((b) => alike(a, b.name)))) && (!secs || !seconds(t.duration) || Math.abs(secs - seconds(t.duration)!) <= 20);

const rank = (r: Hit) => (r.hasWordSync && r.lyricsfile ? 0 : r.syncedLyrics ? 1 : r.plainLyrics ? 2 : r.instrumental ? 3 : 4);
// The first three lines, bare, so copies of the same lyrics group together however they're timed.
// Synced lyrics that can't fit this song: crammed by someone who never heard it (a quarter of the lines
// under a second apart, where even Rap God has one in a hundred), or still singing after it ends (timed
// to a longer cut). Uploads of a bad copy can outvote the good one.
const offbeat = (r: Hit, secs?: number) => {
  const ts = parseLrc(r.syncedLyrics ?? "").filter((l) => l.text).map((l) => l.time).sort((a, b) => a - b);
  return (ts.length > 8 && ts.filter((x, i) => i && x - ts[i - 1] < 1).length > ts.length / 4) || (!!secs && ts.length > 0 && ts.at(-1)! > secs + 1);
};
const print = (r: Hit) => (r.syncedLyrics ?? r.plainLyrics ?? "").split(/\r?\n/).map((l) => l.replace(/\[[^\]]*\]/g, "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim()).filter(Boolean).slice(0, 3).join("|");

// undefined: LRCLIB doesn't have it (404).
async function lrclibApi<T>(path: "get" | "search", q: Record<string, string>): Promise<T | undefined> {
  const go = () => http(`https://lrclib.net/api/${path}?${new URLSearchParams(q)}`, { headers: LRCLIB, signal: timeout() });
  let r = await go();
  if (r.status === 503 || r.status === 429) r = await new Promise((ok) => setTimeout(ok, 1000 * Math.min(5, +(r.headers.get("Retry-After") ?? 0) || 1))).then(go); // busy, or too many asks
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`LRCLIB: ${r.status}`);
  return r.json();
}

async function lrclib(t: Track): Promise<Lyrics | undefined> {
  const name = title(t);
  const artist = t.artists[0]?.name ?? "";
  const secs = seconds(t.duration);
  // LRCLIB's exact match (title, artist, album, length within 2 s) and a search by title and artist at once;
  // a free-text search, which forgives credits written differently, only when neither has it. Then
  // Mixtape's consensus, since anyone can upload: the lyrics most copies agree on win (the exact match
  // breaks a tie, then the song's album, then the newest upload), and within them word sync, then line
  // sync, then the closest length. Copies that can't fit the song don't vote while a well-timed one exists; otherwise
  // they count as plain words.
  const [exact, found] = await Promise.all([
    artist ? lrclibApi<Hit>("get", { track_name: name, artist_name: artist, ...(t.album && { album_name: t.album }), ...(secs && { duration: String(secs) }) }) : undefined,
    lrclibApi<Hit[]>("search", artist ? { track_name: name, artist_name: artist } : { track_name: name }),
  ]);
  const same = (r: Hit) => rank(r) < 4 && matches(t, r.trackName, [r.artistName], r.duration);
  let hits = [exact, ...(found ?? [])].filter((r): r is Hit => !!r && same(r));
  if (!hits.length) hits = ((await lrclibApi<Hit[]>("search", { q: `${name} ${artist}`.trim() })) ?? []).filter(same);
  const fine = hits.filter((r) => !r.syncedLyrics || !offbeat(r, secs));
  hits = fine.some((r) => r.syncedLyrics) ? fine : hits.map((r) => (r.syncedLyrics && offbeat(r, secs) ? { ...r, syncedLyrics: null, hasWordSync: false } : r));
  const groups = new Map<string, Hit[]>();
  for (const r of new Map(hits.map((r) => [r.id, r])).values()) groups.set(print(r), [...(groups.get(print(r)) ?? []), r]);
  const kept = exact && hits.find((r) => r.id === exact.id);
  const won = kept ? print(kept) : undefined;
  const album = (g: Hit[]) => +g.some((r) => !!t.album && !!r.albumName && alike(r.albumName, t.album));
  const newest = (g: Hit[]) => Math.max(...g.map((r) => r.id)); // ponytail: a guess (later uploads are usually fixes); the song's audio would know
  const off = (r: Hit) => (secs ? Math.abs(r.duration - secs) : 0);
  const voted = [...groups].sort(([a, x], [b, y]) => y.length - x.length || +(b === won) - +(a === won) || album(y) - album(x) || newest(y) - newest(x)).map(([, g]) => g.sort((a, b) => rank(a) - rank(b) || off(a) - off(b))[0]);
  const best = voted[0];
  if (!best) return;
  const source = "LRCLIB";
  if (rank(best) === 0) {
    const lines = await lyricsfile(best.lyricsfile!).catch(() => undefined);
    if (lines?.length) return { lines: tidy(lines), synced: true, source };
  }
  if (best.syncedLyrics) {
    const lines = parseLrc(best.syncedLyrics);
    // The runner-up's timed lines go along, for the song to pick between when its words are timed.
    const alt = voted.slice(1).find((r) => r.syncedLyrics)?.syncedLyrics;
    if (lines.length) return { lines: tidy(lines), synced: true, source, ...(alt && { alt: tidy(parseLrc(alt)) }) };
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

// NetEase Cloud Music, for synced lyrics LRCLIB doesn't have: a search, then the song's lyrics. Its API
// expects its own web player, so requests carry its Referer, a browser's User-Agent and an NMTID cookie (a
// random one, as NeteaseCloudMusicApi sends). A page can't set those or call it across origins, so in a
// browser this source fails and there are no lyrics; in the app it goes through Rust.
const hex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const NETEASE = {
  Referer: "https://music.163.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Cookie: `NMTID=${hex(16)}; os=pc; appver=3.1.17.204416`,
};
type Song = { id: number; name: string; artists?: { name: string }[]; duration?: number }; // duration in ms
// The credits NetEase opens its lyrics with: "作词 : …", "Composer: …".
const CREDIT = /^(作词|作曲|编曲|制作人?|监制|混音|母带|和声|录音|吉他|贝斯|鼓|弦乐|出品|发行|企划|统筹|词|曲|lyrics|lyricist|composer|producers?|arranger|written by|mix(ed|ing)?|master(ed|ing)?)\s*(by)?\s*[:：]/i;

async function netease(t: Track, words?: string): Promise<Lyrics | undefined> {
  const name = title(t);
  const artist = t.artists[0]?.name ?? "";
  const secs = seconds(t.duration);
  const call = async (path: string, q: Record<string, string>, method = "GET") => {
    const r = await http(`https://music.163.com/api/${path}?${new URLSearchParams(q)}`, { method, headers: NETEASE, signal: timeout() });
    if (!r.ok) throw new Error(`NetEase: ${r.status}`);
    const j = await r.json();
    if (j?.code != null && j.code !== 200) throw new Error(`NetEase: ${j.code}`); // -462 is it turning bots away, with a 200: not a miss
    return j;
  };
  // Mixtape's way: the four closest in length that pass the same-song test, their lyrics fetched at once.
  const off = (s: Song) => (secs && s.duration ? Math.abs(s.duration / 1000 - secs) : 0);
  const songs: Song[] = ((await call("search/pc", { s: `${name} ${artist}`.trim(), type: "1", limit: "10", offset: "0" }, "POST"))?.result?.songs ?? [])
    .filter((s: Song) => matches(t, s.name, s.artists?.map((a) => a.name) ?? [], s.duration && s.duration / 1000))
    .sort((a: Song, b: Song) => off(a) - off(b))
    .slice(0, 4);
  const got = await Promise.allSettled(songs.map((s) => call("song/lyric", { id: String(s.id), lv: "1", kv: "1", tv: "-1" })));
  if (got.length && got.every((g) => g.status === "rejected")) throw (got[0] as PromiseRejectedResult).reason;
  const lrcs = got.map((g) => (g.status === "fulfilled" && typeof g.value?.lrc?.lyric === "string" ? (g.value.lrc.lyric as string) : ""));
  const source = "NetEase Cloud Music";
  // Synced only: NetEase's untimed lyrics come stamped all at 0.
  const synced = lrcs.map((l) => parseLrc(l).filter((l) => !CREDIT.test(l.text))).filter((lines) => lines.filter((l) => l.time > 0).length > 1);
  if (!synced.length) return lrcs[0]?.includes("纯音乐，请欣赏") ? { lines: [], synced: false, source, instrumental: true } : undefined; // "pure music, enjoy"
  // With LRCLIB's plain words, the copy they fit best, wearing them; else the first that isn't censored.
  const fit = words ? synced.map((lines) => reskin(lines, words)).sort((a, b) => b.score - a.score)[0] : undefined;
  const lines = fit && fit.score >= 0.55 ? fit.lines : (synced.find((lines) => !lines.some((l) => l.text.includes("**"))) ?? synced[0]);
  return { lines: tidy(lines), synced: true, source };
}

// Mixtape's reskin: NetEase's timings carrying LRCLIB's words, which are usually typed out with more care
// (NetEase's are often censored or misheard). Walking forward through LRCLIB's words, each timed line takes
// the run that shares the most words with it (a near one first, then up to 25 words ahead); a line with no
// good match keeps its own. score: how well every line matched, on average.
const token = (w: string) => latin(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function reskin(timed: Line[], text: string) {
  const words = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !CREDIT.test(l) && !/^[[(].*[\])]$/.test(l)).flatMap((l) => l.split(/\s+/));
  const keys = words.map(token);
  const overlap = (a: Set<string>, from: number, len: number) => {
    const b = new Set(keys.slice(from, from + len).filter(Boolean));
    let both = 0;
    for (const w of b) if (a.has(w)) both++;
    return both / (a.size + b.size - both || 1);
  };
  let at = 0, sum = 0, count = 0;
  const lines = timed.map((l) => {
    const own = l.text.split(/\s+/).filter(Boolean);
    const mine = new Set(own.map(token).filter(Boolean));
    if (!mine.size) return l;
    count++;
    const best = (from: number, to: number) => {
      let top = { score: 0, from: 0, len: 0 };
      for (let i = from; i <= to && i < words.length; i++)
        for (let len = Math.max(1, own.length - 1); len <= own.length + 2 && i + len <= words.length; len++) {
          const score = overlap(mine, i, len);
          if (score > top.score) top = { score, from: i, len };
        }
      return top;
    };
    let m = best(at, at + 2);
    if (m.score < 0.5) { const far = best(at + 3, at + 25); if (far.score >= 0.55) m = far; }
    if (m.score < 0.34) return l;
    at = m.from + m.len;
    sum += m.score;
    return { ...l, text: words.slice(m.from, at).join(" "), words: undefined };
  });
  return { lines, score: count ? sum / count : 0 };
}

// Apple Music's lyrics, timed word by word, from the index am-lyrics uses: looked up by title, artist,
// album and length, then the TTML file it points to (on lrc.red). A result counts only if it's the same
// recording (title and main artist, length within 3 s) and timed by the word, which the index says, so
// anything else costs no second request; and only if every line fits inside the song. One 3 s budget
// for both requests, so a slow answer never holds up LRCLIB's.
type AppleHit = { track_name?: string; artist_name?: string; duration?: number; timing_type?: string; lyricsUrl?: unknown };
async function apple(t: Track): Promise<Lyrics | undefined> {
  const name = title(t);
  const artist = t.artists[0]?.name ?? "";
  const secs = seconds(t.duration);
  if (!artist) return;
  const signal = timeout(3000);
  const q = new URLSearchParams({ track: name, artist, ...(t.album && { album: t.album }), ...(secs && { duration: String(secs) }) });
  const r = await http(`https://lyrics-api.binimum.org/?${q}`, { signal });
  if (r.status === 404) return;
  if (!r.ok) throw new Error(`Apple lyrics: ${r.status}`);
  const hits: AppleHit[] = (await r.json())?.results ?? [];
  const url = hits.find(
    (h) =>
      typeof h.lyricsUrl === "string" &&
      (!h.timing_type || h.timing_type === "word") &&
      (!h.track_name || alike(h.track_name, name)) &&
      (!h.artist_name || alike(h.artist_name, artist)) &&
      (!secs || !h.duration || Math.abs(h.duration - secs) <= 3),
  )?.lyricsUrl as string | undefined;
  if (!url) return;
  // The file lives wherever the index says; off the app's allowlist, the webview fetches it itself.
  const file = await http(url, { signal }).catch(() => fetch(url, { signal }));
  if (!file.ok) throw new Error(`Apple lyrics file: ${file.status}`);
  const lyrics = parseTtml(await file.text());
  const last = lyrics?.lines.at(-1);
  if (!lyrics?.lines.some((l) => l.words) || (secs && last && (last.end ?? last.time) > secs + 3)) return;
  return lyrics;
}

// "12.3", "1:02.345", "1:02:03.4", or with a unit: "12.3s", "450ms".
const UNITS: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
function clock(v: string | null) {
  const unit = v && /^([\d.]+)(h|m|s|ms)$/.exec(v.trim());
  if (unit) return +unit[1] * UNITS[unit[2]];
  const n = v?.trim().split(":").reduce((s, x) => s * 60 + +x, 0);
  return n === undefined || Number.isNaN(n) ? undefined : n;
}

// Apple's TTML: a <p> a line and a timed <span> a syllable, with a space between spans where a word ends.
// Backing vocals are spans marked ttm:role="x-bg"; songwriters and sometimes a romanisation (by each line's
// key) sit in the head. Attributes are read by namespace too, as lrc.red's copies name some (the key)
// in its own. undefined unless the file is timed by the word.
const NS = { itunes: "http://music.apple.com/lyric-ttml-internal", ttm: "http://www.w3.org/ns/ttml#metadata", lrc: "http://lrc.red/lyric-ttml-internal" };
const attr = (el: Element, name: string, ...ns: string[]) => el.getAttribute(name) || ns.map((n) => el.getAttributeNS(n, name.split(":")[1])).find(Boolean) || null;
export function parseTtml(xml: string): Lyrics | undefined {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const timing = attr(doc.documentElement, "itunes:timing", NS.itunes);
  if (doc.getElementsByTagName("parsererror").length || (timing && timing !== "Word")) return;
  const roman = new Map<string, string>();
  for (const x of doc.querySelectorAll("transliteration text")) {
    const key = x.getAttribute("for");
    if (key && x.textContent?.trim()) roman.set(key, x.textContent.trim().replace(/\s+/g, " "));
  }
  const agents = new Map([...doc.getElementsByTagNameNS(NS.ttm, "agent")].map((a) => [attr(a, "xml:id", "http://www.w3.org/XML/1998/namespace") ?? "", a.getAttribute("type") ?? ""]));
  const singers: (string | undefined)[] = [];
  const lines: Line[] = [];
  for (const p of doc.getElementsByTagName("p")) {
    const main = syllables(p.childNodes);
    const time = clock(p.getAttribute("begin")) ?? main.words[0]?.time;
    if (time === undefined) continue;
    const key = attr(p, "itunes:key", NS.itunes, NS.lrc);
    const bg = main.bg && syllables(main.bg.childNodes);
    const bgText = bg && (bg.words.length ? bg.words.map((w) => w.text).join("") : bg.loose).trim();
    singers.push(attr(p, "ttm:agent", NS.ttm) ?? undefined);
    lines.push({
      time,
      end: clock(p.getAttribute("end")),
      text: (main.words.length ? main.words.map((w) => w.text).join("") : main.loose).trim(),
      ...(main.words.length && { words: main.words }),
      ...(bgText && { bg: bgText, ...(bg.words.length && { bgWords: bg.words }) }),
      ...(key && roman.has(key) && { roman: roman.get(key) }),
    });
  }
  sides(singers, agents).forEach((side, i) => side && (lines[i].side = side));
  const writers = [...doc.getElementsByTagName("songwriter")].map((w) => w.textContent?.trim()).filter(Boolean).join(", ");
  return lines.length ? { lines: tidy(lines), synced: true, source: "Apple Music", ...(writers && { writers }) } : undefined;
}

// A line's (or its backing vocals') timed spans: syllables, with a space after one where a word ends.
// Untimed text is kept as loose; the backing-vocal span is handed back to read the same way.
function syllables(nodes: NodeListOf<ChildNode>) {
  const words: Word[] = [];
  let loose = "", bg: Element | undefined;
  for (const node of nodes) {
    if (!(node instanceof Element)) {
      if (/\s/.test(node.textContent ?? "") && words.length) words[words.length - 1].text += " "; // a word ends
      else loose += node.textContent ?? "";
    } else if (attr(node, "ttm:role", NS.ttm) === "x-bg") bg = node;
    else {
      const time = clock(node.getAttribute("begin"));
      if (time === undefined) loose += node.textContent ?? "";
      else words.push({ time, end: clock(node.getAttribute("end")), text: node.textContent ?? "" });
    }
  }
  if (words.length) words[words.length - 1].text = words[words.length - 1].text.trimEnd();
  return { words, loose, bg };
}

// Duets, as am-lyrics lays them out: the first singer on the left, and each change of singer swaps
// sides; a group (everyone) stays left. If nearly every line ended up right, all of them flip.
function sides(singers: (string | undefined)[], types: Map<string, string>) {
  let left = true, last: string | undefined;
  const out = singers.map((id): "start" | "end" | undefined => {
    if (!id) return;
    const type = types.get(id) || (id === "v1000" ? "group" : id === "v2000" ? "other" : "person");
    if (type === "group") return "start";
    left = last === undefined ? type !== "other" : id !== last ? !left : left;
    last = id;
    return left ? "start" : "end";
  });
  const marked = out.filter(Boolean).length;
  const right = out.filter((s) => s === "end").length;
  const flip = marked > 0 && Math.round((right / marked) * 100) >= 85;
  return out.map((s) => (s === "end" ? (flip ? undefined : "end") : s === "start" && flip ? "end" : undefined));
}

// Where lyrics come from, the first that has them: Apple's word-timed lyrics, LRCLIB's synced ones, then
// NetEase Cloud Music's (wearing LRCLIB's plain words when it has them, as Mixtape does), then LRCLIB's
// plain ones. Apple and LRCLIB are asked at once, so a song Apple lacks waits no longer than LRCLIB takes;
// NetEase (slower, and far away) only when neither has synced lyrics. None: just no lyrics, with no error,
// and a source that didn't answer is asked again the next time they're shown. Settings → Lyrics can
// switch any of them off.
const SOURCES = { apple: "Apple Music", lrclib: "LRCLIB", netease: "NetEase Cloud Music" } as const;
const off = (name: string) => useSettings.getState().lyricsOff.some((k) => SOURCES[k] === name);
// A source that didn't answer (busy, slow, offline for a moment) is asked twice more before giving up, so
// "no lyrics" means none were found, not that a source hiccuped.
async function find(t: Track): Promise<Lyrics | null> {
  for (let i = 0; ; i++)
    try {
      return await ask(t);
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
}
async function ask(t: Track): Promise<Lyrics | null> {
  let down = false;
  const miss = () => void (down = true);
  const use = (name: string, from: (t: Track) => Promise<Lyrics | undefined>) => (off(name) ? undefined : from(t).catch(miss));
  const fromLrclib = use(SOURCES.lrclib, lrclib);
  const fromApple = await use(SOURCES.apple, apple);
  if (fromApple) return fromApple;
  const l = await fromLrclib;
  if (l?.synced || l?.instrumental) return l;
  const found = (await use(SOURCES.netease, (t) => netease(t, l?.lines.map((x) => x.text).join("\n")))) ?? l;
  if (found) return found;
  if (down) throw new Error("A lyrics source didn't answer");
  return null;
}

// A song file's own lyrics (local.rs local_lyrics), ahead of every source: synced ones in its tags, then a
// .lrc file beside it, then plain ones in its tags. Read each time, not kept: they're on disk already,
// and you may have just fixed the .lrc.
async function fromFile(path: string): Promise<Lyrics | undefined> {
  const { embedded, lrc } = await invoke<{ embedded?: string; lrc?: string }>("local_lyrics", { path }).catch(() => ({ embedded: undefined, lrc: undefined }));
  const synced = (text?: string) => !!text && text.split(/\r?\n/).some((r) => STAMP.test(r));
  if (synced(embedded)) return { lines: tidy(parseLrc(embedded!)), synced: true, source: "the song’s file" };
  if (synced(lrc)) return { lines: tidy(parseLrc(lrc!)), synced: true, source: "its .lrc file" };
  if (embedded?.trim()) return { lines: plain(embedded), synced: false, source: "the song’s file" };
}

// A downloaded song's lyrics, fetched now (if they aren't kept already) so they're there offline.
// How many songs' lyrics are kept, and forgetting them (Settings → Library). Yours stay; a downloaded
// song's are fetched again the next time it plays online.
export const keptLyrics = () => idbKeys("lyrics:").then((k) => k.length);
export const forgetLyrics = () => idbDelete("lyrics:");

// Forgets what's kept for this song and asks every source again: for a miss kept from a bad day, or a
// song a source has since added.
export function lookAgain(t: Track) {
  const key = `lyrics:${heard(t)}`;
  put(key, {});
  idbDelete(`lyrics:v4:${heard(t)}`).catch(() => {}).then(() => stored(t)).then((value) => put(key, { value }), () => put(key, { failed: true }));
}

export const keepLyrics = (t: Track) => stored(t).then(() => {}, () => {});

// Lyrics found are kept on disk, so a song heard before has them at once, even offline, with no request.
// A miss is kept two days, then asked again, as sources keep adding songs. ponytail: never pruned (a
// few KB a song); bump the version when a source is added, or what's read from one changes (v2: Apple's
// backing-vocal timings and duet sides; v3: Mixtape's matching; v4: no copies that can't fit the song).
async function stored(t: Track): Promise<Lyrics | null> {
  const own = t.file ? await fromFile(t.file) : undefined;
  if (own) return own;
  const key = `lyrics:v4:${heard(t)}`;
  const kept = await idbGet<{ at: number; lyrics: Lyrics | null }>(key).catch(() => undefined);
  if (kept && (kept.lyrics ? !off(kept.lyrics.source) : Date.now() - kept.at < 2 * 86_400_000)) return kept.lyrics;
  const lyrics = await find(t);
  idbPut(key, { at: Date.now(), lyrics }).catch(() => {});
  return lyrics;
}

// Lyrics you wrote or fixed yourself. They beat every source, and are kept by song (its bare title and
// main artist), so they stay when the song comes back under another id. text is LRC, or plain.
export type Mine = { title: string; artist: string; text: string; at: number };
export const useMine = create<{ songs: Record<string, Mine> }>()(persist(() => ({ songs: {} }), { name: "my-lyrics", storage: createJSONStorage(() => idb) }));
export const songKey = (t: Track) => `${norm(title(t))}|${norm(t.artists[0]?.name ?? "")}`;
export const titleOf = title;

// Synced once every line has its time. Until then (partway through stamping them) they read as plain
// text, so no line goes missing.
const parsedMine = new WeakMap<Mine, Lyrics>();
export function fromMine(mine: Mine): Lyrics {
  let l = parsedMine.get(mine);
  if (!l) {
    const rows = mine.text.split(/\r?\n/).filter((r) => r.trim() && !/^\[[a-z]+:/i.test(r)); // not [ar:…] tags
    const synced = rows.length > 0 && rows.every((r) => STAMP.test(r));
    l = synced
      ? { lines: tidy(parseLrc(mine.text)), synced, source: "you" }
      : { lines: plain(mine.text.replace(/^\s*(\[\d+:\d+(?:[.:]\d+)?\]\s*)+/gm, "")), synced, source: "you" };
    parsedMine.set(mine, l);
  }
  return l;
}

export function saveMine(key: string, { title, artist, track }: { title: string; artist: string; track?: Track }, text: string) {
  if (!text.trim()) return removeMine(key);
  useMine.setState((s) => ({ songs: { ...s.songs, [key]: { title, artist, text, at: Date.now() } } }));
  notify({ text: "Lyrics Saved", detail: artist ? `${title} · ${artist}` : title, thumb: track?.thumb });
}
export function removeMine(key: string) {
  const was = useMine.getState().songs[key];
  if (!was) return;
  useMine.setState((s) => ({ songs: Object.fromEntries(Object.entries(s.songs).filter(([k]) => k !== key)) }));
  notify({ text: "Your Lyrics Removed", detail: was.title, undo: () => (useMine.setState((s) => ({ songs: { ...s.songs, [key]: was } })), useStore.setState({ toast: undefined })) });
}

// Any lyrics as text to edit: LRC when synced, so the times survive.
export const lrcTime = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
export const asText = (l: Lyrics) => l.lines.map((x) => (l.synced ? `[${lrcTime(x.time)}] ${x.text}` : x.text)).join("\n");

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

// Each song's own timing nudge (s; positive shows the lyrics later), kept by song like your lyrics.
export const useTiming = create<{ songs: Record<string, number> }>()(persist(() => ({ songs: {} }), { name: "lyrics-timing", storage: createJSONStorage(() => idb) }));
export function nudgeLyrics(t: Track, by: number | null) {
  const key = songKey(t);
  useTiming.setState((s) => {
    const next = by === null ? 0 : Math.round(((s.songs[key] ?? 0) + by) * 100) / 100;
    const { [key]: _, ...rest } = s.songs;
    return { songs: next ? { ...rest, [key]: next } : rest };
  });
}
const shifted = new WeakMap<Lyrics, { by: number; l: Lyrics }>();
function timed<L extends Lyrics | null | undefined>(l: L, by = 0): L {
  if (!l || !by || !l.synced) return l;
  let hit = shifted.get(l);
  if (hit?.by !== by) shifted.set(l, (hit = { by, l: { ...l, lines: l.lines.map((x) => shift(x, by)) } }));
  return hit.l as L;
}

// Word timings from the song itself (align.rs), for synced lines that only time themselves, worked out
// once a lyrics view shows the song and kept on disk by song and lyrics, so fixing them times them again.
// The model knows English letters, so only lines in Latin script (accents dropped) or Cyrillic (spelt out
// in Latin) go; the rest, and any line it can't find, keep the estimate. Each line's index gets its words,
// or null. Fetched lyrics found to be off from the song as a whole (timed to another upload) are kept
// moved, so every view has them right; your own stay where you put them.
const SPELLED = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\p{P}\p{S}\s]*$/u;
const CYRILLIC = Object.fromEntries([..."абвгдеёжзийклмнопрстуфхцчшщъыьэюяіїєґ"].map((c, i) => [c, "A B V G D E YO ZH Z I Y K L M N O P R S T U F H TS CH SH SHCH - Y - E YU YA I YI YE G".split(" ")[i].replace("-", "")]));
const letters = (w: string) => w.toLowerCase().replace(/[а-яёіїєґ]/g, (c) => CYRILLIC[c]).normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’‘`]/g, "'").toUpperCase().replace(/[^A-Z']/g, "");
const hash = (lines: Line[]) => [...lines.map((l) => `${l.time}${l.text}`).join("\n")].reduce((h, c) => (h * 31 + c.codePointAt(0)!) | 0, 0) >>> 0;
async function align(t: Track, l: Lyrics, key: string, fetched: boolean): Promise<(Word[] | null)[]> {
  const kept = await idbGet<{ by: number; words: (Word[] | null)[] }>(key).catch(() => undefined);
  if (kept) return slide(t, l, kept, fetched);
  const job = (lines: Line[]) => {
    const want = lines.flatMap((line, i) => (line.text && !line.words && SPELLED.test(line.text) ? [i] : []));
    const parts = want.map((i) => lines[i].text.match(WORDS) ?? []);
    // A line before a long instrumental is looked for in its first 12 s, not across the break.
    return { want, parts, send: want.map((i, k) => ({ start: lines[i].time, end: Math.min(lines[i].end ?? lines[i + 1]?.time ?? Infinity, lines[i].time + 12), words: parts[k].map(letters) })) };
  };
  const shown = job(l.lines), other = fetched && l.alt ? job(l.alt) : undefined;
  let use = l, { want, parts } = shown, out = l.lines.map((): Word[] | null => null), by = 0;
  if (want.length) {
    // 16 kHz mono, what the model hears.
    const buf = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await songBytes(t));
    const pcm = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) buf.getChannelData(c).forEach((v, i) => (pcm[i] += v / buf.numberOfChannels));
    const [slid, got, alt] = await invoke<[number, ([number, number][] | null)[], boolean]>("align_words", new Uint8Array(pcm.buffer), { headers: { "x-lines": JSON.stringify(shown.send), ...(other?.want.length && { "x-alt": JSON.stringify(other.send) }) } });
    // The song fit the other copy clearly better: it's what this song shows from now on, its words kept under it.
    if (alt) {
      ({ want, parts } = other!);
      use = { ...l, lines: l.alt!, alt: undefined };
      out = use.lines.map(() => null);
      key = `words:v5:${heard(t)}:${hash(use.lines)}`;
      idbPut(`lyrics:v4:${heard(t)}`, { at: Date.now(), lyrics: use }).catch(() => {});
      put(`lyrics:${heard(t)}`, { value: use });
    }
    want.forEach((i, k) => (out[i] = got[k]?.map(([time, end], j) => ({ time, end, text: parts[k][j] })) ?? null));
    by = slid;
  }
  idbPut(key, { by, words: out }).catch(() => {});
  const words = await slide(t, use, { by, words: out }, fetched);
  return use === l ? words : []; // the other copy's words reach it under its own key
}
// Fetched lyrics the song is `by` later than: kept moved (with their words, under the moved lyrics' key),
// which shows them everywhere and brings the lyrics view back here for the words.
async function slide(t: Track, l: Lyrics, { by, words }: { by: number; words: (Word[] | null)[] }, fetched: boolean) {
  if (!by || !fetched) return words;
  const moved = { ...timed(l, by), slid: (l.slid ?? 0) + by, alt: undefined };
  await idbPut(`words:v5:${heard(t)}:${hash(moved.lines)}`, { by: 0, words: words.map((w) => w?.map((x) => ({ ...x, time: x.time + by, end: x.end! + by })) ?? null) }).catch(() => {});
  idbPut(`lyrics:v4:${heard(t)}`, { at: Date.now(), lyrics: moved }).catch(() => {});
  put(`lyrics:${heard(t)}`, { value: moved });
  return words;
}
const worded = new WeakMap<Lyrics, { words: (Word[] | null)[]; l: Lyrics }>();
function withWords<L extends Lyrics | null | undefined>(l: L, words?: (Word[] | null)[]): L {
  if (!l || !words?.some(Boolean)) return l;
  let hit = worded.get(l);
  if (hit?.words !== words) worded.set(l, (hit = { words, l: { ...l, lines: l.lines.map((x, i) => (words[i] ? { ...x, words: words[i]! } : x)) } }));
  return hit.l as L;
}

// A song's lyrics: your own if you wrote some, otherwise what the sources have. words: time the words of
// lines that only time themselves from the song (the lyrics views), unless Settings → Lyrics says not to.
export function useLyrics(t?: Track, words = false) {
  const mine = useMine((s) => (t ? s.songs[songKey(t)] : undefined));
  const by = useTiming((s) => (t ? s.songs[songKey(t)] : undefined));
  const fetched = useResult(t && !mine ? `lyrics:${heard(t)}` : undefined, () => stored(t!));
  const base = mine ? fromMine(mine) : fetched.value;
  // Aligned before the timing nudge, so nudging shifts the found words instead of looking again in the wrong place.
  const want = useSettings((s) => s.lyricsWords) && words && "__TAURI_INTERNALS__" in window && !!t && !!base?.synced;
  const key = want ? `words:v5:${heard(t!)}:${hash(base!.lines)}` : undefined;
  const aligned = useResult(key, () => align(t!, base!, key!, !mine));
  const value = timed(withWords(base, aligned.value), by);
  // timing: the words are still being found (the song has to download first), so nothing guesses at them meanwhile.
  return mine ? { value, loading: false, timing: aligned.loading, retry: () => {} } : { ...fetched, value, timing: aligned.loading };
}
// Without a hook: what's known now, for the mini player and the editor.
// raw: without the song's timing nudge (the editor, so saving doesn't bake it in twice).
export const lyricsNow = (t: Track, raw = false) => {
  const mine = useMine.getState().songs[songKey(t)];
  const l = mine ? fromMine(mine) : (results.get(`lyrics:${heard(t)}`)?.value as Lyrics | null | undefined);
  return raw ? l : timed(l, useTiming.getState().songs[songKey(t)]);
};

// The next song's lyrics load while this one plays, so they're there the moment it starts.
useStore.subscribe((s, was) => {
  const t = s.queue[s.index + 1];
  if (t && (s.index !== was.index || s.queue !== was.queue)) fetchOnce(`lyrics:${heard(t)}`, () => stored(t));
});

// The mini player shows the line being sung (store.ts sends it along), unless Settings turned that off:
// "" between lines, undefined when the song has no synced lyrics.
setLyricLine(() => {
  const { queue, index } = useStore.getState();
  const l = queue[index] && useSettings.getState().lyricsPeek ? lyricsNow(queue[index]) : undefined;
  return l?.synced ? (l.lines[lineAt(l.lines, audio.currentTime)]?.text ?? "") : undefined;
});

const lineAt = (lines: Line[], now: number) => {
  let i = -1;
  while (lines[i + 1] && lines[i + 1].time <= now) i++;
  return i;
};
export const lineNow = (l?: Lyrics | null) => (l?.synced ? lineAt(l.lines, audio.currentTime) : -1);

// The line being sung (-1 before the first), read live from the player. It re-renders only when the line
// changes, not on every timeupdate; those come about four times a second, so a timer lands each change
// on the beat. lead looks that many seconds ahead (the scroll starts early, to land on time).
export function useLine(lyrics?: Lyrics | null, lead = 0) {
  const lines = lyrics?.synced ? lyrics.lines : undefined;
  const [seen, setSeen] = useState<{ lines?: Line[]; at: number }>({ at: -1 });
  useEffect(() => {
    if (!lines) return;
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      const now = audio.currentTime + lead;
      const at = lineAt(lines, now);
      setSeen((s) => (s.lines === lines && s.at === at ? s : { lines, at }));
      const next = lines[at + 1];
      if (next && !audio.paused) timer = setTimeout(update, (next.time - now) * 1000 + 5);
    };
    update();
    const off = subscribeAudio(update);
    return () => (off(), clearTimeout(timer));
  }, [lines, lead]);
  return !lines ? -1 : seen.lines === lines ? seen.at : lineAt(lines, audio.currentTime + lead);
}

// How far through each of line i's words the song is, 0 to 1. A last word with no end of its own
// is held for a second at most, so a gap after it doesn't stretch it out.
export function wordProgress(words: Word[], lines: Line[], i: number, now: number) {
  const line = lines[i];
  return words.map((w, j) => {
    const end = w.end ?? words[j + 1]?.time ?? line.end ?? Math.min(lines[i + 1]?.time ?? Infinity, w.time + 1);
    return Math.min(1, Math.max(0, (now - w.time) / Math.max(0.05, end - w.time)));
  });
}

// Syllables into words: a word ends where a syllable ends in a space. Its motion, as am-lyrics picks it
// for word-timed lyrics: Chinese and Japanese characters rise in one by one; a word held a second or
// more (seven letters at most) swells and glows; right-to-left scripts and the rest just lift.
export type Group = { first: number; count: number; start: number; end: number; space: string; motion: "emphasis" | "rise" | "none" };
const RTL = /[\u0590-\u08ff]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;
export const isRtl = (s: string) => RTL.test(s);
export function groups(words: Word[], real: boolean): Group[] {
  const out: Group[] = [];
  let first = 0;
  words.forEach((w, i) => {
    if (!/\s$/.test(w.text) && i < words.length - 1) return;
    const syl = words.slice(first, i + 1);
    const text = syl.map((x) => x.text).join("").trim();
    const end = Math.max(...syl.map((x, j) => x.end ?? syl[j + 1]?.time ?? words[i + 1]?.time ?? x.time + 1));
    const n = [...text].length;
    const motion = !real || !n || RTL.test(text) ? "none" : HAN.test(text) ? (n > 1 ? "rise" : "none") : end - syl[0].time >= 1 && n <= 7 ? "emphasis" : "none";
    out.push({ first, count: syl.length, start: syl[0].time, end, space: /\s*$/.exec(w.text)![0], motion });
    first = i + 1;
  });
  return out;
}

// Springs, as am-lyrics moves things. springProgress: 0 to 1, critically damped, settling in about
// response seconds. sampleSpring: where a spring that started at position with velocity is after time.
export const springProgress = (t: number, response: number) => {
  if (t <= 0) return 0;
  const phase = (2 * Math.PI * t) / Math.max(0.001, response);
  return 1 - (1 + phase) * Math.exp(-phase);
};
export function sampleSpring(position: number, velocity: number, t: number, frequency: number, damping = 0.9 * frequency) {
  const omega = Math.sqrt(frequency * frequency - damping * damping);
  const decay = Math.exp(-damping * t), cos = Math.cos(omega * t), sin = Math.sin(omega * t);
  return {
    position: decay * (position * cos + ((velocity + damping * position) / omega) * sin),
    velocity: decay * (velocity * cos - ((damping * velocity + frequency * frequency * position) / omega) * sin),
  };
}

// Chinese and Japanese go without spaces, so there each character is a word.
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const WORDS = new RegExp(`[${CJK}]\\s*|[^\\s${CJK}]+\\s*`, "gu");
// A word's length in letters; a Chinese, Japanese or Korean character is a syllable, so it counts three.
const WIDE = new RegExp(`[${CJK}\\p{Script=Hangul}]`, "u");
const size = (word: string) => [...word].reduce((n, c) => n + (WIDE.test(c) ? 3 : /[\p{L}\p{N}]/u.test(c) ? 1 : 0), 0) || 1;

// Word timings for a line that only has its own: its time shared out by the words' lengths. At most
// about 0.13 s a letter, so a line before a long instrumental doesn't crawl across it. A guess (a held
// note or a pause mid-line throws it), so real timings win.
export function estimateWords(lines: Line[], i: number, text: string): Word[] {
  const line = lines[i];
  const parts = text.match(WORDS) ?? [];
  const beats = parts.map(size);
  const total = beats.reduce((a, b) => a + b, 0);
  const room = (line.end ?? lines[i + 1]?.time ?? line.time + 10) - line.time;
  const span = Math.min(room * 0.9, total * 0.13 + 0.5);
  let at = line.time;
  return parts.map((text, j) => {
    const time = at;
    at += (span * beats[j]) / total;
    return { time, end: at, text };
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
  // Apple's lyrics sometimes bring their own romanisation: no request needed then.
  const own = useMemo(() => (lyrics?.lines.some((l) => l.roman) ? lyrics.lines.map((l) => l.roman) : undefined), [lyrics]);
  const rm = useResult(t && can.romanise && on.romanise && !own ? `romanise:${t.id}` : undefined, () => romanise(texts()));
  const romanised = on.romanise && can.romanise ? (own ?? rm.value) : undefined;
  return { can, on, to, translation: tr.value, romanised, loading: tr.loading || rm.loading, failed: tr.failed || rm.failed, retry: () => (tr.retry(), rm.retry()) };
}
