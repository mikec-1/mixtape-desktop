import { useEffect, type CSSProperties } from "react";
import { ChevronLeft, Disc3, LoaderCircle, Pause, Play, Search as SearchIcon, SkipBack, SkipForward, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { audio, back, home, next, prev, toggle, useAudio, useStore } from "./store";
import { Artist, Artists, NowPlaying, Search } from "./views";
import { art } from "./yt";

export default function App() {
  const stack = useStore((s) => s.stack);
  const nowPlaying = useStore((s) => s.nowPlaying);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      toggle();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full">
      {/* macOS draws the traffic lights over this strip (titleBarStyle: Overlay). */}
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-50 h-11" />

      <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 pt-20">
        <RailButton icon={SearchIcon} label="Search" active={!nowPlaying} onClick={home} />
        <RailButton icon={Disc3} label="Now Playing" active={nowPlaying} onClick={() => useStore.setState((s) => ({ nowPlaying: !s.nowPlaying }))} />
      </nav>

      <main className="relative min-w-0 flex-1">
        {/* Every view in the stack stays mounted, so going back keeps its results and scroll position. */}
        {stack.map((view, i) => (
          <div key={i + view.name + ("id" in view ? view.id : "")} hidden={i !== stack.length - 1} className="absolute inset-0 overflow-y-auto pb-36">
            {view.name === "search" ? <Search /> : <Artist id={view.id} />}
          </div>
        ))}
        {stack.length > 1 && (
          <button onClick={back} aria-label="Back" className="glass absolute top-12 left-6 z-20 grid size-9 place-items-center rounded-full transition active:scale-95">
            <ChevronLeft size={20} strokeWidth={2.4} />
          </button>
        )}
      </main>

      {nowPlaying && <NowPlaying />}
      <PlayerBar />
    </div>
  );
}

function RailButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`grid size-11 place-items-center rounded-xl transition hover:text-ink ${active ? "text-ink" : "text-muted"}`}>
      <Icon size={22} strokeWidth={active ? 2.4 : 2} />
    </button>
  );
}

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");
const fill = (v: number, max: number) => ({ "--p": `${(v / max) * 100 || 0}%` }) as CSSProperties;

function PlayerBar() {
  const track = useStore((s) => s.queue[s.index]);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const { paused, time, duration, volume, muted } = useAudio();

  return (
    <div className="fixed right-4 bottom-4 left-[76px] z-40">
      <div className="glass relative isolate overflow-hidden rounded-[22px]">
        {/* The only colour in the UI: the artwork, blurred behind the glass. */}
        {track && <img src={art(track.thumb, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-150 object-cover opacity-45 blur-2xl" />}
        <div className="grid grid-cols-[1fr_minmax(0,1.5fr)_1fr] items-center gap-6 py-2.5 pr-5 pl-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => useStore.setState((s) => ({ nowPlaying: !s.nowPlaying }))} aria-label="Now Playing" disabled={!track} className="size-12 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06] shadow-md shadow-black/15 transition active:scale-95">
              {track && <img src={art(track.thumb, 120)} alt="" className="size-full object-cover" />}
            </button>
            <div className="min-w-0">
              <div className="truncate font-semibold">{track?.title ?? "Not playing"}</div>
              <div className="truncate text-sm text-ink/55">{error ? <span className="text-red-700">{error}</span> : track && <Artists list={track.artists} />}</div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-5">
              <button onClick={prev} aria-label="Previous" className="transition active:scale-90"><SkipBack size={20} className="fill-current" /></button>
              <button onClick={toggle} aria-label={paused ? "Play" : "Pause"} className="grid size-10 place-items-center rounded-full bg-ink text-paper transition active:scale-90">
                {loading ? <LoaderCircle size={18} className="animate-spin" /> : paused ? <Play size={18} className="ml-0.5 fill-current" /> : <Pause size={18} className="fill-current" />}
              </button>
              <button onClick={next} aria-label="Next" className="transition active:scale-90"><SkipForward size={20} className="fill-current" /></button>
            </div>
            <div className="flex w-full items-center gap-3 text-[11px] font-medium text-ink/50 tabular-nums">
              <span className="w-9 text-right">{fmt(time)}</span>
              <input type="range" aria-label="Seek" min={0} max={duration || 0} step={0.1} value={time} onChange={(e) => (audio.currentTime = +e.target.value)} style={fill(time, duration)} className="flex-1" />
              <span className="w-9">{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button onClick={() => (audio.muted = !muted)} aria-label={muted ? "Unmute" : "Mute"} className="text-ink/60">
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => ((audio.volume = +e.target.value), (audio.muted = false))} style={fill(muted ? 0 : volume, 1)} className="w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
