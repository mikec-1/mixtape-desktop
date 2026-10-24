import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, Effect, EffectState, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { ArrowUpRight, ChevronDown, Heart, ListPlus, LoaderCircle, Moon, Pause, PictureInPicture2, Play, Repeat, Repeat1, Search, Shuffle, SkipBack, SkipForward, Sparkle, Volume1, Volume2, VolumeX, X } from "lucide-react";
import type { MiniState, Remote } from "./store";
import { art, type Track } from "./yt";

// The menu bar player, opened under the menu-bar icon (startup.ts): what's playing, Up Next, and a search
// that plays anything. Like the mini player it only draws: playback lives in the main window, which sends
// it its state and runs what's pressed here (store.ts remote). Imports only types from store, so this
// window never builds a second player.
const send = (...command: Remote) => void emit("remote", command);
const root = document.documentElement;
root.dataset.theme = JSON.parse(localStorage.settings ?? "{}").state?.theme ?? "system";
root.style.background = document.body.style.background = "transparent";
const win = getCurrentWindow();
void invoke("float"); // a panel (lib.rs float), so it opens over full-screen apps and leaves the main window where it is
const hide = () => void win.hide();
// Liquid Glass (frosted glass on Macs before Tahoe, acrylic on Windows), tinted with the artwork's colour.
function glass(accent = "") {
  const [r, g, b] = accent.match(/[\d.]+/g)?.map(Number) ?? [];
  void win.setEffects({ effects: [Effect.LiquidGlassRegular, Effect.Popover, Effect.Acrylic], state: EffectState.Active, radius: 18, ...(b !== undefined && { color: [r, g, b, 40] }) });
}
const fmt = (s = NaN) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");
const fill = (v: number, max: number) => ({ "--p": `${(v / max) * 100 || 0}%` }) as CSSProperties;
const names = (t: Track) => t.artists.map((a) => a.name).join(", ");
const SLEEP = [15, 30, 45, 60];
// The window fits what's showing, keeping its top edge, or its bottom one above a taskbar at the bottom of
// the screen. Placed again after resizing, since a Mac keeps the bottom edge. One at a time, so each reads
// where the last one left it.
let fitting = Promise.resolve();
const fit = (height: number) =>
  (fitting = fitting.then(async () => {
    const [p, size, m] = await Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()]);
    const h = Math.round(height * (m?.scaleFactor ?? 1));
    if (h === size.height) return;
    await win.setSize(new PhysicalSize(size.width, h));
    await win.setPosition(new PhysicalPosition(p.x, m && p.y > m.position.y + m.size.height / 2 ? p.y + size.height - h : p.y));
  }).catch(() => {}));

// A line too long for its space slides across to show the rest, and back, like the song in Apple Music's
// mini player. With reduced motion it wraps instead (index.css .slide).
function Slide({ className = "", children }: { className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [by, setBy] = useState(0);
  useEffect(() => {
    const el = box.current!, text = el.firstElementChild as HTMLElement;
    const o = new ResizeObserver(() => setBy(Math.max(0, text.offsetWidth - el.clientWidth)));
    [el, text].forEach((e) => o.observe(e));
    return () => o.disconnect();
  }, []);
  return (
    <div ref={box} className={`slide -mx-2 overflow-hidden ${by ? "[mask-image:linear-gradient(90deg,transparent,#000_8px,#000_calc(100%-8px),transparent)]" : ""} ${className}`}>
      <div className="w-fit px-2" style={by ? ({ animation: `marquee ${3 + by / 15}s ease-in-out infinite`, "--by": `-${by}px` } as CSSProperties) : undefined}>{children}</div>
    </div>
  );
}

export default function Bar() {
  const [s, setS] = useState<MiniState>();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; songs: Track[]; more?: boolean }>();
  const [pick, setPick] = useState(0);
  const [seeking, setSeeking] = useState<number>();
  const [sleepy, setSleepy] = useState(false);
  const [open, setOpen] = useState(localStorage.upNext !== "0");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const swipe = useRef({ x: 0, at: 0 });
  useEffect(() => {
    const offs = [
      listen<MiniState>("player", (e) => setS(e.payload)),
      listen<NonNullable<typeof found>>("found", (e) => setFound(e.payload)),
      // Opened: ready to type into, with the last search picked to type over.
      win.onFocusChanged(({ payload }) => payload && input.current?.select()),
    ];
    send("ready");
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, []);
  useEffect(() => {
    if (s?.accent) root.style.setProperty("--accent-raw", s.accent);
    glass(s?.accent);
  }, [s?.accent]);
  // Searches a moment after you stop typing.
  useEffect(() => {
    setPick(0);
    if (!q.trim()) return setFound(undefined);
    const t = setTimeout(() => send("find", q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => list.current?.querySelector("[data-picked]")?.scrollIntoView({ block: "nearest" }), [pick]);
  useEffect(() => {
    const o = new ResizeObserver(() => fit(box.current!.offsetHeight));
    o.observe(box.current!);
    return () => o.disconnect();
  }, []);

  const t = s?.track;
  const playing = s?.paused === false;
  const songs = q.trim() ? (found?.songs ?? []) : [];
  const searching = !!q.trim() && (found?.q !== q.trim() || found.more);
  const play = (song: Track, soon = false) => (send("play", { t: song, soon }), setQ(""));
  const away = (...command: Remote) => (send(...command), hide());
  const time = seeking ?? s?.time ?? 0;
  const left = typeof s?.sleep === "number" ? Math.max(1, Math.ceil((s.sleep - Date.now()) / 60_000)) : undefined;
  // With nothing typed, Space and the arrows do what they do in the main window (keys.ts: play, ← → 5 seconds,
  // ⌘← ⌘→ skip, ↑ ↓ volume); with something typed, ↑ ↓ and Return pick from what's found.
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!q && (e.key === " " || e.key.startsWith("Arrow")) && !e.shiftKey && !e.altKey) return e.preventDefault(), void emit("key", (e.metaKey || e.ctrlKey ? "mod+" : "") + e.key.toLowerCase());
    if (e.key === "ArrowDown" || e.key === "ArrowUp") return e.preventDefault(), setPick((p) => Math.max(0, Math.min(songs.length - 1, p + (e.key === "ArrowDown" ? 1 : -1))));
    if (e.key === "Enter" && songs[pick]) play(songs[pick], e.metaKey || e.shiftKey);
  };
  // A sideways swipe across the song skips, like the Now Playing card on a phone.
  const swiped = (e: WheelEvent) => {
    const w = swipe.current;
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) || Date.now() - w.at < 700) return;
    w.x += e.deltaX;
    if (Math.abs(w.x) > 90) send(w.x > 0 ? "next" : "prev"), (w.x = 0), (w.at = Date.now());
  };
  const side = "press grid size-9 place-items-center rounded-full text-ink/75 hover:text-ink";
  const mode = (on: boolean) => `press relative grid size-9 place-items-center rounded-full ${on ? "text-accent after:absolute after:bottom-0.5 after:size-1 after:rounded-full after:bg-accent" : "text-ink/55 hover:text-ink"}`;
  const tool = "press flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold text-ink/70 hover:bg-ink/[0.07] hover:text-ink";
  const row = (song: Track, i: number, onPick: () => void, picked = false) => (
    <div key={`${song.id}${i}`} data-picked={picked || undefined} className={`group flex items-center gap-3 rounded-[10px] px-2 py-1.5 ${picked ? "bg-ink/[0.08]" : "hover:bg-ink/[0.06]"}`}>
      <button onClick={onPick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="size-9 shrink-0 overflow-hidden rounded-md"><img src={art(song.thumb, 96)} alt="" className="size-full rounded-md object-cover" /></div>
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-snug font-semibold">{song.title}</div>
          <div className="truncate text-[12px] leading-snug text-muted">{names(song)}</div>
        </div>
      </button>
      {q && (
        <button onClick={() => play(song, true)} aria-label="Play Next" title="Play Next (⌘Return)" className="press grid size-7 shrink-0 place-items-center rounded-full text-ink/60 opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
          <ListPlus size={16} />
        </button>
      )}
    </div>
  );

  return (
    <div ref={box} onKeyDown={(e) => e.key === "Escape" && (q ? setQ("") : hide())} className="relative flex flex-col overflow-hidden rounded-[18px] text-ink ring-1 ring-ink/10 ring-inset select-none">
      {/* The artwork, blurred, colours the glass behind the song. */}
      {t?.thumb && <img key={t.thumb} src={art(t.thumb, 120)} alt="" className="animate-enter pointer-events-none absolute -inset-x-10 -top-10 h-80 w-[calc(100%+5rem)] object-cover opacity-50 blur-3xl saturate-150" />}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-paper/0 via-paper/35 to-paper/55" />

      <div onWheel={swiped} className="relative">
        <div className="flex items-center gap-3.5 px-4 pt-4">
          <button onClick={() => away("sheet", "playing")} aria-label="Open Now Playing" className="press size-[88px] shrink-0 overflow-hidden rounded-xl shadow-lg ring-1 ring-ink/10">
            {t?.thumb && <img src={art(t.thumb, 300)} alt="" className="size-full object-cover" />}
          </button>
          <div key={t?.id} className="min-w-0 flex-1">
            <Slide className="text-[20px] leading-tight font-extrabold tracking-[-0.03em]">{t?.title ?? "Nothing playing"}</Slide>
            <Slide className="text-[13px] text-muted">
              {t ? t.artists.map((a, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <button onClick={() => away("show", { name: "artist", id: a.id ?? "", by: a.name })} className="hover:text-ink hover:underline">{a.name}</button>
                </span>
              )) : "Search for anything to play"}
            </Slide>
            <Slide className="text-[13px] text-muted/80">{t?.album}</Slide>
          </div>
          {t && (
            <button onClick={() => send("like")} aria-label={s?.liked ? "Remove from Liked Songs" : "Add to Liked Songs"} aria-pressed={s?.liked} className={`press grid size-8 shrink-0 place-items-center self-start rounded-full ${s?.liked ? "text-accent" : "text-ink/50 hover:text-ink"}`}>
              <Heart size={17} className={s?.liked ? "fill-current" : ""} />
            </button>
          )}
        </div>

        {/* The line being sung, in full, when the song has synced lyrics. Room for two lines, so it doesn't jump. */}
        {s?.line !== undefined && (
          <button onClick={() => away("sheet", "lyrics")} className="mt-3 block min-h-[2lh] w-full px-4 text-left text-[15px] leading-snug font-bold text-pretty text-accent">
            <span key={s.line} className="animate-enter block">{s.line || "♪"}</span>
          </button>
        )}

        <div className="mt-3 flex items-center gap-2 px-4 text-[11px] font-medium text-muted tabular-nums">
          <span className="w-8 text-right">{fmt(time)}</span>
          <input type="range" aria-label="Seek" min={0} max={s?.duration || 0} step={0.1} value={time} onChange={(e) => (setSeeking(+e.target.value), send("seek", +e.target.value))} onPointerUp={() => setSeeking(undefined)} style={fill(time, s?.duration ?? 0)} className="flex-1" />
          <span className="w-8">{fmt(s?.duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-4 py-1.5">
          <button onClick={() => send("shuffle")} aria-label={s?.shuffle === "smart" ? "Smart Shuffle" : "Shuffle"} aria-pressed={!!s?.shuffle} className={mode(!!s?.shuffle)}>
            <Shuffle size={17} />
            {s?.shuffle === "smart" && <Sparkle size={9} className="absolute top-1 right-1 fill-current" />}
          </button>
          <button onClick={() => send("prev")} aria-label="Previous" className={side}><SkipBack size={20} className="fill-current" /></button>
          <button onClick={() => send("toggle")} aria-label={s?.loading ? "Loading…" : playing ? "Pause" : "Play"} className="press grid size-12 place-items-center rounded-full bg-accent text-paper shadow-lg shadow-accent/30">
            {s?.loading ? <LoaderCircle size={20} className="animate-spin" /> : playing ? <Pause size={20} className="fill-current" /> : <Play size={20} className="ml-0.5 fill-current" />}
          </button>
          <button onClick={() => send("next")} aria-label="Next" className={side}><SkipForward size={20} className="fill-current" /></button>
          <button onClick={() => send("repeat")} aria-label={s?.repeat === "one" ? "Repeat One" : s?.repeat === "all" ? "Repeat All" : "Repeat"} aria-pressed={s?.repeat !== "off"} className={mode(!!s && s.repeat !== "off")}>
            {s?.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>

        <div onWheel={(e) => s && send("volume", Math.max(0, Math.min(1, s.volume - e.deltaY / 400)))} className="flex items-center gap-2 px-4 pb-3">
          <button onClick={() => send("mute", !s?.muted)} aria-label={s?.muted ? "Unmute" : "Mute"} className="press grid size-7 place-items-center rounded-full text-ink/60 hover:text-ink">
            {s?.muted || s?.volume === 0 ? <VolumeX size={16} /> : (s?.volume ?? 1) < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
          </button>
          <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={s?.muted ? 0 : (s?.volume ?? 1)} onChange={(e) => send("volume", +e.target.value)} style={fill(s?.muted ? 0 : (s?.volume ?? 1), 1)} className="flex-1" />
        </div>
      </div>

      <div className="relative border-t border-ink/10 bg-paper/40">
        {q ? (
          <div className="flex items-center justify-between px-4 pt-3 pb-1 text-[13px] font-bold">
            Songs
            {searching && <LoaderCircle size={13} className="animate-spin text-muted" />}
          </div>
        ) : (
          // Folds away (and stays folded) for a smaller player; folded, it still names the next song.
          <button onClick={() => (setOpen(!open), (localStorage.upNext = open ? "0" : "1"))} aria-expanded={open} className="flex w-full items-center gap-1 px-4 pt-3 pb-1 text-left text-[13px] font-bold">
            Up Next
            <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
            {!open && s?.next[0] && <span className="ml-1 truncate font-medium text-muted">{s.next[0].title}</span>}
          </button>
        )}
        {(open || q) && (
          <div ref={list} className="h-52 overflow-y-auto px-2 pb-1">
            {q
              ? songs.map((song, i) => row(song, i, () => play(song), i === pick))
              : s?.next.map((song, i) => row(song, i, () => send("jump", s.index + 1 + i)))}
            {!q && !s?.next.length && <p className="px-2 py-3 text-[13px] text-muted">Nothing up next. Search to play anything.</p>}
            {q && !searching && !songs.length && <p className="px-2 py-3 text-[13px] text-muted">Nothing found for “{q.trim()}”.</p>}
          </div>
        )}

        <label className="mx-3 mt-1 flex h-10 shrink-0 items-center gap-2 rounded-xl bg-ink/[0.07] px-3 ring-accent/60 focus-within:ring-2">
          <Search size={15} className="shrink-0 text-muted" />
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={keys} placeholder="Play anything…" aria-label="Play anything" spellCheck={false} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted" />
          {q && <button onClick={() => (setQ(""), input.current?.focus())} aria-label="Clear" className="press grid size-5 place-items-center rounded-full bg-ink/15 text-ink/70"><X size={11} strokeWidth={3} /></button>}
        </label>

        {sleepy && (
          <div className="animate-enter flex flex-wrap gap-1 px-3 pt-2">
            {[...SLEEP.map((m) => [`${m}m`, m] as const), ["End of Song", "track"] as const, ...(s?.sleep ? [["Off", undefined] as const] : [])].map(([label, m]) => (
              <button key={label} onClick={() => (send("sleep", m), setSleepy(false))} className={`press h-7 grow rounded-full px-3 text-[12px] font-semibold whitespace-nowrap ${s?.sleep === m && m ? "bg-accent text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`}>{label}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 px-2 py-2">
          <button onClick={() => setSleepy(!sleepy)} aria-label="Sleep Timer" aria-expanded={sleepy} className={`${tool} ${s?.sleep ? "text-accent" : ""}`}>
            <Moon size={15} />
            {s?.sleep === "track" ? "End of song" : left ? `${left} min` : "Sleep"}
          </button>
          <button onClick={() => away("mini")} className={tool}><PictureInPicture2 size={15} />Mini Player</button>
          <button onClick={() => away("show")} className={`${tool} ml-auto`}>Open<ArrowUpRight size={15} /></button>
        </div>
      </div>
    </div>
  );
}
