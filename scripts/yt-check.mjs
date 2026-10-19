// Smoke test for the YouTube side, outside the app, mirroring src/yt.ts: search -> Home, artist and album
// pages -> lyrics as src/lyrics.ts gets them (LRCLIB exact match and search, NetEase Cloud Music, Google
// translation and romanisation) -> mint a PO token with BotGuard -> resolve the YTMUSIC audio stream ->
// download all of it in 1 MB ranges.
// Run when playback breaks: node scripts/yt-check.mjs "query"
import { JSDOM } from 'jsdom';
import { Innertube, Platform } from 'youtubei.js';
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, getHeaders } from 'bgutils-js/utils';

Platform.shim.eval = (data) => new Function(data.output)();
// BotGuard needs a DOM; the app gets one from the webview.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://www.youtube.com/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location });

const yt = await Innertube.create({ retrieve_player: true });
const res = await yt.music.search(process.argv[2] ?? 'playboi carti magnolia', { type: 'song' });
const song = res.songs?.contents?.[0];
if (!song) throw new Error('no search results');
console.log('song:', song.id, song.title, '-', song.artists?.map((a) => a.name).join(', '));

// Each page the app draws: fails loudly if YouTube changes its shape to empty.
const check = async (name, fn) => {
  const t = Date.now();
  const n = await fn();
  if (!n) throw new Error(`${name}: nothing came back`);
  console.log(`${name}: ${n} in ${Date.now() - t} ms`);
};
await check('home sections', async () => (await yt.music.getHomeFeed()).sections?.length);
await check('explore sections', async () => (await yt.music.getExplore()).sections?.length);
await check('artist sections', async () => (await yt.music.getArtist(song.artists?.find((a) => a.channel_id)?.channel_id)).sections?.length);
await check('album tracks', async () => (await yt.music.getAlbum(song.album?.id)).contents?.length);
const artist = song.artists?.[0]?.name ?? '';
const LRCLIB = { 'Lrclib-Client': 'Sleeve smoke test' };
// A 404 isn't a failure: the album can be named differently there, and the app moves on to a search.
await check('lrclib exact match lines', async () => {
  const q = new URLSearchParams({ track_name: song.title, artist_name: artist, ...(song.album?.name && { album_name: song.album.name }), ...(song.duration?.seconds && { duration: String(song.duration.seconds) }) });
  const r = await fetch(`https://lrclib.net/api/get?${q}`, { headers: LRCLIB });
  return r.status === 404 ? 'none (404)' : (await r.json()).syncedLyrics?.split('\n').length;
});
await check('lrclib synced lines', async () => {
  const q = new URLSearchParams({ track_name: song.title, artist_name: artist });
  const hits = await (await fetch(`https://lrclib.net/api/search?${q}`, { headers: LRCLIB })).json();
  return hits.find((h) => h.syncedLyrics)?.syncedLyrics.split('\n').length;
});
const NETEASE = {
  Referer: 'https://music.163.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  Cookie: `NMTID=${crypto.randomUUID().replaceAll('-', '')}; os=pc; appver=3.1.17.204416`,
};
await check('netease synced lines', async () => {
  const q = new URLSearchParams({ s: `${song.title} ${artist}`, type: '1', limit: '10', offset: '0' });
  const songs = (await (await fetch(`https://music.163.com/api/search/pc?${q}`, { method: 'POST', headers: NETEASE })).json()).result?.songs ?? [];
  const id = (songs.find((s) => s.name.toLowerCase() === song.title.toLowerCase()) ?? songs[0])?.id;
  const lrc = id && (await (await fetch(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, { headers: NETEASE })).json()).lrc?.lyric;
  return lrc?.split('\n').filter((l) => /^\[\d+:\d+/.test(l)).length;
});
const google = async (path, body) => (await fetch(`https://translate.googleapis.com/translate_a/${path}`, { method: 'POST', body })).json();
await check('google translated lines', async () => (await google('t?client=dict-chrome-ex&sl=auto&tl=en', new URLSearchParams([['q', '사랑해'], ['q', '夜に駆ける']]))).length);
await check('google romanised lines', async () => (await google('single?client=dict-chrome-ex&sl=auto&tl=en&dt=rm', new URLSearchParams({ q: '사랑해\n¶\n夜に駆ける' })))[0].find((s) => s[0] == null)?.[3].split(/\s*¶\s*/).length);

const { bg_challenge: bg } = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
new Function(await (await fetch('https:' + bg.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value)).text())();
const client = await BotGuardClient.create({ program: bg.program, globalName: bg.global_name, globalObject: globalThis });
const webPoSignalOutput = [];
const botguardResponse = await client.snapshot({ webPoSignalOutput });
const it = await fetch(buildURL('GenerateIT', true), { method: 'POST', headers: getHeaders(), body: JSON.stringify(['O43z0dpjhgX20SCx4KAo', botguardResponse]) });
const [integrityToken] = await it.json();
if (!integrityToken) throw new Error(`integrity token request failed: ${it.status}`);
const pot = await (await WebPoMinter.create({ integrityToken }, webPoSignalOutput)).mintAsWebsafeString(song.id);

const info = await yt.getBasicInfo(song.id, { client: 'YTMUSIC' });
const f = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
const url = new URL(await f.decipher(yt.session.player));
url.searchParams.set('pot', pot);

const CHUNK = 1 << 20;
const t = Date.now();
const parts = [];
for (let s = 0; s < f.content_length; s += CHUNK) {
  const range = `bytes=${s}-${Math.min(s + CHUNK, f.content_length) - 1}`;
  parts.push(fetch(url, { headers: { range } }).then((r) => {
    if (r.status !== 206) throw new Error(`HTTP ${r.status} for ${range}`);
    return r.arrayBuffer();
  }));
}
const bytes = (await Promise.all(parts)).reduce((n, b) => n + b.byteLength, 0);
if (bytes !== f.content_length) throw new Error(`got ${bytes}/${f.content_length} bytes`);
console.log('OK', f.mime_type, `${(bytes / 1e6).toFixed(1)} MB in ${Date.now() - t} ms`);
process.exit(0);
