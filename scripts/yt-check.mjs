// Smoke test for the YouTube side, outside the app, mirroring src/yt.ts: search -> Home, artist and album
// pages -> lyrics (YT Music, then src/lyrics.ts's LRCLIB and Google translation and romanisation) -> mint a PO
// token with BotGuard -> resolve the YTMUSIC audio stream -> download all of it in 1 MB ranges.
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
await check('yt lyrics lines', async () => (await yt.music.getLyrics(song.id))?.description?.toString().split('\n').length);
await check('lrclib synced lines', async () => {
  const q = new URLSearchParams({ track_name: song.title, artist_name: song.artists?.[0]?.name ?? '' });
  const hits = await (await fetch(`https://lrclib.net/api/search?${q}`, { headers: { 'Lrclib-Client': 'Sleeve smoke test' } })).json();
  return hits.find((h) => h.syncedLyrics)?.syncedLyrics.split('\n').length;
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
