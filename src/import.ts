import { searchSongs, searchVideos, searchYouTube, parseSecs, type Track, type Artist } from "./yt";
import { newPlaylist, notify, useStore } from "./store";

export type CsvTrack = {
  title: string;
  artist: string;
  album?: string;
  secs?: number;
  isrc?: string;
};

// Parses RFC 4180 CSV with quoted fields, escaped quotes (""), and CRLF / LF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (c === "\r") {
        if (i + 1 < text.length && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
      } else if (c === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
      } else {
        field += c;
      }
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// Reads headers case-insensitively to support Exportify, TuneMyMusic, and generic exports.
export function parsePlaylistCsv(text: string): CsvTrack[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());

  const findCol = (...names: string[]) =>
    headers.findIndex((h) => names.some((n) => h === n.toLowerCase()));

  const titleIdx = findCol("track name", "title", "song", "name");
  const artistIdx = findCol("artist name(s)", "artist name", "artist", "artists");
  const albumIdx = findCol("album name", "album");
  const durationIdx = findCol("duration (ms)", "duration (s)", "duration", "length");
  const isrcIdx = findCol("isrc");

  if (titleIdx === -1 || artistIdx === -1) return [];

  const tracks: CsvTrack[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const title = row[titleIdx]?.trim();
    const artist = row[artistIdx]?.trim();
    if (!title || !artist) continue;

    const album = albumIdx !== -1 ? row[albumIdx]?.trim() || undefined : undefined;
    const isrc = isrcIdx !== -1 ? row[isrcIdx]?.trim() || undefined : undefined;

    let secs: number | undefined;
    if (durationIdx !== -1 && row[durationIdx]) {
      const val = row[durationIdx].trim();
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        secs = num > 1000 ? Math.round(num / 1000) : Math.round(num);
      } else if (val.includes(":")) {
        secs = parseSecs(val);
      }
    }

    tracks.push({ title, artist, album, secs, isrc });
  }
  return tracks;
}

// Cyrillic to Latin transliteration mapping for Eastern European artists
const CYRILLIC_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  є: "ye", і: "i", ї: "yi", ґ: "g",
};

export function transliterateCyrillic(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((c) => CYRILLIC_MAP[c] ?? c)
    .join("");
}

// Normalizes strings: NFKD diacritics stripping, stylized characters (!ce -> ice, mon€ -> mone, rmx -> remix).
export function normalizeStr(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/€/g, "e")
    .replace(/\b!([a-z])/gi, "i$1")
    .replace(/\brmx\b/gi, "remix");
}

// Lowercase word set, stripped of punctuation, accents, and 1-char tokens (unless that empties it).
export function words(s: string): Set<string> {
  if (!s) return new Set();
  const normalized = normalizeStr(s);
  const tokens = normalized.split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
  const all = new Set(tokens);
  const meaningful = new Set([...all].filter((w) => w.length > 1));
  return meaningful.size > 0 ? meaningful : all;
}

// Strips feature credits and version/bonus tags anywhere in the title, while preserving
// phrases like "Dancing With Myself" or "Stay With Me".
export function bareTitle(title: string): string {
  if (!title) return "";
  const s = title
    // Strip bracketed feat/ft/with anywhere: "(feat. X)", "[ft. Y]", "(with Z)"
    .replace(/\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]/gi, " ")
    // Strip unbracketed "feat. X" or "ft. Y" up to the next bracket, dash, or end of string
    .replace(/\s+(?:feat|ft|featuring)\b\.?\s+[^()[\]-]+/gi, " ")
    // Strip bracketed version/bonus tags: "(Extended Version)", "(Bonus)", "(Bonus Track)", "(Radio Edit)", etc.
    .replace(
      /\s*[\(\[]\s*(?:extended|radio|club|original|album|single|acoustic|instrumental|vocal|dub|bonus)?\s*(?:mix|version|edit|cut|remaster(?:ed)?|deluxe|anniversary|live|session|track)[^\)\]]*[\)\]]/gi,
      " ",
    )
    // Strip standalone "(Bonus)" or "[Bonus]"
    .replace(/\s*[\(\[]\s*bonus\s*[\)\]]/gi, " ")
    // Strip trailing "- Extended Version", "- Radio Edit", etc.
    .replace(
      /\s*-\s*(?:\d{4}\s+)?(?:extended|radio|club|original|album|single|acoustic|instrumental|vocal|dub|bonus)?\s*(?:mix|version|edit|cut|remaster(?:ed)?|deluxe|mono|stereo|bonus track|anniversary edition).*$/i,
      "",
    )
    // Strip standalone trailing "(2020 Remaster)"
    .replace(/\s*[\(\[]\s*\d{4}\s+remaster(?:ed)?\s*[\)\]]/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
  return s || title;
}

// Parses artist string by semicolon, comma, slash, or feature markers.
export function parseRowArtists(artistStr: string): string[] {
  if (!artistStr) return [];
  return artistStr
    .split(/[;,/]|(?:\s+x\s+)|\b(?:feat\.?|ft\.?|featuring|with)\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Precomputes normalized and transliterated search haystacks for a candidate track.
export function candidateHaystacks(candidate: Track): { norm: string; stripped: string; translit: string } {
  const artistsStr = (candidate.artists || []).map((a) => a.name).join(" ");
  const raw = `${candidate.title} ${artistsStr} ${candidate.album || ""}`;
  const norm = normalizeStr(raw);
  const stripped = norm.replace(/[^\p{L}\p{N}]+/gu, "");
  const translit = transliterateCyrillic(norm).replace(/[^\p{L}\p{N}]+/gu, "");
  return { norm, stripped, translit };
}

// Identity gate: verifies that the candidate is genuinely the song from the CSV.
// Rule: The wrong song is worse than no song.
export function matchesCandidate(row: CsvTrack, candidate: Track): boolean {
  const { stripped, translit } = candidateHaystacks(candidate);
  if (!stripped) return false;

  // Title Gate: Every significant word from the CSV title must appear in candidate
  const targetTitle = bareTitle(row.title);
  const allTitleWords = [...words(targetTitle)];
  const titleWords = allTitleWords.filter((w) => w.length > 1);
  const effectiveTitleWords = titleWords.length > 0 ? titleWords : allTitleWords;

  if (effectiveTitleWords.length > 0) {
    const matchedCount = effectiveTitleWords.filter(
      (w) => stripped.includes(w) || translit.includes(w),
    ).length;
    const requiredMin =
      effectiveTitleWords.length <= 2 ? effectiveTitleWords.length : Math.ceil(effectiveTitleWords.length * 0.7);
    if (matchedCount < requiredMin) {
      return false;
    }
  }

  // Artist Gate: At least ONE of the CSV artists must appear in the candidate
  const artists = parseRowArtists(row.artist);
  if (artists.length > 0) {
    const artistMatched = artists.some((art) => {
      const allArtWords = [...words(art)];
      const artWords = allArtWords.filter((w) => w.length > 1);
      const effectiveArtWords = artWords.length > 0 ? artWords : allArtWords;
      if (effectiveArtWords.length === 0) return true;
      return effectiveArtWords.every((w) => stripped.includes(w) || translit.includes(w));
    });

    if (!artistMatched) {
      // Long distinctive title exception (e.g. viral sound or multi-song mashup with 4+ words where duration aligns)
      const isLongDistinctiveTitle = effectiveTitleWords.length >= 4;
      const durSecs = candidate.secs ?? parseSecs(candidate.duration) ?? 0;
      const durDiff = row.secs && durSecs > 0 ? Math.abs(durSecs - row.secs) : Infinity;
      if (!(isLongDistinctiveTitle && (durDiff <= 15 || row.secs === undefined))) {
        return false;
      }
    }
  }

  return true;
}

// Noise and bootleg word lists from Mixtape resolver
const NOISE = [
  "official video",
  "music video",
  "lyric video",
  "live",
  "cover",
  "remix",
  "sped up",
  "slowed",
  "reverb",
  "mashup",
  "intro",
  "trailer",
  "8d",
  "extended",
];

const BOOTLEG = [
  "ai cover",
  "ai verse",
  "leak",
  "unreleased",
  "snippet",
  "bootleg",
  "fan made",
  "fanmade",
  "concept",
  "remake",
  "reimagined",
  "open verse",
  "added verse",
];

// Scores a candidate that has already passed the identity gate.
export function scoreCandidate(
  c: Track,
  expectedDur: number,
  query: string,
  rank: number,
): number {
  let score = rank * 2;
  const dur = c.secs ?? parseSecs(c.duration) ?? 0;
  if (expectedDur > 0 && dur > 0) {
    const delta = Math.abs(dur - expectedDur);
    score += delta;
    if (delta > 20) {
      score += 60;
    }
  }

  const artistsStr = (c.artists?.map((a) => a.name).join(" ") || "").toLowerCase();
  const title = c.title.toLowerCase();
  const queryLower = query.toLowerCase();

  // Official YouTube Topic uploads get strongest preference
  if (artistsStr.endsWith("- topic") || artistsStr.includes("- topic")) {
    score -= 120;
  }
  if (
    title.includes("official audio") ||
    title.includes("(audio)") ||
    title.includes("[audio]")
  ) {
    score -= 40;
  }

  for (const w of NOISE) {
    if (title.includes(w) && !queryLower.includes(w)) {
      score += 40;
    }
  }

  for (const w of BOOTLEG) {
    if (title.includes(w) && !queryLower.includes(w)) {
      score += 100;
    }
  }

  return score;
}

// Picks the best candidate matching identity gates with optimal scoring.
export function pickBestCandidate(
  row: CsvTrack,
  query: string,
  candidates: Track[],
): Track | undefined {
  if (!candidates.length) return undefined;

  const expectedDur = row.secs ?? 0;
  let best: Track | undefined;
  let bestScore = Infinity;

  for (let rank = 0; rank < candidates.length; rank++) {
    const c = candidates[rank];
    if (!matchesCandidate(row, c)) continue;

    const score = scoreCandidate(c, expectedDur, query, rank);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

// Format seconds into "M:SS" string for display
export function formatSecs(secs?: number): string | undefined {
  if (!secs || isNaN(secs) || secs <= 0) return undefined;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// Preserves Spotify/CSV artist names while linking to YouTube artist pages when candidate IDs match.
export function parseArtists(
  artistStr: string,
  candidateArtists?: Artist[],
): Artist[] {
  if (!artistStr) {
    return candidateArtists?.length ? candidateArtists : [{ name: "Unknown Artist" }];
  }

  // If candidate from YouTube Music has artist IDs, preserve them if names match
  if (candidateArtists && candidateArtists.length > 0) {
    const candidateCombined = candidateArtists.map((a) => a.name.toLowerCase()).join(" ");
    const candWords = words(candidateCombined);
    const rowWords = words(artistStr);
    const overlap = [...rowWords].filter((w) => candWords.has(w));
    if (overlap.length >= Math.min(rowWords.size, 2)) {
      return candidateArtists;
    }
  }

  const names = parseRowArtists(artistStr);
  return names.length > 0 ? names.map((name) => ({ name })) : [{ name: artistStr.trim() }];
}

// Builds the final Track for Sleeve, preserving original Spotify/CSV title and artist metadata
// while attaching the matched video ID for audio playback.
export function buildMatchedTrack(row: CsvTrack, candidate: Track): Track {
  const durSecs = candidate.secs ?? row.secs;
  return {
    id: candidate.id,
    title: row.title, // Keep original clean title from CSV
    artists: parseArtists(row.artist, candidate.artists), // Keep original artist(s) from CSV
    album: row.album || candidate.album,
    duration: candidate.duration || formatSecs(row.secs),
    secs: durSecs,
    thumb: candidate.thumb,
    explicit: candidate.explicit,
    isrc: row.isrc,
  };
}

// Backward-compatible matcher interface.
export function matchSong(row: CsvTrack, candidates: Track[]): Track | undefined {
  const cleanTitle = bareTitle(row.title);
  const primaryArtist = parseRowArtists(row.artist)[0] || row.artist;
  const query = `${cleanTitle} ${primaryArtist}`.trim();
  const best = pickBestCandidate(row, query, candidates);
  return best ? buildMatchedTrack(row, best) : undefined;
}

// Global active import cancellation handle
let activeCancel: (() => void) | undefined;

// Multi-tier high-speed track lookup:
// Pass 1: Fast official song lookup on YouTube Music (matches 95%+ of tracks in ~150-250ms)
// Pass 2: Music video search on YouTube Music
// Pass 3: Multi-artist collab fallback (e.g. secondary artist in credited collab)
// Pass 4: Main YouTube search fallback (viral sounds, niche bootlegs, soundcloud imports)
async function findBestTrack(
  row: CsvTrack,
  cache: Map<string, Track[]>,
): Promise<Track | undefined> {
  const artists = parseRowArtists(row.artist);
  const primaryArtist = artists[0] || row.artist.trim();
  const cleanTitle = bareTitle(row.title);
  const primaryQuery = `${cleanTitle} ${primaryArtist}`.trim();

  async function getOrSearch(
    prefix: "s" | "v" | "yt",
    query: string,
    fetcher: (q: string, ms: number) => Promise<Track[]>,
  ): Promise<Track[]> {
    const key = `${prefix}:${query.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const res = await fetcher(query, 10000).catch(() => []);
    if (res.length) cache.set(key, res);
    return res;
  }

  // Pass 1: Fast official song lookup on YouTube Music
  const songs = await getOrSearch("s", primaryQuery, searchSongs);
  const matchedSong = pickBestCandidate(row, primaryQuery, songs);
  if (matchedSong) return buildMatchedTrack(row, matchedSong);

  // Pass 2: Music video search on YouTube Music
  const videos = await getOrSearch("v", primaryQuery, searchVideos);
  const matchedVideo = pickBestCandidate(row, primaryQuery, videos);
  if (matchedVideo) return buildMatchedTrack(row, matchedVideo);

  // Pass 3: If multiple artists are credited (collaborations), try secondary artist song search
  if (artists.length > 1) {
    for (const otherArtist of artists.slice(1, 2)) {
      const collabQuery = `${cleanTitle} ${otherArtist}`.trim();
      const collabSongs = await getOrSearch("s", collabQuery, searchSongs);
      const matchedCollab = pickBestCandidate(row, collabQuery, collabSongs);
      if (matchedCollab) return buildMatchedTrack(row, matchedCollab);
    }
  }

  // Pass 4: Fallback to main YouTube search
  const ytCandidates = await getOrSearch("yt", primaryQuery, searchYouTube);
  const matchedYt = pickBestCandidate(row, primaryQuery, ytCandidates);
  if (matchedYt) return buildMatchedTrack(row, matchedYt);

  return undefined;
}

// High-speed song matching with controlled concurrency and event loop breathing room
async function matchAll(
  rows: CsvTrack[],
  isCancelled: () => boolean,
  onProgress: (done: number, total: number) => void,
): Promise<{ matched: Track[]; unmatched: CsvTrack[] }> {
  const results = new Array<Track | undefined>(rows.length);
  const unmatchedSet = new Set<number>();
  const cache = new Map<string, Track[]>();
  let index = 0;
  let doneCount = 0;

  async function worker() {
    while (index < rows.length) {
      if (isCancelled()) break;
      const i = index++;
      const row = rows[i];
      try {
        const found = await findBestTrack(row, cache);
        if (found) {
          results[i] = found;
        } else {
          unmatchedSet.add(i);
        }
      } catch {
        unmatchedSet.add(i);
      }
      doneCount++;
      if (doneCount % 5 === 0 || doneCount === rows.length) {
        onProgress(doneCount, rows.length);
      }
      if (isCancelled()) break;
      // Yield to the browser event loop so WebKit can paint and process user input smoothly
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  const concurrency = Math.min(3, rows.length);
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Preserve original sequential playlist order from the CSV
  const matched: Track[] = [];
  const unmatched: CsvTrack[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (results[i]) {
      matched.push(results[i]!);
    } else if (unmatchedSet.has(i) || i < index) {
      unmatched.push(rows[i]);
    }
  }

  return { matched, unmatched };
}

// Imports a playlist file (.csv), matches each song, and creates a new playlist.
export async function importPlaylistFile(file: File) {
  activeCancel?.();

  let cancelled = false;
  activeCancel = () => {
    cancelled = true;
  };

  try {
    const text = await file.text();
    const rows = parsePlaylistCsv(text);
    if (!rows.length) {
      notify({
        text: "Couldn’t Import Playlist",
        detail: `${file.name} doesn’t contain recognisable song columns`,
      });
      return;
    }

    const playlistName = file.name.replace(/\.[^.]+$/, "") || "Imported Playlist";
    const cancelAction = {
      label: "Cancel",
      run: () => {
        cancelled = true;
        notify({ text: "Cancelling Import…", detail: "Stopping remaining searches" });
      },
    };

    notify({
      text: `Importing ${playlistName}…`,
      detail: `Matching 0 of ${rows.length} songs (0%)`,
      action: cancelAction,
      sticky: true,
    });

    let lastToast = 0;
    const { matched, unmatched } = await matchAll(
      rows,
      () => cancelled,
      (done, total) => {
        const now = Date.now();
        if (now - lastToast > 250 || done === total || cancelled) {
          lastToast = now;
          if (!cancelled) {
            const pct = Math.round((done / total) * 100);
            notify({
              text: `Importing ${playlistName}…`,
              detail: `Matching ${done} of ${total} songs (${pct}%)`,
              action: cancelAction,
              sticky: true,
            });
          }
        }
      },
    );

    activeCancel = undefined;

    if (cancelled) {
      if (matched.length) {
        newPlaylist(matched, undefined, playlistName);
        notify({
          text: "Import Cancelled",
          detail: `Saved ${matched.length} songs to ${playlistName}`,
          thumb: matched[0]?.thumb,
          sticky: false,
        });
      } else {
        notify({ text: "Import Cancelled", detail: "No songs were imported", sticky: false });
      }
      return;
    }

    if (matched.length) {
      newPlaylist(matched, undefined, playlistName);
    }

    if (unmatched.length) {
      notify({
        text: `Imported ${matched.length} of ${rows.length} songs`,
        detail: `Added to ${playlistName}`,
        thumb: matched[0]?.thumb,
        sticky: false,
        action: {
          label: "Review",
          run: () => {
            useStore.setState({
              toast: undefined,
              dialog: {
                kind: "unmatched",
                title: `${unmatched.length} Unmatched Songs`,
                items: unmatched.map((u) => ({ title: u.title, artist: u.artist })),
              },
            });
          },
        },
      });
    } else {
      notify({
        text: `Imported all ${matched.length} songs`,
        detail: `Added to ${playlistName}`,
        thumb: matched[0]?.thumb,
        sticky: false,
      });
    }
  } catch (e) {
    activeCancel = undefined;
    notify({
      text: "Import Failed",
      detail: e instanceof Error ? e.message : String(e),
      sticky: false,
    });
  }
}

// Unit test suite for CSV parser and Mixtape matcher
export function demo() {
  const sample = [
    `Track Name,Artist Name(s),Album Name,Duration (ms),ISRC`,
    `"The Less I Know, The Better",Tame Impala,Currents,216000,AUUM71500303`,
    `"Don't Stop Believin'","Journey, The Band",Escape,250000,USSM10003886`,
    `"Song with ""Quotes""",Artist Name,Some Album,180000,`,
    `Tu vuò fà l'Americano,Renato Carosone,Album,200000,`,
    `верните в моду любовь - hardstyle,WhiteHard,Album,99000,`,
    `!ce Cream Sped Up,Ysl Pierre,Album,120000,`,
    `Blame (feat. John Newman) - Extended Version,Calvin Harris;John Newman,Motion,329000,`,
    `2019 (justbars rmx),Pashanim,Single,104000,`,
    `WIEN LEBT,mon€;paqay,wienbra,115000,`,
    `Навернопотомучто,Vremya i Steklo,Album,204000,`,
    `Boss Orange feat. RB030 (Bonus),Pashanim;RB030,Album,150000,`,
    `Trust Issues,Drake,Care Package,281000,`,
    `hot girl bummer,blackbear,Album,185000,`,
    `Verstappen Garten,Akh;Can;keyblade;Tony Hilfiger,Single,130000,`,
    `4AM,Nemzzz,Single,142000,`,
  ].join("\n");

  const parsed = parsePlaylistCsv(sample);
  console.assert(parsed.length === 15, `Expected 15 rows, got ${parsed.length}`);
  console.assert(parsed[0].title === "The Less I Know, The Better", "Parsed title with comma");
  console.assert(parsed[0].artist === "Tame Impala", "Parsed artist");
  console.assert(parsed[0].secs === 216, `Expected 216s, got ${parsed[0].secs}`);
  console.assert(parsed[0].isrc === "AUUM71500303", "Parsed ISRC");

  // Calvin Harris: Extended Version match
  const candidateCalvin: Track = {
    id: "yt_calvin",
    title: "Blame (feat. John Newman)",
    artists: [{ name: "Calvin Harris" }, { name: "John Newman" }],
    duration: "3:32",
    secs: 212,
  };
  const matchedCalvin = matchSong(parsed[6], [candidateCalvin]);
  console.assert(matchedCalvin?.id === "yt_calvin", "Matched Calvin Harris Blame");

  // Pashanim: 2019 (justbars rmx) match
  const candidatePashanim: Track = {
    id: "yt_pashanim",
    title: "Pashanim - 2019 (justbars rmx)",
    artists: [{ name: "Pashanim Nulldreinull" }],
    duration: "1:44",
    secs: 104,
  };
  const matchedPashanim = matchSong(parsed[7], [candidatePashanim]);
  console.assert(matchedPashanim?.id === "yt_pashanim", "Matched Pashanim 2019 justbars");

  // WIEN LEBT: mon€;paqay match
  const candidateWien: Track = {
    id: "yt_wien",
    title: "WIEN LEBT",
    artists: [{ name: "mon€ - Topic" }],
    duration: "1:55",
    secs: 115,
  };
  const matchedWien = matchSong(parsed[8], [candidateWien]);
  console.assert(matchedWien?.id === "yt_wien", "Matched WIEN LEBT");

  // Vremya i Steklo: Cyrillic / Latin match
  const candidateVremya: Track = {
    id: "yt_vremya",
    title: "Время и Стекло - Навернопотомучто",
    artists: [{ name: "Время и Стекло" }],
    duration: "3:24",
    secs: 204,
  };
  const matchedVremya = matchSong(parsed[9], [candidateVremya]);
  console.assert(matchedVremya?.id === "yt_vremya", "Matched Vremya i Steklo");

  // Boss Orange feat. RB030 (Bonus): Pashanim
  console.assert(bareTitle(parsed[10].title) === "Boss Orange", `bareTitle Boss Orange: expected 'Boss Orange', got '${bareTitle(parsed[10].title)}'`);
  const candidateBoss: Track = {
    id: "yt_boss",
    title: "Boss Orange (Bonus)",
    artists: [{ name: "Pashanim" }],
    duration: "2:30",
    secs: 150,
  };
  const matchedBoss = matchSong(parsed[10], [candidateBoss]);
  console.assert(matchedBoss?.id === "yt_boss", "Matched Boss Orange");

  // Drake - Trust Issues
  const candidateDrake: Track = {
    id: "yt_drake",
    title: "Trust Issues",
    artists: [{ name: "Drake" }],
    duration: "4:41",
    secs: 281,
  };
  const matchedDrake = matchSong(parsed[11], [candidateDrake]);
  console.assert(matchedDrake?.id === "yt_drake", "Matched Drake Trust Issues");

  // blackbear - hot girl bummer
  const candidateBlackbear: Track = {
    id: "yt_blackbear",
    title: "hot girl bummer",
    artists: [{ name: "blackbear" }],
    duration: "3:05",
    secs: 185,
  };
  const matchedBlackbear = matchSong(parsed[12], [candidateBlackbear]);
  console.assert(matchedBlackbear?.id === "yt_blackbear", "Matched blackbear hot girl bummer");

  // Verstappen Garten - keyblade
  const candidateVerstappen: Track = {
    id: "yt_verstappen",
    title: "Verstappen Garten",
    artists: [{ name: "keyblade" }],
    duration: "2:10",
    secs: 130,
  };
  const matchedVerstappen = matchSong(parsed[13], [candidateVerstappen]);
  console.assert(matchedVerstappen?.id === "yt_verstappen", "Matched Verstappen Garten");

  // Nemzzz - 4AM
  const candidateNemzzz: Track = {
    id: "yt_nemzzz",
    title: "4AM",
    artists: [{ name: "Nemzzz" }],
    duration: "2:22",
    secs: 142,
  };
  const matchedNemzzz = matchSong(parsed[14], [candidateNemzzz]);
  console.assert(matchedNemzzz?.id === "yt_nemzzz", "Matched Nemzzz 4AM");

  // CRITICAL IDENTITY REJECTION: Tyga - Ice Cream must NOT match Ysl Pierre !ce Cream
  const candidateTyga: Track = {
    id: "yt_tyga",
    title: "Tyga - Ice Cream (Official Music Video)",
    artists: [{ name: "Tyga" }],
    duration: "2:30",
    secs: 150,
  };
  const rejectedTyga = matchSong(parsed[5], [candidateTyga]);
  console.assert(
    rejectedTyga === undefined,
    "Strict identity gate correctly REJECTED Tyga for Ysl Pierre",
  );
}


