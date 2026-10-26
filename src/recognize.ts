import { convertFileSrc } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import type { Found, SongEdit } from "./local";
import { stripVersion } from "./yt";

// A song's Shazam signature, to recognise it from its sound (for files whose tags say too little to look up):
// the loudest peaks of its spectrum in 12 s from the middle, in Shazam's own format. Ported from SongRec and
// ShazamIO (MIT). In: 16 kHz mono samples, scaled like 16-bit ones. Out: base64, and how long it heard (ms).
const RATE = 16000, SIZE = 2048, BINS = 1025, HELD = 256;
// A Hann window without its zero ends.
const WINDOW = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (SIZE + 1)));
const REV = Uint16Array.from({ length: SIZE }, (_, i) => { let r = 0; for (let b = 1, x = i; b < SIZE; b <<= 1, x >>= 1) r = (r << 1) | (x & 1); return r; });
const COS = Float64Array.from({ length: SIZE / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / SIZE)), SIN = COS.map((_, k) => Math.sin((-2 * Math.PI * k) / SIZE));
// Each bin's power, from a radix-2 FFT.
function power(x: Float64Array) {
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) re[REV[i]] = x[i];
  for (let n = 2; n <= SIZE; n <<= 1)
    for (let s = 0, step = SIZE / n; s < SIZE; s += n)
      for (let k = 0; k < n / 2; k++) {
        const c = COS[k * step], d = SIN[k * step], a = s + k, b = a + n / 2;
        const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
        (re[b] = re[a] - tr), (im[b] = im[a] - ti), (re[a] += tr), (im[a] += ti);
      }
  return Float64Array.from({ length: BINS }, (_, i) => Math.max((re[i] ** 2 + im[i] ** 2) / (1 << 17), 1e-10));
}
const AROUND = [-10, -7, -4, -3, 1, 2, 5, 8], BEFORE = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
const level = (x: number) => Math.log(Math.max(1 / 64, x)) * 1477.3 + 6144;

export function signature(pcm: Float32Array | Int16Array) {
  const ring = new Float64Array(SIZE), x = new Float64Array(SIZE);
  const ffts = Array.from({ length: HELD }, () => new Float64Array(BINS)), spread = Array.from({ length: HELD }, () => new Float64Array(BINS));
  const at = (i: number) => ((i % HELD) + HELD) % HELD;
  const bands: [number, number, number][][] = [[], [], [], []]; // [pass, level, bin]
  let n = 0, heard = 0, peaks = 0;
  // A song over 36 s is heard from 6 s before its middle, past the intro.
  for (let p = pcm.length > RATE * 36 ? RATE * (Math.floor(pcm.length / RATE / 2) - 6) : 0; p + 128 <= pcm.length && (heard < RATE * 12 || peaks < 255); p += 128, heard += 128) {
    ring.set(pcm.subarray(p, p + 128), heard % SIZE);
    for (let i = 0, from = (heard + 128) % SIZE; i < SIZE; i++) x[i] = ring[(from + i) % SIZE] * WINDOW[i];
    const f = (ffts[at(n)] = power(x)), s = new Float64Array(f);
    for (let i = 0; i < BINS - 3; i++) s[i] = Math.max(f[i], f[i + 1], f[i + 2]);
    for (const back of [1, 3, 6]) for (let i = 0, o = spread[at(n - back)]; i < BINS; i++) o[i] = Math.max(o[i], s[i]);
    spread[at(n++)] = s;
    if (n < 46) continue;
    // A peak stands above its neighbours in frequency, then in time.
    const now = ffts[at(n - 46)], then = spread[at(n - 49)];
    for (let b = 10; b < 1015; b++) {
      const v = now[b];
      if (v < 1 / 64 || v < then[b - 1]) continue;
      let most = 0;
      for (const o of AROUND) most = Math.max(most, then[b + o]);
      if (v <= most) continue;
      for (const o of BEFORE) most = Math.max(most, spread[at(n + o)][b - 1]);
      if (v <= most) continue;
      const mid = level(v), lo = level(now[b - 1]), hi = level(now[b + 1]);
      const bin = b * 64 + ((hi - lo) * 32) / (mid * 2 - lo - hi), hz = bin * (RATE / 2 / 1024 / 64);
      const band = hz > 250 && hz < 520 ? 0 : hz >= 520 && hz < 1450 ? 1 : hz >= 1450 && hz < 3500 ? 2 : hz >= 3500 && hz <= 5500 ? 3 : -1;
      if (band >= 0) bands[band].push([n - 46, Math.trunc(mid), Math.trunc(bin)]), peaks++;
    }
  }
  // The format: a 48-byte header, then each band's peaks as gaps in passes, levels and bins.
  const body: number[] = [], u32 = (a: number[], v: number) => a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255), u16 = (a: number[], v: number) => a.push(v & 255, (v >>> 8) & 255);
  bands.forEach((list, band) => {
    if (!list.length) return;
    const out: number[] = [];
    let pass = 0;
    for (const [n, mid, bin] of list) {
      if (n - pass >= 255) out.push(255), u32(out, n), (pass = n);
      out.push(n - pass), u16(out, mid), u16(out, bin), (pass = n);
    }
    u32(body, 0x60030040 + band), u32(body, out.length), body.push(...out, ...Array((4 - (out.length % 4)) % 4).fill(0));
  });
  const head: number[] = [];
  for (const v of [0xcafe2580, 0, body.length + 8, 0x94119c00, 0, 0, 0, 3 << 27, 0, 0, Math.trunc(heard + RATE * 0.24), (15 << 19) + 0x40000, 0x40000000, body.length + 8]) u32(head, v);
  const all = Uint8Array.from([...head, ...body]);
  new DataView(all.buffer).setUint32(4, crc32(all.subarray(8)), true);
  let text = "";
  for (const b of all) text += String.fromCharCode(b);
  return { uri: `data:audio/vnd.shazam.sig;base64,${btoa(text)}`, samplems: Math.trunc((heard / RATE) * 1000) };
}
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n; });
const crc32 = (b: Uint8Array) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };

// The song a file is, heard by Shazam: for files whose tags (and name) say too little to look it up.
// Nothing if Shazam doesn't know it or can't be reached. The file is read with the webview's own fetch: Tauri's
// (imported above, for Shazam) can't open asset:// URLs.
export async function heard(path: string, e: SongEdit): Promise<Found | undefined> {
  const sound = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await window.fetch(convertFileSrc(path)).then((r) => r.arrayBuffer()));
  const pcm = new Float32Array(sound.length);
  for (let c = 0; c < sound.numberOfChannels; c++) sound.getChannelData(c).forEach((v, i) => (pcm[i] += (v * 32768) / sound.numberOfChannels));
  const id = crypto.randomUUID().toUpperCase();
  const r = await fetch(`https://amp.shazam.com/discovery/v5/en-US/US/iphone/-/tag/${id}/${crypto.randomUUID().toUpperCase()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shazam-Platform": "IPHONE", "X-Shazam-AppVersion": "14.1.0", Accept: "*/*", "Accept-Language": "en-US" },
    body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, signature: signature(pcm), timestamp: Date.now(), context: {}, geolocation: {} }),
  }).then((r) => r.json());
  const t = r.track;
  if (!r.matches?.length || !t?.title) return;
  const meta = (name: string): string | undefined => t.sections?.[0]?.metadata?.find((m: { title: string }) => m.title === name)?.text;
  const [artist, ...feat] = String(t.subtitle ?? "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i).filter(Boolean);
  // A sped-up or slowed copy still matches the original, off by its speed (5% faster: 0.05; the song itself:
  // ~0.0001). It keeps your title if that names the edit, else gets the original's with it named, and never
  // the original's ISRC, so it's found and lyric-timed as the edit it is.
  const skew = r.matches[0].timeskew ?? 0, edited = Math.abs(skew) > 0.02;
  const title = !edited ? t.title : stripVersion(e.title) !== e.title.replace(/\s+/g, " ").trim() ? e.title : `${t.title} (${skew > 0 ? "Sped Up" : "Slowed"})`;
  return {
    edit: { ...e, title, artist: artist ?? e.artist, feat: feat.join(", "), album: meta("Album") ?? e.album, year: meta("Released"), genre: t.genres?.primary, cover: t.images?.coverarthq?.replace("400x400", "1000x1000"), isrc: edited ? undefined : t.isrc },
    source: "Shazam",
    sure: true,
  };
}
