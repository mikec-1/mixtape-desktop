import { Innertube, Misc, Platform, YTMusic, YTNodes } from "youtubei.js/web";
import { fetch } from "@tauri-apps/plugin-http";
import { emitTo, listen } from "@tauri-apps/api/event";

// youtubei.js needs a JS evaluator to decipher stream URLs; the webview is one.
Platform.shim.eval = (data) => new Function(data.output)();

// Requests go through Rust (plugin-http): no CORS, and they come from the user's own IP.
// plugin-http adds the webview's Origin (localhost:1420) which YouTube 403s; an empty Origin
// removes it (needs the "unsafe-headers" feature). A plain Headers object keeps forbidden names.
const ytFetch: typeof globalThis.fetch = (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("origin", "");
  return fetch(input, { ...init, headers });
};

const yt = Innertube.create({ fetch: ytFetch, retrieve_player: true });

export type Artist = { id?: string; name: string };
// rec: added by Smart Shuffle. at: when it was added to the list it's in (a playlist, Liked Songs).
// file: a song on this computer (local.ts), by its path; it plays from disk and isn't on YouTube.
// albumId opens its album; album "" means it was looked for and there's none (store.ts fill).
export type Track = { id: string; title: string; artists: Artist[]; album?: string; albumId?: string; thumb?: string; duration?: string; rec?: true; at?: number; file?: string };
export type Album = { id: string; title: string; year?: string; by?: string; thumb?: string; at?: number }; // at: when you saved it

// YT Music image URLs end in a size spec (=w60-h60-l90-rj, =s120…); ask for the size we draw at. A
// downloaded song's artwork (offline.ts sets covers.local) comes from disk instead, at any size.
export const covers: { local?: (url: string, w: number) => string | undefined } = {};
export const artBase = (url: string) => url.replace(/=(w\d+-h\d+|s\d+)[^/]*$/, "");
export const sizedArt = (url: string, w: number, h = w) => url.replace(/=(w\d+-h\d+|s\d+)[^/]*$/, `=w${w}-h${h}-l90-rj`);
export const art = (url: string | undefined, w: number, h = w) => url && (covers.local?.(url, w) ?? sizedArt(url, w, h));

// YT Music links only the artists it has a page for; the rest are plain text in the same line ("Jazeek &
// Luciano" with only Jazeek linked). Every name in text becomes an artist, in the order written: a linked
// one with its page, the others split at , & + x feat. ft. with vs., and given a page by search when
// opened (artistByName). A linked name is never split ("Mumford & Sons").
export const SEP = /\s*(?:,|&|\+|\s+x\s+|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\bwith\b|\bvs\.?(?=\s))\s*/i;
export function withUnlinked(linked: Artist[], text = ""): Artist[] {
  const marks: [number, Artist][] = [];
  let left = text;
  for (const a of linked) {
    const at = left.indexOf(a.name);
    if (at >= 0) left = left.slice(0, at) + "\0".repeat(a.name.length) + left.slice(at + a.name.length);
    marks.push([at < 0 ? text.length : at, a]);
  }
  for (const m of left.matchAll(/[^\0]+/g)) for (const name of splits(m[0])) marks.push([m.index + m[0].indexOf(name), { name }]);
  return marks.sort((a, b) => a[0] - b[0]).map(([, a]) => a);
}
const splits = (text: string) => text.split(SEP).map((x) => x.trim()).filter((x) => x && !STAT.test(x));
// Not names: a count ("1.2M plays"), a year, a length.
const STAT = /^([\d.,]+[KMB]?\s+\w+|\d{4}|\d+:\d\d(:\d\d)?)$/i;
// The part of a list item's second line that holds its artists ("Jazeek & Luciano • STARBOYZ • 2:38"):
// the first, after any word for what the item is ("Song • …").
const KINDS = /^(song|video|single|ep|album|episode|podcast|playlist)$/i;
const artistLine = (text = "") => text.split(" • ").find((p) => !KINDS.test(p.trim())) ?? "";

const toTracks = (items: YTNodes.MusicResponsiveListItem[] = []): Track[] =>
  items.flatMap((s) =>
    s.id
      ? [{
          id: s.id,
          title: s.title ?? "",
          // Videos have authors.
          artists: withUnlinked((s.artists ?? s.authors)?.map((a) => ({ name: a.name, id: a.channel_id })) ?? [], artistLine(s.flex_columns?.[1]?.title?.text)),
          album: s.album?.name,
          albumId: s.album?.id,
          thumb: s.thumbnails?.[0]?.url,
          duration: s.duration?.text,
        }]
      : [],
  );

const toAlbums = (items: YTNodes.MusicTwoRowItem[] = []): Album[] =>
  items.map((a) => ({ id: a.id!, title: a.title.text ?? "", year: a.year, by: a.artists?.map((x) => x.name).join(", "), thumb: a.thumbnail?.[0]?.url }));

export async function search(query: string) {
  const music = (await yt).music;
  const [songs, all] = await Promise.all([music.search(query, { type: "song" }), music.search(query)]);
  // The "top result" card; only artists get the big treatment for now.
  const card = all.contents?.firstOfType(YTNodes.MusicCardShelf);
  const id: string | undefined = card?.on_tap?.payload?.browseId;
  const top = card && id?.startsWith("UC")
    ? { id, name: card.title.text ?? "", about: card.subtitle.text?.split(" • ").pop(), thumb: card.thumbnail?.contents?.[0]?.url }
    : undefined;
  return { top, songs: toTracks(songs.songs?.contents?.filterType(YTNodes.MusicResponsiveListItem)) };
}

export type Shelf = { title: string; tracks: Track[]; albums: Album[] };

// The YT Music start page: its home shelves (two pages of them) followed by Explore's.
let homeFeed: ReturnType<typeof loadHome> | undefined;
// Fetched once per launch, so going back Home is instant. A failed load is retried next time.
export const home = () =>
  (homeFeed ??= loadHome().then(
    (s) => ((localStorage.home = JSON.stringify(s)), s),
    (e) => ((homeFeed = undefined), Promise.reject(e)),
  ));
// Last launch's Home: drawn instantly, and all there is when offline.
export const lastHome: Shelf[] | undefined = JSON.parse(localStorage.home ?? "null") ?? undefined;

async function loadHome(): Promise<Shelf[]> {
  const music = (await yt).music;
  const [feed, explore] = await Promise.all([
    music.getHomeFeed().then(async (f) => [f, f.has_continuation ? await f.getContinuation().catch(() => undefined) : undefined]),
    music.getExplore(),
  ]);
  const sections = [...feed.flatMap((f) => f?.sections ?? []), ...(explore.sections ?? [])];
  return sections.flatMap((s) => {
    if (!s.is(YTNodes.MusicCarouselShelf)) return [];
    const shelf = {
      title: s.header?.title?.text ?? "",
      tracks: toTracks(s.contents.filterType(YTNodes.MusicResponsiveListItem)),
      // Only things with a page of tracks: no artists, music videos or genre buttons.
      albums: toAlbums(s.contents.filterType(YTNodes.MusicTwoRowItem).filter((i) => i.item_type === "album" || i.item_type === "playlist")),
    };
    return shelf.tracks.length || shelf.albums.length ? [shelf] : [];
  });
}

// The counts YouTube Music shows under an artist's name, from its reply as sent (youtubei.js drops
// them): monthly audience ("75.1M monthly audience") and subscribers ("36.1M"). An artist with their own
// official channel has a header with a subscribe button; that's what verified means here.
type Raw = { runs?: { text?: string }[] };
const runs = (t?: Raw) => t?.runs?.map((r) => r.text).join("") || undefined;
export async function artist(id: string) {
  const client = await yt;
  const reply = await client.actions.execute("/browse", { browseId: id, client: "YTMUSIC" });
  const a = new YTMusic.Artist(reply, client.actions);
  const raw = (reply.data as { header?: { musicImmersiveHeaderRenderer?: { monthlyListenerCount?: Raw; subscriptionButton?: { subscribeButtonRenderer?: { subscriberCountText?: Raw; longSubscriberCountText?: Raw } } } } }).header?.musicImmersiveHeaderRenderer;
  const subs = raw?.subscriptionButton?.subscribeButtonRenderer;
  const listeners = runs(raw?.monthlyListenerCount)?.replace(/\s*monthly (audience|listeners?)$/i, "");
  const subscribers = runs(subs?.subscriberCountText)?.replace(/\s*subscribers?$/i, "");
  const header = a.header?.as(YTNodes.MusicImmersiveHeader, YTNodes.MusicVisualHeader);
  const section = (title: string) => a.sections.find((s) => (s.is(YTNodes.MusicShelf) ? s.title?.text : s.header?.title?.text) === title);
  const shelf = (title: string) => section(title)?.contents;
  const top = section("Top songs");
  const more = top?.is(YTNodes.MusicShelf) ? (top.endpoint ?? top.bottom_button?.endpoint)?.payload?.browseId : undefined;
  return {
    name: header?.title.text ?? "",
    listeners,
    subscribers,
    verified: !!subs,
    about: header?.is(YTNodes.MusicImmersiveHeader) ? header.description?.text : undefined,
    banner: (Array.isArray(header?.thumbnail) ? header.thumbnail : header?.thumbnail?.contents)?.[0]?.url,
    // The page lists five, without their lengths; more is the whole list's playlist (topSongs).
    songs: toTracks(shelf("Top songs")?.filterType(YTNodes.MusicResponsiveListItem)),
    more: more as string | undefined,
    albums: toAlbums(shelf("Albums")?.filterType(YTNodes.MusicTwoRowItem)),
    singles: toAlbums(shelf("Singles & EPs")?.filterType(YTNodes.MusicTwoRowItem)),
  };
}

// An artist's ten most played songs, with their lengths and albums: the first page of their top songs list.
export async function topSongs(id: string) {
  const p = await (await yt).music.getPlaylist(id);
  return toTracks(p.items?.filterType(YTNodes.MusicResponsiveListItem)).slice(0, 10);
}

export type Collection = { title: string; by: Artist[]; kind?: string; meta: string[]; about?: string; thumb?: string; tracks: Track[] };

// An album (MPRE… ids) or a playlist (VL…/PL… ids): both pages share YT Music's responsive header.
export async function collection(id: string): Promise<Collection> {
  const music = (await yt).music;
  const album = id.startsWith("MPRE") ? await music.getAlbum(id) : undefined;
  const page = album ?? (await music.getPlaylist(id));
  const header = page.header?.as(YTNodes.MusicResponsiveHeader);
  const runs = (header?.strapline_text_one?.runs ?? []) as Misc.TextRun[];
  const linked = runs.flatMap((r) => (r.endpoint?.payload?.browseId?.startsWith("UC") ? [{ name: r.text, id: r.endpoint.payload.browseId as string }] : []));
  const by = withUnlinked(linked, header?.strapline_text_one?.text);
  const thumb = header?.thumbnail?.contents?.[0]?.url;
  const [kind, year] = header?.subtitle?.text?.split(" • ") ?? [];
  let tracks: Track[];
  if (album) {
    // Album tracks carry neither artwork nor artists; both come from the header.
    tracks = toTracks(album.contents?.filterType(YTNodes.MusicResponsiveListItem)).map((t) => ({ ...t, artists: t.artists.length ? t.artists : by, album: header?.title.text, albumId: id, thumb }));
  } else {
    // ponytail: first 5 pages (~500 tracks); page in on scroll if huge playlists matter.
    let p = page as Awaited<ReturnType<typeof music.getPlaylist>>;
    tracks = toTracks(p.items?.filterType(YTNodes.MusicResponsiveListItem));
    for (let i = 0; i < 4 && p.has_continuation; i++) {
      p = await p.getContinuation();
      tracks.push(...toTracks(p.items?.filterType(YTNodes.MusicResponsiveListItem)));
    }
  }
  return {
    title: header?.title.text ?? "",
    by,
    kind,
    meta: [year, header?.second_subtitle?.text].filter((x): x is string => !!x),
    about: header?.description?.description?.text,
    thumb,
    tracks,
  };
}

// Without a proof-of-origin token googlevideo only serves the first ~1 MB of a stream. Tokens are bound
// to the video ID and minted by BotGuard in a hidden youtube.com window (src-tauri/src/potoken.js), since
// it rejects attestations from localhost. Only the YTMUSIC (web) client honours them.
// Re-run scripts/yt-check.mjs when YouTube changes something.
let requests = 0;

async function poToken(videoId: string): Promise<string> {
  const reply = `po-token-${++requests}`;
  let done!: (r: { token?: string; error?: string }) => void;
  const result = new Promise<{ token?: string; error?: string }>((r) => (done = r));
  const unlisten = await listen<{ token?: string; error?: string }>(reply, (e) => done(e.payload));
  try {
    // The hidden window may still be loading right after launch; resend until it answers.
    for (let i = 0; i < 15; i++) {
      await emitTo("potoken", "po-mint", { videoId, reply });
      const r = await Promise.race([result, new Promise<undefined>((ok) => setTimeout(ok, 2000))]);
      if (r?.token) return r.token;
      if (r) throw new Error(`PO token: ${r.error}`);
    }
    throw new Error("PO token window not responding");
  } finally {
    unlisten();
  }
}

// high: the best stream this WebView can play (Opus ~160 kbps where WebM works, else AAC 128); low: AAC ~48 kbps.
export type Quality = "high" | "low";
async function stream(id: string, quality: Quality) {
  const y = await yt;
  const [info, pot] = await Promise.all([y.getBasicInfo(id, { client: "YTMUSIC" }), poToken(id)]);
  const best = quality === "high" ? info.chooseFormat({ type: "audio", quality: "best", format: "any" }) : undefined;
  const format = best && MediaSource.isTypeSupported(best.mime_type) ? best : info.chooseFormat({ type: "audio", quality: quality === "high" ? "best" : "bestefficiency", format: "mp4" });
  if (!format.content_length) throw new Error("Unknown stream size");
  const url = new URL(await format.decipher(y.session.player));
  url.searchParams.set("pot", pot);
  // How much louder than YouTube's reference level this track is, in dB, for normalisation.
  const loudness = format.loudness_db ?? info.player_config?.audio_config.loudness_db ?? 0;
  return { url: url.toString(), mime: format.mime_type, size: format.content_length, duration: info.basic_info.duration, loudness };
}

const CHUNK = 1 << 20; // googlevideo 403s ranges much bigger than ~1 MB

// Fire all 1 MB range requests in parallel; playback starts as soon as the first one lands.
export async function fetchAudio(id: string, quality: Quality = "high") {
  const { url, mime, size, duration, loudness } = await stream(id, quality);
  const chunks: Promise<ArrayBuffer>[] = [];
  for (let start = 0; start < size; start += CHUNK) {
    const range = `bytes=${start}-${Math.min(start + CHUNK, size) - 1}`;
    const chunk = ytFetch(url, { headers: { range } }).then((r) => {
      if (!r.ok) throw new Error(`Stream request failed: ${r.status}`);
      return r.arrayBuffer();
    });
    chunk.catch(() => {}); // surfaced when awaited in playAudio; silences abandoned tracks
    chunks.push(chunk);
  }
  return { chunks, mime, duration, loudness };
}

// Song radio: YT Music's automix "watch next" for a track (the seed itself comes first).
export async function radio(id: string): Promise<Track[]> {
  const panel = await (await yt).music.getUpNext(id, true);
  return panel.contents
    .map((v) => (v.is(YTNodes.PlaylistPanelVideoWrapper) ? v.primary : v))
    .flatMap((v) =>
      v?.is(YTNodes.PlaylistPanelVideo)
        ? [{
            id: v.video_id,
            title: v.title.toString(),
            artists: withUnlinked(v.artists?.map((a) => ({ name: a.name, id: a.channel_id })) ?? [], artistLine(v.author)),
            album: v.album?.name,
            albumId: v.album?.id,
            thumb: v.thumbnail[0]?.url,
            duration: v.duration.text,
          }]
        : [],
    );
}

// What a song's own entry on YT Music says, for one that came without it (store.ts fill): its album and
// length. A music video has no album of its own; its song version (the counterpart) does.
export async function details(id: string) {
  const panel = await (await yt).music.getUpNext(id, false);
  for (const v of panel.contents) {
    const both = v.is(YTNodes.PlaylistPanelVideoWrapper) ? [v.primary, ...(v.counterpart ?? [])] : [v];
    const all = both.filter((x): x is YTNodes.PlaylistPanelVideo => !!x?.is(YTNodes.PlaylistPanelVideo));
    const me = all.find((x) => x.video_id === id);
    if (!me) continue;
    const album = me.album ?? all.find((x) => x.album)?.album;
    const artists = withUnlinked(me.artists?.map((x) => ({ name: x.name, id: x.channel_id })) ?? [], artistLine(me.author));
    return { album: album?.name, albumId: album?.id, duration: me.duration?.text || undefined, artists };
  }
}

// An artist by name, for one YT Music didn't link (and the artists to pick from on first launch): the
// artist search finds by that name.
const named = new Map<string, Promise<{ id: string; name: string; thumb?: string } | undefined>>();
export function findArtist(name: string) {
  const key = name.toLocaleLowerCase();
  if (!named.has(key))
    named.set(key, (async () => {
      const list = (await (await yt).music.search(name, { type: "artist" })).artists?.contents?.filterType(YTNodes.MusicResponsiveListItem) ?? [];
      const a = list.find((x) => x.name?.toLocaleLowerCase() === key) ?? list[0];
      return a?.id ? { id: a.id, name: a.name ?? name, thumb: a.thumbnail?.contents?.[0]?.url } : undefined;
    })().catch((e) => (named.delete(key), Promise.reject(e))));
  return named.get(key)!;
}
export const artistByName = (name: string) => findArtist(name).then((a) => a?.id);

// An album's page by its name and artist, for a song kept without the link (albumId): the album search,
// the result with that name (by that artist, if there's more than one).
const albums = new Map<string, Promise<string | undefined>>();
export function albumByName(name: string, artist = "") {
  const key = `${name}\u0000${artist}`.toLocaleLowerCase();
  const same = (a = "", b = "") => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  if (!albums.has(key))
    albums.set(key, (async () => {
      const list = (await (await yt).music.search(`${name} ${artist}`.trim(), { type: "album" })).albums?.contents?.filterType(YTNodes.MusicResponsiveListItem) ?? [];
      const named = list.filter((a) => same(a.title, name));
      return (named.find((a) => same(a.author?.name, artist)) ?? named[0])?.id;
    })().catch((e) => (albums.delete(key), Promise.reject(e))));
  return albums.get(key)!;
}

// YouTube serves fragmented (DASH) MP4, which WebKit can't play from a plain src, so feed it via MSE.
// start resumes partway in (after a relaunch). autoplay false only buffers it (the next track, for gapless).
export async function playAudio(audio: HTMLAudioElement, { chunks, mime, duration }: Awaited<ReturnType<typeof fetchAudio>>, start = 0, autoplay = true) {
  const ms = new MediaSource();
  URL.revokeObjectURL(audio.src); // each player's own last one
  audio.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
  const sb = ms.addSourceBuffer(mime);
  if (duration) ms.duration = duration; // fragmented MP4 doesn't say, and the scrubber needs it
  for (const [i, chunk] of chunks.entries()) {
    const data = await chunk;
    if (ms.readyState !== "open") return; // another track took over the player
    sb.appendBuffer(data);
    await new Promise((r) => sb.addEventListener("updateend", r, { once: true }));
    if (i === 0 && !autoplay) continue;
    if (i === 0 && !start) await audio.play();
    // Seeking past the first chunk makes play() wait for data that this loop hasn't appended yet.
    else if (i === 0) (audio.currentTime = start), audio.play().catch(() => {});
  }
  ms.endOfStream();
}
