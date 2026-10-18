import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, Disc3, Heart, Music, House, Library as LibraryIcon, LoaderCircle, Pause, Play, Search as SearchIcon, SkipBack, SkipForward, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { audio, back, go, next, prev, toggle, toggleLike, useAudio, useLibrary, useStore } from "./store";
import { Artist, Artists, CollectionPage, Home, Library, NowPlaying, PlaylistPage, Search, trackMenu } from "./views";
import { art } from "./yt";

export default function App() {
  const stack = useStore((s) => s.stack);
  const nowPlaying = useStore((s) => s.nowPlaying);
  const root = stack[0].name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return useStore.setState({ nowPlaying: false });
      // Space on a focused button or field is theirs.
      if (e.code !== "Space" || e.repeat || (e.target as Element).closest?.("button, input, textarea")) return;
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

      {/* The Now Playing sheet covers these; keep focus out of what's under it. */}
      <nav inert={nowPlaying} className="flex w-[76px] shrink-0 flex-col items-center gap-1 pt-20">
        <RailButton icon={House} label="Home" active={!nowPlaying && root === "home"} onClick={() => go("home")} />
        <RailButton icon={SearchIcon} label="Search" active={!nowPlaying && root === "search"} onClick={() => go("search")} />
        <RailButton icon={LibraryIcon} label="Library" active={!nowPlaying && root === "library"} onClick={() => go("library")} />
        <RailButton icon={Disc3} label="Now Playing" active={nowPlaying} onClick={() => useStore.setState((s) => ({ nowPlaying: !s.nowPlaying }))} />
      </nav>

      <main inert={nowPlaying} className="relative min-w-0 flex-1">
        {/* Every view in the stack stays mounted, so going back keeps its results and scroll position. */}
        {stack.map((view, i) => (
          <div key={i + view.name + ("id" in view ? view.id : "")} hidden={i !== stack.length - 1} className="absolute inset-0 overflow-y-auto pb-36">
            {"id" in view ? (
              view.name === "artist" ? <Artist id={view.id} /> : view.name === "playlist" ? <PlaylistPage id={view.id} /> : <CollectionPage id={view.id} />
            ) : view.name === "home" ? <Home /> : view.name === "search" ? <Search /> : <Library />}
          </div>
        ))}
        {stack.length > 1 && (
          <button onClick={back} aria-label="Back" className="glass press absolute top-12 left-6 z-20 grid size-9 place-items-center rounded-full">
            <ChevronLeft size={20} strokeWidth={2.4} />
          </button>
        )}
      </main>

      <NowPlaying />
      <PlayerBar />
      <Toast />
    </div>
  );
}

function RailButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-current={active ? "page" : undefined} className={`press grid size-11 place-items-center rounded-xl hover:text-ink ${active ? "text-ink" : "text-muted"}`}>
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
  const liked = useLibrary((s) => !!track && s.liked.some((t) => t.id === track.id));

  return (
    <div className="fixed right-4 bottom-4 left-[76px] z-40">
      <div className="glass relative isolate overflow-hidden rounded-[22px]">
        {/* The artwork's colour washes the glass, strongest behind the artwork. */}
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-accent/30 via-accent/12 to-accent/5 transition-opacity duration-500" style={{ opacity: track ? 1 : 0 }} />
        <div className="grid grid-cols-[1fr_minmax(0,1.5fr)_1fr] items-center gap-6 py-2.5 pr-5 pl-2.5">
          <div onContextMenu={(e) => track && (e.preventDefault(), trackMenu(track))} className="flex min-w-0 items-center gap-3">
            <button onClick={() => useStore.setState((s) => ({ nowPlaying: !s.nowPlaying }))} aria-label="Now Playing" disabled={!track} className="press size-12 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06] shadow-md shadow-black/15">
              {track && <img src={art(track.thumb, 120)} alt="" className="size-full object-cover" />}
            </button>
            <div className="min-w-0">
              <div className="truncate font-semibold">{track?.title ?? "Not playing"}</div>
              <div aria-live="polite" className="truncate text-sm text-muted">{error ? <span title={error} className="text-ink">Couldn’t play this track. Try it again or pick another.</span> : track && <Artists list={track.artists} />}</div>
            </div>
            {track && (
              <button onClick={() => toggleLike(track)} aria-label={liked ? "Unlike" : "Like"} aria-pressed={liked} className="press grid size-8 shrink-0 place-items-center rounded-full text-ink/50 hover:text-ink">
                <Heart size={18} className={liked ? "fill-accent text-accent" : ""} />
              </button>
            )}
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-2">
              <button onClick={prev} aria-label="Previous" className="press grid size-10 place-items-center rounded-full"><SkipBack size={20} className="fill-current" /></button>
              <button onClick={toggle} aria-label={loading ? "Loading…" : paused ? "Play" : "Pause"} className="press grid size-10 place-items-center rounded-full bg-accent text-white">
                {loading ? <LoaderCircle size={18} className="animate-[spin_0.6s_linear_infinite]" /> : paused ? <Play size={18} className="ml-0.5 fill-current" /> : <Pause size={18} className="fill-current" />}
              </button>
              <button onClick={next} aria-label="Next" className="press grid size-10 place-items-center rounded-full"><SkipForward size={20} className="fill-current" /></button>
            </div>
            <div className="flex w-full items-center gap-3 text-[11px] font-medium text-muted tabular-nums">
              <span className="w-9 text-right">{fmt(time)}</span>
              <input type="range" aria-label="Seek" min={0} max={duration || 0} step={0.1} value={time} onChange={(e) => (audio.currentTime = +e.target.value)} style={fill(time, duration)} className="flex-1" />
              <span className="w-9">{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button onClick={() => (audio.muted = !muted)} aria-label={muted ? "Unmute" : "Mute"} className="press grid size-8 place-items-center rounded-full text-ink/60 hover:text-ink">
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => ((audio.volume = +e.target.value), (audio.muted = false))} style={fill(muted ? 0 : volume, 1)} className="w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Every library change answers here, above the player bar. Stays mounted so it can animate out and
// so screen readers hear each one; holds still while the pointer or focus is on it.
function Toast() {
  const toast = useStore((s) => s.toast);
  const [last, setLast] = useState(toast);
  const [hold, setHold] = useState(false);
  if (toast && toast !== last) setLast(toast);
  useEffect(() => {
    if (!toast || hold) return;
    const t = setTimeout(() => useStore.setState({ toast: undefined }), 5000);
    return () => clearTimeout(t);
  }, [toast, hold]);
  const t = toast ?? last;

  return (
    <div role="status" className="pointer-events-none fixed bottom-[108px] left-[calc(50%+38px)] z-40 -translate-x-1/2">
      {t && (
        <div
          inert={!toast}
          onPointerEnter={() => setHold(true)}
          onPointerLeave={() => setHold(false)}
          onFocus={() => setHold(true)}
          onBlur={() => setHold(false)}
          className={`flex w-[min(460px,calc(100vw-140px))] items-center gap-4 rounded-[22px] bg-ink p-3 text-white shadow-2xl shadow-black/30 ${
            toast
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100 transition-[opacity,translate,scale] duration-400 ease-(--ease-out)"
              : "translate-y-4 scale-95 opacity-0 transition-[opacity,translate,scale] duration-200 ease-in"
          }`}
        >
          {/* A new toast over a showing one swaps its contents in place. */}
          <div key={t.id} className="flex min-w-0 flex-1 animate-enter items-center gap-4">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white/10">
              {t.thumb ? <img src={art(t.thumb, 120)} alt="" className="size-full object-cover" /> : <Music size={22} className="text-white/60" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-bold tracking-tight">{t.text}</div>
              {t.detail && <div className="truncate text-sm text-white/60">{t.detail}</div>}
            </div>
          </div>
          {t.undo && (
            <button onClick={t.undo} className="press h-10 shrink-0 rounded-full bg-white px-5 font-semibold text-black hover:bg-white/85">
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
