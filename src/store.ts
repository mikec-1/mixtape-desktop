import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { art, fetchAudio, playAudio, type Track } from "./yt";

export type View = { name: "home" } | { name: "search" } | { name: "artist"; id: string };

type State = {
  stack: View[];
  nowPlaying: boolean;
  queue: Track[];
  index: number;
  loading: boolean;
  error: string;
};

export const useStore = create<State>(() => ({
  stack: [{ name: "home" }],
  nowPlaying: false,
  queue: [],
  index: -1,
  loading: false,
  error: "",
}));
const { setState: set, getState: get } = useStore;

export const open = (view: View) => set((s) => ({ stack: [...s.stack, view], nowPlaying: false }));
export const back = () => set((s) => ({ stack: s.stack.slice(0, Math.max(1, s.stack.length - 1)) }));
export const home = () => set({ stack: [{ name: "home" }], nowPlaying: false });
export const searchView = () => set({ stack: [{ name: "search" }], nowPlaying: false });
export const report = (e: unknown) => set({ error: e instanceof Error ? e.message : String(e), loading: false });

export const audio = new Audio();

// Live <audio> state, snapshotted on each media event. useSyncExternalStore needs a stable snapshot:
// reading audio.currentTime directly changes between calls and loops React.
const read = () => ({ paused: audio.paused, time: audio.currentTime, duration: audio.duration, volume: audio.volume, muted: audio.muted });
let snapshot = read();
const listeners = new Set<() => void>();
for (const e of ["timeupdate", "durationchange", "play", "pause", "volumechange", "emptied"])
  audio.addEventListener(e, () => ((snapshot = read()), listeners.forEach((l) => l())));
const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
export const useAudio = () => useSyncExternalStore(subscribe, () => snapshot);

let latest = 0;

export async function play(queue: Track[], index: number) {
  const track = queue[index];
  if (!track) return;
  const me = ++latest;
  set({ queue, index, loading: true, error: "" });
  audio.pause();
  setMediaSession(track);
  setAccent(art(track.thumb, 64));
  try {
    const data = await fetchAudio(track.id);
    if (me === latest) await playAudio(audio, data);
  } catch (e) {
    if (me === latest) report(e);
  } finally {
    if (me === latest) set({ loading: false });
  }
}

export const toggle = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
export const next = () => play(get().queue, get().index + 1);
export const prev = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : play(get().queue, get().index - 1));
audio.addEventListener("ended", next);

// The UI's one colour: the artwork's most prominent vivid hue, by chroma-weighted 30° hue buckets.
// Grey artwork leaves it at ink. index.css clamps it to a readable lightness and fades between tracks.
let accentSrc: string | undefined;
function setAccent(src?: string) {
  accentSrc = src;
  if (!src) return;
  const img = new Image();
  img.crossOrigin = "anonymous"; // googleusercontent and ytimg allow it; a tainted canvas can't be read
  img.onload = () => {
    if (src !== accentSrc) return;
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      if (d < 40) continue;
      const h = (max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d) * 60;
      const k = buckets[Math.floor(((h + 360) % 360) / 30)], w = (d / 255) ** 2;
      k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
    }
    const k = buckets.reduce((a, b) => (b.w > a.w ? b : a));
    const root = document.documentElement.style;
    if (k.w > 3) root.setProperty("--accent-raw", `rgb(${k.r / k.w} ${k.g / k.w} ${k.b / k.w})`);
    else root.removeProperty("--accent-raw");
  };
  img.src = src;
}

// Media keys, Control Center / taskbar controls.
function setMediaSession(t: Track) {
  if (!("mediaSession" in navigator)) return;
  const src = art(t.thumb, 512);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album,
    artwork: src ? [{ src, sizes: "512x512" }] : [],
  });
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("nexttrack", next);
  ms.setActionHandler("previoustrack", prev);
  ms.setActionHandler("seekto", (d) => (audio.currentTime = d.seekTime ?? 0));
}
