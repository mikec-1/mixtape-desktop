// Word timings from the song itself on the web: align.rs ported line for line, the same model run by onnxruntime-web
// in a worker (lyrics.ts alignHere), so the music and the page never wait on it. It runs on the graphics card where
// there is one, about 4x faster than the browser's single CPU thread. align.rs says how it works and why each number
// is what it is. The model is fetched the first time and kept in the browser's cache.
import * as ort from "onnxruntime-web/webgpu";

const MODEL = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model_quantized.onnx";
const RATE = 16000, BLANK = 0, SPACE = 4, LETTERS = "ETAONIHSRDLUMWCFGYPBVK'XJQZ", WORST = -6, LEAD = 0.5, PAUSE = 0.5, AFTER_PAUSE = 0.15, GAP = 1, FRAME = 0.02, SLIDE = 8, BETTER = 1;
type Line = { start: number; end: number; words: string[] };
type Heard = Float32Array[]; // log probabilities of each letter (and blank) for each 20 ms

let session: Promise<ort.InferenceSession> | undefined;
async function load() {
  const cache = await caches.open("models");
  let got = await cache.match(MODEL);
  // Kept only once it's all here, so a download cut off midway is never taken for the model.
  if (!got) { const res = await fetch(MODEL); if (!res.ok) throw new Error(`model ${res.status}`); await cache.put(MODEL, res.clone()); got = res; }
  return ort.InferenceSession.create(new Uint8Array(await got.arrayBuffer()), { executionProviders: ["webgpu", "wasm"] });
}

async function run(pcm: Float32Array, lines: Line[], alt?: Line[]): Promise<[number, ([number, number][] | null)[], boolean]> {
  const s = await (session ??= load().catch((e) => { session = undefined; throw e; }));
  const lp = await hearAll(s, pcm);
  let by = slide(lp, lines), other = false;
  if (alt) { const altBy = slide(lp, alt); if (perLetter(lp, alt, altBy) - perLetter(lp, lines, by) > BETTER) [lines, by, other] = [alt, altBy, true]; }
  return [by, lines.map((l) => align(lp, l, by)), other];
}

async function hear(s: ort.InferenceSession, clip: Float32Array): Promise<Heard> {
  // The model wants zero mean and unit variance.
  let mean = 0, v = 0;
  for (const x of clip) mean += x;
  mean /= clip.length;
  for (const x of clip) v += (x - mean) ** 2;
  const sd = Math.max(Math.sqrt(v / clip.length), 1e-5);
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", clip.map((x) => (x - mean) / sd), [1, clip.length]) });
  const t = out[s.outputNames[0]], V = t.dims[2], logits = t.data as Float32Array;
  return Array.from({ length: logits.length / V }, (_, k) => {
    const row = logits.subarray(k * V, k * V + V), max = Math.max(...row);
    let sum = 0;
    for (const x of row) sum += Math.exp(x - max);
    const ln = Math.log(sum) + max;
    return row.map((x) => x - ln);
  });
}

async function hearAll(s: ort.InferenceSession, pcm: Float32Array) {
  const step = 20 * RATE, pad = RATE, n = Math.trunc(pcm.length / RATE / FRAME), out: Heard = [];
  for (let c = 0; c < pcm.length; c += step) {
    const a = Math.max(c - pad, 0), b = Math.min(c + step + pad, pcm.length);
    const lp = await hear(s, pcm.subarray(a, b)), per = (b - a) / lp.length;
    while (out.length < n && out.length * FRAME * RATE < c + step) out.push(lp[Math.min(Math.max(Math.trunc((out.length * FRAME * RATE - a) / per), 0), lp.length - 1)]);
  }
  return out;
}

function slide(lp: Heard, lines: Line[]) {
  let by = 0, best = -Infinity;
  for (let i = -SLIDE * 10; i <= SLIDE * 10; i++) { const f = fits(lp, lines, i / 10); if (f > best) [by, best] = [i / 10, f]; }
  return best - fits(lp, lines, 0) > 4 ? by : 0;
}
function fits(lp: Heard, lines: Line[], by: number) {
  const scores = inside(lp, lines).map((l) => fit(lp, l, by));
  return scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);
}
function perLetter(lp: Heard, lines: Line[], by: number) {
  const ins = inside(lp, lines);
  return ins.reduce((s, l) => s + fit(lp, l, by), 0) / Math.max(ins.reduce((n, l) => n + spell(l.words)[0].length, 0), 1);
}
const inside = (lp: Heard, lines: Line[]) => lines.filter((l) => l.start - SLIDE - 0.3 >= 0 && l.end + SLIDE + 0.3 <= lp.length * FRAME);
function fit(lp: Heard, l: Line, by: number) {
  const a = Math.trunc((l.start + by - 0.3) / FRAME), b = Math.trunc((l.end + by + 0.3) / FRAME), tokens = spell(l.words)[0];
  const row = new Float64Array(tokens.length + 1).fill(-Infinity);
  row[0] = 0;
  for (let t = a; t < b; t++) {
    const frame = lp[t];
    for (let j = tokens.length; j >= 0; j--) row[j] = Math.max(row[j] + frame[BLANK], j > 0 ? row[j - 1] + frame[tokens[j - 1]] : -Infinity);
  }
  return Math.max(row[tokens.length], -1e4);
}

function spell(words: string[]): [number[], (number | null)[]] {
  const tokens: number[] = [], owner: (number | null)[] = [];
  words.forEach((word, w) => {
    const ids = [...word].map((c) => LETTERS.indexOf(c)).filter((i) => i >= 0).map((i) => i + 5);
    if (!ids.length) return;
    if (tokens.length) tokens.push(SPACE), owner.push(null);
    tokens.push(...ids), owner.push(...ids.map(() => w));
  });
  return [tokens, owner];
}

function path(lp: Heard, tokens: number[]) {
  const T = lp.length, J = tokens.length, W = J + 1;
  if (!J || T < J) return null;
  const best = new Float64Array((T + 1) * W).fill(-Infinity);
  best[0] = 0;
  for (let t = 0; t < T; t++) for (let j = 0; j <= J; j++) best[(t + 1) * W + j] = Math.max(best[t * W + j] + lp[t][BLANK], j > 0 ? best[t * W + j - 1] + lp[t][tokens[j - 1]] : -Infinity);
  const frames = new Array<number>(J).fill(0);
  let j = J, heard = 0;
  for (let t = T - 1; t >= 0; t--) if (j > 0 && best[t * W + j - 1] + lp[t][tokens[j - 1]] >= best[t * W + j] + lp[t][BLANK]) (j--, (frames[j] = t), (heard += lp[t][tokens[j]]));
  return j === 0 && heard / J > WORST ? frames : null;
}

function align(lp: Heard, line: Line, by: number): [number, number][] | null {
  const a = Math.trunc(Math.max(line.start + by - 0.3, 0) / FRAME), b = Math.min(Math.trunc((line.end + by + 0.3) / FRAME), lp.length);
  if (b < a + 12) return null;
  const at = (f: number) => (a + f) * FRAME, [tokens, owner] = spell(line.words), frames = path(lp.slice(a, b), tokens);
  if (!frames) return null;
  const out: ([number, number] | undefined)[] = line.words.map(() => undefined), sung = line.words.map(() => 0), first = owner.indexOf(null);
  frames.forEach((f, k) => {
    const w = owner[k];
    // A space: the word before it runs on to here.
    if (w === null) { const span = out[owner[k - 1]!]; if (span) span[1] = f + 1; return; }
    const span = (out[w] ??= [f, f]);
    if ((first < 0 || k < first) && at(f) - at(Math.max(span[1] - 1, 0)) > GAP) span[0] = f;
    span[1] = sung[w] = f + 1;
  });
  let last = 0, heard = 0, floor = 0;
  return out.map((s, i) => {
    const [st, e] = s ?? [last, last], lead = i > 0 && at(st) - at(heard) > PAUSE ? AFTER_PAUSE : LEAD;
    [last, heard] = [e, Math.max(sung[i], st)];
    floor = Math.max(at(st) - lead - by, floor, 0);
    return [floor, Math.max(at(e) - LEAD - by, floor)];
  });
}

// One song at a time, as in the app.
let queue = Promise.resolve();
onmessage = ({ data: { id, pcm, lines, alt } }: MessageEvent) =>
  void (queue = queue.then(() => run(pcm, lines, alt).then((ok) => postMessage({ id, ok }), (e) => postMessage({ id, error: String(e) }))));
