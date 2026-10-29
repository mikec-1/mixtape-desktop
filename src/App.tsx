import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, House, Library as LibraryIcon, ListMusic, Maximize2, MicVocal, Moon, Music, PanelLeftClose, PanelLeftOpen, Pause, PictureInPicture2, Play, Repeat, Repeat1, Search as SearchIcon, Settings as SettingsIcon, Shuffle, SkipBack, Sparkle, SkipForward, TriangleAlert, Volume2, VolumeX, WifiOff, X, type LucideIcon } from "lucide-react";
import { ROOTS, audio, back, cycleRepeat, go, next, prev, seekTo, setMuted, setVolume, sleepIn, subscribeAudio, toggle, toggleMini, toggleSheet, toggleShuffle, useAudio, useLibrary, useOnline, useSettings, useStore } from "./store";
import { actionFor, comboFrom, recording, searchTab } from "./keys";
import { useExtras, useLine, useLyrics } from "./lyrics";
import { Artist, Artists, SongName, LikeButton, ChartsPage, CollectionPage, DiscographyPage, Explicit, Dialogs, WebMenu, FolderPage, HistoryPage, Home, Library, LocalPage, NowPlaying, PlaylistPage, popup, ProfilePage, QueuePanel, ReleasesPage, Search, Settings, SharedPage, trackMenu, WrappedPage } from "./views";
import { handingOff, mustSignIn, publicProfile, setProfile, useAccount, useOwner } from "./account";
import { Welcome } from "./welcome";
import { Hello } from "./hello";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { addFiles, canHaveFiles } from "./local";
import { importCsvPaths, importLink, isLink } from "./import";
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
  // The owner only: ⌘⇧O replays the welcome from sign-in, without wiping anything.
  const owner = useOwner();
  useEffect(() => {
    if (!owner) return;
    const key = (e: KeyboardEvent) => e.metaKey && e.shiftKey && e.code === "KeyO" && (e.preventDefault(), setWelcome("preview"));
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [owner]);
  // The app, signed out: sign in before anything else (and the website, signing the app in). Signed in without an
  // @ yet (or still asking): pick one first, on the app and the website alike.
  const locked = useAccount((s) => ((mustSignIn || s.out) && !s.user) || (!!s.user && !s.profile?.handle && !s.named)) || !!handingOff();
  // An account that's never had the welcome gets it, even after a reload mid sign-in. One from before the
  // welcome (it already has a library) is marked done instead. Not by this browser's onboarded flag: that
  // belongs to whoever used it before. Waits for the profile so it never syncs a blank name.
  const signedIn = useAccount((s) => !!s.user), profile = useAccount((s) => s.profile);
  useEffect(() => {
    if (!signedIn || locked || !profile?.name || profile.welcomed) return;
    const l = useLibrary.getState();
    if (l.liked.length || l.playlists.length || l.saved.length || l.followed.length) setProfile({ welcomed: true });
    else setWelcome((w) => w || true);
  }, [signedIn, locked, profile]);
  // Just signed in: the sign-in says hi and fades into the app, rather than vanishing the moment the account lands.
  const [leaving, setLeaving] = useState<false | "wait" | "hi" | "out">(false);
  const wasLocked = useRef(locked);
  useEffect(() => {
    const go = wasLocked.current && !locked && !!useAccount.getState().user; // not when you skip it
    wasLocked.current = locked;
    if (locked) setLeaving(false); // signed out again mid-hi: back to the form, not a blank screen
    if (!go) return;
    setLeaving("wait"); // blank until the name comes, so it never says "You’re in." and then swaps
    const out = () => (setLeaving("out"), (t = setTimeout(() => setLeaving(false), 450)));
    // Says hi by name, so it waits for the profile (asked of the server directly; a new account's hasn't
    // synced yet), then holds the hi long enough to read. An account that's never had the welcome gets it.
    const me = useAccount.getState().user!.id;
    let t = setTimeout(() => (setLeaving("hi"), (t = setTimeout(out, 1600))), 2000); // the server's slow: carry on without the name
    void publicProfile(me).then((p) => {
      if (useAccount.getState().user?.id !== me) return;
      const name = p?.profile?.name;
      if (name && !useAccount.getState().profile?.name) useAccount.setState({ profile: { ...useAccount.getState().profile, ...p!.profile } });
      if (!p?.profile?.welcomed) setWelcome(true);
      clearTimeout(t), setLeaving("hi"), (t = setTimeout(out, 1600));
    }, () => {});
    return () => clearTimeout(t);
  }, [locked]);
  const stack = useStore((s) => s.stack);
  const tabs = useStore((s) => s.tabs);
  const covered = useStore((s) => !!s.sheet || !!s.dialog); // the sheet or a dialog is over the page
  const root = stack[0].name;
  const open = useSettings((s) => s.sidebar);
  const width = useSettings((s) => s.sidebarWidth);
  const queue = useSettings((s) => s.queue);

  useEffect(() => {
    // Whether focus last moved by mouse or by Tab, so Space only presses buttons you tabbed to.
    let tabbed = false;
    const onPointer = () => (tabbed = false);
    const onKey = (e: KeyboardEvent) => {
      const key = comboFrom(e);
      if (e.key === "Tab") tabbed = true;
      if (!key || recording || e.defaultPrevented) return; // Settings → Shortcuts, or what's focused, took this press
      const target = e.target as Element;
      // Fields keep their own keys (arrows, space, ⌘← …); ⌘ shortcuts without arrows still work in them.
      if (target.closest?.("input, textarea, select") && key !== "escape" && !(key.startsWith("mod+") && !key.includes("arrow"))) return;
      // Space presses a button you tabbed to; one focused by a click or by code (the lyrics sheet's Close) doesn't steal play/pause.
      if (key === " " && (e.repeat || (tabbed && target.closest?.("button")))) return;
      const action = actionFor(key);
      if (!action) return;
      e.preventDefault();
      action.run();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onPointer, true);
    // A playlist or album link pasted outside a text field imports it.
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]") || !isLink(text)) return;
      e.preventDefault();
      void importLink(text);
    };
    addEventListener("paste", onPaste);
    return () => (removeEventListener("keydown", onKey), removeEventListener("pointerdown", onPointer, true), removeEventListener("paste", onPaste));
  }, []);

  // Files dropped on the window: a playlist (.csv) imports, songs play from Local Files.
  // While they're held over it, a sheet says what dropping them will do.
  const [dragging, setDragging] = useState<string>();
  useEffect(() => {
    if (!canHaveFiles) return;
    const sort = (paths: string[]) => ({
      csv: paths.filter((p) => /\.csv$/i.test(p)),
      // Folders (no extension; "Vol. 2" isn't one) are added whole, like Settings → Add Folder.
      songs: paths.filter((p) => /\.(mp3|m4a|aac|flac|wav|aiff?|ogg|oga|opus)$/i.test(p) || !/\.[a-z0-9]{1,5}$/i.test(p)),
    });
    const off = getCurrentWebview().onDragDropEvent(async ({ payload: e }) => {
      if (e.type === "over") return;
      if (e.type === "enter") {
        const { csv, songs } = sort(e.paths);
        return setDragging(csv.length ? (csv.length > 1 ? `Import ${csv.length} Playlists` : "Import Playlist") : songs.length ? "Add to Local Files" : "Can’t Open These");
      }
      setDragging(undefined);
      if (e.type !== "drop") return;
      const { csv, songs } = sort(e.paths);
      if (songs.length) void addFiles(songs);
      void importCsvPaths(csv);
    });
    return () => void off.then((f) => f());
  }, []);

  return (
    // The sidebar, one big page card and the queue side by side, the player under all three. The gaps drag the window.
    // The toasts centre on the window, over the play button, whatever's open. The welcome goes over all of it.
    <>
    <div data-tauri-drag-region inert={!!welcome || locked} className={`flex h-full flex-col gap-2 p-2 ${onWindows ? "pt-8" : ""}`}>
      <div className="flex min-h-0 flex-1 gap-2">
        <Sidebar root={root} open={open} width={width} inert={covered} />
        <main inert={covered} className="@container relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-paper">
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-11" />
          {/* Every view in every tab's stack stays mounted, so going back, or to another tab and back, keeps its results and scroll position. */}
          {ROOTS.flatMap((tab) => (tab === root ? stack : (tabs[tab]?.stack ?? [])).map((view, i, list) => (
            <div key={tab + i + view.name + ("id" in view ? view.id : "")} hidden={tab !== root || i !== list.length - 1} className="absolute inset-0 overflow-x-hidden overflow-y-auto pb-10">
              {"id" in view ? (
                view.name === "artist" ? <Artist id={view.id} by={view.by} /> : view.name === "discography" ? <DiscographyPage id={view.id} params={view.params} artist={view.artist} /> : view.name === "playlist" ? <PlaylistPage id={view.id} /> : view.name === "folder" ? <FolderPage id={view.id} /> : view.name === "shared" ? <SharedPage id={view.id} /> : view.name === "profile" ? <ProfilePage id={view.id} /> : <CollectionPage id={view.id} />
              ) : view.name === "home" ? <Home /> : view.name === "search" ? <Search /> : view.name === "settings" ? <Settings /> : view.name === "history" ? <HistoryPage /> : view.name === "local" ? <LocalPage /> : view.name === "charts" ? <ChartsPage /> : view.name === "releases" ? <ReleasesPage /> : view.name === "wrapped" ? <WrappedPage /> : <Library />}
            </div>
          )))}
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
      <Offline />
    </div>
    {dragging && (
      <div className="pointer-events-none fixed inset-2 z-50 grid animate-[fade_0.15s_ease-out] place-items-center rounded-2xl bg-black/40 ring-4 ring-accent backdrop-blur-sm ring-inset">
        <div className="flex animate-enter flex-col items-center gap-3 text-white">
          <div className="grid size-20 animate-bounce place-items-center rounded-full bg-accent shadow-2xl shadow-black/40">
            {dragging.startsWith("Import") ? <ListMusic size={36} /> : dragging.startsWith("Play") ? <Music size={36} /> : <X size={36} />}
          </div>
          <div className="text-2xl font-bold tracking-tight drop-shadow">{dragging}</div>
        </div>
      </div>
    )}
    {/* The welcome sits under the hi as it fades, so the app never shows in between. */}
    {!locked && welcome && <Welcome preview={welcome === "preview"} onDone={() => setWelcome(false)} />}
    {/* Outside the frame, which goes inert under the welcome, so its buttons still answer there. */}
    <Toast />
    <WebMenu />
    {(locked || leaving) && <Hello leaving={leaving} onSkip={mustSignIn || handingOff() ? undefined : () => useAccount.setState({ out: false })} />}
    {onWindows && <WindowButtons />}
    </>
  );
}

// Windows has no title bar here (lib.rs), so its three buttons sit in the strip above the cards, drawn in
// its own icon font. They stay usable over the welcome.
const onWindows = "__TAURI_INTERNALS__" in window && /Windows/.test(navigator.userAgent);
function WindowButtons() {
  const [win] = useState(getCurrentWindow);
  const [max, setMax] = useState(false);
  useEffect(() => {
    const off = win.onResized(() => void win.isMaximized().then(setMax));
    return () => void off.then((f) => f());
  }, [win]);
  const button = "grid h-8 w-[46px] place-items-center font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets'] text-[10px] text-ink/80 transition-colors";
  return (
    <div className="fixed top-0 right-0 z-[60] flex">
      <button aria-label="Minimise" onClick={() => win.minimize()} className={`${button} hover:bg-ink/10`}>{"\uE921"}</button>
      <button aria-label={max ? "Restore" : "Maximise"} onClick={() => win.toggleMaximize()} className={`${button} hover:bg-ink/10`}>{max ? "\uE923" : "\uE922"}</button>
      <button aria-label="Close" onClick={() => win.close()} className={`${button} hover:bg-[#c42b1c] hover:text-white`}>{"\uE8BB"}</button>
    </div>
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
    <nav inert={inert} data-tauri-drag-region style={{ width: open ? width : RAIL }} className={`relative flex shrink-0 flex-col gap-1 rounded-2xl bg-paper px-4 pb-3 ${onWindows ? "pt-3" : "pt-12"} ${dragging ? "" : "transition-[width] duration-300 ease-drawer"}`}>
      <SideButton icon={House} label="Home" active={root === "home"} open={open} onClick={() => go("home")} />
      <SideButton icon={SearchIcon} label="Search" active={root === "search"} open={open} onClick={() => searchTab(root === "search")} />
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
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const sleep = useStore((s) => s.sleep);
  const lyrics = useStore((s) => s.sheet === "lyrics");
  const open = useStore((s) => !!s.sheet); // over Now Playing or lyrics: the same bar, white in a faint glass box
  const queue = useSettings((s) => s.queue);
  const icon = "press grid size-8 shrink-0 place-items-center rounded-full text-ink/60 hover:text-ink";
  const roomy = icon.replace("grid", "hidden @2xl:grid"); // only when the bar has room
  // On: the accent, with a dot under it, as in Spotify.
  const mode = (on: boolean) => `press relative grid size-8 place-items-center rounded-full ${on ? "text-accent after:absolute after:bottom-0 after:size-1 after:rounded-full after:bg-accent" : "text-ink/60 hover:text-ink"}`;

  // Stays above the Now Playing sheet, so it keeps working while the sheet is up. Narrow, it lets go of
  // the volume slider (mute and ⌘↑/↓ stay), then of Mini Player and Full Screen (the artwork opens it too).
  return (
    <div data-player className={`@container relative isolate z-40 shrink-0 overflow-hidden rounded-2xl ${open ? "text-white [--color-accent:white] [--color-ink:white] [--color-muted:rgb(255_255_255/0.6)] [--color-paper:black]" : ""}`}>
      {/* Over the sheet the card turns to a faint glass box, so it never vanishes or leaves a cream rim. */}
      <div className={`absolute inset-0 -z-20 rounded-2xl transition-[background-color,box-shadow] duration-300 ease-out ${open ? "bg-white/10 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]" : "bg-[light-dark(#fbf9f5,#141416)]"}`} />
      {/* The artwork's colour washes the bar, strongest behind the artwork. */}
      <div className="absolute inset-0 -z-10 bg-linear-to-r from-accent/30 via-accent/12 to-accent/5 transition-opacity duration-500" style={{ opacity: track && !open ? 1 : 0 }} />
      {/* And fills it as the song plays: the artwork's colour follows the song, under a lighter trail running ahead at twice the speed. */}
      <div className="absolute inset-0 -z-10 rounded-2xl transition-opacity duration-500" style={{ opacity: track && !open ? 1 : 0, background: ((p) => `linear-gradient(to right, color-mix(in oklch, var(--color-accent-vivid) 22%, transparent) ${p}%, transparent calc(${p}% + 6%)), linear-gradient(to right, color-mix(in oklch, var(--color-accent-vivid) 9%, transparent) ${Math.min(100, p * 2)}%, transparent calc(${Math.min(100, p * 2)}% + 12%))`)(duration ? (time / duration) * 100 : 0) }} />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-6 py-2.5 pr-4 pl-2.5">
        <div onContextMenu={(e) => track && (e.preventDefault(), trackMenu(track))} className="flex min-w-0 items-center gap-3">
          <button onClick={() => toggleSheet("playing")} aria-label="Now Playing" disabled={!track} className="press size-12 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06] shadow-md shadow-black/15">
            {track && <img src={art(track.thumb, 120)} alt="" className="size-full object-cover" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{track ? <SongName t={track} /> : "Not playing"}</div>
            <div aria-live="polite" className="truncate text-sm text-muted">{track && <>{error && <span title={error} className="font-semibold text-[#ff453a]">Unavailable · </span>}{track.explicit && <Explicit />}<Artists list={track.artists} /></>}</div>
            {track && !error && !open && <Peek track={track} />}
          </div>
          {track && <LikeButton track={track} />}
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-2">
            <button onClick={toggleShuffle} aria-label={shuffle === "smart" ? "Smart Shuffle" : "Shuffle"} aria-pressed={!!shuffle} title={shuffle === "smart" ? "Smart Shuffle: mixing in recommendations" : shuffle ? "Shuffle (again for Smart Shuffle)" : "Shuffle"} className={mode(!!shuffle)}>
              <Shuffle size={17} />
              {shuffle === "smart" && <Sparkle size={9} className="absolute top-0.5 right-0.5 fill-current" />}
            </button>
            <button onClick={prev} aria-label="Previous" className="press grid size-10 place-items-center rounded-full"><SkipBack size={20} className="fill-current" /></button>
            <button onClick={toggle} aria-label={loading ? "Loading…" : paused ? "Play" : "Pause"} className="press grid size-10 place-items-center rounded-full bg-accent text-paper">
              {loading ? <span className="spinner size-[18px]" /> : paused ? <Play size={18} className="ml-0.5 fill-current" /> : <Pause size={18} className="fill-current" />}
            </button>
            <button onClick={next} aria-label="Next" className="press grid size-10 place-items-center rounded-full"><SkipForward size={20} className="fill-current" /></button>
            <button onClick={cycleRepeat} aria-label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat"} aria-pressed={repeat !== "off"} title={repeat === "one" ? "Repeat One" : repeat === "all" ? "Repeat All" : "Repeat"} className={mode(repeat !== "off")}>
              {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
            </button>
          </div>
          <div className="flex w-full items-center gap-3 text-[11px] font-medium text-muted tabular-nums">
            <span className="w-9 text-right">{fmt(time)}</span>
            <input type="range" aria-label="Seek" min={0} max={duration || 0} step={0.1} value={time} onChange={(e) => seekTo(+e.target.value)} style={fill(time, duration)} className="flex-1" />
            <span className="w-9">{fmt(duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button onClick={sleepMenu} aria-label="Sleep Timer" title={sleep === "track" ? "Sleep Timer: end of track" : sleep ? `Sleep Timer: ${Math.ceil((sleep - Date.now()) / 60_000)} min left` : "Sleep Timer"} className={mode(!!sleep)}>
            <Moon size={17} />
          </button>
          {!open && <button onClick={() => toggleSheet("lyrics")} aria-label="Lyrics" aria-pressed={lyrics} title="Lyrics" className={mode(lyrics)}>
            <MicVocal size={17} />
          </button>}
          {!open && <button onClick={() => useSettings.setState({ queue: !queue })} aria-label="Queue" aria-pressed={queue} title="Queue" className={mode(queue)}>
            <ListMusic size={18} />
          </button>}
          <button onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} className={icon}>
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => setVolume(+e.target.value)} style={fill(muted ? 0 : volume, 1)} className="hidden w-24 @3xl:block" />
          <button onClick={toggleMini} aria-label="Mini Player" title="Mini Player" className={roomy}>
            <PictureInPicture2 size={17} />
          </button>
          {!open && <button onClick={() => toggleSheet("playing")} aria-label="Full screen" title="Full screen" className={roomy}>
            <Maximize2 size={17} />
          </button>}
        </div>
      </div>
    </div>
  );
}

// The line being sung, under the artist, for songs with synced lyrics; it opens the lyrics. Its height
// is the artwork's and the controls', so it never makes the bar taller. It runs on under the heart, and a
// line longer than that shows a piece at a time, each when it's sung.
function Peek({ track }: { track: Track }) {
  const on = useSettings((s) => s.lyricsPeek);
  const { value } = useLyrics(track);
  const lyrics = on && value?.synced ? value : undefined;
  const { romanised } = useExtras(track, lyrics);
  const at = useLine(lyrics);
  const line = lyrics?.lines[at], words = romanised?.[at] ?? line?.text ?? "♪";
  const box = useRef<HTMLButtonElement>(null);
  const [part, setPart] = useState<{ at: number; list: string[]; i: number }>();
  useLayoutEffect(() => {
    const el = box.current, shown = el?.firstElementChild;
    if (!el || !shown || !line) return setPart(undefined);
    // Measured in a copy of the line as shown, to the fraction of a pixel (whole pixels let a hair too much
    // through, and the "…" then takes a letter or two), with a little to spare.
    const pen = el.appendChild(shown.cloneNode() as HTMLElement), room = shown.getBoundingClientRect().width - 3;
    pen.style.cssText = "position:absolute;visibility:hidden;width:max-content";
    const fits = (t: string) => ((pen.textContent = t), pen.getBoundingClientRect().width <= room);
    const list = words.split(" ").reduce<string[]>((out, w) => (out.length && fits(`${out.at(-1)} ${w}`) ? (out[out.length - 1] += ` ${w}`) : out.push(w), out), []);
    pen.remove();
    if (list.length < 2) return setPart(undefined);
    // ponytail: takes the singing as even through the line; its word timings would place each switch exactly.
    const end = line.end ?? lyrics!.lines[at + 1]?.time ?? line.time + 5;
    const sync = () => {
      const sung = ((audio.currentTime - line.time) / Math.max(1, end - line.time)) * words.length;
      let i = 0;
      for (let n = list[0].length + 1; i < list.length - 1 && n <= sung; n += list[++i].length + 1);
      setPart((p) => (p?.list === list && p.i === i ? p : { at, list, i }));
    };
    sync();
    return subscribeAudio(sync);
  }, [lyrics, at, words]);
  if (!lyrics) return null;
  const i = part?.at === at ? part.i : 0;
  return (
    <button ref={box} onClick={() => toggleSheet("lyrics")} title="Lyrics" className="-mr-11 block w-[calc(100%+2.75rem)] text-left text-[13px] leading-[15px] font-semibold text-accent">
      <span key={`${at}:${i}`} className="block animate-enter truncate">{part?.at === at ? part.list[i] : words}</span>
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
    <div role="status" className="glass fixed top-3 left-1/2 z-50 flex -translate-x-1/2 animate-enter items-center gap-2.5 rounded-full py-2 pr-5 pl-4 text-sm font-semibold">
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
    // Long enough to reach Undo; just news goes sooner.
    const t = setTimeout(() => useStore.setState({ toast: undefined }), toast.undo || toast.action ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [toast, hold]);
  const t = toast ?? last;

  return (
    <div role="status" className="pointer-events-none fixed bottom-[110px] left-1/2 z-[60] -translate-x-1/2">
      {t && (
        <div
          inert={!toast}
          onPointerEnter={() => setHold(true)}
          onPointerLeave={() => setHold(false)}
          onFocus={() => setHold(true)}
          onBlur={() => setHold(false)}
          className={`flex w-max max-w-[min(460px,calc(100vw-32px))] items-center gap-3 rounded-[10px] bg-white py-2.5 pr-4 text-black shadow-xl shadow-black/25 ${t.thumb || t.sticky || t.warn ? "pl-2.5" : "pl-4"} ${
            toast
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100 transition-[opacity,translate,scale] duration-400 ease-(--ease-out)"
              : "translate-y-4 scale-95 opacity-0 transition-[opacity,translate,scale] duration-200 ease-in"
          }`}
        >
          {/* A new toast over a showing one swaps its contents in place. */}
          <div key={t.id} className="flex min-w-0 flex-1 animate-enter items-center gap-3">
            {/* Ones still working keep a black square for the cover they're about to get. */}
            {/* Something went wrong: a red warning where the cover would be. */}
            {t.warn ? <div className="grid size-8 shrink-0 place-items-center rounded-[5px] bg-[#ff453a]/15 text-[#ff453a]"><TriangleAlert size={16} /></div> : (t.thumb || t.sticky) && <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[5px] bg-black/[0.07]">{t.thumb ? <img src={art(t.thumb, 120)} alt="" className="size-full object-cover" /> : <span className="spinner block size-4 text-black/40" />}</div>}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{t.text}</div>
              {t.detail && <div className="truncate text-[13px] text-black/55">{t.detail}</div>}
            </div>
          </div>
          {t.action ? (
            <button onClick={t.action.run} className="press shrink-0 text-[15px] font-bold text-accent hover:underline">
              {t.action.label}
            </button>
          ) : t.undo ? (
            <button onClick={t.undo} className="press shrink-0 text-[15px] font-bold text-accent hover:underline">
              Undo
            </button>
          ) : null}
          <button onClick={() => useStore.setState({ toast: undefined })} aria-label="Close" className="press -mr-1 grid size-6 shrink-0 place-items-center rounded-full text-black/40 hover:bg-black/[0.06] hover:text-black"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
