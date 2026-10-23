import { useEffect, useState, type CSSProperties } from "react";
import { ChevronLeft, Heart, House, Library as LibraryIcon, ListMusic, LoaderCircle, Maximize2, MicVocal, Moon, Music, PanelLeftClose, PanelLeftOpen, Pause, PictureInPicture2, Play, Repeat, Repeat1, Search as SearchIcon, Settings as SettingsIcon, Shuffle, SkipBack, Sparkle, SkipForward, Volume2, VolumeX, WifiOff, type LucideIcon } from "lucide-react";
import { audio, back, cycleRepeat, go, next, prev, setMuted, setVolume, sleepIn, toggle, toggleLike, toggleMini, toggleSheet, toggleShuffle, useAudio, useLibrary, useOnline, useSettings, useStore } from "./store";
import { actionFor, comboFrom, findSearch, recording } from "./keys";
import { useExtras, useLine, useLyrics } from "./lyrics";
import { Artist, Artists, ChartsPage, CollectionPage, DiscographyPage, Explicit, Dialogs, FolderPage, HistoryPage, Home, Library, LocalPage, NowPlaying, PlaylistPage, popup, ProfilePage, QueuePanel, ReleasesPage, Search, Settings, SharedPage, trackMenu, WrappedPage } from "./views";
import { useAccount } from "./account";
import { Welcome } from "./welcome";
import { art, type Track } from "./yt";

// A picture that can't load (offline, say) leaves its grey tile rather than WebKit's broken-image mark;
// it shows again once its source loads.
addEventListener("error", (e) => e.target instanceof HTMLImageElement && (e.target.style.visibility = "hidden"), true);
addEventListener("load", (e) => e.target instanceof HTMLImageElement && e.target.style.visibility && (e.target.style.visibility = ""), true);

// The welcome is for a new library: one that's already got things in it (from before it existed) skips it.
function firstLaunch() {
  if (localStorage.onboarded || !useLibrary.persist.hasHydrated()) return false; // not read yet: can't tell
  const l = useLibrary.getState();
  const fresh = !l.liked.length && !l.playlists.length && !l.saved.length && !l.followed.length && !useAccount.getState().user;
  if (!fresh) localStorage.onboarded = 1;
  return fresh;
}

export default function App() {
  // Settings → About can show it again ("preview"), after a reload.
  const [welcome, setWelcome] = useState<boolean | "preview">(() => (sessionStorage.welcome ? (delete sessionStorage.welcome, "preview") : firstLaunch()));
  const stack = useStore((s) => s.stack);
  const covered = useStore((s) => !!s.sheet || !!s.dialog); // the sheet or a dialog is over the page
  const root = stack[0].name;
  const open = useSettings((s) => s.sidebar);
  const width = useSettings((s) => s.sidebarWidth);
  const queue = useSettings((s) => s.queue);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = comboFrom(e);
      if (!key || recording) return; // Settings → Shortcuts is taking this press
      const target = e.target as Element;
      // Fields keep their own keys (arrows, space, ⌘← …); ⌘ shortcuts without arrows still work in them.
      if (target.closest?.("input, textarea") && key !== "escape" && !(key.startsWith("mod+") && !key.includes("arrow"))) return;
      // Space on a focused button presses it.
      if (key === " " && (e.repeat || target.closest?.("button"))) return;
      const action = actionFor(key);
      if (!action) return;
      e.preventDefault();
      action.run();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    // The sidebar, one big page card and the queue side by side, the player under all three. The gaps drag the window.
    // --sidebar and --panel centre the toasts on the page card. The welcome goes over all of it.
    <>
    <div data-tauri-drag-region inert={!!welcome} className="flex h-full flex-col gap-2 p-2" style={{ "--sidebar": `${open ? width : RAIL}px`, "--panel": queue ? "328px" : "0px" } as CSSProperties}>
      <div className="flex min-h-0 flex-1 gap-2">
        <Sidebar root={root} open={open} width={width} inert={covered} />
        <main inert={covered} className="@container relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-paper">
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-11" />
          {/* Every view in the stack stays mounted, so going back keeps its results and scroll position. */}
          {stack.map((view, i) => (
            <div key={i + view.name + ("id" in view ? view.id : "")} hidden={i !== stack.length - 1} className="absolute inset-0 overflow-x-hidden overflow-y-auto pb-10">
              {"id" in view ? (
                view.name === "artist" ? <Artist id={view.id} /> : view.name === "discography" ? <DiscographyPage id={view.id} params={view.params} artist={view.artist} /> : view.name === "playlist" ? <PlaylistPage id={view.id} /> : view.name === "folder" ? <FolderPage id={view.id} /> : view.name === "shared" ? <SharedPage id={view.id} /> : view.name === "profile" ? <ProfilePage id={view.id} /> : <CollectionPage id={view.id} />
              ) : view.name === "home" ? <Home /> : view.name === "search" ? <Search /> : view.name === "settings" ? <Settings /> : view.name === "history" ? <HistoryPage /> : view.name === "local" ? <LocalPage /> : view.name === "charts" ? <ChartsPage /> : view.name === "releases" ? <ReleasesPage /> : view.name === "wrapped" ? <WrappedPage /> : <Library />}
            </div>
          ))}
          {stack.length > 1 && (
            <button onClick={back} className="press absolute top-4 left-4 z-30 flex h-9 items-center gap-1 rounded-full bg-black/60 pr-3.5 pl-2 text-sm font-semibold text-white backdrop-blur-md hover:bg-black/75">
              <ChevronLeft size={18} strokeWidth={2.4} /> Back
            </button>
          )}
        </main>
        {queue && <QueuePanel />}
      </div>
      <PlayerBar />

      <NowPlaying />
      <Dialogs />
      <Toast />
      <Offline />
    </div>
    {welcome && <Welcome preview={welcome === "preview"} onDone={() => setWelcome(false)} />}
    </>
  );
}

// Wide enough to hold the traffic lights (lib.rs) inside the card; px-4 centres the icons in it.
const RAIL = 76;
const toggleSidebar = (sidebar = !useSettings.getState().sidebar) => useSettings.setState({ sidebar });
// Dragged narrower than 140 it snaps shut to the rail, like Spotify's.
const resize = (w: number) => (w < 140 ? toggleSidebar(false) : useSettings.setState({ sidebar: true, sidebarWidth: Math.round(Math.min(360, Math.max(180, w))) }));

function Sidebar({ root, open, width, inert }: { root: string; open: boolean; width: number; inert: boolean }) {
  const [dragging, setDragging] = useState(false);
  const drag = (on: boolean) => (setDragging(on), (document.documentElement.style.cursor = on ? "col-resize" : ""));
  return (
    <nav inert={inert} data-tauri-drag-region style={{ width: open ? width : RAIL }} className={`relative flex shrink-0 flex-col gap-1 rounded-2xl bg-paper px-4 pt-12 pb-3 ${dragging ? "" : "transition-[width] duration-300 ease-drawer"}`}>
      <SideButton icon={House} label="Home" active={root === "home"} open={open} onClick={() => go("home")} />
      <SideButton icon={SearchIcon} label="Search" active={root === "search"} open={open} onClick={findSearch} />
      <SideButton icon={LibraryIcon} label="Library" active={root === "library"} open={open} onClick={() => go("library")} />
      <div className="mt-auto flex flex-col gap-1">
        <SideButton icon={open ? PanelLeftClose : PanelLeftOpen} label={open ? "Hide Sidebar" : "Show Sidebar"} open={open} onClick={() => toggleSidebar()} />
        <SideButton icon={SettingsIcon} label="Settings" active={root === "settings"} open={open} onClick={() => go("settings")} />
      </div>
      {/* The resize handle fills the gap beside the sidebar. Keys follow the window-splitter pattern: arrows resize, Enter collapses. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Sidebar"
        aria-valuenow={open ? width : RAIL}
        aria-valuemin={RAIL}
        aria-valuemax={360}
        tabIndex={0}
        onPointerDown={(e) => e.button === 0 && (e.currentTarget.setPointerCapture(e.pointerId), drag(true))}
        onPointerMove={(e) => dragging && resize(e.clientX - e.currentTarget.parentElement!.getBoundingClientRect().left)}
        onLostPointerCapture={() => drag(false)}
        onDoubleClick={() => toggleSidebar()}
        onKeyDown={(e) => {
          const by = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
          if (by) resize((open ? width : RAIL) + by);
          else if (e.key === "Enter") toggleSidebar();
          else return;
          e.preventDefault();
        }}
        className={`absolute inset-y-0 -right-2 z-10 w-2 cursor-col-resize outline-none before:absolute before:inset-y-6 before:left-[3px] before:w-0.5 before:rounded-full before:bg-accent before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100 ${dragging ? "before:opacity-100" : "before:opacity-0"}`}
      />
    </nav>
  );
}

function SideButton({ icon: Icon, label, active, open, onClick }: { icon: LucideIcon; label: string; active?: boolean; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={open ? undefined : label} aria-current={active ? "page" : undefined} className={`press flex h-11 shrink-0 items-center gap-3.5 overflow-hidden rounded-xl px-[11px] text-[15px] font-bold whitespace-nowrap hover:text-ink ${active ? "bg-ink/[0.07] text-ink" : "text-muted"}`}>
      <Icon size={22} strokeWidth={active ? 2.4 : 2} className="shrink-0" />
      {open && label}
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
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const sleep = useStore((s) => s.sleep);
  const lyrics = useStore((s) => s.sheet === "lyrics");
  const queue = useSettings((s) => s.queue);
  const icon = "press grid size-8 shrink-0 place-items-center rounded-full text-ink/60 hover:text-ink";
  const roomy = icon.replace("grid", "hidden @2xl:grid"); // only when the bar has room
  // On: the accent, with a dot under it, as in Spotify.
  const mode = (on: boolean) => `press relative grid size-8 place-items-center rounded-full ${on ? "text-accent after:absolute after:bottom-0 after:size-1 after:rounded-full after:bg-accent" : "text-ink/60 hover:text-ink"}`;

  // Stays above the Now Playing sheet, so it keeps working while the sheet is up. Narrow, it lets go of
  // the volume slider (mute and ⌘↑/↓ stay), then of Mini Player and Full Screen (the artwork opens it too).
  return (
    <div className="@container relative isolate z-40 shrink-0 overflow-hidden rounded-2xl bg-paper">
      {/* The artwork's colour washes the bar, strongest behind the artwork. */}
      <div className="absolute inset-0 -z-10 bg-linear-to-r from-accent/30 via-accent/12 to-accent/5 transition-opacity duration-500" style={{ opacity: track ? 1 : 0 }} />
      <div className="grid grid-cols-[1fr_minmax(0,1.5fr)_1fr] items-center gap-6 py-2.5 pr-4 pl-2.5">
        <div onContextMenu={(e) => track && (e.preventDefault(), trackMenu(track))} className="flex min-w-0 items-center gap-3">
          <button onClick={() => toggleSheet("playing")} aria-label="Now Playing" disabled={!track} className="press size-12 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06] shadow-md shadow-black/15">
            {track && <img src={art(track.thumb, 120)} alt="" className="size-full object-cover" />}
          </button>
          <div className="min-w-0">
            <div className="truncate font-semibold">{track?.title ?? "Not playing"}</div>
            <div aria-live="polite" className="truncate text-sm text-muted">{error ? <span title={error} className="text-ink">Couldn’t play this track. Try it again or pick another.</span> : track && <>{track.explicit && <Explicit />}<Artists list={track.artists} /></>}</div>
            {track && !error && <Peek track={track} />}
          </div>
          {track && (
            <button onClick={() => toggleLike(track)} aria-label={liked ? "Unlike" : "Like"} aria-pressed={liked} className={icon}>
              <Heart size={18} className={liked ? "fill-accent text-accent" : ""} />
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-2">
            <button onClick={toggleShuffle} aria-label={shuffle === "smart" ? "Smart Shuffle" : "Shuffle"} aria-pressed={!!shuffle} title={shuffle === "smart" ? "Smart Shuffle: mixing in recommendations" : shuffle ? "Shuffle (again for Smart Shuffle)" : "Shuffle"} className={mode(!!shuffle)}>
              <Shuffle size={17} />
              {shuffle === "smart" && <Sparkle size={9} className="absolute top-0.5 right-0.5 fill-current" />}
            </button>
            <button onClick={prev} aria-label="Previous" className="press grid size-10 place-items-center rounded-full"><SkipBack size={20} className="fill-current" /></button>
            <button onClick={toggle} aria-label={loading ? "Loading…" : paused ? "Play" : "Pause"} className="press grid size-10 place-items-center rounded-full bg-accent text-paper">
              {loading ? <LoaderCircle size={18} className="animate-[spin_0.6s_linear_infinite]" /> : paused ? <Play size={18} className="ml-0.5 fill-current" /> : <Pause size={18} className="fill-current" />}
            </button>
            <button onClick={next} aria-label="Next" className="press grid size-10 place-items-center rounded-full"><SkipForward size={20} className="fill-current" /></button>
            <button onClick={cycleRepeat} aria-label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat"} aria-pressed={repeat !== "off"} title={repeat === "one" ? "Repeat One" : repeat === "all" ? "Repeat All" : "Repeat"} className={mode(repeat !== "off")}>
              {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
            </button>
          </div>
          <div className="flex w-full items-center gap-3 text-[11px] font-medium text-muted tabular-nums">
            <span className="w-9 text-right">{fmt(time)}</span>
            <input type="range" aria-label="Seek" min={0} max={duration || 0} step={0.1} value={time} onChange={(e) => (audio.currentTime = +e.target.value)} style={fill(time, duration)} className="flex-1" />
            <span className="w-9">{fmt(duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button onClick={sleepMenu} aria-label="Sleep Timer" title={sleep === "track" ? "Sleep Timer: end of track" : sleep ? `Sleep Timer: ${Math.ceil((sleep - Date.now()) / 60_000)} min left` : "Sleep Timer"} className={mode(!!sleep)}>
            <Moon size={17} />
          </button>
          <button onClick={() => toggleSheet("lyrics")} aria-label="Lyrics" aria-pressed={lyrics} title="Lyrics" className={mode(lyrics)}>
            <MicVocal size={17} />
          </button>
          <button onClick={() => useSettings.setState({ queue: !queue })} aria-label="Queue" aria-pressed={queue} title="Queue" className={mode(queue)}>
            <ListMusic size={18} />
          </button>
          <button onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} className={icon}>
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => setVolume(+e.target.value)} style={fill(muted ? 0 : volume, 1)} className="hidden w-24 @3xl:block" />
          <button onClick={toggleMini} aria-label="Mini Player" title="Mini Player" className={roomy}>
            <PictureInPicture2 size={17} />
          </button>
          <button onClick={() => toggleSheet("playing")} aria-label="Full screen" title="Full screen" className={roomy}>
            <Maximize2 size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

// The line being sung, under the artist, for songs with synced lyrics; it opens the lyrics. Its height
// is the artwork's and the controls', so it never makes the bar taller.
function Peek({ track }: { track: Track }) {
  const on = useSettings((s) => s.lyricsPeek);
  const { value } = useLyrics(track);
  const lyrics = on && value?.synced ? value : undefined;
  const { romanised } = useExtras(track, lyrics);
  const at = useLine(lyrics);
  if (!lyrics) return null;
  return (
    <button onClick={() => toggleSheet("lyrics")} title="Lyrics" className="block w-full text-left text-[13px] leading-[15px] font-semibold text-accent">
      <span key={at} className="block animate-enter truncate">{romanised?.[at] ?? lyrics.lines[at]?.text ?? "♪"}</span>
    </button>
  );
}

const sleepMenu = () =>
  popup([
    ...[15, 30, 45, 60].map((m) => ({ text: `${m} Minutes`, action: () => sleepIn(m) })),
    { text: "End of Track", action: () => sleepIn("track") },
    ...(useStore.getState().sleep ? [{ item: "Separator" as const }, { text: "Turn Off Timer", action: () => sleepIn() }] : []),
  ]);

function Offline() {
  if (useOnline()) return null;
  return (
    <div role="status" className="glass fixed top-3 left-[calc(50%+var(--sidebar)/2-var(--panel)/2+4px)] z-50 flex -translate-x-1/2 animate-enter items-center gap-2.5 rounded-full py-2 pr-5 pl-4 text-sm font-semibold">
      <WifiOff size={16} /> You’re offline. Your library is still here.
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
    if (!toast || hold || toast.sticky) return;
    const t = setTimeout(() => useStore.setState({ toast: undefined }), 5000);
    return () => clearTimeout(t);
  }, [toast, hold]);
  const t = toast ?? last;

  return (
    <div role="status" className="pointer-events-none fixed bottom-[92px] left-[calc(50%+var(--sidebar)/2-var(--panel)/2+4px)] z-40 -translate-x-1/2">
      {t && (
        <div
          inert={!toast}
          onPointerEnter={() => setHold(true)}
          onPointerLeave={() => setHold(false)}
          onFocus={() => setHold(true)}
          onBlur={() => setHold(false)}
          className={`flex w-[min(460px,calc(100vw-140px))] items-center gap-4 rounded-[22px] bg-neutral-900 p-3 text-white shadow-2xl ring-1 shadow-black/30 ring-white/10 ${
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
          {t.action ? (
            <button onClick={t.action.run} className="press h-10 shrink-0 rounded-full bg-white px-5 font-semibold text-black hover:bg-white/85">
              {t.action.label}
            </button>
          ) : t.undo ? (
            <button onClick={t.undo} className="press h-10 shrink-0 rounded-full bg-white px-5 font-semibold text-black hover:bg-white/85">
              Undo
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
