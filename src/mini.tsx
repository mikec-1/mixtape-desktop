import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LoaderCircle, Music, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { MiniState } from "./store";
import { art } from "./yt";

// The mini player window: borderless and transparent (store.ts toggleMini), so this card is the
// whole window. Playback lives in the main window, which sends this its state.
// Imports only types from store, so this window never builds a second player.
const send = (command: "ready" | "toggle" | "next" | "prev") => void emit("mini", command);
const root = document.documentElement;
root.dataset.theme = JSON.parse(localStorage.settings ?? "{}").state?.theme ?? "system";
root.style.background = document.body.style.background = "transparent";
// Always on top (store.ts toggleMini), and a panel (lib.rs float_mini) so that includes other
// apps' full-screen spaces.
const win = getCurrentWindow();
void invoke("float_mini");
const fmt = (s = NaN) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");

export default function Mini() {
  const [s, setS] = useState<MiniState>();
  useEffect(() => {
    const off = listen<MiniState>("player", (e) => setS(e.payload));
    send("ready");
    return () => void off.then((f) => f());
  }, []);
  useEffect(() => {
    if (s?.accent) root.style.setProperty("--accent-raw", s.accent);
  }, [s?.accent]);
  const t = s?.track;
  const playing = s?.paused === false;
  const side = "press grid size-9 place-items-center rounded-full text-ink/75 hover:text-ink";
  return (
    <div
      data-tauri-drag-region
      className="group relative flex h-screen overflow-hidden rounded-[18px] bg-paper text-ink ring-1 ring-ink/10 ring-inset select-none"
      style={{ backgroundImage: "linear-gradient(to right, color-mix(in oklab, var(--color-accent) 30%, transparent), transparent 85%)" }}
    >
      <div className="pointer-events-none grid aspect-square h-full shrink-0 place-items-center bg-ink/[0.08] text-muted">
        {t?.thumb ? <img src={art(t.thumb, 300)} alt="" className="size-full object-cover" /> : <Music size={28} />}
      </div>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 flex-col justify-between py-3 pr-4 pl-4">
        <div data-tauri-drag-region className="min-w-0 pr-5">
          <div data-tauri-drag-region className="truncate text-[15px] leading-tight font-bold">{t?.title ?? "Nothing playing"}</div>
          <div data-tauri-drag-region className="truncate text-[13px] text-muted">{t?.artists.map((a) => a.name).join(", ") || "Sleeve"}</div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => send("prev")} aria-label="Previous" className={side}><SkipBack size={18} className="fill-current" /></button>
          <button onClick={() => send("toggle")} aria-label={s?.loading ? "Loading…" : playing ? "Pause" : "Play"} className="press grid size-10 place-items-center rounded-full bg-accent text-paper">
            {s?.loading ? <LoaderCircle size={18} className="animate-spin" /> : playing ? <Pause size={17} className="fill-current" /> : <Play size={17} className="ml-0.5 fill-current" />}
          </button>
          <button onClick={() => send("next")} aria-label="Next" className={side}><SkipForward size={18} className="fill-current" /></button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted tabular-nums">
          <span className="w-7 text-right">{fmt(s?.time)}</span>
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink/15">
            <div className="h-full rounded-full bg-accent" style={{ width: `${s?.duration ? (s.time / s.duration) * 100 : 0}%` }} />
          </div>
          <span className="w-7">{fmt(s?.duration)}</span>
        </div>
      </div>
      <button onClick={() => void win.close()} aria-label="Close Mini Player" className="press absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-ink/10 text-ink/70 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink/20 hover:text-ink focus-visible:opacity-100">
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}
