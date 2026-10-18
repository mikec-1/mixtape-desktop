import { Innertube, Misc, Platform, YTNodes } from "youtubei.js/web";
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
export type Track = { id: string; title: string; artists: Artist[]; album?: string; thumb?: string; duration?: string };
export type Album = { id: string; title: string; year?: string; thumb?: string };

// YT Music image URLs end in a size spec (=w60-h60-l90-rj, =s120…); ask for the size we draw at.
export const art = (url: string | undefined, w: number, h = w) => url?.replace(/=(w\d+-h\d+|s\d+)[^/]*$/, `=w${w}-h${h}-l90-rj`);

const toTracks = (items: YTNodes.MusicResponsiveListItem[] = []): Track[] =>
  items.flatMap((s) =>
    s.id
      ? [{
          id: s.id,
          title: s.title ?? "",
          artists: s.artists?.map((a) => ({ name: a.name, id: a.channel_id })) ?? [],
          album: s.album?.name,
          thumb: s.thumbnails?.[0]?.url,
          duration: s.duration?.text,
        }]
      : [],
  );

const toAlbums = (items: YTNodes.MusicTwoRowItem[] = []): Album[] =>
  items.map((a) => ({ id: a.id!, title: a.title.text ?? "", year: a.year, thumb: a.thumbnail?.[0]?.url }));

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

export async function artist(id: string) {
  const a = await (await yt).music.getArtist(id);
  const header = a.header?.as(YTNodes.MusicImmersiveHeader, YTNodes.MusicVisualHeader);
  const shelf = (title: string) =>
    a.sections.find((s) => (s.is(YTNodes.MusicShelf) ? s.title?.text : s.header?.title?.text) === title)?.contents;
  return {
    name: header?.title.text ?? "",
    about: header?.is(YTNodes.MusicImmersiveHeader) ? header.description?.text : undefined,
    banner: (Array.isArray(header?.thumbnail) ? header.thumbnail : header?.thumbnail?.contents)?.[0]?.url,
    songs: toTracks(shelf("Top songs")?.filterType(YTNodes.MusicResponsiveListItem)),
    albums: toAlbums(shelf("Albums")?.filterType(YTNodes.MusicTwoRowItem)),
    singles: toAlbums(shelf("Singles & EPs")?.filterType(YTNodes.MusicTwoRowItem)),
  };
}

// Album tracks carry neither artwork nor artists; both come from the album header.
export async function albumTracks(id: string): Promise<Track[]> {
  const a = await (await yt).music.getAlbum(id);
  const header = a.header?.as(YTNodes.MusicResponsiveHeader);
  const run = header?.strapline_text_one.runs?.[0] as Misc.TextRun | undefined;
  const by = { name: header?.strapline_text_one.text ?? "", id: run?.endpoint?.payload?.browseId };
  return toTracks(a.contents).map((t) => ({
    ...t,
    artists: t.artists.length ? t.artists : [by],
    album: header?.title.text,
    thumb: header?.thumbnail?.contents?.[0]?.url,
  }));
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

async function stream(id: string) {
  const y = await yt;
  const [info, pot] = await Promise.all([y.getBasicInfo(id, { client: "YTMUSIC" }), poToken(id)]);
  const format = info.chooseFormat({ type: "audio", quality: "best", format: "mp4" });
  if (!format.content_length) throw new Error("Unknown stream size");
  const url = new URL(await format.decipher(y.session.player));
  url.searchParams.set("pot", pot);
  return { url: url.toString(), mime: format.mime_type, size: format.content_length, duration: info.basic_info.duration };
}

let objectUrl = "";
const CHUNK = 1 << 20; // googlevideo 403s ranges much bigger than ~1 MB

// Fire all 1 MB range requests in parallel; playback starts as soon as the first one lands.
export async function fetchAudio(id: string) {
  const { url, mime, size, duration } = await stream(id);
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
  return { chunks, mime, duration };
}

// YouTube serves fragmented (DASH) MP4, which WebKit can't play from a plain src, so feed it via MSE.
export async function playAudio(audio: HTMLAudioElement, { chunks, mime, duration }: Awaited<ReturnType<typeof fetchAudio>>) {
  const ms = new MediaSource();
  URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(ms);
  audio.src = objectUrl;
  await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
  const sb = ms.addSourceBuffer(mime);
  if (duration) ms.duration = duration; // fragmented MP4 doesn't say, and the scrubber needs it
  for (const [i, chunk] of chunks.entries()) {
    const data = await chunk;
    if (ms.readyState !== "open") return; // another track took over the player
    sb.appendBuffer(data);
    await new Promise((r) => sb.addEventListener("updateend", r, { once: true }));
    if (i === 0) await audio.play();
  }
  ms.endOfStream();
}
