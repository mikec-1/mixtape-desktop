import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { type LucideIcon, TriangleAlert, ChevronRight, ListMusic, SlidersHorizontal, SunMoon, LockKeyhole, Command, CodeXml, LifeBuoy, MicVocal, UserRound, LibraryBig, Power, ArrowDownToLine, Disc3, Link2, ArrowUpDown, LoaderCircle, Trash2, AudioLines, BadgeCheck, CircleArrowDown, Clock3, CaseSensitive, Check, ChevronDown, Copy, Download, Link, Ellipsis, EyeOff, Folder as FolderIcon, GripVertical, HardDrive, Heart, History as HistoryIcon, ImageDown, ImagePlus, Languages, LayoutGrid, List, Maximize2, Music, PencilLine, Pin, Play, Minus, Pause, Plus, Quote, Radio, Search as SearchIcon, Shuffle, Sparkle, Upload, UserCheck, UserPlus, X } from "lucide-react";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import {
  EQ_BANDS, EQ_PRESETS, addToPlaylist, audio, back, go, clearHistory, fill as fillIn, clearQueue, deleteFolder, deletePlaylist, describePlaylist, duplicatePlaylist, enqueue, firstPlayable, jump, libraryKey, moveInQueue,
  copyPlaylist, movePlaylistTrack, moveToFolder, newFolder, newPlaylist, notify, open, play, plays, plural, removeFromPlaylist, radioFrom, removeFromQueue, renameFolder, renamePlaylist, report, restoreLibrary, setCover, setPublic,
  shufflePlay, skipped, sortPlaylist, unavailable, patch, TRACK_COLS, startRadio, subscribeAudio, toggle, toggleBlock, toggleFollow, toggleHide, toggleLike, likeAll, togglePin, toggleSave, useAudio, useHistory, useLibrary, useOnline, usePrivate, useRecents, useSettings, useStore, type LyricsSource,
  useRecentSearches, addRecentSearch, idbGet, idbPut, idbBytes, idbDelete, deleteAllPlaylists, clearLibrary, resetSettings,
  type Dialog, type Library as LibraryData, type LibraryFilter, type LibraryKind, type LibrarySort, type Play as PlayRow, type TrackSort, type View,
} from "./store";
import { asText, estimateWords, forgetLyrics, groups, isRtl, lineNow, lrcTime, lyricsNow, nudgeLyrics, removeMine, sampleSpring, saveMine, songKey, springProgress, titleOf, translateTarget, useExtras, useLine, useLyrics, useMine, useTiming, wordProgress, type Group, type Lyrics, type Word } from "./lyrics";
import { albumByName, art, artist, artistByName, charts, collection as ytCollection, discography, newReleases, parseSecs, topSongs, home, lastHome, search, searchKind, suggestions, type Album, type Artist, type SearchArtist, type Track } from "./yt";
import { album as deezerAlbum, covers as coversFor, isDeezer, pin, withGuests, youtubeId } from "./deezer";
import { addFolder, canHaveFiles, guessTags, localTracks, lookUp, addedFiles, removeFiles, removeFolder, rescan, useLocal, useLocalTracks, type SongEdit } from "./local";
import { canDownload, download, downloadedSize, listTracks, progress, removeAllDownloads, removeDownload, forgetArt, useOffline } from "./offline";
import { canSignIn, deleteAccount, exportAll, fromLink, playlistLink, profileLink, publicProfile, setProfile, sharedLink, sharedPlaylist, signOut, syncNow, useAccount, type Profile } from "./account";
import { SignIn } from "./signin";
import { bind, comboFrom, comboOf, KEYS, resetKeys, ZOOMS, setRecording, showCombo } from "./keys";
import { version } from "../package.json";
import appIcon from "../src-tauri/icons/128x128@2x.png";
import { clearDiscordRpc, lastfmAuthFinish, lastfmAuthStart, lastfmSignOut } from "./scrobble";
import { importLink, importPlaylistFile, isLink, pickPlaylists, versions } from "./import";
import { connect, contents, disconnect, importSpotify, useSpotify } from "./spotify";

// An album from Deezer (artist pages) or YouTube Music (search, Home).
const collection = (id: string) => (isDeezer(id) ? deezerAlbum(id) : ytCollection(id));

// Runs fn whenever deps change; responses for superseded deps are dropped. Keeps old data while reloading.
function useAsync<T>(fn: () => Promise<T> | undefined, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: false });
  useEffect(() => {
    let stale = false;
    const p = fn();
    if (!p) return setState({ loading: false });
    setState((s) => ({ ...s, loading: true }));
    p.then(
      (data) => !stale && setState({ data, loading: false }),
      (e) => !stale && setState({ error: String(e), loading: false }),
    );
    return () => void (stale = true);
  }, deps);
  return state;
}

const fold = (s = "") => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const matches = (t: Track, q: string) => fold([t.title, t.album, ...(t.artists ?? []).map((a) => a.name)].join(" ")).includes(fold(q));

// A tile per genre that searches for it.
const genres = [
  ["Pop", "#dc148c"],
  ["Hip-Hop", "#ba5d07"],
  ["Rock", "#e91429"],
  ["Indie", "#608108"],
  ["Electronic", "#0d73ec"],
  ["R&B", "#8c1932"],
  ["Jazz", "#8d67ab"],
  ["Classical", "#7d4b32"],
  ["K-Pop", "#148a08"],
  ["Chill", "#477d95"],
  ["Metal", "#503750"],
  ["Latin", "#1e3264"],
] as const;

const TABS = { all: "All", songs: "Songs", videos: "Videos", albums: "Albums", artists: "Artists", playlists: "Playlists" };
const KINDS = { songs: "song", videos: "video", albums: "album", artists: "artist", playlists: "playlist" } as const;
const rememberTrack = (t: Track) => addRecentSearch({ id: t.id, kind: "track", title: t.title, subtitle: t.artists.map((a) => a.name).join(", "), thumb: t.thumb, track: t });

export function Search() {
  const query = useStore((s) => s.query);
  const [term, setTerm] = useState("");
  const [tab, setTab] = useState<keyof typeof TABS>("all");
  const [pick, setPick] = useState(-1);
  const [typing, setTyping] = useState(false);
  const recents = useRecentSearches((s) => s.items);
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const online = useOnline(); // a search that failed offline runs again on reconnect
  const ok = term && !fromLink(term);
  const found = useAsync(() => (ok && tab === "all" ? search(term) : undefined), [term, tab, online]);
  // Which tab they're for: the last tab's results stay up while the next tab's load, and aren't its kind.
  const kind = useAsync(() => (ok && tab !== "all" ? (searchKind(term, KINDS[tab]) as Promise<(Track & Album & SearchArtist)[]>).then((items) => ({ tab, items })) : undefined), [term, tab, online]);
  const { error, loading } = tab === "all" ? found : kind;
  const sugs = useAsync(() => (typing && query.trim() ? suggestions(query) : undefined), [typing && query]).data ?? [];
  // A Sleeve link pasted in opens what it's for.
  useEffect(() => {
    const view = fromLink(query);
    if (view) useStore.setState({ query: "" }), open(view);
  }, [query]);
  const go = (q: string) => (useStore.setState({ query: q }), setTerm(q), setTyping(false), addRecentSearch({ id: q.toLowerCase(), kind: "query", title: q }));
  const playFrom = (list: Track[]) => (i: number) => (rememberTrack(list[i]), play(list, i));
  const all = tab === "all" ? found.data : undefined;
  const list = kind.data?.tab === tab ? kind.data.items : undefined;
  const top = all?.top;
  // The first songs found get their titles as released (deezer.ts original).
  useEffect(() => void original((all?.songs ?? (tab === "songs" ? list : undefined) ?? []).slice(0, 10)), [all, list, tab]);

  return (
    <div className="animate-enter px-8 pt-14">
      <div className="relative" onBlur={() => setTyping(false)}>
        {/* The placeholder doubles as the page title. */}
        <input
          autoFocus
          value={query}
          onChange={(e) => (useStore.setState({ query: e.target.value }), setTyping(true), setPick(-1))}
          onKeyDown={(e) => {
            const n = typing ? sugs.length : 0;
            if (n && (e.key === "ArrowDown" || e.key === "ArrowUp")) e.preventDefault(), setPick((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1 + (i < 0 ? 1 : 0))) % n);
            else if (n && e.key === "Escape") e.stopPropagation(), setTyping(false);
            else if (e.key === "Enter" && query.trim()) go(sugs[pick] && typing ? sugs[pick] : query.trim());
          }}
          placeholder="Search"
          aria-label="Search"
          name="q"
          autoComplete="off"
          spellCheck={false}
          className="room w-full bg-transparent text-display outline-none placeholder:text-ink"
        />
        {typing && sugs.length > 0 && (
          <div role="listbox" className="absolute top-full left-0 z-50 mt-2 w-full max-w-xl overflow-hidden rounded-2xl bg-paper py-1.5 shadow-2xl ring-1 ring-ink/10">
            {sugs.slice(0, 8).map((s, i) => (
              <button key={s} role="option" aria-selected={i === pick} onMouseDown={(e) => (e.preventDefault(), go(s))} onMouseEnter={() => setPick(i)} className={`flex w-full items-center gap-3.5 px-4 py-2.5 text-left font-medium ${i === pick ? "bg-ink/[0.07]" : ""}`}>
                <SearchIcon size={15} className="shrink-0 text-muted" />
                <span className="truncate">{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {query ? (
        <div className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {Object.entries(TABS).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as keyof typeof TABS)} className={`press h-8 shrink-0 rounded-full px-4 text-sm font-semibold ${tab === id ? "bg-ink text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <>
          {recents.length > 0 && (
            <Section title="Recent Searches" action={<button onClick={() => useRecentSearches.setState({ items: [] })} className="press text-sm font-semibold text-muted hover:text-ink">Clear</button>}>
              <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
                {recents.map((r) => (
                  <div key={r.id} className="group relative w-36 shrink-0">
                    <button
                      onClick={() => (r.kind === "query" ? go(r.title) : r.kind === "artist" ? open({ name: "artist", id: r.id, by: r.title }) : r.kind === "album" ? open({ name: "collection", id: r.id }) : r.track && play([r.track], 0))}
                      className="press block w-full text-left"
                    >
                      <div className={`grid aspect-square place-items-center overflow-hidden bg-ink/[0.06] text-muted ${r.kind === "artist" ? "rounded-full" : "rounded-xl"}`}>
                        {r.thumb ? <img src={art(r.thumb, 300)} alt="" className="size-full object-cover" /> : <SearchIcon size={28} />}
                      </div>
                      <div className="mt-2 truncate font-semibold">{r.title}</div>
                      <div className="truncate text-sm text-muted">{r.subtitle ?? { query: "Search", artist: "Artist", album: "Album", track: "Song" }[r.kind]}</div>
                    </button>
                    <button
                      onClick={() => useRecentSearches.setState((s) => ({ items: s.items.filter((x) => x.id !== r.id) }))}
                      aria-label={`Remove ${r.title}`}
                      className="press absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section title="Browse All">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {([["Charts", "#0d73ec", () => open({ name: "charts" })], ["New Releases", "#e8115b", () => open({ name: "releases" })], ...genres.map(([name, colour]) => [name, colour, () => go(`${name} hits`)] as const)] as const).map(([name, colour, run]) => (
                <button key={name} onClick={run} style={{ background: colour }} className="press relative aspect-[16/10] overflow-hidden rounded-2xl p-4 text-left text-xl font-extrabold tracking-tight text-white hover:brightness-110">
                  {name}
                </button>
              ))}
            </div>
          </Section>
        </>
      )}
      {error && <p title={error} className="mt-6 text-muted">Search didn’t go through. Check your connection and try again.</p>}

      {term && (all || list) && (
        <div aria-busy={loading} className={`transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>
          {all ? (
            <>
              {top && (
                <button onClick={() => (addRecentSearch({ id: top.id, kind: "artist", title: top.name, thumb: top.thumb }), open({ name: "artist", id: top.id, by: top.name }))} {...warm(top)} className="group mt-10 flex items-center gap-6 text-left">
                  <div className="size-32 shrink-0 overflow-hidden rounded-full bg-ink/[0.06]">
                    <img src={art(top.thumb, 400)} alt="" className="size-full object-cover" />
                  </div>
                  <div>
                    <div className="text-5xl font-extrabold tracking-[-0.04em]">{top.name}</div>
                    <div className="mt-2 text-muted">{top.about}</div>
                  </div>
                </button>
              )}
              <Section title="Songs">
                <TrackList tracks={all.songs} onPlay={playFrom(all.songs)} />
              </Section>
              {all.albums.length > 0 && <Section title="Albums"><Albums items={all.albums} remember /></Section>}
              {all.artists.length > 0 && <Section title="Artists"><ArtistCards items={all.artists} remember /></Section>}
            </>
          ) : !list?.length ? (
            <p className="mt-8 text-muted">No {TABS[tab].toLowerCase()} found for “{term}”.</p>
          ) : (
            <div className="mt-6">
              {tab === "songs" || tab === "videos" ? <TrackList tracks={list} onPlay={playFrom(list)} /> : tab === "artists" ? <ArtistCards items={list} grid remember /> : <Albums items={list} grid remember />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const playCollection = (id: string) => collection(id).then((c) => play(c.tracks, 0), report);
const count = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

// Right-click menus are the OS's own. ponytail: Tauri-only; the web build needs an HTML fallback.
// Shown by lib.rs's popup, not Tauri's, which froze the app if the menu-bar icon changed while it was open.
export const popup = (items: Entry[]) => withIcons(items).then((items) => Menu.new({ items })).then((m) => invoke("popup", { rid: m.rid }), report);
// An item's icon is lucide's, drawn twice size (the menu's is 18pt) in the menu's text colour, as the OS doesn't tint it.
// Drawn once per look and kept; a menu of choices (sort order, a folder to pick) has none, like the OS's own.
type Entry = { icon?: LucideIcon; items?: Entry[]; [k: string]: unknown };
// A submenu is made first: Tauri reads an entry with an icon as a plain item, so an inline one with an icon lost its items.
const withIcons = (items: Entry[]): Promise<MenuOptions["items"]> => Promise.all(items.map(async ({ icon, items: sub, ...e }) => {
  const entry = { ...e, ...(icon && { icon: await drawIcon(icon) }) };
  return sub ? Submenu.new({ ...entry, items: await withIcons(sub) } as never) : entry;
})) as never;
const drawn = [new Map<LucideIcon, Promise<Uint8Array>>(), new Map<LucideIcon, Promise<Uint8Array>>()];
function drawIcon(Icon: LucideIcon) {
  const dark = +matchMedia("(prefers-color-scheme: dark)").matches, kept = drawn[dark].get(Icon);
  if (kept) return kept;
  const box = document.createElement("div"), root = createRoot(box);
  flushSync(() => root.render(<Icon size={32} strokeWidth={1.9} color={dark ? "rgb(255 255 255 / 0.85)" : "rgb(0 0 0 / 0.85)"} />));
  const svg = box.innerHTML;
  root.unmount();
  const png = new Promise<Uint8Array>((ok, no) => {
    const img = new Image(36, 36);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 36;
      c.getContext("2d")!.drawImage(img, 2, 2, 32, 32);
      c.toBlob((b) => (b ? b.arrayBuffer().then((a) => ok(new Uint8Array(a)), no) : no(Error("No icon"))), "image/png");
    };
    img.onerror = no;
    img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  });
  drawn[dark].set(Icon, png);
  return png;
}

// Anything that deletes asks first (Warning): what goes, and a red button that Return presses.
export const warn = (title: string, yes: string, then: () => void, text = "") => useStore.setState({ dialog: { kind: "warn", title, text, yes, then } });
const named = (ts: Track[]) => (ts.length === 1 ? `“${ts[0].title}”` : count(ts.length));
// The removals songs' menus and ⌘⌫ share.
const unlike = (ts: Track[]) => warn(`Remove ${named(ts)} from Liked Songs?`, "Remove", () => likeAll(ts, false));
const unlist = (id: string, at: number[], ts: Track[]) => warn(`Remove ${named(ts)} from “${useLibrary.getState().playlists.find((p) => p.id === id)?.name}”?`, "Remove", () => removeFromPlaylist(id, at));
const unsave = (key: string) => warn(`Remove “${useOffline.getState().lists[key]?.title}” from Downloads?`, "Remove", () => removeDownload(key), "Its songs will stream again, so they need the internet.");
const unfile = (ts: Track[]) => warn(`Remove ${named(ts)} from your library?`, "Remove", () => removeFiles(ts.map((t) => t.file!)), `${ts.length === 1 ? "The file stays" : "The files stay"} on your disk.`);

// from: the row is in one of your playlists, or in the queue (an index into the whole queue).
export function trackMenu(t: Track, from?: { playlist: string; index: number } | { queue: number }) {
  const { liked, playlists, hidden } = useLibrary.getState();
  const by = t.artists;
  const q = from && "queue" in from ? from.queue : -1;
  const { index, queue } = useStore.getState();
  popup([
    ...(q < 0
      ? [
          { text: "Play Next", icon: ListStart, action: () => enqueue([t], true) },
          { text: "Add to Queue", icon: ListEnd, action: () => enqueue([t], false) },
        ]
      : [
          ...(q > index + 1 ? [{ text: "Move Up", icon: ArrowUp, action: () => moveInQueue(q, q - 1) }] : []),
          ...(q < queue.length - 1 ? [{ text: "Move Down", icon: ArrowDown, action: () => moveInQueue(q, q + 1) }] : []),
          { text: "Remove from Queue", icon: ListX, action: () => removeFromQueue(q) },
        ]),
    ...(t.file ? [] : [{ text: "Start Radio", icon: Radio, action: () => startRadio(t) }, { text: "Wrong Version? Re-resolve", icon: RefreshCw, action: () => useStore.setState({ dialog: { kind: "versions", track: t } }) }]),
    ...(t.file
      ? [
          { text: "Edit Song Info…", icon: PencilLine, action: () => useStore.setState({ dialog: { kind: "songs", paths: [t.file!], editing: true } }) },
          { text: "Remove from Sleeve", icon: Trash2, action: () => unfile([t]) },
        ]
      : []),
    { text: "Edit Lyrics…", icon: MicVocal, action: () => editLyrics(t) },
    { item: "Separator" as const },
    likedAs(t, liked) ? { text: "Remove from Liked Songs", icon: HeartOff, action: () => unlike([t]) } : { text: "Add to Liked Songs", icon: Heart, action: () => toggleLike(t) },
    {
      text: "Add to Playlist",
      icon: ListPlus,
      items: [
        { text: "New Playlist", icon: Plus, action: () => open({ name: "playlist", id: newPlaylist([t]) }) },
        ...(playlists.length ? [{ item: "Separator" as const }] : []),
        ...playlists.map((p) => ({ text: p.name, icon: ListMusic, action: () => addToPlaylist(p.id, [t]) })),
      ],
    },
    ...(from && "playlist" in from ? [{ text: "Remove from This Playlist", icon: ListMinus, action: () => unlist(from.playlist, [from.index], [t]) }] : []),
    { text: hidden.some((x) => x.id === t.id) ? "Unhide Song" : "Hide Song", icon: hidden.some((x) => x.id === t.id) ? Eye : EyeOff, action: () => toggleHide(t) },
    ...(by.length ? [{ item: "Separator" as const }] : []),
    ...(by.length === 1 ? [{ text: `Go to ${by[0].name}`, icon: UserRound, action: () => goToArtist(by[0]) }] : by.length ? [{ text: "Go to Artist", icon: UserRound, items: by.map((a) => ({ text: a.name, icon: UserRound, action: () => goToArtist(a) })) }] : []),
    ...(t.album ? [{ text: "Go to Album", icon: Disc3, action: () => goToAlbum(t) }] : []),
  ]);
}

// Several songs picked in a list at once: what applies to all of them. at: their places in a playlist.
function tracksMenu(ts: Track[], playlist?: { id: string; at: number[] }) {
  const { liked, playlists } = useLibrary.getState();
  const allLiked = ts.every((t) => likedAs(t, liked));
  const files = ts.every((t) => t.file);
  popup([
    { text: "Play Next", icon: ListStart, action: () => enqueue(ts, true) },
    { text: "Add to Queue", icon: ListEnd, action: () => enqueue(ts, false) },
    ...(files ? [{ text: "Edit Song Info…", icon: PencilLine, action: () => useStore.setState({ dialog: { kind: "songs", paths: ts.map((t) => t.file!), editing: true } }) }] : []),
    { item: "Separator" as const },
    allLiked ? { text: "Remove from Liked Songs", icon: HeartOff, action: () => unlike(ts) } : { text: "Add to Liked Songs", icon: Heart, action: () => likeAll(ts, true) },
    {
      text: "Add to Playlist",
      icon: ListPlus,
      items: [
        { text: "New Playlist", icon: Plus, action: () => open({ name: "playlist", id: newPlaylist(ts) }) },
        ...(playlists.length ? [{ item: "Separator" as const }] : []),
        ...playlists.map((p) => ({ text: p.name, icon: ListMusic, action: () => addToPlaylist(p.id, ts) })),
      ],
    },
    ...(playlist ? [{ text: "Remove from This Playlist", icon: ListMinus, action: () => unlist(playlist.id, playlist.at, ts) }] : []),
    ...(files ? [{ text: "Remove from Sleeve", icon: Trash2, action: () => unfile(ts) }] : []),
  ]);
}

const albumMenu = (a: Album) =>
  popup([
    { text: "Play", icon: Play, action: () => playCollection(a.id) },
    { text: "Play Next", icon: ListStart, action: () => collection(a.id).then((c) => enqueue(c.tracks, true), report) },
    { text: "Add to Queue", icon: ListEnd, action: () => collection(a.id).then((c) => enqueue(c.tracks, false), report) },
    useLibrary.getState().saved.some((x) => x.id === a.id) ? { text: "Remove from Library", icon: CircleMinus, action: () => warn(`Remove “${a.title}” from your library?`, "Remove", () => toggleSave(a)) } : { text: "Add to Library", icon: CirclePlus, action: () => toggleSave(a) },
  ]);

const LIKED = "bg-linear-to-br from-[#ff375f] to-[#b80f3c]";
// A playlist with no artwork yet still gets its own colour, picked from its id.
const tints = ["from-[#ff375f] to-[#ff9f0a]", "from-[#0a84ff] to-[#30d158]", "from-[#bf5af2] to-[#ff375f]", "from-[#ff9f0a] to-[#ffd60a]", "from-[#5e5ce6] to-[#64d2ff]", "from-[#30d158] to-[#0a84ff]"];
const tint = (id: string) => `bg-linear-135 ${tints[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % tints.length]}`;
// A page's big title: set tight, so its letters hang past its lines; nothing around it clips them. It
// gets smaller the longer it is, so a long one takes two or three lines instead of running on.
const TITLE = "leading-[0.92] font-extrabold tracking-[-0.04em] text-balance break-words";
const titleSize = (text = "") => (text.length <= 16 ? "text-[clamp(36px,6.5cqw,80px)]" : text.length <= 32 ? "text-[clamp(32px,5cqw,64px)]" : "text-[clamp(28px,3.6cqw,46px)]");
const title = (text?: string) => `${TITLE} ${titleSize(text)}`;

// The top of every album and playlist page: cover and title over the artwork's own blur.
function Masthead({ cover, bg, fill = "bg-neutral-800", title, sub, meta, children }: { cover: ReactNode; bg?: string; fill?: string; title: ReactNode; sub?: ReactNode; meta: string; children: ReactNode }) {
  return (
    <header className="relative isolate overflow-hidden px-8 pt-20 pb-8 text-white [--color-ink:white]">
      {bg ? <img src={art(bg, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-150 object-cover blur-3xl saturate-150" /> : <div className={`absolute inset-0 -z-10 ${fill}`} />}
      <div className="absolute inset-0 -z-10 bg-linear-to-r from-black/70 via-black/45 to-black/20" />
      <div className="flex items-end gap-8">
        <div className="size-[clamp(150px,20cqw,232px)] shrink-0 overflow-hidden rounded-2xl bg-white/10 shadow-2xl shadow-black/40">{cover}</div>
        <div className="min-w-0 flex-1">
          {title}
          {sub && <div className="mt-3 truncate text-lg font-semibold">{sub}</div>}
          <div className="mt-1 truncate text-white/80">{meta}</div>
          <div className="mt-6 flex gap-2.5">{children}</div>
        </div>
      </div>
    </header>
  );
}

const pill = "press flex h-10 items-center gap-2 rounded-full px-5 font-semibold";
// radio false: no Radio button (Local Files: radio comes from YouTube Music, which doesn't have them).
// Play turns to Pause only on the list that started the queue, not on every list holding the song.
function PlayButtons({ tracks, from, radio = true }: { tracks: Track[]; from?: string; radio?: boolean }) {
  const here = useStore((s) => !!from && s.source === from && s.index >= 0);
  const { paused } = useAudio();
  const pausing = here && !paused;
  return (
    <>
      <button onClick={() => (here ? toggle() : play(tracks, firstPlayable(tracks), from))} disabled={!tracks.length} className={`${pill} bg-white text-black hover:bg-white/85 disabled:opacity-50`}>
        {pausing ? <Pause size={16} className="fill-current" /> : <Play size={16} className="fill-current" />} {pausing ? "Pause" : "Play"}
      </button>
      <button onClick={() => shufflePlay(tracks, from)} disabled={!tracks.length} className={`${pill} bg-white/20 hover:bg-white/30 disabled:opacity-50`}>
        <Shuffle size={16} /> Shuffle
      </button>
      {radio && (
        <button onClick={() => radioFrom(tracks, from)} disabled={!tracks.length} aria-label="Radio" title="Radio" className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-50">
          <Radio size={16} />
        </button>
      )}
    </>
  );
}

// Download a list to play offline (offline.ts): an arrow; while it downloads, a ring filling up; once it's
// all here, a solid arrow, which offers to remove it. about: what to keep with it, asked for on the press.
function DownloadButton({ id, about }: { id: string; about: () => Parameters<typeof download>[1] }) {
  const state = useOffline();
  useLibrary((l) => l.playlists), useLibrary((l) => l.liked); // a playlist growing moves the ring back
  if (!canDownload) return null;
  const p = progress(id, state);
  const label = !p ? "Download" : p.done ? "Downloaded" : `Downloading, ${p.saved} of ${p.total}`;
  return (
    <button onClick={() => (p ? popup([{ text: "Remove Download", action: () => unsave(id) }]) : download(id, about()))} aria-label={label} title={label} aria-haspopup={p ? "menu" : undefined} className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30">
      {!p ? (
        <ArrowDownToLine size={18} />
      ) : p.done ? (
        <CircleArrowDown size={24} strokeWidth={2.2} className="fill-white text-black/75" />
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden className="size-5 -rotate-90">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(p.total ? p.saved / p.total : 0) * 50.3} 50.3`} className="transition-[stroke-dasharray] duration-300" />
        </svg>
      )}
    </button>
  );
}

const Skeleton = ({ className }: { className: string }) => (
  <div role="status" className={`animate-pulse ${className}`}>
    <span className="sr-only">Loading…</span>
  </div>
);

// YT Music's own start page, artwork first, with what you played lately under its big card.
export function Home() {
  return (
    <div className="animate-enter px-8 pt-14">
      <h1 className="text-display">Home</h1>
      <Shelves>
        <RecentlyPlayed />
        <OnThisDay />
      </Shelves>
    </div>
  );
}

// Read from this Mac, so it's there at once, and offline.
function RecentlyPlayed() {
  const recent = useHistory((s) => s.recent);
  if (!recent.length) return null;
  return (
    <Section title="Recently Played" action={<button onClick={() => open({ name: "history" })} className="press text-sm font-semibold text-muted hover:text-ink">History</button>}>
      <TrackGrid tracks={recent.slice(0, 20)} />
    </Section>
  );
}

// What you played on this day a year ago, or that week if the day itself was quiet; five songs or more.
function OnThisDay() {
  const [tracks, setTracks] = useState<Track[]>([]);
  useEffect(() => {
    const d = new Date(), day = (n: number) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() + n).getTime();
    const week: PlayRow[] = [];
    let live = true;
    void plays((p) => (p.at < day(4) && p.at >= day(-3) && week.push(p), p.at >= day(-3))).finally(() => {
      const exact = week.filter((p) => p.at >= day(0) && p.at < day(1));
      const list = [...new Map((exact.length >= 5 ? exact : week).map((p) => [p.t.id, p.t])).values()];
      if (live) setTracks(list.length >= 5 ? list : []);
    });
    return () => void (live = false);
  }, []); // a year ago doesn't change as you play
  if (!tracks.length) return null;
  return (
    <Section title="On This Day">
      <TrackGrid tracks={tracks} />
    </Section>
  );
}

// children go under the big card, or above the page while it loads or if it can't.
function Shelves({ children }: { children?: ReactNode }) {
  const online = useOnline();
  const [tries, setTries] = useState(0);
  const { data: fresh, error } = useAsync(home, [online, tries]);
  const data = fresh ?? lastHome;
  if (!data && error)
    return (
      <>
        <div className="mt-6 flex items-center gap-4">
          <p className="text-muted">Couldn’t load your start page. Search still works.</p>
          <button onClick={() => setTries((n) => n + 1)} className="press h-9 rounded-full bg-ink/[0.07] px-4 text-sm font-semibold hover:bg-ink/[0.12]">
            Try Again
          </button>
        </div>
        {children}
      </>
    );
  if (!data)
    return (
      <>
        {children}
        <div role="status" className="animate-pulse">
          <span className="sr-only">Loading…</span>
          <div className="mt-8 h-[clamp(260px,38vh,380px)] rounded-3xl bg-ink/[0.05]" />
          <div className="mt-12 h-56 rounded-2xl bg-ink/[0.04]" />
        </div>
      </>
    );

  // The first album or playlist on the page gets the big card instead of a spot on its shelf.
  const heroShelf = data.find((s) => s.albums.length);
  const hero = heroShelf?.albums[0];
  return (
    <div className="animate-enter">
      {hero && (
        <div className="group relative isolate mt-8 flex h-[clamp(260px,38vh,380px)] items-center overflow-hidden rounded-3xl text-white">
          <button onClick={() => open({ name: "collection", id: hero.id })} aria-label={`Open ${hero.title}`} className="hit" />
          <img src={art(hero.thumb, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-150 object-cover blur-3xl saturate-150" />
          <div className="absolute inset-0 -z-10 bg-linear-to-r from-black/60 via-black/30 to-black/0" />
          <div className="pointer-events-none min-w-0 flex-1 p-8 @4xl:p-10">
            <h2 className={`${TITLE} ${hero.title.length <= 24 ? "text-[clamp(36px,6cqw,76px)]" : "text-[clamp(30px,4.2cqw,54px)]"}`}>{hero.title}</h2>
            <div className="mt-3 truncate text-lg text-white/80">{hero.by}</div>
            <button onClick={() => playCollection(hero.id)} className={`${pill} pointer-events-auto mt-6 inline-flex bg-white text-black hover:bg-white/85`}>
              <Play size={16} className="fill-current" /> Play
            </button>
          </div>
          <img src={art(hero.thumb, 900)} alt="" className="pointer-events-none mr-8 aspect-square h-[78%] shrink-0 rounded-2xl object-cover shadow-2xl shadow-black/40 @4xl:mr-10" />
        </div>
      )}
      {children}
      {data.map((shelf, i) => {
        const albums = shelf === heroShelf ? shelf.albums.slice(1) : shelf.albums;
        if (!shelf.tracks.length && !albums.length) return null;
        return (
          <Section key={i} title={shelf.title}>
            {shelf.tracks.length > 0 && <TrackGrid tracks={shelf.tracks} numbered={/trend|chart/i.test(shelf.title)} />}
            {albums.length > 0 && <Albums items={albums} />}
          </Section>
        );
      })}
    </div>
  );
}

// An album or playlist on YouTube Music.
// A downloaded one opens from what was kept with it while offline, or if YouTube Music doesn't answer.
export function CollectionPage({ id }: { id: string }) {
  const online = useOnline();
  const kept = useOffline((s) => s.lists[libraryKey("album", id)]?.collection);
  const { data: fresh, error } = useAsync(() => (online || !kept ? collection(id) : undefined), [id, online]);
  const { data: guests } = useAsync(() => (fresh && isDeezer(id) ? withGuests(fresh.tracks) : undefined), [fresh]);
  useEffect(() => void (fresh && isAlbum(id) && original(fresh.tracks)), [fresh]); // one artist, so a call or two
  const page = fresh && guests ? { ...fresh, tracks: guests } : (fresh ?? kept);
  const liked = useLibrary((s) => s.liked);
  // Songs you like keep the names you know them by (Spotify's "Она не я", not "Ona ne ya"), and play this copy.
  const tracks = page?.tracks.map((t) => ((m) => (m && m.title !== t.title ? { ...t, title: m.title } : t))(likedAs(t, liked)));
  const data = page && tracks && { ...page, tracks, by: [page.by ?? []].flat() }; // kept before an album's artists were a list
  const saved = useLibrary((s) => s.saved.some((a) => a.id === id));
  const [query, setQuery] = useState("");
  if (!data && error) return <p className="px-8 pt-20 text-muted">Couldn’t open this. Go back and try again.</p>;
  if (!data) return <Skeleton className="h-[380px] bg-ink/[0.04]" />;
  const album = isAlbum(id);
  const q = query.trim();
  const shown = q ? data.tracks.filter((t) => matches(t, q)) : data.tracks;

  return (
    <div className="animate-enter">
      <Masthead
        cover={<img src={art(data.thumb, 600)} alt="" className="size-full object-cover" />}
        bg={data.thumb}
        title={<h1 className={title(data.title)}>{data.title}</h1>}
        sub={data.by.length > 0 && <Artists list={data.by} />}
        meta={[data.kind, ...data.meta].filter(Boolean).join(" · ")}
      >
        <PlayButtons tracks={shown} from={libraryKey("album", id)} />
        <DownloadButton id={libraryKey("album", id)} about={() => (!saved && toggleSave({ id, title: data.title, by: data.by.map((a) => a.name).join(", "), thumb: data.thumb }), { title: data.title, thumb: data.thumb, collection: data })} />
        <button onClick={() => toggleSave({ id, title: data.title, by: data.by.map((a) => a.name).join(", "), thumb: data.thumb })} aria-pressed={saved} className={`${pill} bg-white/20 px-4 hover:bg-white/30`}>
          {saved ? <Check size={16} strokeWidth={2.6} /> : <Plus size={16} strokeWidth={2.6} />} {saved ? "Saved" : "Save"}
        </button>
      </Masthead>
      <div className="px-8">
        {data.about && <p className="mt-6 line-clamp-2 max-w-2xl text-[15px] leading-relaxed text-ink/65">{data.about}</p>}
        {data.tracks.length > 5 && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <PlaylistSearch value={query} onChange={setQuery} label={album ? "Search in Album" : "Search in Playlist"} />
          </div>
        )}
        <div className="mt-2">
          {shown.length ? (
            <TrackList tracks={shown} numbered={album} plain={album} from={libraryKey("album", id)} />
          ) : (
            <p className="py-8 text-muted">No songs match “{q}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Your library: Liked Songs, your playlists and folders, the albums and playlists you saved, the artists
// you follow. Filter it by kind, search it, order it, see it as a grid or a list; pinned things stay on
// top, and Liked Songs is always first (the big card, or the first item). Songs lists Liked Songs.
export function Library() {
  const library = useLibrary();
  const recents = useRecents();
  const { libraryView: view, librarySort: sort, libraryFilter: filter } = useSettings();
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase();
  const hero = view === "grid" && !filter && !q;
  const local = useLocal((s) => (s.folders.length ? Object.keys(s.files).length : -1));
  const lists = useOffline((s) => s.lists);
  const items = useMemo(() => libraryItems(library, recents, sort, filter, q, local, lists).filter((i) => !(hero && i.kind === "liked")), [library, recents, sort, filter, q, hero, local, lists]);
  const songs = useMemo(() => (filter === "songs" ? sorted(library.liked, SONG_ORDER[sort]).filter((r) => !q || matches(r.t, q)) : []), [library.liked, filter, sort, q]);
  useEffect(() => void (filter === "songs" && fillIn(library.liked)), [filter, library.liked]);
  const set = useSettings.setState;
  const chip = (on: boolean) => `press h-8 rounded-full px-3.5 text-sm font-semibold transition-colors ${on ? "bg-ink text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`;

  return (
    <div className="animate-enter px-8 pt-14">
      <h1 className="text-display">Library</h1>
      {hero && <LikedHero liked={library.liked} />}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map(([f, label]) => (
            <button key={f} role="radio" aria-checked={filter === f} onClick={() => set({ libraryFilter: filter === f ? undefined : f })} className={chip(filter === f)}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <label className="flex h-8 w-44 items-center gap-2 rounded-full bg-ink/[0.07] px-3 focus-within:bg-ink/[0.1] @3xl:w-56">
            <SearchIcon size={15} className="shrink-0 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Search in Library" aria-label="Search in Library" data-find autoComplete="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
          </label>
          <button onClick={() => popup(LIBRARY_SORTS.map(([s, label]) => ({ text: filter === "songs" ? SONG_SORT_LABEL[s] : label, checked: sort === s, action: () => set({ librarySort: s }) })))} aria-label={`Order: ${LIBRARY_SORTS.find(([s]) => s === sort)?.[1]}`} title="Order" className={`${round2} w-auto gap-1.5 px-3 text-sm font-semibold`}>
            <ArrowUpDown size={15} /> <span className="hidden @3xl:inline">{filter === "songs" ? SONG_SORT_LABEL[sort] : LIBRARY_SORTS.find(([s]) => s === sort)?.[1]}</span>
          </button>
          <button onClick={() => set({ libraryView: view === "grid" ? "list" : "grid" })} aria-label={view === "grid" ? "Show as List" : "Show as Grid"} title={view === "grid" ? "Show as List" : "Show as Grid"} className={round2}>
            {view === "grid" ? <List size={17} /> : <LayoutGrid size={16} />}
          </button>
          <button onClick={() => open({ name: "wrapped" })} aria-label="Wrapped" title="Wrapped" className={round2}>
            <Sparkle size={17} />
          </button>
          <button onClick={() => open({ name: "history" })} aria-label="History" title="History" className={round2}>
            <HistoryIcon size={17} />
          </button>
          <button onClick={() => popup([{ text: "New Playlist", icon: Plus, action: () => open({ name: "playlist", id: newPlaylist() }) }, { text: "New Folder", icon: FolderPlus, action: () => open({ name: "folder", id: newFolder() }) }, { text: "Import from Link…", icon: Link, action: () => useStore.setState({ dialog: { kind: "link" } }) }, ...(canHaveFiles ? [{ text: "Import from Spotify…", icon: Import, action: () => useStore.setState({ dialog: { kind: "spotify" } }) }] : [])])} aria-label="New" title="New Playlist or Folder" className={round2}>
            <Plus size={18} />
          </button>
        </div>
      </div>
      {filter === "songs" ? (
        songs.length ? <div className="mt-2"><TrackList tracks={songs.map((r) => r.t)} from="liked" added /></div> : <p className="mt-6 text-muted">{q ? "No liked songs match." : "Tap the heart on any song and it lands here."}</p>
      ) : items.length ? (
        <LibraryItems items={items} view={view} />
      ) : (
        <p className="mt-6 text-muted">{q ? "Nothing in your library matches." : filter === "artists" ? "Follow an artist and they land here." : filter === "albums" ? "Save an album and it lands here." : filter === "downloaded" ? "Download a playlist or album and it plays without a connection." : "Make a playlist with the + button, or save one."}</p>
      )}
    </div>
  );
}

const round2 = "press flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/[0.07] hover:text-ink";
const FILTERS = [["playlists", "Playlists"], ["albums", "Albums"], ["artists", "Artists"], ["songs", "Songs"], ...(canDownload ? ([["downloaded", "Downloaded"]] as const) : [])] as const;
const LIBRARY_SORTS = [["recents", "Recents"], ["added", "Recently Added"], ["name", "Alphabetical"], ["creator", "Creator"]] as const;
// Songs order by the same setting, read for songs.
const SONG_ORDER: Record<LibrarySort, TrackSort> = { recents: "custom", added: "custom", name: "title", creator: "artist" };
const SONG_SORT_LABEL: Record<LibrarySort, string> = { recents: "Recently Added", added: "Recently Added", name: "Title", creator: "Artist" };

// The big Liked Songs card, with the latest likes stacked like sleeves pulled from a crate.
function LikedHero({ liked }: { liked: Track[] }) {
  return (
    <div className={`group relative isolate mt-8 flex min-h-[clamp(230px,30vh,320px)] items-end overflow-hidden rounded-3xl p-8 text-white @4xl:p-10 ${LIKED}`}>
      <button onClick={() => open({ name: "playlist", id: "liked" })} aria-label="Open Liked Songs" className="hit" />
      <div className="pointer-events-none min-w-0 flex-1">
        <Heart className="size-9 fill-white" strokeWidth={0} />
        <h2 className="mt-4 text-[clamp(36px,6cqw,76px)] leading-[0.92] font-extrabold tracking-[-0.04em]">Liked Songs</h2>
        <div className="mt-2 text-lg text-white/80">{liked.length ? count(liked.length) : "Tap the heart on any song."}</div>
        {liked.length > 0 && (
          <button onClick={() => play(liked, firstPlayable(liked), "liked")} className={`${pill} pointer-events-auto mt-6 bg-white text-black hover:bg-white/85`}>
            <Play size={16} className="fill-current" /> Play
          </button>
        )}
      </div>
      <div className="pointer-events-none absolute top-1/2 right-8 hidden -translate-y-1/2 @3xl:flex @4xl:right-10">
        {liked.slice(0, 4).map((t, i) => (
          <img
            key={t.id}
            src={art(t.thumb, 400)}
            alt=""
            style={{ zIndex: 4 - i, rotate: `${i * 4 - 3}deg` }}
            className="-ml-24 size-[clamp(130px,18vh,190px)] rounded-xl object-cover shadow-2xl shadow-black/40 transition-[rotate] duration-300 ease-(--ease-out) first:ml-0 group-hover:rotate-0"
          />
        ))}
      </div>
    </div>
  );
}

// One thing in the library, as the Library page and a folder's page show it.
type Item = { key: string; kind: LibraryKind; id: string; title: string; sub: string; at: number; creator: string; folder?: string };
const isAlbum = (id: string) => id.startsWith("MPRE") || id.startsWith("dz:album:");

// What the Library shows for a filter and search, pinned first (Liked Songs before all), then in order.
// Searching looks inside folders too. at: when it was added; things saved before Sleeve kept the time
// keep their old order.
// local: how many songs Local Files has, or -1 when you've added no folders (and it isn't shown).
// downloaded: the keys of what's downloaded (offline.ts).
function libraryItems(l: LibraryData, recents: Record<string, number>, sort: LibrarySort, filter: LibraryFilter | undefined, q: string, local = -1, downloaded: Record<string, unknown> = {}): Item[] {
  const folders = new Set(l.folders.map((f) => f.id));
  const all: Item[] = [
    { key: "liked", kind: "liked", id: "liked", title: "Liked Songs", sub: `Playlist · ${count(l.liked.length)}`, at: Infinity, creator: "" },
    ...(local >= 0 ? [{ key: "local", kind: "local" as const, id: "local", title: "Local Files", sub: `On this Mac · ${count(local)}`, at: 0, creator: "" }] : []),
    ...l.folders.map((f, i) => ({ key: libraryKey("folder", f.id), kind: "folder" as const, id: f.id, title: f.name, sub: `Folder · ${plural(l.playlists.filter((p) => p.folder === f.id).length, "playlist")}`, at: f.at ?? i, creator: "" })),
    ...l.playlists.map((p, i) => ({ key: libraryKey("playlist", p.id), kind: "playlist" as const, id: p.id, title: p.name, sub: `Playlist · ${count(p.tracks.length)}`, at: p.at ?? i, creator: "", folder: p.folder && folders.has(p.folder) ? p.folder : undefined })),
    ...l.saved.map((a, i) => ({ key: libraryKey("album", a.id), kind: "album" as const, id: a.id, title: a.title, sub: `${isAlbum(a.id) ? "Album" : "Playlist"}${a.by ? ` · ${a.by}` : ""}`, at: a.at ?? -i, creator: a.by ?? "" })),
    ...l.followed.map((a, i) => ({ key: libraryKey("artist", a.id), kind: "artist" as const, id: a.id, title: a.name, sub: "Artist", at: a.at ?? -i, creator: a.name })),
  ];
  const kinds: Record<LibraryFilter, (i: Item) => boolean> = {
    playlists: (i) => i.kind === "liked" || i.kind === "local" || i.kind === "folder" || i.kind === "playlist" || (i.kind === "album" && !isAlbum(i.id)),
    albums: (i) => i.kind === "album" && isAlbum(i.id),
    artists: (i) => i.kind === "artist",
    songs: () => false,
    downloaded: (i) => i.key in downloaded,
  };
  const order: Record<LibrarySort, (a: Item, b: Item) => number> = {
    recents: (a, b) => Math.max(recents[b.key] ?? 0, b.at) - Math.max(recents[a.key] ?? 0, a.at),
    added: (a, b) => b.at - a.at,
    name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    creator: (a, b) => a.creator.localeCompare(b.creator, undefined, { sensitivity: "base" }) || a.title.localeCompare(b.title),
  };
  const pin = (i: Item) => (i.kind === "liked" ? -1 : l.pinned.indexOf(i.key) + 1 || Infinity);
  return all
    .filter((i) => (q ? fold(`${i.title} ${i.sub}`).includes(fold(q)) : !i.folder) && (!filter || kinds[filter](i)))
    .sort((a, b) => pin(a) - pin(b) || order[sort](a, b));
}

// Items as a grid of covers or a list of rows. Playlists drag onto folders.
function LibraryItems({ items, view }: { items: Item[]; view: "grid" | "list" }) {
  const pinned = useLibrary((s) => s.pinned);
  const [over, setOver] = useState<string>();
  return (
    <ul className={view === "grid" ? "mt-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6" : "mt-2"}>
      {items.map((item) => {
        const drop = item.kind === "folder";
        return (
          <li
            key={item.key}
            draggable={item.kind === "playlist"}
            onDragStart={(e) => (e.dataTransfer.setData("sleeve/playlist", item.id), (e.dataTransfer.effectAllowed = "move"))}
            onDragOver={(e) => drop && e.dataTransfer.types.includes("sleeve/playlist") && (e.preventDefault(), setOver(item.key))}
            onDragLeave={() => setOver(undefined)}
            onDrop={(e) => (setOver(undefined), drop && moveToFolder(e.dataTransfer.getData("sleeve/playlist"), item.id))}
            onContextMenu={(e) => (e.preventDefault(), itemMenu(item))}
            className={`group relative rounded-xl transition-[background-color,box-shadow] ${view === "list" ? "flex items-center gap-3 p-2 hover:bg-ink/[0.04]" : ""} ${over === item.key ? "bg-accent/15 shadow-[0_0_0_2px_var(--color-accent)]" : ""}`}
          >
            <button onClick={() => open(itemView(item))} aria-label={`Open ${item.title}`} className="hit" />
            <div className={`pointer-events-none relative shrink-0 overflow-hidden bg-ink/[0.06] ${item.kind === "artist" ? "rounded-full" : view === "grid" ? "rounded-xl" : "rounded-lg"} ${view === "grid" ? "aspect-square w-full shadow-sm" : "size-12"}`}>
              <ItemCover item={item} />
            </div>
            <div className={`pointer-events-none min-w-0 ${view === "grid" ? "mt-2.5" : "flex-1"}`}>
              <div className="truncate font-semibold">{item.title}</div>
              <div className="flex items-center gap-1 truncate text-sm text-muted">
                {(item.kind === "liked" || pinned.includes(item.key)) && <Pin size={13} aria-label="Pinned" className="shrink-0 fill-accent text-accent" />}
                {item.sub}
              </div>
            </div>
            {item.kind !== "folder" && (
              <button
                onClick={() => void itemTracks(item).then((t) => (t.length ? play(t, firstPlayable(t), item.key) : notify({ text: "Nothing to Play", detail: item.title })), report)}
                aria-label={`Play ${item.title}`}
                className={`grid place-items-center rounded-full bg-accent text-paper shadow-lg shadow-black/25 transition-[opacity,translate,scale] duration-200 ease-(--ease-out) group-hover:opacity-100 focus-visible:opacity-100 active:scale-95 ${
                  view === "grid" ? "absolute right-2 bottom-[62px] size-11 translate-y-1 opacity-0 group-hover:translate-y-0" : "relative size-9 shrink-0 opacity-0"
                }`}
              >
                <Play size={view === "grid" ? 18 : 15} className="ml-0.5 fill-current" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const itemView = (i: Item): View => (i.kind === "liked" ? { name: "playlist", id: "liked" } : i.kind === "album" ? { name: "collection", id: i.id } : i.kind === "local" ? { name: "local" } : { name: i.kind, id: i.id, ...(i.kind === "artist" && { by: i.title }) });

// An item's songs, to play from its card: your own lists at once, the rest from YouTube Music.
async function itemTracks(i: Item): Promise<Track[]> {
  const l = useLibrary.getState();
  if (i.kind === "liked") return l.liked;
  if (i.kind === "local") return localTracks();
  if (i.kind === "playlist") return l.playlists.find((p) => p.id === i.id)?.tracks ?? [];
  if (i.kind === "folder") return l.playlists.filter((p) => p.folder === i.id).flatMap((p) => p.tracks);
  if (i.kind === "artist") return (await loadArtist(i.id).full).songs;
  return (await collection(i.id)).tracks;
}

function ItemCover({ item }: { item: Item }) {
  const l = useLibrary();
  if (item.kind === "liked") return <PlaylistCover id="liked" tracks={[]} />;
  if (item.kind === "local") return <LocalCover />;
  if (item.kind === "playlist") {
    const p = l.playlists.find((x) => x.id === item.id);
    return <PlaylistCover id={item.id} tracks={p?.tracks ?? []} cover={p?.cover} />;
  }
  if (item.kind === "folder") return <FolderCover id={item.id} />;
  if (item.kind === "artist") {
    const thumb = l.followed.find((a) => a.id === item.id)?.thumb;
    return thumb ? <img src={artistArt(thumb)} alt="" loading="lazy" className="size-full object-cover object-[50%_25%]" /> : <div className={`size-full ${tint(item.id)}`} />;
  }
  return <img src={art(l.saved.find((a) => a.id === item.id)?.thumb, 400)} alt="" loading="lazy" className="size-full object-cover" />;
}
// An artist's picture is their page's banner: asked for wide, so a circle cut from it stays sharp.
const artistArt = (u: string) => art(u, 640, 267);

// A folder's cover: its first four playlists' covers, or a folder on its own colour.
function FolderCover({ id }: { id: string }) {
  const inside = useLibrary((s) => s.playlists).filter((p) => p.folder === id).slice(0, 4);
  if (inside.length === 4)
    return (
      <div className="grid size-full grid-cols-2">
        {inside.map((p) => <PlaylistCover key={p.id} id={p.id} tracks={p.tracks} cover={p.cover} small />)}
      </div>
    );
  return (
    <div className={`grid size-full place-items-center text-white/85 ${tint(id)}`}>
      <FolderIcon className="size-1/3" strokeWidth={1.5} />
    </div>
  );
}

// Right-click on a library item.
function itemMenu(i: Item) {
  const l = useLibrary.getState();
  const pinned = l.pinned.includes(i.key);
  const folder = l.playlists.find((p) => p.id === i.id)?.folder;
  popup([
    ...(i.kind !== "folder" ? [{ text: "Play", action: () => void itemTracks(i).then((t) => play(t, firstPlayable(t), i.key), report) }] : []),
    ...(i.kind !== "liked" ? [{ text: pinned ? "Unpin" : "Pin to Top", action: () => togglePin(i.key) }] : []),
    { item: "Separator" as const },
    ...(i.kind === "playlist"
      ? [
          {
            text: "Move to Folder",
            icon: FolderInput,
            items: [
              { text: "New Folder", action: () => void newFolder([i.id]) },
              ...(l.folders.length ? [{ item: "Separator" as const }] : []),
              ...l.folders.map((f) => ({ text: f.name, checked: folder === f.id, action: () => moveToFolder(i.id, f.id) })),
              ...(folder ? [{ item: "Separator" as const }, { text: "Remove from Folder", action: () => moveToFolder(i.id) }] : []),
            ],
          },
          { text: "Duplicate", icon: Copy, action: () => void duplicatePlaylist(i.id) },
          { text: "Delete Playlist", icon: Trash2, action: () => warn(`Delete “${i.title}”?`, "Delete", () => deletePlaylist(i.id)) },
        ]
      : []),
    ...(i.kind === "folder" ? [{ text: "Delete Folder", icon: Trash2, action: () => warn(`Delete “${i.title}”?`, "Delete", () => deleteFolder(i.id), "Its playlists stay in your library.") }] : []),
    ...(i.kind === "album" ? [{ text: "Remove from Library", icon: CircleMinus, action: () => warn(`Remove “${i.title}” from your library?`, "Remove", () => toggleSave({ id: i.id, title: i.title })) }] : []),
    ...(i.kind === "artist" ? [{ text: "Unfollow", icon: UserMinus, action: () => toggleFollow({ id: i.id, name: i.title }) }] : []),
  ]);
}

function PlaylistCover({ id, tracks, cover, small }: { id: string; tracks: Track[]; cover?: string; small?: boolean }) {
  if (id === "liked")
    return (
      <div className={`grid size-full place-items-center ${LIKED}`}>
        <Heart className="size-[36%] fill-white text-white" strokeWidth={0} />
      </div>
    );
  if (cover) return <img src={cover} alt="" className="size-full object-cover" />;
  const thumbs = [...new Set(tracks.map((t) => t.thumb).filter(Boolean))].slice(0, small ? 1 : 4);
  if (thumbs.length === 4)
    return (
      <div className="grid size-full grid-cols-2">
        {thumbs.map((src) => <img key={src} src={art(src, 300)} alt="" className="size-full object-cover" />)}
      </div>
    );
  if (thumbs[0]) return <img src={art(thumbs[0], small ? 300 : 600)} alt="" className="size-full object-cover" />;
  return (
    <div className={`grid size-full place-items-center text-white/85 ${tint(id)}`}>
      <Music className="size-1/3" strokeWidth={1.5} />
    </div>
  );
}

// How a list of songs can be ordered. Custom is the list's own order (for Liked Songs, newest first).
const secs = (d?: string) => d?.split(":").reduce((s, n) => s * 60 + +n, 0) ?? 0;
const byText = (f: (t: Track) => string | undefined) => (a: Track, b: Track) => (f(a) ?? "").localeCompare(f(b) ?? "", undefined, { sensitivity: "base" });
const TRACK_SORTS: Record<TrackSort, { label: string; cmp?: (a: Track, b: Track) => number }> = {
  custom: { label: "Custom Order" },
  added: { label: "Date Added", cmp: (a, b) => (b.at ?? 0) - (a.at ?? 0) },
  title: { label: "Title", cmp: byText((t) => t.title) },
  artist: { label: "Artist", cmp: byText((t) => t.artists[0]?.name) },
  album: { label: "Album", cmp: byText((t) => t.album) },
  duration: { label: "Duration", cmp: (a, b) => secs(a.duration) - secs(b.duration) },
};
// The songs in the order sort shows them, each with its place in the list it's kept in.
function sorted(tracks: Track[], sort: TrackSort) {
  const rows = tracks.map((t, i) => ({ t, i }));
  const cmp = TRACK_SORTS[sort].cmp;
  return cmp ? rows.sort((a, b) => cmp(a.t, b.t) || a.i - b.i) : rows;
}

// custom: what Custom Order is called where the list's own order means something else (and there's then
// no Date Added to offer): Liked Songs' newest first, Local Files' by artist and album.
function SortSelect({ value, onChange, custom }: { value: TrackSort; onChange: (s: TrackSort) => void; custom?: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value as TrackSort)} aria-label="Order" className="press h-8 appearance-none rounded-full bg-ink/[0.07] pr-8 pl-3.5 text-sm font-semibold outline-none hover:bg-ink/[0.12] focus-visible:outline-2 focus-visible:outline-accent">
        {(Object.keys(TRACK_SORTS) as TrackSort[]).filter((s) => !(custom && s === "added")).map((s) => (
          <option key={s} value={s}>{custom && s === "custom" ? custom : TRACK_SORTS[s].label}</option>
        ))}
      </select>
      <ChevronDown size={15} aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
    </div>
  );
}

// A search button that opens into a field, as in Spotify's playlists; Escape clears it, then closes it.
function PlaylistSearch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [shown, setShown] = useState(!!value);
  if (!shown && !value)
    return <button data-find onClick={() => setShown(true)} aria-label={label} title={label} className={round2}><SearchIcon size={16} /></button>;
  return (
    <label className="flex h-8 w-56 animate-enter items-center gap-1.5 rounded-full bg-ink/[0.07] px-2.5">
      <SearchIcon size={14} className="shrink-0 text-muted" />
      <input
        data-find
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), value ? onChange("") : setShown(false))}
        onBlur={() => !value && setShown(false)}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
    </label>
  );
}

// Liked Songs, or one of your playlists: rename it, describe it, give it your own cover, order it, drag
// its songs about (in Custom Order), duplicate it, file it in a folder.
export function PlaylistPage({ id }: { id: string }) {
  const liked = useLibrary((s) => s.liked);
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const likedSort = useSettings((s) => s.likedSort);
  const pinned = useLibrary((s) => s.pinned.includes(libraryKey("playlist", id)));
  const folder = useLibrary((s) => s.folders.find((f) => f.id === playlist?.folder));
  const signedIn = useAccount((s) => !!s.user);
  const file = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const tracks = playlist?.tracks ?? liked;
  useEffect(() => fillIn(tracks), [tracks]); // albums, lengths and artists some songs came without
  const sort = (playlist ? playlist.sort : likedSort) ?? "custom";
  const rows = useMemo(() => {
    const list = sorted(tracks, sort);
    const q = query.trim();
    return q ? list.filter((r) => matches(r.t, q)) : list;
  }, [tracks, sort, query]);
  if (id !== "liked" && !playlist) return <p className="px-8 pt-20 text-muted">This playlist was deleted.</p>;
  const from = playlist ? libraryKey("playlist", id) : "liked";
  const shown = rows.map((r) => r.t);
  const more = () =>
    popup([
      { text: pinned ? "Unpin" : "Pin to Top", action: () => togglePin(from) },
      { text: "Choose Cover Image…", action: () => file.current?.click() },
      ...(playlist?.cover ? [{ text: "Remove Cover Image", action: () => warn("Remove the cover image?", "Remove", () => setCover(id)) }] : []),
      { item: "Separator" as const },
      {
        text: "Move to Folder",
        icon: FolderInput,
        items: [
          { text: "New Folder", action: () => void newFolder([id]) },
          ...useLibrary.getState().folders.map((f) => ({ text: f.name, checked: playlist?.folder === f.id, action: () => moveToFolder(id, f.id) })),
          ...(playlist?.folder ? [{ item: "Separator" as const }, { text: "Remove from Folder", action: () => moveToFolder(id) }] : []),
        ],
      },
      { text: "Duplicate", icon: Copy, action: () => open({ name: "playlist", id: duplicatePlaylist(id)! }) },
      // Sharing needs an account: the link is to your copy on the server.
      ...(playlist && signedIn
        ? [
            { item: "Separator" as const },
            { text: "Copy Link", icon: Link, action: () => (playlist.public || setPublic(id, true), copyLink(playlistLink(id), playlist.public ? undefined : "Anyone with it can see this playlist")) },
            ...(playlist.public ? [{ text: "Make Private", icon: Lock, action: () => setPublic(id, false) }] : []),
          ]
        : []),
      { item: "Separator" as const },
      { text: "Delete Playlist", icon: Trash2, action: () => warn(`Delete “${playlist?.name}”?`, "Delete", () => (back(), deletePlaylist(id))) },
    ]);

  return (
    <div className="animate-enter">
      <Masthead
        cover={
          playlist ? (
            <button onClick={() => file.current?.click()} aria-label="Choose Cover Image" title="Choose Cover Image" className="group/cover relative block size-full">
              <PlaylistCover id={id} tracks={tracks} cover={playlist.cover} />
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
                <ImagePlus size={36} strokeWidth={1.5} />
              </span>
            </button>
          ) : (
            <PlaylistCover id={id} tracks={tracks} />
          )
        }
        bg={playlist && (playlist.cover ?? tracks[0]?.thumb)}
        fill={playlist ? tint(id) : LIKED}
        title={
          playlist ? (
            <h1>
              <input
                value={playlist.name}
                onChange={(e) => renamePlaylist(id, e.target.value)}
                onBlur={(e) => !e.target.value.trim() && renamePlaylist(id, "Untitled Playlist")}
                aria-label="Playlist name"
                name="playlist-name"
                autoComplete="off"
                spellCheck={false}
                className={`${title(playlist.name)} room w-full bg-transparent caret-white outline-none`}
              />
            </h1>
          ) : (
            <h1 className={title("Liked Songs")}>Liked Songs</h1>
          )
        }
        sub={
          playlist && (
            <input
              value={playlist.about ?? ""}
              onChange={(e) => describePlaylist(id, e.target.value)}
              placeholder="Add a description"
              aria-label="Description"
              name="playlist-about"
              autoComplete="off"
              className="w-full bg-transparent text-base font-medium text-white/85 caret-white outline-none placeholder:text-white/50"
            />
          )
        }
        meta={[folder?.name ?? (playlist ? (playlist.public && signedIn ? "Public Playlist" : "Playlist") : "Library"), count(tracks.length)].join(" · ")}
      >
        <PlayButtons tracks={shown} from={from} />
        <DownloadButton id={from} about={() => ({ title: playlist?.name ?? "Liked Songs", thumb: playlist?.cover ?? tracks[0]?.thumb })} />
        <button onClick={more} aria-label="More" title="More" aria-haspopup="menu" className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30">
          <Ellipsis size={20} />
        </button>
      </Masthead>
      {playlist && <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void coverFrom(e.target.files[0]).then((c) => setCover(id, c), report), (e.target.value = ""))} />}
      <div className="mt-6 px-8">
        {tracks.length > 0 && (
          <div className="mb-2 flex items-center justify-end gap-2">
            <PlaylistSearch value={query} onChange={setQuery} label={id === "liked" ? "Search in Liked Songs" : "Search in Playlist"} />
            {tracks.length > 1 && (
              <SortSelect
                value={sort}
                custom={playlist ? undefined : "Recently Added"}
                onChange={(s) => (playlist ? sortPlaylist(id, s) : useSettings.setState({ likedSort: s }))}
              />
            )}
          </div>
        )}
        {tracks.length ? (
          shown.length ? (
            <TrackList
              tracks={shown}
              playlist={playlist?.id}
              origin={rows.map((r) => r.i)}
              from={from}
              added
              onMove={playlist && sort === "custom" && !query.trim() ? (a, b) => movePlaylistTrack(id, a, b) : undefined}
            />
          ) : (
            <p className="py-8 text-muted">No songs match “{query.trim()}”.</p>
          )
        ) : (
          <p className="text-muted">{playlist ? "Right-click any song and choose Add to Playlist." : "Tap the heart on any song and it lands here."}</p>
        )}
      </div>
    </div>
  );
}

// An image you picked, as a playlist cover: cropped square and drawn at 640 px as a JPEG, so the library
// stays small (about 80 KB a cover) and the cover loads at once. Profile pictures are 256 px.
async function coverFrom(file: File, size = 640) {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(size, side);
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  img.close();
  return canvas.toDataURL("image/jpeg", 0.86);
}

const copyLink = (link: string, detail = link) => navigator.clipboard.writeText(link).then(() => notify({ text: "Link Copied", detail }), report);

// Someone's public playlist, from its link: play it, or save a copy to your library.
export function SharedPage({ id }: { id: string }) {
  const online = useOnline();
  const { data, error } = useAsync(() => (canSignIn ? sharedPlaylist(id) : Promise.reject(new Error("Accounts aren’t set up"))), [id, online]);
  const [query, setQuery] = useState("");
  if (data === null) return <p className="px-8 pt-20 text-muted">This playlist isn’t shared any more.</p>;
  if (!data && error) return <p title={error} className="px-8 pt-20 text-muted">Couldn’t open this playlist. Check your connection and try again.</p>;
  if (!data) return <Skeleton className="h-[380px] bg-ink/[0.04]" />;
  const p = data.playlist;
  const owner = id.split("/")[0];
  const q = query.trim();
  const shown = q ? p.tracks.filter((t) => matches(t, q)) : p.tracks;

  return (
    <div className="animate-enter">
      <Masthead
        cover={<PlaylistCover id={p.id} tracks={p.tracks} cover={p.cover} />}
        bg={p.cover ?? p.tracks[0]?.thumb}
        fill={tint(p.id)}
        title={<h1 className={title(p.name)}>{p.name}</h1>}
        sub={
          <button onClick={() => open({ name: "profile", id: owner })} className="flex items-center gap-2 hover:underline">
            <Avatar profile={data.owner} className="size-7 text-sm" /> {data.owner.name || "Someone"}
          </button>
        }
        meta={["Public Playlist", count(p.tracks.length)].join(" · ")}
      >
        <PlayButtons tracks={shown} />
        <button onClick={() => copyPlaylist(p)} className={`${pill} bg-white/20 px-4 hover:bg-white/30`}>
          <Plus size={16} strokeWidth={2.6} /> Save a Copy
        </button>
        <button onClick={() => copyLink(sharedLink(id))} aria-label="Copy Link" title="Copy Link" className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30">
          <Link size={17} />
        </button>
      </Masthead>
      <div className="mt-6 px-8">
        {p.about && <p className="mb-6 line-clamp-2 max-w-2xl text-[15px] leading-relaxed text-ink/65">{p.about}</p>}
        {p.tracks.length > 0 && (
          <div className="mb-2 flex items-center justify-end gap-2">
            <PlaylistSearch value={query} onChange={setQuery} label="Search in Playlist" />
          </div>
        )}
        {p.tracks.length ? (
          shown.length ? (
            <TrackList tracks={shown} />
          ) : (
            <p className="py-8 text-muted">No songs match “{q}”.</p>
          )
        ) : (
          <p className="text-muted">No songs in it yet.</p>
        )}
      </div>
    </div>
  );
}

// A picture, or the first letter of the name on a colour.
function Avatar({ profile, className }: { profile?: Profile; className: string }) {
  if (profile?.avatar) return <img src={profile.avatar} alt="" className={`shrink-0 rounded-full bg-ink/[0.06] object-cover ${className}`} />;
  return <span className={`grid shrink-0 place-items-center rounded-full bg-linear-135 from-[#ff375f] to-[#ff9f0a] font-extrabold text-white ${className}`}>{(profile?.name || "?").trim()[0]?.toUpperCase()}</span>;
}

// Someone's profile: their name and picture, and the playlists they've made public.
export function ProfilePage({ id }: { id: string }) {
  const online = useOnline();
  const mine = useAccount((s) => s.user?.id === id);
  const synced = useAccount((s) => (mine ? s.synced : 0)); // your own: as it is after each sync
  const { data, error } = useAsync(() => (canSignIn ? publicProfile(id) : Promise.reject(new Error("Accounts aren’t set up"))), [id, online, synced]);
  if (data === null) return <p className="px-8 pt-20 text-muted">There’s no Sleeve profile here any more.</p>;
  if (!data && error) return <p title={error} className="px-8 pt-20 text-muted">Couldn’t open this profile. Check your connection and try again.</p>;
  if (!data) return <Skeleton className="h-[300px] bg-ink/[0.04]" />;
  const name = data.profile.name || "Sleeve Listener";
  return (
    <div className="animate-enter px-8 pt-20">
      <div className="flex items-end gap-8">
        <Avatar profile={data.profile} className="size-[clamp(120px,16cqw,200px)] text-7xl shadow-xl shadow-black/20" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-muted">Profile</div>
          <h1 className={title(name)}>{name}</h1>
          <div className="mt-2 text-muted">{plural(data.playlists.length, "public playlist")}</div>
          <div className="mt-5 flex gap-2">
            <button onClick={() => copyLink(profileLink(id))} className={quiet}><Link size={16} /> Copy Link</button>
            {mine && <button onClick={() => (go("settings"), useStore.setState({ pane: "account" }))} className={quiet}>Edit Profile</button>}
          </div>
        </div>
      </div>
      <Section title="Public Playlists">
        {data.playlists.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
            {data.playlists.map((p) => (
              <li key={p.id} className="relative">
                <button onClick={() => open({ name: "shared", id: `${id}/${p.id}` })} aria-label={`Open ${p.name}`} className="hit" />
                <div className="pointer-events-none aspect-square w-full overflow-hidden rounded-xl bg-ink/[0.06] shadow-sm">
                  <PlaylistCover id={p.id} cover={p.cover} tracks={p.thumbs.map((thumb, i) => ({ id: `${i}`, title: "", artists: [], thumb: thumb ?? undefined }))} />
                </div>
                <div className="pointer-events-none mt-2.5 truncate font-semibold">{p.name}</div>
                <div className="pointer-events-none truncate text-sm text-muted">{count(p.count)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{mine ? "Make a playlist public from its page: ••• then Copy Link." : "Nothing public yet."}</p>
        )}
      </Section>
    </div>
  );
}

// A folder of your playlists: rename it, play them all, add a playlist straight into it.
export function FolderPage({ id }: { id: string }) {
  const folder = useLibrary((s) => s.folders.find((f) => f.id === id));
  const playlists = useLibrary((s) => s.playlists);
  const view = useSettings((s) => s.libraryView);
  const items = useMemo(() => playlists.flatMap((p, i): Item[] => (p.folder === id ? [{ key: libraryKey("playlist", p.id), kind: "playlist", id: p.id, title: p.name, sub: `Playlist · ${count(p.tracks.length)}`, at: p.at ?? i, creator: "" }] : [])), [playlists, id]);
  if (!folder) return <p className="px-8 pt-20 text-muted">This folder was deleted.</p>;
  const tracks = playlists.filter((p) => p.folder === id).flatMap((p) => p.tracks);
  const key = libraryKey("folder", id);
  return (
    <div className="animate-enter">
      <Masthead
        cover={<FolderCover id={id} />}
        fill={tint(id)}
        title={
          <h1>
            <input value={folder.name} onChange={(e) => renameFolder(id, e.target.value)} onBlur={(e) => !e.target.value.trim() && renameFolder(id, "Untitled Folder")} aria-label="Folder name" name="folder-name" autoComplete="off" spellCheck={false} className={`${title(folder.name)} room w-full bg-transparent caret-white outline-none`} />
          </h1>
        }
        meta={`Folder · ${plural(items.length, "playlist")}`}
      >
        <PlayButtons tracks={tracks} from={key} />
        <button
          onClick={() => popup([{ text: useLibrary.getState().pinned.includes(key) ? "Unpin" : "Pin to Top", icon: useLibrary.getState().pinned.includes(key) ? PinOff : Pin, action: () => togglePin(key) }, { text: "New Playlist in Folder", icon: Plus, action: () => open({ name: "playlist", id: newPlaylist([], id) }) }, { item: "Separator" }, { text: "Delete Folder", icon: Trash2, action: () => warn(`Delete “${folder.name}”?`, "Delete", () => (back(), deleteFolder(id)), "Its playlists stay in your library.") }])}
          aria-label="More"
          title="More"
          aria-haspopup="menu"
          className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30"
        >
          <Ellipsis size={20} />
        </button>
      </Masthead>
      <div className="px-8">
        {items.length ? <LibraryItems items={items} view={view} /> : <p className="mt-6 text-muted">Drag a playlist onto this folder in your Library, or right-click one and choose Move to Folder.</p>}
      </div>
    </div>
  );
}

// Songs on this Mac, from the folders you added (local.ts): play them, order them, search them.
export function LocalPage() {
  const tracks = useLocalTracks();
  const folders = useLocal((s) => s.folders);
  const scanning = useLocal((s) => s.scanning);
  const sort = useSettings((s) => s.localSort);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => sorted(tracks, sort).filter((r) => !query.trim() || matches(r.t, query.trim())), [tracks, sort, query]);
  const shown = rows.map((r) => r.t);
  return (
    <div className="animate-enter">
      <Masthead cover={<LocalCover />} fill="bg-linear-135 from-[#5e5ce6] to-[#30d158]" title={<h1 className={title("Local Files")}>Local Files</h1>} meta={`On this Mac · ${count(tracks.length)} · ${plural(folders.length, "folder")}${scanning ? " · Looking for changes…" : ""}`}>
        <PlayButtons tracks={shown} from="local" radio={false} />
        <button onClick={() => popup([{ text: "Add Folder…", icon: FolderPlus, action: () => void addFolder() }, { text: "Look for New Songs", icon: RefreshCw, action: () => void rescan() }])} aria-label="More" title="More" aria-haspopup="menu" className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30">
          <Ellipsis size={20} />
        </button>
      </Masthead>
      <div className="mt-6 px-8">
        {!folders.length ? (
          <div className="flex items-center gap-4">
            <p className="text-muted">{canHaveFiles ? "Add a folder of music on this Mac and it plays here, alongside everything else." : "Local files play in the Sleeve app."}</p>
            {canHaveFiles && <button onClick={() => void addFolder()} className={solid}><Plus size={16} /> Add Folder…</button>}
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-end gap-2">
              <label className="flex h-8 w-56 items-center gap-2 rounded-full bg-ink/[0.07] px-3 focus-within:bg-ink/[0.1]">
                <SearchIcon size={15} className="shrink-0 text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Search in Local Files" aria-label="Search in Local Files" data-find autoComplete="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
              </label>
              <SortSelect value={sort} custom="Artist & Album" onChange={(localSort) => useSettings.setState({ localSort })} />
            </div>
            {shown.length ? <TrackList tracks={shown} from="local" /> : <p className="text-muted">{query.trim() ? "No songs match." : scanning ? "Reading your music…" : "No songs in these folders yet."}</p>}
          </>
        )}
      </div>
    </div>
  );
}
function LocalCover() {
  return (
    <div className="grid size-full place-items-center bg-linear-135 from-[#5e5ce6] to-[#30d158] text-white/90">
      <HardDrive className="size-1/3" strokeWidth={1.5} />
    </div>
  );
}

// Everything you've listened to, newest first, by day; read from disk a page at a time.
export function HistoryPage() {
  const [rows, setRows] = useState<{ p: PlayRow; key: number }[]>([]);
  const [done, setDone] = useState(false);
  const recent = useHistory((s) => s.recent); // a new play, or the history cleared: read it again
  const more = (from: { p: PlayRow; key: number }[]) => {
    const got: { p: PlayRow; key: number }[] = [];
    void plays((p, key) => (got.push({ p, key }), got.length < 200), from.at(-1)?.key).then(() => (setRows([...from, ...got]), setDone(got.length < 200)));
  };
  useEffect(() => more([]), [recent]);
  const days = useMemo(() => {
    const out: { day: string; rows: typeof rows }[] = [];
    for (const r of rows) {
      const day = dayName(r.p.at);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(r);
    }
    return out;
  }, [rows]);
  return (
    <div className="animate-enter px-8 pt-14">
      <div className="flex items-end justify-between gap-6">
        <h1 className="text-display">History</h1>
        {rows.length > 0 && <button onClick={() => warn("Clear your listening history?", "Clear History", clearHistory, "Every play goes, and Recently Played on Home with it.")} className={quiet}>Clear…</button>}
      </div>
      {!rows.length && done && <p className="mt-6 text-muted">Songs you listen to for 30 seconds or more land here.</p>}
      {days.map(({ day, rows }) => (
        <Section key={day} title={day}>
          <TrackList tracks={rows.map((r) => r.p.t)} times={rows.map((r) => r.p.at)} />
        </Section>
      ))}
      {!done && rows.length > 0 && (
        <button onClick={() => more(rows)} className={`${quiet} mt-6`}>Show More</button>
      )}
    </div>
  );
}
const dayName = (at: number) => {
  const d = new Date(at), today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: days < 7 ? "long" : undefined, day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

// Your listening over a stretch of time: minutes, top songs, artists and album, busiest day.
type Span = "week" | "month" | "year" | "all";
const SPANS: [Span, string][] = [["week", "This Week"], ["month", "This Month"], ["year", "This Year"], ["all", "All Time"]];
const spanStart = (s: Span, d = new Date()) =>
  s === "all" ? 0 : new Date(d.getFullYear(), s === "year" ? 0 : d.getMonth(), s === "week" ? d.getDate() - ((d.getDay() + 6) % 7) : 1).getTime();
const top = <T,>(m: Map<string, { v: T; n: number }>, k = 10) => [...m.values()].sort((a, b) => b.n - a.n).slice(0, k);
const tally = <T,>(m: Map<string, { v: T; n: number }>, key: string, v: T) => {
  const e = m.get(key) ?? m.set(key, { v, n: 0 }).get(key)!;
  e.n++;
};
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function replay(list: PlayRow[]) {
  const songs = new Map<string, { v: Track; n: number }>(), artists = new Map<string, { v: Artist; n: number }>(), albums = new Map<string, { v: Track; n: number }>();
  const days = WEEK.map(() => 0);
  let secs = 0;
  for (const { t, at } of list) {
    secs += parseSecs(t.duration) ?? 0;
    tally(songs, t.id, t);
    for (const a of t.artists) tally(artists, a.name, a);
    if (t.album) tally(albums, t.albumId ?? t.album, t);
    days[(new Date(at).getDay() + 6) % 7]++;
  }
  return { minutes: Math.round(secs / 60), plays: list.length, songs: top(songs), artists: top(artists, 5), album: top(albums, 1)[0], days };
}

export function WrappedPage() {
  const [span, setSpan] = useState<Span>("year");
  const [list, setList] = useState<PlayRow[]>();
  const recent = useHistory((s) => s.recent);
  useEffect(() => {
    const since = spanStart(span), got: PlayRow[] = [];
    let live = true;
    // ponytail: reads every play in range on each visit; keep a daily summary if history gets huge
    void plays((p) => p.at >= since && got.push(p) > 0).finally(() => live && setList(got));
    return () => void (live = false);
  }, [span, recent]);
  const r = useMemo(() => replay(list ?? []), [list]);
  const label = SPANS.find(([s]) => s === span)![1];
  const busiest = Math.max(...r.days);
  const card = async () => {
    const c = document.createElement("canvas");
    await drawCard(c, r.songs[0].v, [`${r.minutes.toLocaleString()} minutes listened ${label.toLowerCase()}`, `Top artist: ${r.artists[0]?.v.name}`], "Artwork");
    return c;
  };
  const save = () =>
    void card().then((c) =>
      c.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `Sleeve Wrapped ${label}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        notify({ text: "Card Saved", detail: "Saved to your Downloads folder" });
      }, "image/png"),
    );
  const copy = () =>
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": card().then((c) => new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail()), "image/png"))) })])
      .then(() => notify({ text: "Card Copied" }), () => notify({ text: "Couldn’t Copy the Card", detail: "Save it instead" }));
  const hero = r.songs[0]?.v;
  return (
    <div className="animate-enter px-8 pt-14 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-display">Wrapped</h1>
        <Segments label="Time range" value={span} options={SPANS} onPick={setSpan} />
      </div>
      {list && !hero && <p className="mt-6 text-muted">Nothing played {label.toLowerCase()} yet. Songs you listen to for 30 seconds or more count.</p>}
      {hero && (
        <>
          <div className="relative isolate mt-6 flex flex-wrap items-end justify-between gap-6 overflow-hidden rounded-2xl p-8 text-white">
            <img src={art(hero.thumb, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-125 object-cover blur-3xl brightness-50 saturate-150" />
            <div>
              <div className="text-sm font-semibold text-white/70">{label}</div>
              <div className="text-6xl font-black tabular-nums">{r.minutes.toLocaleString()}</div>
              <div className="font-semibold text-white/80">minutes · {plural(r.plays, "play")}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={copy} aria-label="Copy Card" title="Copy Card" className={`${pill} bg-white/15 px-3 hover:bg-white/25`}><Copy size={16} /></button>
              <button onClick={save} className={`${pill} bg-white text-black hover:bg-white/85`}><ImageDown size={16} /> Share Card</button>
            </div>
          </div>
          <Section title="Top Songs">
            <TrackList tracks={r.songs.map((s) => s.v)} numbered />
          </Section>
          <Section title="Top Artists">
            <ol className="grid gap-1">
              {r.artists.map(({ v, n }, i) => (
                <li key={v.name} className="flex items-center gap-4 py-1.5">
                  <span className="w-5 text-right text-muted tabular-nums">{i + 1}</span>
                  {v.id ? <button onClick={() => open({ name: "artist", id: v.id!, by: v.name })} className="font-semibold hover:underline">{v.name}</button> : <span className="font-semibold">{v.name}</span>}
                  <span className="ml-auto text-sm text-muted">{plural(n, "play")}</span>
                </li>
              ))}
            </ol>
          </Section>
          <div className="grid gap-6 @2xl:grid-cols-2">
            {r.album && (
              <Section title="Top Album">
                <button onClick={() => r.album.v.albumId && open({ name: "collection", id: r.album.v.albumId })} className="flex items-center gap-4 text-left">
                  <img src={art(r.album.v.thumb, 160)} alt="" className="size-20 rounded-lg object-cover" />
                  <span>
                    <span className="block font-semibold">{r.album.v.album}</span>
                    <span className="block text-sm text-muted">{r.album.v.artists[0]?.name} · {plural(r.album.n, "play")}</span>
                  </span>
                </button>
              </Section>
            )}
            <Section title="By Day">
              <div className="flex h-28 items-end gap-2">
                {r.days.map((n, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1.5" title={plural(n, "play")}>
                    <div style={{ height: `${busiest ? (n / busiest) * 100 : 0}%` }} className={`min-h-1 w-full max-w-8 rounded-md ${n === busiest ? "bg-accent" : "bg-ink/15"}`} />
                    <span className="text-xs text-muted">{WEEK[i]}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

// A song's title as released, once known ("Лампочки", not "Lampochki").
const Title = ({ t }: { t: Track }) => <>{useOriginals((s) => s[t.id]) || t.title}</>;

// Songs in columns of four that scroll sideways, like a record shelf.
function TrackGrid({ tracks, numbered }: { tracks: Track[]; numbered?: boolean }) {
  const current = useStore((s) => s.queue[s.index]), on = (t: Track) => !!current && sameSong(current, t);
  return (
    <ol className="-mx-8 grid auto-cols-[clamp(260px,31%,360px)] grid-flow-col grid-rows-4 gap-x-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
      {tracks.map((t, i) => (
        <li key={t.id + i} {...warmSong(t)} onContextMenu={(e) => (e.preventDefault(), trackMenu(t))} className="group relative flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-ink/[0.04]">
          <button onClick={() => play(tracks, i)} aria-label={`Play ${t.title}`} className="hit" />
          {numbered && <span className="w-7 shrink-0 text-center text-xl font-extrabold tracking-tight text-muted tabular-nums">{i + 1}</span>}
          <div className="pointer-events-none relative size-12 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06]">
            <img src={art(t.thumb, 120)} alt="" loading="lazy" className="size-full object-cover" />
            <div className={`absolute inset-0 grid place-items-center bg-black/35 text-white transition-opacity duration-150 ${on(t) ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              {on(t) ? <AudioLines size={18} /> : <Play size={16} className="fill-current" />}
            </div>
          </div>
          <div className="min-w-0">
            <div className={`truncate font-semibold ${on(t) ? "text-accent" : ""}`}><SongName t={t} /></div>
            <div className="truncate text-sm text-muted">
              {t.rec && <Sparkle size={14} aria-label="Recommended" className="mr-1.5 inline -translate-y-px fill-accent text-accent drop-shadow-[0_0_4px_var(--color-accent)]" />}
              {t.explicit && <Explicit />}
              <Artists list={t.artists} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Artist pages, each fetched once per launch: page is YT Music's own (five songs, no lengths), full adds
// their top ten once that comes too: Deezer's, like Mixtape, or YT Music's if Deezer hasn't five.
type ArtistPage = Awaited<ReturnType<typeof artist>>;
const artistPages = new Map<string, { page: Promise<ArtistPage>; full: Promise<ArtistPage> }>();
function loadArtist(id: string) {
  if (!artistPages.has(id)) {
    const page = artist(id);
    const full = page.then(async (p) => { const [dz, yt] = await Promise.all([dzTop(p.name).catch(() => []), p.more ? topSongs(p.more).catch(() => []) : []]); const top = dz.length >= 5 ? dz : yt; return top.length ? { ...p, songs: top } : p; });
    artistPages.set(id, { page, full });
    full.catch(() => artistPages.delete(id));
  }
  return artistPages.get(id)!;
}
// Resting on a link to an artist starts loading their page, so it's mostly there by the click.
let resting: ReturnType<typeof setTimeout> | undefined;
const warm = (a: { id?: string; name: string }) => ({
  onPointerEnter: () => (resting = setTimeout(() => (a.id && !isDeezer(a.id) ? Promise.resolve(a.id) : artistByName(a.name)).then((id) => void (id && loadArtist(id).full)).catch(() => {}), 120)),
  onPointerLeave: () => clearTimeout(resting),
});
// Resting on a song starts fetching it, so a click plays at once (Settings → Audio → Fetch While Browsing).
const browsing = (t: Track) => useSettings.getState().browse && fetchAhead(t);
const warmSong = (t: Track) => ({ onPointerEnter: () => (resting = setTimeout(() => browsing(t), 120)), onPointerLeave: () => clearTimeout(resting) });

// The banner runs edge to edge and fades into the page; the about text floats on it.
const LINK = "press text-sm font-semibold text-muted hover:text-ink";
export function Artist({ id: linked, by }: { id: string; by?: string }) {
  // One YT Music didn't link (on your own files, or from Deezer) opens at once and is found by name meanwhile.
  const yt = isDeezer(linked) ? "" : linked;
  // The last copy of the page draws at once (and offline), and the fresh one replaces it whole.
  const key = `artist:${yt || by?.toLowerCase()}`;
  const { data: kept } = useAsync(() => idbGet<ArtistPage & { id: string }>(key).catch(() => undefined), [key]);
  const { data: found, error: lost } = useAsync(() => (yt ? undefined : artistByName(by ?? "").then((id) => id ?? Promise.reject("none"))), [yt, by]);
  const id = yt || found || kept?.id || "";
  const { data: page, error } = useAsync(() => (id ? loadArtist(id).page : undefined), [id]);
  const { data: full } = useAsync(() => (id ? loadArtist(id).full.then((p) => (idbPut(key, { ...p, id }).catch(() => {}), p)) : undefined), [id]);
  const data = full ?? kept ?? page;
  const [all, setAll] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Followed or blocked under either id, or their name.
  const lower = (data?.name ?? by ?? "").toLowerCase();
  const followed = useLibrary((s) => s.followed.find((a) => a.id === id || a.id === linked || a.name.toLowerCase() === lower));
  const blocked = useLibrary((s) => s.blocked.find((b) => (b.id && (b.id === id || b.id === linked)) || b.name.toLowerCase() === lower));
  // Your own files credited to them: edits, remixes, songs that aren't on YouTube.
  const files = useLocalTracks();
  const yours = data ? files.filter((t) => t.artists.some((a) => a.name.toLowerCase() === data.name.toLowerCase())) : [];
  if (lost && !id) return <p title={lost} className="px-8 pt-20 text-muted">Couldn’t find {by} on YouTube Music.</p>;
  if (error && !data) return <p title={error} className="px-8 pt-20 text-muted">Couldn’t load this artist. Go back and try again.</p>;
  if (!data) return <Skeleton className="h-[min(60vh,540px)] bg-ink/[0.03]" />;
  const me = { id: followed?.id ?? id, name: data.name };
  const from = libraryKey("artist", me.id);

  return (
    <div className="animate-enter">
      <header className={`relative flex items-end gap-8 px-8 ${data.banner ? "h-[min(60vh,540px)]" : "pt-24"}`}>
        {data.banner && (
          <img
            src={art(data.banner, 2160, 900)}
            alt=""
            className="absolute inset-0 size-full object-cover object-[50%_25%] [mask-image:linear-gradient(to_bottom,black_45%,transparent)]"
          />
        )}
        <div className="relative min-w-0 flex-1">
          {data.verified && (
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <BadgeCheck size={20} aria-hidden className="fill-[#3d91ff] text-paper" /> Verified Artist
            </div>
          )}
          <h1 className="text-display">{data.name}</h1>
          {(data.listeners || data.subscribers) && (
            <p className="mt-3 font-semibold text-ink/80">
              {[data.listeners && `${data.listeners} monthly listeners`, data.subscribers && `${data.subscribers} subscribers`].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="mt-6 flex gap-2.5">
            <button onClick={() => play(data.songs, firstPlayable(data.songs), from)} disabled={!data.songs.length} className={`${pill} bg-accent text-paper disabled:opacity-50`}>
              <Play size={16} className="fill-current" /> Play
            </button>
            <button onClick={() => toggleFollow(followed ?? { ...me, thumb: data.banner })} aria-pressed={!!followed} className={`${pill} bg-ink/[0.08] px-4 hover:bg-ink/[0.14]`}>
              {followed ? <UserCheck size={16} /> : <UserPlus size={16} />} {followed ? "Following" : "Follow"}
            </button>
            <button onClick={() => shufflePlay(data.songs, from)} disabled={!data.songs.length} aria-label="Shuffle" title="Shuffle" className="press grid size-10 place-items-center rounded-full bg-ink/[0.08] hover:bg-ink/[0.14] disabled:opacity-50">
              <Shuffle size={17} />
            </button>
            <button onClick={() => radioFrom(data.songs, from)} disabled={!data.songs.length} aria-label="Artist radio" title="Artist radio" className="press grid size-10 place-items-center rounded-full bg-ink/[0.08] hover:bg-ink/[0.14] disabled:opacity-50">
              <Radio size={17} />
            </button>
            <button
              onClick={() => popup([...(followed ? [{ text: useLibrary.getState().pinned.includes(from) ? "Unpin" : "Pin to Top", icon: useLibrary.getState().pinned.includes(from) ? PinOff : Pin, action: () => togglePin(from) }] : []), { text: blocked ? "Allow This Artist" : "Don’t Play This Artist", icon: blocked ? CircleCheck : Ban, action: () => toggleBlock(blocked ?? me) }])}
              aria-label="More"
              title="More"
              aria-haspopup="menu"
              className="press grid size-10 place-items-center rounded-full bg-ink/[0.08] hover:bg-ink/[0.14]"
            >
              <Ellipsis size={18} />
            </button>
          </div>
          {blocked && <p className="mt-3 text-sm font-semibold text-muted">You won’t hear {data.name}: their songs are skipped and left out of radio.</p>}
        </div>
      </header>

      <div className="px-8">
        {data.songs.length > 0 && (
          <Section title="Popular Songs" action={data.songs.length > 5 && <button onClick={() => setAll(!all)} className={LINK}>{all ? "Show Less" : "Show More"}</button>}>
            <TrackList tracks={all ? data.songs : data.songs.slice(0, 5)} numbered header={false} onPlay={(i) => play(data.songs, i, from)} />
          </Section>
        )}
        {yours.length > 0 && (
          <Section title="In Your Files">
            <TrackList tracks={yours} header={false} from="local" />
          </Section>
        )}
        {([["Albums", data.albums, data.albumsMore], ["Singles & EPs", data.singles, data.singlesMore], ["Featured On", data.featured], ["Appears On", data.appearsOn]] as const).map(
          ([title, items, more]) =>
            !!items?.length && (
              <Section key={title} title={title} action={more && <button onClick={() => open({ name: "discography", id: more.browseId, params: more.params, artist: data.name })} className={LINK}>Show All</button>}>
                <Albums items={items} />
              </Section>
            ),
        )}
        {!!data.videos?.length && (
          <Section title="Videos">
            <TrackGrid tracks={data.videos} />
          </Section>
        )}
        {!!data.fans?.length && (
          <Section title="Fans Also Like">
            <ArtistCards items={data.fans} />
          </Section>
        )}
        {data.about && (
          <Section title="About">
            <button onClick={() => setAboutOpen(true)} className="press relative isolate block w-full max-w-2xl overflow-hidden rounded-2xl p-6 text-left text-white">
              {data.banner && <img src={art(data.banner, 1200, 600)} alt="" className="absolute inset-0 -z-10 size-full object-cover object-[50%_25%]" />}
              <div className="absolute inset-0 -z-10 bg-linear-to-t from-black/90 to-black/30" />
              <div className="flex min-h-36 flex-col justify-end">
                {data.listeners && <div className="font-bold">{data.listeners} monthly listeners</div>}
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/80">{data.about}</p>
              </div>
            </button>
          </Section>
        )}
      </div>
      {aboutOpen && (
        <Modal label={`About ${data.name}`} onClose={() => setAboutOpen(false)} className="max-h-[85vh] w-[min(640px,90vw)] overflow-y-auto p-6">
          <h2 className="text-2xl font-bold">{data.name}</h2>
          {data.listeners && <p className="mt-1 font-semibold text-muted">{data.listeners} monthly listeners</p>}
          <p className="mt-4 text-sm leading-relaxed whitespace-pre-line text-ink/80 select-text">{data.about}</p>
        </Modal>
      )}
    </div>
  );
}

// The page behind an artist's Albums or Singles "More": all of them.
export function DiscographyPage({ id, params, artist }: { id: string; params?: string; artist?: string }) {
  const { data, error } = useAsync(() => discography(id, params), [id, params]);
  return (
    <div className="animate-enter px-8 pt-14">
      {artist && <p className="text-sm font-semibold text-muted">{artist}</p>}
      <h1 className="text-display">Discography</h1>
      <div className="mt-6">
        {error ? <p className="text-muted">Couldn’t load these. Go back and try again.</p> : data ? <Albums items={data} grid /> : <Skeleton className="h-60 w-full rounded-xl" />}
      </div>
    </div>
  );
}

const COUNTRIES = ["ZZ", "US", "GB", "AU", "BR", "CA", "DE", "ES", "FR", "IN", "IT", "JP", "KR", "MX", "NL", "NZ", "NO", "PL", "SE"];
const region = new Intl.DisplayNames(undefined, { type: "region" });
const countryName = (code: string) => (code === "ZZ" ? "Global" : (region.of(code) ?? code));

export function ChartsPage() {
  const country = useSettings((s) => s.country);
  const { data, error } = useAsync(() => charts(country), [country]);
  return (
    <div className="animate-enter px-8 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-display">Charts</h1>
        <label className="relative">
          <select value={country} onChange={(e) => useSettings.setState({ country: e.target.value })} aria-label="Country" className={`${pill} appearance-none bg-ink/[0.07] pr-9 hover:bg-ink/[0.12]`}>
            {(COUNTRIES.includes(country) ? COUNTRIES : [country, ...COUNTRIES]).map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
          <ChevronDown size={15} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
        </label>
      </div>
      {error ? (
        <p title={error} className="mt-8 text-muted">Couldn’t load the charts. Check your connection and try again.</p>
      ) : !data ? (
        <Skeleton className="mt-10 h-64 rounded-2xl" />
      ) : (
        data.map((shelf) => (
          <Section key={shelf.title} title={shelf.title}>
            {shelf.tracks.length > 0 && <TrackGrid tracks={shelf.tracks} numbered />}
            {shelf.albums.length > 0 && <Albums items={shelf.albums} />}
            {shelf.artists?.length ? <ArtistCards items={shelf.artists} /> : null}
          </Section>
        ))
      )}
    </div>
  );
}

const RELEASES = { All: () => true, Albums: (a: Album) => a.kind === "Album", "Singles & EPs": (a: Album) => a.kind === "Single" || a.kind === "EP" };

export function ReleasesPage() {
  const { data, error } = useAsync(newReleases, []);
  const [filter, setFilter] = useState<keyof typeof RELEASES>("All");
  return (
    <div className="animate-enter px-8 pt-14">
      <h1 className="text-display">New Releases</h1>
      <div className="mt-6 flex gap-2">
        {Object.keys(RELEASES).map((f) => (
          <button key={f} onClick={() => setFilter(f as keyof typeof RELEASES)} className={`${pill} ${filter === f ? "bg-ink text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`}>{f}</button>
        ))}
      </div>
      <div className="mt-6">
        {error ? <p title={error} className="text-muted">Couldn’t load new releases. Check your connection and try again.</p> : !data ? <Skeleton className="h-64 rounded-2xl" /> : <Albums items={data.filter(RELEASES[filter])} grid />}
      </div>
    </div>
  );
}

// A sheet that rises from the player bar: Now Playing (the artwork, with lyrics or Up Next beside it), or
// just the lyrics, big, on the artwork's colour. Always mounted so it can slide both ways; transitions,
// not keyframes, so a quick open-close reverses from wherever it is. Its contents go once it's down,
// so a closed sheet costs nothing.
export function NowPlaying() {
  const sheet = useStore((s) => s.sheet);
  // Which one it was stays while it slides away, so it doesn't change on the way down.
  const [last, setLast] = useState(sheet);
  if (sheet && sheet !== last) setLast(sheet);
  const open = !!sheet;
  const [drawn, setDrawn] = useState(open);
  if (open && !drawn) setDrawn(true);
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setDrawn(false), 320);
    return () => clearTimeout(t);
  }, [open]);
  const big = (sheet ?? last) === "lyrics";
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const track = queue[index];
  const upNext = queue.slice(index + 1);
  const [tab, setTab] = useState<"lyrics" | "queue">("lyrics");
  const lyrics = useLyrics(track);
  const extras = useExtras(track, lyrics.value);
  const karaoke = !!lyrics.value?.lines.some((l) => l.words);
  const still = useSettings((s) => s.lyricsStill);
  const close = useRef<HTMLButtonElement>(null);

  // Focus moves into the sheet, and back to wherever it was when the sheet closes.
  useEffect(() => {
    if (!open) return;
    const was = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => was?.focus({ preventScroll: true });
  }, [open]);

  const tabClass = (on: boolean) => `press text-2xl font-bold tracking-tight ${on ? "" : "text-white/45 hover:text-white/75"}`;
  return (
    <div
      inert={!open}
      role="dialog"
      aria-modal="true"
      aria-label={big ? "Lyrics" : "Now Playing"}
      className={`fixed inset-0 z-30 overflow-clip ${big ? "bg-accent-vivid" : "bg-accent-deep"} ${
        open
          ? "visible translate-y-0 [transition:transform_450ms_var(--ease-drawer),background-color_300ms]"
          : "invisible translate-y-full [transition:transform_300ms_var(--ease-drawer),visibility_0s_300ms]"
      }`}
    >
      {drawn && track && <img src={art(track.thumb, 120)} alt="" className={`absolute inset-0 size-full scale-125 object-cover blur-3xl saturate-150 transition-opacity duration-300 ${big ? "opacity-0" : "opacity-35"}`} />}
      {drawn && big && karaoke && <Drift moving={open && !still} />}
      <div className={`absolute inset-0 transition-opacity duration-300 ${big ? "bg-linear-to-b from-black/0 to-black/15" : "bg-linear-to-t from-black/45 to-black/5"}`} />
      {/* Everything on the sheet is white: the palette is remapped rather than restyled. */}
      {!drawn ? null : big ? (
        <div key="lyrics" className="relative flex h-full animate-enter flex-col pt-[42px] pb-24 text-white [--color-accent:white] [--color-ink:white] [--color-muted:rgb(255_255_255/0.75)]">
          <header className="mb-4 flex min-h-12 items-center gap-6 pr-20 pl-16">
            {track && (
              <div className="flex min-w-0 items-center gap-3">
                <button onClick={() => useStore.setState({ sheet: "playing" })} aria-label="Now Playing" title="Now Playing" className="press size-12 shrink-0 overflow-hidden rounded-lg shadow-lg shadow-black/20">
                  <img src={art(track.thumb, 120)} alt="" className="size-full object-cover" />
                </button>
                <div className="min-w-0">
                  <div className="truncate font-bold">{track.title}</div>
                  <div className="truncate text-sm text-white/75"><Artists list={track.artists} /></div>
                </div>
              </div>
            )}
            <div className="ml-auto flex shrink-0 gap-2">
              <LyricOptions extras={extras} />
              <LyricTools track={track} lyrics={lyrics.value} />
            </div>
          </header>
          <LyricLines track={track} lyrics={lyrics} extras={extras} live={open} size="big" />
        </div>
      ) : (
        <div key="playing" className="relative grid h-full animate-enter grid-cols-2 gap-16 px-16 pt-20 pb-32 text-white [--color-accent:white] [--color-ink:white] [--color-muted:rgb(255_255_255/0.68)]">
          <div className="flex min-h-0 flex-col justify-end">
            {track ? (
              <>
                <img src={art(track.thumb, 1000)} alt="" className="aspect-square w-full max-w-[min(100%,50vh)] rounded-2xl object-cover shadow-2xl shadow-black/25" />
                <h1 className={`mt-10 leading-[0.95] font-extrabold tracking-[-0.04em] text-balance break-words ${track.title.length <= 28 ? "text-[clamp(40px,5vw,72px)]" : "text-[clamp(30px,3.4vw,48px)]"}`}>{track.title}</h1>
                <div className="mt-3 truncate text-xl text-white/75">
                  <Artists list={track.artists} />
                </div>
              </>
            ) : (
              <h1 className="text-display">Nothing playing</h1>
            )}
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="mb-4 flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2 pr-12">
              <div role="tablist" className="flex gap-5">
                <button role="tab" aria-selected={tab === "lyrics"} onClick={() => setTab("lyrics")} className={tabClass(tab === "lyrics")}>Lyrics</button>
                <button role="tab" aria-selected={tab === "queue"} onClick={() => setTab("queue")} className={tabClass(tab === "queue")}>Up Next</button>
              </div>
              {tab === "lyrics" && (
                <div className="ml-auto flex gap-2">
                  <LyricOptions extras={extras} />
                  <LyricTools track={track} lyrics={lyrics.value} />
                  {lyrics.value?.lines.length ? (
                    <button onClick={() => useStore.setState({ sheet: "lyrics" })} aria-label="Full Screen Lyrics" title="Full Screen Lyrics" className={round}>
                      <Maximize2 size={15} />
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            {tab === "lyrics" ? (
              <div role="tabpanel" aria-label="Lyrics" className="flex min-h-0 flex-1 flex-col">
                <LyricLines track={track} lyrics={lyrics} extras={extras} live={sheet === "playing"} />
              </div>
            ) : (
              <div role="tabpanel" aria-label="Up Next" className="flex min-h-0 flex-1 flex-col justify-end">
                {upNext.length ? (
                  <div className="min-h-0 overflow-y-auto">
                    <TrackList tracks={upNext} onPlay={(i) => jump(index + 1 + i)} />
                  </div>
                ) : (
                  <p className="text-muted">Nothing queued.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <button
        ref={close}
        onClick={() => useStore.setState({ sheet: undefined })}
        aria-label="Close"
        className="glass press absolute top-12 right-6 z-10 grid size-9 place-items-center rounded-full text-white"
      >
        <ChevronDown size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}

// The karaoke view's own backdrop, for word-timed lyrics: soft blobs of the artwork's colours drifting
// under the words. Only transforms move, which the GPU does without repainting; it stops while the sheet
// is going away, and stays still with Reduce Lyric Motion.
function Drift({ moving }: { moving: boolean }) {
  return (
    <div aria-hidden data-paused={!moving || undefined} className="drift absolute inset-0 overflow-hidden [contain:strict]">
      <i /><i /><i />
    </div>
  );
}

const round = "press grid size-8 shrink-0 place-items-center rounded-full bg-white/15 hover:bg-white/25";

type Extras = ReturnType<typeof useExtras>;

// Romanise and Translate, on songs they apply to. Their state is a setting, so it carries to the next song.
function LyricOptions({ extras: { can, on, to, loading, failed, retry } }: { extras: Extras }) {
  const pill = (pressed: boolean) => `press flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${pressed ? `bg-white text-black ${loading ? "animate-pulse" : ""}` : "bg-white/15 hover:bg-white/25"}`;
  return (
    <>
      {failed && (on.translate || on.romanise) && (
        <button onClick={retry} title="Translation didn’t come through" className="press h-8 rounded-full px-3 text-sm font-semibold text-white/75 hover:text-white">
          Try Again
        </button>
      )}
      {can.romanise && (
        <button onClick={() => useSettings.setState({ lyricsRomanise: !on.romanise })} aria-pressed={on.romanise} title="Show the lyrics in Latin letters" className={pill(on.romanise)}>
          <CaseSensitive size={17} /> Romanise
        </button>
      )}
      {can.translate && (
        <button onClick={() => useSettings.setState({ lyricsTranslate: !on.translate })} aria-pressed={on.translate} title={`Translate to ${languageName(to)}`} className={pill(on.translate)}>
          <Languages size={15} /> Translate
        </button>
      )}
    </>
  );
}

// Edit a song's lyrics (yours then beat every source), and make a lyric card from them.
function LyricTools({ track, lyrics }: { track?: Track; lyrics?: Lyrics | null }) {
  const by = useTiming((s) => (track ? s.songs[songKey(track)] ?? 0 : 0));
  if (!track) return null;
  return (
    <>
      {lyrics?.synced && (
        <span className="flex items-center rounded-full bg-white/15 text-sm font-semibold">
          <button onClick={() => nudgeLyrics(track, -0.25)} aria-label="Lyrics Earlier" title="Lyrics Earlier" className="press grid size-8 place-items-center rounded-full hover:bg-white/15">
            <Minus size={14} />
          </button>
          <button onClick={() => nudgeLyrics(track, null)} title={by ? "Reset Timing" : "Lyrics Timing"} className="min-w-10 tabular-nums">
            {by ? `${by > 0 ? "+" : ""}${by.toFixed(2)}s` : "0s"}
          </button>
          <button onClick={() => nudgeLyrics(track, 0.25)} aria-label="Lyrics Later" title="Lyrics Later" className="press grid size-8 place-items-center rounded-full hover:bg-white/15">
            <Plus size={14} />
          </button>
        </span>
      )}
      <button onClick={() => editLyrics(track)} aria-label="Edit Lyrics" title="Edit Lyrics" className={round}>
        <PencilLine size={15} />
      </button>
      {lyrics?.lines.some((l) => l.text) && (
        <button onClick={() => makeCard(track)} aria-label="Lyric Card" title="Lyric Card" className={round}>
          <Quote size={14} className="fill-current" />
        </button>
      )}
    </>
  );
}

// The editor opens on your own lyrics, or else the song's current ones (as LRC when synced) to fix.
function editLyrics(t: Track) {
  const key = songKey(t);
  const now = lyricsNow(t, true);
  const text = useMine.getState().songs[key]?.text ?? (now ? asText(now) : "");
  useStore.setState({ dialog: { kind: "edit", key, title: titleOf(t), artist: t.artists[0]?.name ?? "", text, track: t } });
}
// A card starts from the line being sung, or the first one with words.
function makeCard(t: Track) {
  const lines = lyricsNow(t)?.lines ?? [];
  const at = lineNow(lyricsNow(t));
  const first = lines[at]?.text ? at : lines.findIndex((l) => l.text);
  useStore.setState({ dialog: { kind: "card", track: t, pick: first >= 0 ? [first] : [] } });
}

const SIZES = {
  big: { ol: "max-w-5xl text-[clamp(30px,3.6vw,56px)] leading-[1.12] font-extrabold tracking-[-0.025em]", note: "text-[clamp(28px,3.2vw,44px)] tracking-tight", bar: "h-10", pad: "px-16" },
  panel: { ol: "text-[clamp(22px,2.1vw,32px)] leading-tight font-bold tracking-tight", note: "text-2xl", bar: "h-7", pad: "" },
};
const LEAD = 0.35; // the view moves this early (s), so it lands as the line starts (am-lyrics' look-ahead)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// How soft a line is, by where it sits from the one in focus (am-lyrics' falloff): the next few barely,
// the rest a little more. Lines farther than eight away go unblurred: they're off screen, and blur costs.
const blurAt = (d: number) => (Math.abs(d) > 8 ? undefined : d === -1 ? 0.035 : d === 1 || d === 2 ? 0.028 : d === 3 ? 0.05 : 0.07);
type Words = { words: Word[]; groups: Group[] };

// Lyrics that follow the song, moving the way am-lyrics (and Apple Music) does. The line being sung is
// bright and full size, the rest smaller, dimmer and softer the further they are; as the song moves on,
// the lines glide up on springs, each a beat after the last. Words lift as they're sung, the fill wipes
// across them with a soft edge, held words swell and glow letter by letter, and long instrumental
// breaks breathe with three dots. Clicking a line plays from it; scrolling by hand makes every line
// sharp for five seconds. live: on screen. It re-renders only when the line changes; all motion is
// painted straight to the DOM, and lines move on the GPU. The system's Reduce Motion doesn't stop it (it
// looked broken without its motion); Settings → Lyrics has a switch of its own.
function LyricLines({ track, lyrics, extras, live, size = "panel" }: { track?: Track; lyrics: ReturnType<typeof useLyrics>; extras: Extras; live: boolean; size?: keyof typeof SIZES }) {
  const { value, loading } = lyrics;
  const at = useLine(value);
  const ahead = useLine(value, LEAD);
  const box = useRef<HTMLDivElement>(null);
  const held = useRef(0); // when you last scrolled by hand: the view leaves you there for five seconds
  const [scrolling, setScrolling] = useState(false);
  const motion = useRef<Motion>({ springs: new Map(), tops: new WeakMap(), width: 0 });
  const shown = useRef<Lyrics | null>(null); // the lyrics last laid out: new ones jump, rather than glide
  const synced = !!value?.synced;
  const lines = value?.lines ?? [];
  const sz = SIZES[size];
  const estimate = useSettings((s) => s.lyricsWords);
  const still = useSettings((s) => s.lyricsStill);

  // The lines around the one being sung, as words: their own timings when they have them (and show their
  // own words, not a romanisation); otherwise, unless Settings says not to, spread by the words' lengths.
  const near = useMemo(() => {
    const out = new Map<number, Words>();
    for (const i of synced ? new Set([at - 1, at, ahead]) : []) {
      const line = lines[i];
      if (!line?.text) continue;
      const roman = extras.romanised?.[i];
      const real = !!line.words && !roman;
      const words = real ? line.words! : estimate ? estimateWords(lines, i, roman ?? line.text) : undefined;
      if (words) out.set(i, { words, groups: groups(words, real) });
    }
    return out;
  }, [value, at, ahead, extras.romanised, estimate]);

  // The line coming up sits a third of the way down. Opening, or a new song, jumps there (before it's
  // drawn, so it never flashes the top); after that the lines spring there. Any render that moves lines
  // (backing vocals opening, a break's row closing, a translation coming in) springs them from where they
  // were too, so nothing jumps; while you scroll by hand the view stays where you put it.
  useLayoutEffect(() => {
    const root = box.current;
    if (!live || !root || !value) return void (shown.current = null);
    const el = synced && Date.now() - held.current >= 5000 ? root.querySelector<HTMLElement>(`[data-line="${Math.max(0, ahead)}"]`) : null;
    const glide = shown.current === value && !still;
    shown.current = value;
    cascade(root, el, Math.max(0, ahead), motion.current, glide);
  });

  // The line being sung, every frame while playing and again on a pause or seek: the fill, each word's
  // lift, held words' letters, backing vocals, and an instrumental break's dots. The player's events
  // wake it without a re-render.
  useEffect(() => {
    const root = box.current;
    if (!live || !root) return;
    // After a seek back, lines still to come lose the lift they had.
    root.querySelectorAll<HTMLElement>("[data-line]").forEach((l) => {
      if (+l.dataset.line! <= at) return;
      l.querySelectorAll(".lw[data-on]").forEach((w) => w.removeAttribute("data-on"));
      l.querySelectorAll<HTMLElement>(".lc").forEach((c) => (c.style.transform = ""));
    });
    const el = root.querySelector<HTMLElement>(`[data-line="${at}"]`);
    if (!el) return;
    const set = near.get(at);
    const line = lines[at];
    const all = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
    const syl = all("[data-s]:not([data-c])"), chars = all("[data-c]"), lifts = all(".lw[data-g]"), letters = all(".lc"), bg = all("[data-b]");
    const gap = el.classList.contains("lyric-gap") && el.firstElementChild ? (el.firstElementChild as HTMLElement) : undefined;
    let frame = 0;
    const paint = () => {
      const now = audio.currentTime;
      if (set) {
        const p = wordProgress(set.words, lines, at, now);
        syl.forEach((s) => s.style.setProperty("--p", String(p[+s.dataset.s!])));
        chars.forEach((c) => c.style.setProperty("--p", String(clamp01(p[+c.dataset.s!] * +c.dataset.n! - +c.dataset.k!))));
        lifts.forEach((w) => w.toggleAttribute("data-on", now >= set.groups[+w.dataset.g!].start));
        if (!still) letters.forEach((c) => letter(c, set.groups[+c.dataset.g!], now));
      }
      if (line?.bgWords && bg.length) {
        const p = wordProgress(line.bgWords, lines, at, now);
        bg.forEach((s) => s.style.setProperty("--p", String(p[+s.dataset.b!])));
      }
      if (gap) breathe(gap, line.time, lines[at + 1].time, now, still);
      frame = audio.paused ? 0 : requestAnimationFrame(paint);
    };
    const wake = () => (cancelAnimationFrame(frame), paint());
    wake();
    const off = subscribeAudio(wake);
    // Held words left mid-swell (a seek, or the line moving on) come to rest, raised and unlit.
    return () => (off(), cancelAnimationFrame(frame), set && letters.forEach((c) => letter(c, set.groups[+c.dataset.g!], Infinity)));
  }, [live, at, near, still]);

  const quiet = useRef(0);
  const hold = () => {
    held.current = Date.now();
    setScrolling(true);
    clearTimeout(quiet.current);
    quiet.current = setTimeout(() => setScrolling(false), 5000);
  };
  const seekTo = (time: number) => {
    held.current = 0;
    setScrolling(false);
    audio.currentTime = time;
    if (audio.paused) void toggle();
  };
  const note = `font-bold ${sz.note}`;
  const google = extras.translation && extras.romanised && !value?.lines.some((l) => l.roman) ? "Translation and romanisation" : extras.translation ? "Translation" : extras.romanised && !value?.lines.some((l) => l.roman) ? "Romanisation" : "";

  if (!track) return null;
  if (loading && !value)
    return (
      <div role="status" className={`flex animate-pulse flex-col gap-4 pt-6 ${sz.pad}`}>
        <span className="sr-only">Loading lyrics…</span>
        {[70, 55, 80, 45, 65].map((w) => <div key={w} className={`rounded-full bg-white/15 ${sz.bar}`} style={{ width: `${w}%` }} />)}
      </div>
    );
  // No source had any, or none answered (they're asked again next time): no lyrics either way, no error.
  if (!value) return <p className={`pt-6 ${note} ${sz.pad}`}>No lyrics for this one yet.</p>;
  if (value.instrumental) return <p className={`pt-6 ${note} ${sz.pad}`}>♪ Instrumental</p>;

  const focus = Math.max(0, ahead);
  return (
    <div
      ref={box}
      onWheel={hold}
      onTouchMove={hold}
      onKeyDown={hold}
      onPointerDown={(e) => e.target === e.currentTarget && hold()}
      data-plain={!synced || undefined}
      data-blur={(synced && !scrolling) || undefined}
      data-scrolling={scrolling || undefined}
      data-duet={lines.some((l) => l.side) || undefined}
      data-still={still || undefined}
      className={`lyrics relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent,black_5%,black_75%,transparent)] ${sz.pad}`}
    >
      <ol className={`pt-[8vh] ${sz.ol}`}>
        {lines.map((l, i) => {
          if (!l.text) {
            if (!synced) return <li key={i} aria-hidden className="h-[0.8em]" />;
            // A break: three dots when it's an instrumental of 7 s or more, otherwise nothing to see. Its row
            // opens with the view moving to it and closes as the view moves on; the dots show while it plays.
            const long = lines[i + 1] && lines[i + 1].time - l.time >= 7;
            return (
              <li key={i} data-line={i} aria-hidden className="lyric-gap" data-on={(long && i === ahead) || undefined} data-state={i === at ? "now" : undefined}>
                {long && <span className="lyric-dots"><i /><i /><i /></span>}
              </li>
            );
          }
          const text = extras.romanised?.[i] ?? l.text;
          const sub = extras.translation?.[i];
          const d = i - focus;
          const state = !synced ? undefined : i === at ? "now" : i === ahead ? "pre" : undefined;
          const blur = synced && !state ? blurAt(d) : undefined;
          const words = near.get(i);
          const body = (
            <>
              {words ? <LineWords {...words} /> : text}
              {l.bg && (
                <span className="bgv">
                  <span>{i === at && l.bgWords ? l.bgWords.map((w, j) => <span key={j} data-b={j} className="sung">{w.text}</span>) : l.bg}</span>
                </span>
              )}
              {sub && <span dir="auto" className="mt-1 block text-[0.6em] leading-snug font-semibold opacity-80">{sub}</span>}
            </>
          );
          return (
            <li
              key={i}
              data-line={i}
              data-state={state}
              data-dist={synced && d ? Math.min(4, Math.abs(d)) : undefined}
              data-side={l.side}
              dir={isRtl(text) ? "rtl" : undefined}
              className="lyric"
              style={blur ? ({ "--f": `blur(${blur}em)` } as CSSProperties) : undefined}
            >
              {synced ? (
                <button onClick={() => seekTo(l.time)} className="lyric-body">{body}</button>
              ) : (
                <p className="py-1">{body}</p>
              )}
            </li>
          );
        })}
      </ol>
      {/* The padding under it lets the last line scroll up to where the others are read. */}
      <p className="mt-8 pb-[45vh] text-sm font-semibold text-white/70">
        {synced ? "" : "These lyrics aren’t synced to the song yet. "}
        {value.source === "you" ? "Your own lyrics." : `Lyrics from ${value.source}.`}
        {value.writers && ` Written by ${value.writers}.`}
        {google && ` ${google} by Google.`}
      </p>
    </div>
  );
}

// A line as words. A word wraps its syllables, filled one by one, and lifts as it's sung; a word that
// moves letter by letter (held, or Chinese and Japanese) wraps each letter instead, filled in turn.
function LineWords({ words, groups }: Words) {
  return groups.map((g, gi) => {
    const syl = words.slice(g.first, g.first + g.count).map((w, j) => (j === g.count - 1 ? w.text.trimEnd() : w.text));
    let n = 0;
    const size = syl.reduce((a, t) => a + [...t].length, 0);
    return (
      <Fragment key={gi}>
        <span className="lw" data-g={g.motion === "none" ? gi : undefined}>
          {g.motion === "none"
            ? syl.map((t, j) => <span key={j} data-s={g.first + j} className="sung">{t}</span>)
            : syl.flatMap((t, j) =>
                [...t].map((c, k, cs) => (
                  <span key={`${j}.${k}`} className="lc" data-g={gi} data-i={n++} data-w={size}>
                    <span className="sung" data-c data-s={g.first + j} data-k={k} data-n={cs.length} data-glyph={c}>{c}</span>
                  </span>
                )),
              )}
        </span>
        {g.space}
      </Fragment>
    );
  });
}

// A held word's letter (am-lyrics' character motion): one after another, each swells, lifts and fans out
// from the word's middle, glowing, then settles a little raised. The longer the hold, the more (full at
// 2 s). Chinese and Japanese characters instead rise in on a bouncier spring, without the glow.
function letter(el: HTMLElement, g: Group, now: number) {
  const i = +el.dataset.i!, n = +el.dataset.w!;
  const d = Math.max(0.001, g.end - g.start);
  const rise = g.motion === "rise";
  const stagger = (d / n) * (rise ? 0.4 : 0.35);
  const delay = rise ? Math.min(stagger, 0.05, 0.2 / n) : Math.min(stagger, 0.35);
  const hold = (2 * d) / n, response = Math.min(3, d);
  const strength = rise ? 0 : clamp01(d - 1);
  const glow = rise ? 0 : 0.45 * clamp01((d - 1) / 0.5);
  const span = Math.max(hold + response * 2, rise ? 3 : 0);
  const t = now - g.start - (i + 1) * delay;
  const glyph = el.firstElementChild as HTMLElement;
  if (t <= 0 || t >= span) {
    el.style.transform = t <= 0 ? "" : "translateY(-3px)";
    return glyph.style.removeProperty("--glow");
  }
  const up = rise ? 1 - sampleSpring(1, 0, t, Math.sqrt(14), 3.5).position : springProgress(t, response);
  const swell = springProgress(t, response) * (1 - springProgress(t - hold, response));
  el.style.transform = `translate(${(i - (n - 1) / 2) * 0.05 * strength * swell}em, ${-3 * up - 2.5 * strength * swell}px) scale(${1 + 0.1 * strength * swell})`;
  if (glow) {
    const x = t / span; // the glow's curve: up fast, peak at 30 %, gone by the end
    const k = x < 0.15 ? (x / 0.15) * 0.8 : x < 0.3 ? 0.8 + ((x - 0.15) / 0.15) * 0.2 : x < 0.6 ? 1 - ((x - 0.3) / 0.3) * 0.7 : 0.3 * (1 - (x - 0.6) / 0.4);
    glyph.style.setProperty("--glow", String(glow * k));
  }
}

// An instrumental break (am-lyrics' gap): three dots grow in, breathe, fill one by one across the break,
// then pop and vanish just before the singing comes back.
function breathe(el: HTMLElement, start: number, end: number, now: number, still: boolean) {
  const t = now - start, out = end - start - 0.6; // the pop takes the last 0.6 s
  let scale: number, opacity: number;
  if (t >= out) {
    const x = clamp01((t - out) / 0.6), pop = x <= 0.35, y = pop ? x / 0.35 : (x - 0.35) / 0.65, ease = y * y * (3 - 2 * y);
    scale = pop ? 0.85 + 0.35 * ease : 1.2 * (1 - ease);
    opacity = pop ? 1 : 1 - ease;
  } else {
    // Breathing between 1.12 and 0.85 every 4 s, timed to be at its smallest as the pop starts.
    const phase = (((t + 4 - (out % 8)) % 8) + 8) % 8;
    const mix = (1 - Math.cos((Math.PI * phase) / 4)) / 2;
    const grow = Math.min(1, t / 0.4);
    scale = still ? 1 : (1.12 - 0.27 * mix) * (grow === 1 ? 1 : 1 - 2 ** (-10 * grow));
    opacity = clamp01(t / 0.16);
  }
  el.style.setProperty("--gs", String(scale));
  el.style.setProperty("--go", String(opacity));
  [...el.children].forEach((dot, k) => (dot as HTMLElement).style.setProperty("--d", String(0.25 + 0.75 * clamp01((t - (k * out) / 3) / (out / 3)))));
}

// am-lyrics' scroll: the view jumps to the line (el; none while you scroll by hand), then every line near
// it springs from where it was on screen to where it now is, each a beat (50 ms) after the one before.
// Where it was counts its spring so far and any change of layout since the last render: as in am-lyrics,
// heights change at once and the springs carry the move. Only translate is animated, which the GPU runs
// on its own. glide false: just jump.
type Spring = { anim: Animation; pos: number; vel: number; delay: number };
type Motion = { springs: Map<Element, Spring>; tops: WeakMap<Element, number>; width: number };
let unit: { offset: number; p: number; v: number }[] | undefined;
const springFrames = (pos: number, vel: number) =>
  (unit ??= Array.from({ length: 97 }, (_, f) => ({ offset: f / 96, p: f === 96 ? 0 : sampleSpring(1, 0, (1.2 * f) / 96, 10).position, v: f === 96 ? 0 : sampleSpring(0, 1, (1.2 * f) / 96, 10).position }))).map(({ offset, p, v }) => ({ offset, translate: `0 ${pos * p + vel * v}px` }));
function cascade(root: HTMLElement, el: HTMLElement | null, ref: number, m: Motion, glide: boolean) {
  const { springs } = m;
  const items = [...root.querySelectorAll<HTMLElement>("[data-line]")];
  const known = glide && root.clientWidth === m.width; // no resize since, so the old places still hold
  const moved = items.map((item) => (known ? (m.tops.get(item) ?? item.offsetTop) - item.offsetTop : 0));
  const from = root.scrollTop;
  if (el) root.scrollTop = el.offsetTop - root.clientHeight * 0.3;
  const delta = root.scrollTop - from;
  m.width = root.clientWidth;
  items.forEach((item) => m.tops.set(item, item.offsetTop));
  if (!glide || (Math.abs(delta) < 1 && moved.every((d) => Math.abs(d) < 0.5))) {
    if (!glide) springs.forEach((s) => s.anim.cancel()), springs.clear();
    return;
  }
  const retarget = springs.size > 0;
  const poses = items.map((item) => {
    const s = springs.get(item);
    const ran = s ? Number(s.anim.currentTime ?? 0) / 1000 : 0;
    return s && { ...sampleSpring(s.pos, s.vel, Math.max(0, ran - s.delay), 10), delay: Math.max(0, s.delay - ran) };
  });
  springs.forEach((s) => s.anim.cancel());
  springs.clear();
  const lo = Math.min(from, root.scrollTop) - 200, hi = Math.max(from, root.scrollTop) + root.clientHeight + 200;
  items.forEach((item, i) => {
    const pose = poses[i] || { position: 0, velocity: 0, delay: 0 };
    const pos = pose.position + delta + moved[i];
    const top = item.offsetTop;
    if (Math.abs(i - ref) > 20 || (!poses[i] && (top + item.offsetHeight < lo || top > hi)) || (Math.abs(pos) < 0.1 && Math.abs(pose.velocity) < 0.1)) return;
    const wait = retarget ? pose.delay : Math.max(0, Math.min(4, delta >= 0 ? i - ref : ref - i)) * 0.05;
    const anim = item.animate(springFrames(pos, pose.velocity), { duration: 1200, delay: wait * 1000, fill: "both", easing: "linear" });
    const s = { anim, pos, vel: pose.velocity, delay: wait };
    springs.set(item, s);
    anim.onfinish = () => springs.get(item) === s && (anim.cancel(), springs.delete(item));
  });
}

// One style for every modal: a card over a dimmed window. A click outside or Esc closes it, and it keeps
// the keyboard to itself, so app shortcuts (⌘S is Shuffle) don't fire while you type in it.
function Modal({ label, onClose, className, children }: { label: string; onClose: () => void; className: string; children: ReactNode }) {
  return createPortal(
    <div onPointerDown={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && onClose())}
        className={`flex max-h-full animate-enter flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-2xl ring-1 shadow-black/30 ring-ink/10 ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  return dialog?.kind === "edit" ? <LyricsEditor d={dialog} /> : dialog?.kind === "card" ? <LyricCard d={dialog} /> : dialog?.kind === "versions" ? <Versions d={dialog} /> : dialog?.kind === "songs" ? <SongImport key={dialog.paths[0]} d={dialog} /> : dialog?.kind === "warn" ? <Warning d={dialog} /> : dialog?.kind === "link" ? <LinkImport /> : dialog?.kind === "spotify" ? <SpotifyImport /> : dialog?.kind === "saved" ? <SavedIn key={dialog.track.id} d={dialog} /> : null;
}
const closeDialog = () => useStore.setState({ dialog: undefined });

function Warning({ d }: { d: Extract<Dialog, { kind: "warn" }> }) {
  return (
    <Modal label={d.title} onClose={closeDialog} className="w-[400px] p-6">
      <p className="text-lg leading-snug font-bold text-balance">{d.title}</p>
      {d.text && <p className="mt-1.5 text-sm text-muted">{d.text}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={closeDialog} className={quiet}>Cancel</button>
        <button autoFocus onClick={() => (closeDialog(), d.then())} className={`${btn} bg-[#ff375f] text-white`}>{d.yes}</button>
      </div>
    </Modal>
  );
}

// A playlist or album from another app, by its link (import.ts importLink). Pasting one anywhere does the same.
function LinkImport() {
  const [text, setText] = useState("");
  const go = () => isLink(text) && (closeDialog(), void importLink(text));
  return (
    <Modal label="Import from a Link" onClose={closeDialog} className="w-[440px] p-6">
      <p className="text-lg leading-snug font-bold">Import from a Link</p>
      <p className="mt-1.5 text-sm text-muted">A playlist or album from Spotify, Apple Music, Deezer or YouTube Music. Pasting a link anywhere in the app works too.</p>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="https://open.spotify.com/playlist/…" aria-label="Link" autoComplete="off" spellCheck={false} className="mt-4 h-10 w-full rounded-lg bg-ink/[0.06] px-3 text-sm outline-none placeholder:text-muted focus:ring-2 focus:ring-accent" />
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={closeDialog} className={quiet}>Cancel</button>
        <button disabled={!isLink(text)} onClick={go} className={solid}>Import</button>
      </div>
    </Modal>
  );
}

// Your Spotify library, once you're signed in (spotify.ts): everything is ticked, untick what stays behind.
function SpotifyImport() {
  const name = useSpotify((s) => s.name);
  const history = useSettings((s) => s.history);
  const [lib, setLib] = useState<Awaited<ReturnType<typeof contents>>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(() => new Set<string>()); // unticked: playlist ids, or liked, albums, artists, recent
  const say = (e: unknown) => setError(String(e instanceof Error ? e.message : e));
  useEffect(() => void (name && contents().then(setLib, say)), [name]);
  const tick = (id: string) => setOff((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])));
  const signIn = () => (setBusy(true), setError(""), connect().catch(say).finally(() => setBusy(false)));
  const on = (id: string) => !off.has(id) && (id !== "recent" || history);
  const picked = lib ? lib.playlists.filter((p) => on(p.id)) : [];
  const any = !!lib && (picked.length > 0 || ["liked", "albums", "artists", "recent"].some(on));
  const go = () => lib && (closeDialog(), void importSpotify({ playlists: picked, liked: on("liked"), albums: on("albums"), artists: on("artists"), recent: on("recent") }));
  // A plain function, not a component, so ticking one keeps its focus.
  const row = (id: string, cover: ReactNode, title: string, detail: string) => (
    <li key={id}>
      <label className={`flex h-14 items-center gap-3 rounded-xl px-2 hover:bg-ink/[0.05] ${id === "recent" && !history ? "opacity-50" : ""}`}>
        {cover}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{title}</div>
          <div className="truncate text-sm text-muted">{detail}</div>
        </div>
        <input type="checkbox" checked={on(id)} disabled={id === "recent" && !history} onChange={() => tick(id)} className="size-4 shrink-0 accent-accent" />
      </label>
    </li>
  );
  const tile = (bg: string, icon: ReactNode) => <div className={`grid size-10 shrink-0 place-items-center rounded-md text-white ${bg}`}>{icon}</div>;
  return (
    <Modal label="Import from Spotify" onClose={closeDialog} className="flex max-h-[86vh] w-[min(520px,94vw)] flex-col">
      <header className="px-6 pt-5">
        <h2 className="text-xl font-bold tracking-tight">Import from Spotify</h2>
        <p className="text-sm text-muted">{name ? `Signed in as ${name}. Untick anything you’d rather leave behind.` : "Sign in to bring over your playlists, Liked Songs, albums and artists. Your recent plays join your History, and keep coming in while you’re signed in."}</p>
      </header>
      {lib ? (
        <ul className="mt-3 min-h-0 flex-1 overflow-y-auto px-4">
          {row("liked", tile(LIKED, <Heart size={16} className="fill-white" />), "Liked Songs", plural(lib.liked, "song"))}
          {row("albums", tile(tint("b"), <Disc3 size={18} />), "Albums", plural(lib.albums, "album"))}
          {row("artists", tile(tint("c"), <UserCheck size={18} />), "Artists", plural(lib.artists, "artist"))}
          {row("recent", tile(tint("a"), <HistoryIcon size={18} />), "Recent Plays", history ? "Your last 50 plays, into History" : "History is off in Settings")}
          {lib.playlists.length > 0 && (
            <li className="flex items-baseline px-2 pt-4 pb-1">
              <span className="text-sm font-semibold text-muted">Playlists</span>
              <button onClick={() => setOff((o) => new Set(lib.playlists.every((p) => !o.has(p.id)) ? [...o, ...lib.playlists.map((p) => p.id)] : [...o].filter((id) => !lib.playlists.some((p) => p.id === id))))} className="ml-auto text-sm font-semibold text-accent">
                {lib.playlists.every((p) => !off.has(p.id)) ? "Select None" : "Select All"}
              </button>
            </li>
          )}
          {lib.playlists.map((p) => {
            const n = (p.items ?? p.tracks)?.total;
            return row(p.id, <img src={p.images?.[0]?.url} alt="" loading="lazy" className="size-10 shrink-0 rounded-md object-cover" />, p.name, [n !== undefined && plural(n, "song"), p.owner?.display_name !== name && p.owner?.display_name && `by ${p.owner.display_name}`].filter(Boolean).join(" · "));
          })}
        </ul>
      ) : (
        name && !error && <span className="spinner mx-auto my-8 block size-5 text-muted" />
      )}
      {error && <p className="px-6 pt-3 text-sm text-[#ff375f]">{error}</p>}
      <footer className="flex items-center gap-2 px-6 py-4">
        {name && <button onClick={() => (disconnect(), setLib(undefined))} className={quiet}>Sign Out</button>}
        <div className="ml-auto flex gap-2">
          <button onClick={closeDialog} className={quiet}>Cancel</button>
          {name ? <button disabled={!any} onClick={go} className={solid}>Import</button> : <button disabled={busy} onClick={signIn} className={`${btn} bg-[#1ed760] text-black`}>{busy ? "Waiting for Spotify…" : "Sign In with Spotify"}</button>}
        </div>
      </footer>
    </Modal>
  );
}

// Songs dropped on the window, one at a time before they go into Local Files: what the file says, read
// sensibly (local.ts guessTags), then the original song looked up (lookUp) for its artist, album, year,
// genre and cover. Everything stays editable; Skip keeps the file's own tags. editing: opened again from a
// song's menu, starting from what you saved, with no lookup.
function SongImport({ d }: { d: Extract<Dialog, { kind: "songs" }> }) {
  const files = useLocal((s) => s.files);
  const [at, setAt] = useState(0);
  const pickCover = useRef<HTMLInputElement>(null);
  const coverPicked = (f: Blob) => {
    const r = new FileReader();
    r.onload = () => (touched.current.add("cover"), setEdit((x) => ({ ...x, cover: String(r.result) })));
    r.readAsDataURL(f);
  };
  const touched = useRef(new Set<keyof SongEdit>()); // what you've changed; the lookup leaves those alone
  const path = d.paths[at];
  const file = files[path];
  const saved = d.editing ? useLocal.getState().edits[path] : undefined;
  const [edit, setEdit] = useState<SongEdit>(() => saved ?? guessTags(file));
  const [found, setFound] = useState<Awaited<ReturnType<typeof lookUp>> | null>(null);
  // Lookups by file, so the next song's is already under way (or done) by the time you get to it.
  const asked = useRef(new Map<string, ReturnType<typeof lookUp>>());
  const ask = (p: string) => asked.current.get(p) ?? asked.current.set(p, identify(p, guessTags(files[p]))).get(p)!;
  // What was found fills in everything you haven't changed here; a song moved on from drops its answer.
  const stop = useRef<() => void>(undefined);
  const look = () => {
    let live = true;
    setFound(null), stop.current?.(), (stop.current = () => void (live = false));
    ask(path).then(
      (f) =>
        live &&
        (setFound(f),
        f &&
          setEdit((e) => {
            const mine = Object.fromEntries([...touched.current].map((k) => [k, e[k]]));
            return { ...f.edit, cover: files[path].cover ? undefined : f.edit.cover, ...mine };
          })),
    );
  };
  useEffect(() => {
    const own = saved ?? guessTags(files[path]);
    setEdit(own), touched.current.clear();
    if (saved) return setFound(undefined);
    if (d.paths[at + 1]) ask(d.paths[at + 1]);
    look();
    return () => stop.current?.();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  // Edit Song Info shows what you saved; this looks the file up afresh, from its own tags and sound.
  const again = () => (asked.current.delete(path), look());
  const next = (save: boolean) => {
    // The ISRC is of the song as heard; retitled, it may be another.
    const from = found?.edit ?? saved, same = from && edit.title === from.title && edit.artist === from.artist;
    if (save) useLocal.setState((s) => ({ edits: { ...s.edits, [path]: { ...edit, isrc: same ? edit.isrc : undefined } } }));
    // Now another song: its YouTube match (for radio) and lyrics are found again as that.
    if (save && saved && (edit.title !== saved.title || edit.artist !== saved.artist || edit.feat !== saved.feat)) findAgain([`file:${path}`]), lookAgain(fileTrack(file));
    if (at < d.paths.length - 1) return setAt(at + 1);
    if (!d.editing) addedFiles(d.paths);
    closeDialog();
  };
  const cover = edit.cover ?? (file.cover && convertFileSrc(file.cover));
  const looking = found === null;
  const rows: [keyof SongEdit, string, string?][] = [["title", "Title"], ["artist", "Artist"], ["feat", "Featuring", "Other artists"], ["album", "Album"], ["year", "Year"], ["genre", "Genre"]];
  return (
    <Modal label={d.editing ? "Edit Song Info" : "Review Song"} onClose={closeDialog} className="w-[min(600px,94vw)]">
      <header className="flex items-start gap-4 px-6 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold tracking-tight">{d.editing ? "Edit Song Info" : "Review Song"}{d.paths.length > 1 && <span className="ml-2 text-base font-semibold text-muted">{at + 1} of {d.paths.length}</span>}</h2>
          <p className="mt-0.5 text-muted">{d.editing ? "Fix anything that’s off. Only Sleeve changes, not the file." : "Check what we found before it’s added to your library."}</p>
        </div>
        <button onClick={closeDialog} aria-label="Close" className="press grid size-8 shrink-0 place-items-center rounded-full bg-ink/[0.08] hover:bg-ink/[0.14]">
          <X size={16} />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto px-6 pt-5 pb-2">
        <div key={path} className="flex animate-enter items-center gap-5">
          <div className="relative size-40 shrink-0 overflow-hidden rounded-xl bg-ink/[0.06] shadow-xl shadow-black/25">
            {cover ? <img key={cover} src={art(cover, 400)} alt="" className="size-full animate-[fade_0.4s] object-cover" /> : <Music size={44} className={`absolute inset-0 m-auto text-muted ${looking ? "animate-pulse" : ""}`} />}
            {/* "" is no cover at all, the file's own included. */}
            {cover && (
              <button onClick={() => (touched.current.add("cover"), setEdit({ ...edit, cover: "" }))} aria-label="Remove Cover" title="Remove Cover" className="press absolute bottom-2 left-2 grid size-9 place-items-center rounded-full bg-red-500 text-white shadow-lg">
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={() => pickCover.current?.click()} aria-label="Change Cover" title="Change Cover" className="press absolute right-2 bottom-2 grid size-9 place-items-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur">
              <PencilLine size={16} />
            </button>
            <input
              ref={pickCover}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const r = new FileReader();
                r.onload = () => (touched.current.add("cover"), setEdit((x) => ({ ...x, cover: String(r.result) })));
                r.readAsDataURL(f);
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-xl font-bold leading-tight">{edit.title || "Untitled"}</div>
            <div className="mt-1 truncate text-lg font-semibold text-accent">{[edit.artist, edit.feat].filter(Boolean).join(", ") || "Unknown Artist"}</div>
            {edit.album && <div className="mt-1 truncate text-ink/70">{edit.album}</div>}
            {edit.year && <div className="text-sm text-muted">{edit.year}</div>}
            <div className="mt-3 truncate text-xs text-muted" title={path}>{path.split(/[\\/]/).pop()}</div>
          </div>
        </div>
        <div className="mt-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${looking ? "bg-ink/[0.06] text-muted" : found?.sure ? "bg-green-500/15 text-green-500" : found ? "bg-amber-500/15 text-amber-500" : "bg-ink/[0.06] text-muted"}`}>
            {looking ? <><span className="spinner size-3.5" /> Looking it up…</> : found ? <><Music size={14} /> {found.source} · {found.sure ? "High confidence" : "Best guess"}</> : saved ? "Your saved info" : "Not found online · from the file"}
          </span>
          {!looking && found?.note && <span className="ml-2 text-sm text-amber-500">{found.note}</span>}
          {d.editing && !looking && (
            <button onClick={again} className="press ml-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold text-muted hover:bg-ink/[0.06] hover:text-ink">
              <RefreshCw size={14} /> Look Up Again
            </button>
          )}
        </div>
        <div className="mt-4 divide-y divide-ink/10 overflow-hidden rounded-xl bg-ink/[0.04]">
          {rows.map(([key, label, hint]) => (
            <label key={key} className="flex items-center gap-4 px-4 focus-within:bg-ink/[0.03]">
              <span className="w-24 shrink-0 text-muted">{label}</span>
              <input value={edit[key] ?? ""} onChange={(e) => (touched.current.add(key), setEdit({ ...edit, [key]: e.target.value }))} placeholder={hint ?? "—"} spellCheck={false} inputMode={key === "year" ? "numeric" : undefined} className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-muted/60" />
            </label>
          ))}
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 px-6 pt-3 pb-5">
        <button onClick={() => (d.editing ? closeDialog() : next(false))} className="press rounded-full px-5 py-2.5 font-semibold hover:bg-ink/[0.06]">{d.editing ? "Cancel" : "Skip"}</button>
        <button onClick={() => next(true)} className={`press rounded-full px-6 py-2.5 font-semibold transition-colors duration-300 ${looking ? "bg-ink/[0.07] text-ink" : "bg-accent text-paper"}`}>{d.editing ? "Save" : at < d.paths.length - 1 ? "Apply & Next" : "Apply Changes"}</button>
      </footer>
    </Modal>
  );
}

// Right-click → Wrong Version? Re-resolve: other copies of the song on YouTube (play one to check it). Picking one keeps
// it for this song from then on.
function Versions({ d }: { d: Extract<Dialog, { kind: "versions" }> }) {
  const t = d.track, { data, loading } = useAsync(() => versions(t), [t.id]);
  const [now, setNow] = useState<string>();
  useEffect(() => void youtubeId(t).then(setNow, () => {}), [t.id]);
  return (
    <Modal label="Pick the Right Version" onClose={closeDialog} className="flex max-h-[86vh] w-[min(520px,94vw)] flex-col">
      <header className="px-6 pt-5">
        <h2 className="text-xl font-bold tracking-tight">Pick the Right Version</h2>
        <p className="truncate text-sm text-muted">{t.title} · {t.artists.map((a) => a.name).join(", ")}</p>
      </header>
      <div className="mt-3 grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto px-6">
        {loading && <p className="text-sm text-muted">Searching…</p>}
        {!loading && !data?.length && <p className="text-sm text-muted">No other versions found.</p>}
        {data?.map((v) => {
          const on = now === v.id;
          return (
            <div key={v.id} className={`group relative flex items-center gap-2.5 rounded-xl p-1.5 ${on ? "bg-accent/15 ring-1 ring-accent" : "bg-ink/[0.05] hover:bg-ink/[0.09]"}`}>
              <button onClick={() => (setNow(v.id), pin(t, v.id))} aria-pressed={on} aria-label={`Use ${v.title} by ${v.artists[0]?.name}`} className="hit" />
              <button onClick={() => play([v], 0)} aria-label={`Play ${v.title}`} className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                <img src={art(v.thumb, 80)} alt="" className="absolute inset-0 size-full object-cover" />
                <Play size={14} className="relative fill-white text-white opacity-0 drop-shadow group-hover:opacity-100" />
              </button>
              <div className="pointer-events-none min-w-0 flex-1 text-sm">
                <div className="truncate font-semibold">{v.title}</div>
                <div className="truncate text-muted">{[v.artists.map((a) => a.name).join(", "), v.album, v.duration].filter(Boolean).join(" · ")}</div>
              </div>
              {on && <Check size={16} className="pointer-events-none mr-1 shrink-0 text-accent" />}
            </div>
          );
        })}
      </div>
      <footer className="flex justify-end px-6 py-4">
        <button onClick={closeDialog} className={solid}>Done</button>
      </footer>
    </Modal>
  );
}

// Your own lyrics for a song: plain text, or LRC ("[01:02.50] line") to sync them. While the song plays,
// Stamp Line (⌘↩) puts its time on the line the cursor is in and moves to the next, so a song can be synced
// by tapping along.
function LyricsEditor({ d }: { d: Extract<Dialog, { kind: "edit" }> }) {
  const [text, setText] = useState(d.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const mine = useMine((s) => s.songs[d.key]);
  const playing = useStore((s) => !!d.track && s.queue[s.index]?.id === d.track.id);
  const save = () => (saveMine(d.key, d, text), closeDialog());
  const stampLine = () => {
    const el = area.current!;
    const start = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const end = text.indexOf("\n", el.selectionStart) < 0 ? text.length : text.indexOf("\n", el.selectionStart);
    const line = `[${lrcTime(audio.currentTime)}] ${text.slice(start, end).replace(/^\s*(\[\d+:\d+(?:[.:]\d+)?\]\s*)+/, "")}`;
    const next = text.slice(0, start) + line + text.slice(end);
    const caret = Math.min(next.length, start + line.length + 1);
    setText(next);
    requestAnimationFrame(() => el.setSelectionRange(caret, caret));
  };
  return (
    <Modal label="Edit Lyrics" onClose={closeDialog} className="h-[min(640px,86vh)] w-[min(620px,92vw)]">
      <header className="px-6 pt-5">
        <h2 className="text-xl font-bold tracking-tight">Edit Lyrics</h2>
        <p className="truncate text-sm text-muted">{d.title} · {d.artist}</p>
      </header>
      <textarea
        ref={area}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key === "Enter" && playing) e.preventDefault(), stampLine();
          else if (mod && e.key.toLowerCase() === "s") e.preventDefault(), save();
        }}
        aria-label="Lyrics"
        spellCheck={false}
        placeholder="Type or paste the lyrics. To sync them, put a time before each line, like [01:02.50], or play the song and use Stamp Line."
        className="mx-6 mt-4 min-h-0 flex-1 resize-none rounded-xl bg-ink/[0.05] p-4 font-mono text-[13px] leading-relaxed outline-none select-text placeholder:font-sans placeholder:text-sm placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
      />
      <footer className="flex flex-wrap items-center gap-2 px-6 py-4">
        {playing && (
          <button onClick={stampLine} title="Put the song’s time on this line (⌘↩)" className={quiet}>
            Stamp Line <kbd className="font-sans text-xs text-muted">{mod}↩</kbd>
          </button>
        )}
        {mine && <button onClick={() => (removeMine(d.key), closeDialog())} className={quiet}>Remove My Lyrics</button>}
        <div className="ml-auto flex gap-2">
          <button onClick={closeDialog} className={quiet}>Cancel</button>
          <button onClick={save} className={solid}>Save</button>
        </div>
      </footer>
    </Modal>
  );
}

// A lyric card: up to four lines over one of four backdrops, as an image to save or copy.
const BACKDROPS = ["Artwork", "Colour", "Dark", "Light"] as const;
type Backdrop = (typeof BACKDROPS)[number];
function LyricCard({ d }: { d: Extract<Dialog, { kind: "card" }> }) {
  const lyrics = useMemo(() => lyricsNow(d.track), [d.track]);
  const lines = lyrics?.lines ?? [];
  const [pick, setPick] = useState(d.pick);
  const [backdrop, setBackdrop] = useState<Backdrop>("Artwork");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => void drawCard(canvas.current!, d.track, pick.map((i) => lines[i].text), backdrop), [pick, backdrop]);
  const choose = (i: number) => setPick((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < 4 ? [...p, i].sort((a, b) => a - b) : p));
  const name = `${d.track.title} - ${d.track.artists[0]?.name ?? ""}`.replace(/[\\/:*?"<>|]/g, "");
  const save = () =>
    canvas.current!.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      notify({ text: "Lyric Card Saved", detail: "Saved to your Downloads folder" });
    }, "image/png");
  // The blob as a promise keeps the click's permission to write to the clipboard (Safari needs that).
  const copy = () =>
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": new Promise<Blob>((ok, fail) => canvas.current!.toBlob((b) => (b ? ok(b) : fail()), "image/png")) })])
      .then(() => notify({ text: "Lyric Card Copied", detail: name }), () => notify({ text: "Couldn’t Copy the Card", detail: "Save it instead" }));
  return (
    <Modal label="Lyric Card" onClose={closeDialog} className="h-[min(700px,90vh)] w-[min(940px,94vw)]">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_min(360px,38vw)] gap-6 overflow-y-auto p-6">
        <div className="flex min-h-0 flex-col">
          <h2 className="text-xl font-bold tracking-tight">Lyric Card</h2>
          <p className="text-sm text-muted">Pick up to four lines.</p>
          <ol className="-mx-2 mt-4 min-h-0 flex-1 overflow-y-auto">
            {lines.map((l, i) =>
              l.text ? (
                <li key={i}>
                  <button onClick={() => choose(i)} aria-pressed={pick.includes(i)} disabled={!pick.includes(i) && pick.length >= 4} className={`w-full rounded-lg px-2 py-1.5 text-left font-semibold transition-colors disabled:opacity-40 ${pick.includes(i) ? "bg-accent text-paper" : "hover:bg-ink/[0.05]"}`}>
                    {l.text}
                  </button>
                </li>
              ) : null,
            )}
          </ol>
        </div>
        <div className="flex flex-col items-center gap-4">
          {/* Drawn at 1080 × 1350, shown at the column's width. */}
          <canvas ref={canvas} aria-label="Card preview" className="aspect-[4/5] w-full rounded-xl shadow-xl shadow-black/25" />
          <div role="radiogroup" aria-label="Backdrop" className="flex flex-wrap justify-center gap-2">
            {BACKDROPS.map((b) => (
              <button key={b} role="radio" aria-checked={backdrop === b} onClick={() => setBackdrop(b)} className={`press h-8 rounded-full px-3.5 text-sm font-semibold transition-colors ${backdrop === b ? "bg-ink text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`}>
                {b}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={copy} disabled={!pick.length} className={quiet}><Copy size={15} /> Copy Image</button>
            <button onClick={save} disabled={!pick.length} className={solid}><ImageDown size={16} /> Save Image</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// The card, 1080 × 1350: the backdrop, the song at the top, the lines big in the middle, Sleeve at the foot.
// The artwork backdrop is the cover drawn tiny and stretched, which blurs it the same in every WebView.
const cardArt = (t: Track) =>
  new Promise<HTMLImageElement | undefined>((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => ok(undefined);
    img.src = art(t.thumb, 600) ?? "";
  });
const covers = new Map<string, ReturnType<typeof cardArt>>();
async function drawCard(c: HTMLCanvasElement, t: Track, texts: string[], backdrop: Backdrop) {
  const W = 1080, H = 1350, pad = 96;
  const run = (c.dataset.run = String(+(c.dataset.run ?? 0) + 1)); // a newer draw wins
  if (!covers.has(t.id)) covers.set(t.id, cardArt(t));
  const cover = await covers.get(t.id);
  if (c.dataset.run !== run) return;
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const probe = document.createElement("i");
  document.body.append(probe);
  probe.style.color = "var(--color-accent-vivid)";
  const vivid = getComputedStyle(probe).color;
  probe.remove();
  const light = backdrop === "Light";
  ctx.fillStyle = light ? "#f5f5f7" : backdrop === "Dark" ? "#121214" : vivid;
  ctx.fillRect(0, 0, W, H);
  if (backdrop === "Artwork" && cover) {
    const tiny = document.createElement("canvas");
    tiny.width = 12;
    tiny.height = 15;
    tiny.getContext("2d")!.drawImage(cover, 0, 0, 12, 15);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, 0, 0, W, H);
    ctx.fillStyle = "rgb(0 0 0 / 0.38)";
    ctx.fillRect(0, 0, W, H);
  }
  const ink = light ? "#121212" : "#fff";
  const font = (weight: number, px: number) => `${weight} ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", system-ui, sans-serif`;
  // The song: cover and name at the top.
  if (cover) {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(pad, pad, 132, 132, 18);
    else ctx.rect(pad, pad, 132, 132);
    ctx.clip();
    ctx.drawImage(cover, pad, pad, 132, 132);
    ctx.restore();
  }
  const x = cover ? pad + 132 + 32 : pad;
  ctx.fillStyle = ink;
  ctx.font = font(700, 42);
  ctx.fillText(fit(ctx, t.title, W - pad - x), x, pad + 58);
  ctx.globalAlpha = 0.7;
  ctx.font = font(500, 36);
  ctx.fillText(fit(ctx, t.artists.map((a) => a.name).join(", "), W - pad - x), x, pad + 108);
  ctx.globalAlpha = 1;
  // The lines, wrapped, smaller the more there are, centred in the space left.
  const px = texts.length > 2 ? 64 : 76;
  ctx.font = font(800, px);
  const rows = texts.flatMap((s) => wrap(ctx, s, W - pad * 2).concat(""));
  rows.pop();
  const lead = px * 1.18;
  let y = (pad + 132 + H - pad - 60) / 2 - (rows.length * lead) / 2 + px * 0.8;
  for (const row of rows) {
    if (row) ctx.fillText(row, pad, y);
    y += row ? lead : lead * 0.45;
  }
  ctx.globalAlpha = 0.7;
  ctx.font = font(800, 34);
  ctx.fillText("Sleeve", pad, H - pad + 10);
  ctx.globalAlpha = 1;
}
function fit(ctx: CanvasRenderingContext2D, s: string, w: number) {
  if (ctx.measureText(s).width <= w) return s;
  while (s && ctx.measureText(`${s}…`).width > w) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
function wrap(ctx: CanvasRenderingContext2D, s: string, w: number) {
  const rows: string[] = [];
  for (const word of s.split(/\s+/)) {
    const row = rows.length ? `${rows[rows.length - 1]} ${word}` : word;
    if (rows.length && ctx.measureText(row).width <= w) rows[rows.length - 1] = row;
    else rows.push(fit(ctx, word, w));
  }
  return rows;
}

const isMac = /Mac/.test(navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl+";

// The file comes from anywhere, so check its shape before it replaces the library. Exports from before
// follows, folders, pins and hiding have none of them.
export async function restore(file: File) {
  const ids = (x: unknown) => Array.isArray(x) && x.every((y) => typeof y?.id === "string");
  const maybe = (x: unknown) => x === undefined || ids(x);
  try {
    const { liked, saved, playlists, followed, folders, pinned, hidden, blocked, lyrics } = JSON.parse(await file.text());
    const names = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((y) => typeof y?.name === "string"));
    const keys = pinned === undefined || (Array.isArray(pinned) && pinned.every((k: unknown) => typeof k === "string"));
    if (!ids(liked) || !ids(saved) || !ids(playlists) || !playlists.every((p: { tracks: unknown }) => ids(p.tracks)) || !maybe(followed) || !maybe(folders) || !maybe(hidden) || !names(blocked) || !keys) throw 0;
    restoreLibrary({ liked, saved, playlists, ...(followed && { followed }), ...(folders && { folders }), ...(pinned && { pinned }), ...(hidden && { hidden }), ...(blocked && { blocked }) });
    // A full export (Settings → Account) has your lyrics too: added to what's here.
    if (lyrics && typeof lyrics === "object" && Object.values(lyrics).every((m) => typeof (m as { text?: unknown })?.text === "string")) useMine.setState((s) => ({ songs: { ...s.songs, ...lyrics } }));
  } catch {
    notify({ text: "Couldn’t Restore", detail: `${file.name} isn’t a Sleeve library export` });
  }
}

// Grouped as what you'd tune, then the app itself. tint colours the icon's chip; find: extra words the search matches.
const PANES: { group: string; id: string; tint: string; label: string; icon: LucideIcon; about: string; find: string; view: () => ReactNode }[] = [
  { group: "Preferences", id: "playback", tint: "#ff9f0a", label: "Playback", icon: ListMusic, about: "What plays next, and what clicks do.", find: "autoplay double-click queue resume startup crossfade headphones device", view: Playback },
  { group: "Preferences", id: "audio", tint: "#ff375f", label: "Audio", icon: SlidersHorizontal, about: "Streaming quality, volume and the equalizer.", find: "quality data saver fetch ahead prefetch preload browsing hover normalise normalize loudness eq equalizer bass treble", view: AudioPane },
  { group: "Preferences", id: "lyrics", tint: "#bf5af2", label: "Lyrics", icon: MicVocal, about: "Where lyrics come from and how they move.", find: "translate romanise word by word sources player bar", view: LyricsPane },
  { group: "Preferences", id: "appearance", tint: "#0a84ff", label: "Appearance", icon: SunMoon, about: "Theme, colour and size.", find: "theme dark light colour color accent artwork motion zoom size", view: Appearance },
  { group: "Preferences", id: "shortcuts", tint: "#8e8e93", label: "Shortcuts", icon: Command, about: "Keyboard shortcuts, and changing them.", find: "keys keyboard hotkeys", view: Shortcuts },
  { group: "Application", id: "account", tint: "#5e5ce6", label: "Account", icon: UserRound, about: "Your profile, sync and public playlists.", find: "sign in sync profile public delete export", view: AccountPane },
  { group: "Application", id: "linked", tint: "#30d158", label: "Linked Accounts", icon: Link2, about: "Scrobbling and your Discord status.", find: "last.fm lastfm listenbrainz discord scrobble", view: LinkedAccountsPane },
  { group: "Application", id: "library", tint: "#ff6b3d", label: "Library", icon: LibraryBig, about: "Importing, exporting and what you’ve hidden.", find: "import export restore spotify csv local files folders hidden blocked artists", view: LibraryPane },
  { group: "Application", id: "storage", tint: "#7d7aff", label: "Storage", icon: HardDrive, about: "What’s kept on this computer, and the room it takes.", find: "cache downloads offline space clear lyrics size disk", view: Storage },
  { group: "Application", id: "privacy", tint: "#40c8e0", label: "Privacy", icon: LockKeyhole, about: "Your listening history, and what’s kept.", find: "private session history wrapped clear", view: Privacy },
  ...(canHaveFiles ? [{ group: "Application", id: "startup", tint: "#34c759", label: "Startup", icon: Power, about: "Opening at login, the tray and the menu bar.", find: "login tray menu bar background close", view: Startup }] : []),
  { group: "Application", id: "danger", tint: "#ff453a", label: "Danger Zone", icon: TriangleAlert, about: "Starting over, in part or in full. Everything asks first.", find: "reset defaults delete playlists clear library history wipe", view: DangerZone },
  { group: "Help", id: "about", tint: "#8e8e93", label: "About", icon: Disc3, about: "The version, and what it’s built on.", find: "version licences licenses welcome github", view: About },
];
const matching = (q: string) => PANES.filter((p) => !q || `${p.label} ${p.about} ${p.find}`.toLowerCase().includes(q));

const subhead = "text-[15px] font-semibold tracking-tight";
// A group of rows on a step of tone, with lines between the rows but not around them.
const card = "rounded-2xl bg-ink/[0.04] px-4 divide-y divide-ink/[0.07]";
const btn = "press flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50";
export const solid = `${btn} bg-ink text-paper`;
export const quiet = `${btn} bg-ink/[0.07] hover:bg-ink/[0.12]`;

// What the settings search is looking for, so a row it names lights up.
const Looking = createContext("");

// Mixtape's layout: the categories down a column of their own under the search, and one pane at a time
// beside them. Searching swaps the categories for the panes that match; picking one opens it with the
// matching rows lit for a few seconds. Opened at a pane (Edit Profile opens Account), it starts there.
export function Settings() {
  const pane = useStore((s) => s.pane);
  const [now, setNow] = useState(pane ?? PANES[0].id);
  const [q, setQ] = useState("");
  const [lit, setLit] = useState(""); // what a search opened the pane for
  const page = useRef<HTMLDivElement>(null);
  const fade = useRef(0);
  const find = q.trim().toLowerCase();
  const shown = matching(find);
  const go = (id: string, light = "") => {
    setNow(id);
    setLit(light);
    clearTimeout(fade.current);
    if (light) fade.current = window.setTimeout(() => setLit(""), 3000);
    page.current?.scrollTo({ top: 0 });
  };
  const pick = (id: string) => (go(id, find), setQ(""));
  useEffect(() => void (pane && (go(pane), useStore.setState({ pane: undefined }))), [pane]);
  const { id, label, about, view: View } = PANES.find((p) => p.id === now) ?? PANES[0];
  const chip = (p: (typeof PANES)[number]) => (
    <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-[6px]" style={{ background: `color-mix(in oklab, ${p.tint} 22%, transparent)`, color: p.tint }}><p.icon size={13} strokeWidth={2.25} /></span>
  );
  return (
    <div className="absolute inset-0 flex animate-enter">
      <nav aria-label="Settings" className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-ink/[0.06] bg-ink/[0.025] px-3 pt-16 pb-6 @max-2xl:w-48">
        <h1 className="px-2 text-[22px] font-bold tracking-tight">Settings</h1>
        <label className="mt-3 mb-4 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-ink/[0.07] px-2.5 text-muted transition-colors focus-within:bg-ink/[0.1]">
          <SearchIcon size={14} aria-hidden />
          <input
            data-find
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => (e.key === "Escape" && q ? (e.stopPropagation(), setQ("")) : e.key === "Enter" && shown[0] && find && pick(shown[0].id))}
            placeholder="Search settings"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
          />
          {q && <button onClick={() => setQ("")} aria-label="Clear Search" className="press -mr-1 grid size-5 place-items-center rounded-full hover:bg-ink/[0.1] hover:text-ink"><X size={12} /></button>}
        </label>
        {!find ? (
          [...new Set(PANES.map((p) => p.group))].map((group) => (
            <div key={group} className="pb-3">
              {PANES.filter((p) => p.group === group).map((p) => (
                <button key={p.id} onClick={() => go(p.id)} aria-current={now === p.id ? "page" : undefined} className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium transition-colors duration-100 ${now === p.id ? "bg-accent/20" : "hover:bg-ink/[0.05]"}`}>
                  {chip(p)} {p.label}
                </button>
              ))}
            </div>
          ))
        ) : shown.length ? (
          shown.map((p) => (
            <button key={p.id} onClick={() => pick(p.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 hover:bg-ink/[0.05]">
              {chip(p)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.label}</span>
                <span className="block truncate text-[11px] text-muted">{p.about}</span>
              </span>
              <ChevronRight size={14} aria-hidden className="shrink-0 text-muted" />
            </button>
          ))
        ) : (
          <p className="px-2 text-[13px] text-muted">No settings match “{q.trim()}”.</p>
        )}
      </nav>
      <div ref={page} className="min-w-0 flex-1 overflow-y-auto">
        <Looking value={find || lit}>
          <section key={id} aria-labelledby="settings-pane" className="max-w-2xl animate-enter px-10 pt-16 pb-24 @max-2xl:px-6">
            <h2 id="settings-pane" className={`text-[28px] font-bold tracking-tight ${id === "danger" ? "text-[#ff375f]" : ""}`}>{label}</h2>
            <p className="mt-1 mb-8 text-[13px] text-muted">{about}</p>
            <View />
          </section>
        </Looking>
      </div>
    </div>
  );
}

// Your account: profile, sync, what's public, your data. Without one, signing in.
function AccountPane() {
  const { user, profile, state, synced, error } = useAccount();
  const online = useOnline();
  const playlists = useLibrary((s) => s.playlists);
  const picture = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<"ask" | "busy">();
  if (!canSignIn)
    return (
      <>
        <p className="max-w-xl text-[13px] text-muted">Accounts aren’t set up in this copy of Sleeve, so your library stays on this computer. Everything works without one.</p>
        <button onClick={() => void exportAll()} className={`${quiet} mt-6`}><Download size={16} /> Export Your Data</button>
      </>
    );
  if (!user)
    return (
      <>
        <h2 className="text-xl font-bold tracking-tight">Sign in</h2>
        <p className="mt-1 mb-6 max-w-md text-[13px] text-muted">Your library, playlists and lyrics, the same on every computer you use. Everything works without an account too.</p>
        <SignIn />
      </>
    );
  const status = !online ? "You’re offline. Changes sync when you’re back." : state === "syncing" ? "Syncing…" : state === "error" ? `Couldn’t sync: ${error}` : synced ? `Up to date. Last synced ${ago(synced).toLowerCase()}` : "Not synced yet";
  return (
    <>
      <div className="flex items-center gap-5">
        <button
          onClick={() => (profile?.avatar ? popup([{ text: "Choose Picture…", action: () => picture.current?.click() }, { text: "Remove Picture", action: () => warn("Remove your picture?", "Remove", () => setProfile({ avatar: undefined })) }]) : picture.current?.click())}
          aria-label="Change Picture"
          title="Change Picture"
          className="press group/avatar relative rounded-full"
        >
          <Avatar profile={profile} className="size-14 text-2xl" />
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100"><ImagePlus size={22} /></span>
        </button>
        <input ref={picture} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void coverFrom(e.target.files[0], 256).then((avatar) => setProfile({ avatar }), report), (e.target.value = ""))} />
        <div className="min-w-0 flex-1">
          <input value={profile?.name ?? ""} onChange={(e) => setProfile({ name: e.target.value })} placeholder="Your name" aria-label="Your name" name="profile-name" autoComplete="off" className="room w-full bg-transparent text-xl font-bold tracking-tight outline-none placeholder:text-muted" />
          <div className="truncate text-[13px] text-muted">{user.email}</div>
        </div>
      </div>
      <div className={`${card} mt-6`}>
        <Row label="Library Sync" detail={status}>
          <button onClick={() => void syncNow()} disabled={state === "syncing" || !online} className={quiet}>Sync Now</button>
        </Row>
        <Row label="Your Profile" detail="Your name, picture and public playlists, for anyone with the link">
          <div className="flex gap-2">
            <button onClick={() => open({ name: "profile", id: user.id })} className={quiet}>View</button>
            <button onClick={() => copyLink(profileLink())} className={quiet}><Link size={16} /> Copy Link</button>
          </div>
        </Row>
      </div>
      <section className="mt-8">
        <h3 className={`${subhead} mb-1`}>Public Playlists</h3>
        <p className="mb-3 text-xs text-muted">Anyone with a public playlist’s link can see it and play it, and it shows on your profile.</p>
        {playlists.length ? (
          <div className={card}>
            {playlists.map((p) => (
              <div key={p.id} className="flex h-14 items-center gap-3">
                <div className="size-10 shrink-0 overflow-hidden rounded-lg"><PlaylistCover id={p.id} tracks={p.tracks} cover={p.cover} small /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{p.name}</div>
                  <div className="truncate text-xs text-muted">{count(p.tracks.length)}</div>
                </div>
                {p.public && <button onClick={() => copyLink(playlistLink(p.id))} aria-label={`Copy Link to ${p.name}`} title="Copy Link" className="press grid size-9 place-items-center rounded-full text-muted hover:bg-ink/[0.07] hover:text-ink"><Link size={16} /></button>}
                <Switch label={`${p.name} is public`} on={!!p.public} onChange={(on) => setPublic(p.id, on)} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">Playlists you make show here.</p>
        )}
      </section>
      <section className="mt-8">
        <h3 className={`${subhead} mb-3`}>Your Data</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void exportAll()} className={quiet}><Download size={16} /> Export Your Data</button>
          <button onClick={() => void signOut().catch(report)} className={quiet}>Sign Out</button>
          <button onClick={() => setDeleting("ask")} className={`${quiet} text-[#ff375f]`}>Delete Account…</button>
        </div>
        {deleting && (
          <div ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })} role="alertdialog" aria-label="Delete Account" className="mt-4 max-w-xl animate-enter rounded-2xl bg-[#ff375f]/10 p-5">
            <p className="font-semibold">Delete your Sleeve account?</p>
            <p className="mt-1 text-sm text-muted">Everything synced with it is deleted for good, and your public playlists and profile go with it. Your library stays on this computer.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => (setDeleting("busy"), void deleteAccount().catch((e) => (setDeleting(undefined), report(e))))} disabled={deleting === "busy"} className={`${btn} bg-[#ff375f] text-white`}>{deleting === "busy" ? "Deleting…" : "Delete Account"}</button>
              <button onClick={() => setDeleting(undefined)} className={quiet}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

// Scrobbling to Last.fm (sign in on its site, then come back) or ListenBrainz (paste a token), and Discord.
function LinkedAccountsPane() {
  const { listenBrainzToken, lastfmSessionKey, lastfmUsername, discordRpc } = useSettings();
  const set = useSettings.setState;
  const [token, setToken] = useState("");
  const [lastfm, setLastfm] = useState<{ token?: string; busy?: boolean; error?: string }>({});
  const step = (run: () => Promise<string | undefined>) => {
    setLastfm((s) => ({ ...s, busy: true, error: undefined }));
    run().then((t) => setLastfm({ token: t }), (e) => setLastfm((s) => ({ token: s.token, error: e instanceof Error ? e.message : "Couldn’t reach Last.fm" })));
  };
  const linkBrainz = () => token && (set({ listenBrainzToken: token }), setToken(""), notify({ text: "Connected to ListenBrainz" }));
  return (
    <div className={card}>
      <Row label="Last.fm" detail={lastfmSessionKey ? `Scrobbling as ${lastfmUsername}` : lastfm.error ?? (lastfm.token ? "Allow Sleeve in your browser, then come back and click Done" : "Scrobble what you play to Last.fm")}>
        {lastfmSessionKey ? (
          <button onClick={lastfmSignOut} className={quiet}>Disconnect</button>
        ) : lastfm.token ? (
          <div className="flex gap-2">
            <button onClick={() => setLastfm({})} className={quiet}>Cancel</button>
            <button onClick={() => step(() => lastfmAuthFinish(lastfm.token!).then(() => undefined))} disabled={lastfm.busy} className={solid}>Done</button>
          </div>
        ) : (
          <button onClick={() => step(lastfmAuthStart)} disabled={lastfm.busy} className={quiet}>Connect…</button>
        )}
      </Row>
      <Row label="ListenBrainz" detail={listenBrainzToken ? "Scrobbling to ListenBrainz" : "Paste your user token from listenbrainz.org/settings"}>
        {listenBrainzToken ? (
          <button onClick={() => set({ listenBrainzToken: "" })} className={quiet}>Disconnect</button>
        ) : (
          <div className="flex gap-2">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && linkBrainz()} placeholder="User token" aria-label="ListenBrainz user token" className="w-48 rounded-full bg-ink/[0.07] px-3.5 text-sm outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent" />
            <button onClick={linkBrainz} disabled={!token} className={solid}>Connect</button>
          </div>
        )}
      </Row>
      {canHaveFiles && (
        <Row label="Discord" detail="Show what you’re playing as your Discord status">
          <Switch label="Discord status" on={discordRpc} onChange={(on) => (set({ discordRpc: on }), on || clearDiscordRpc())} />
        </Row>
      )}
    </div>
  );
}

function Appearance() {
  const { theme, artworkAccent, reduceMotion, zoom } = useSettings();
  const set = useSettings.setState;
  return (
    <>
      <Group title="Theme" about="Choose the overall appearance of the app.">
        <Choice label="System" on={theme === "system"} onPick={() => set({ theme: "system" })}><Mini scheme="light" /><Mini scheme="dark" /></Choice>
        <Choice label="Light" on={theme === "light"} onPick={() => set({ theme: "light" })}><Mini scheme="light" /></Choice>
        <Choice label="Dark" on={theme === "dark"} onPick={() => set({ theme: "dark" })}><Mini scheme="dark" /></Choice>
      </Group>
      <Group title="Colour" about="Where the highlight colour comes from.">
        <Choice label="From Artwork" on={artworkAccent} onPick={() => set({ artworkAccent: true })}><Mini tint="#ff8a3d" /></Choice>
        <Choice label="Sleeve Pink" on={!artworkAccent} onPick={() => set({ artworkAccent: false })}><Mini tint="#ff375f" /></Choice>
      </Group>
      <div className={card}>
        <Row label="Reduce Motion" detail={reduceMotion ? "Things fade in place instead of sliding" : "Follows the system’s Reduce Motion"}>
          <Switch label="Reduce Motion" on={reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
        </Row>
        {canHaveFiles && (
          <Row label="Size" detail="Makes everything in the window bigger or smaller">
            <Segments label="Size" value={zoom} onPick={(zoom) => set({ zoom })} options={ZOOMS.map((z) => [z, `${Math.round(z * 100)}%`])} />
          </Row>
        )}
      </div>
    </>
  );
}

const fill = (v: number, min: number, max: number) => ({ "--p": `${((v - min) / (max - min)) * 100}%` }) as CSSProperties;

function Row({ label, detail, children }: { label: string; detail: ReactNode; children: ReactNode }) {
  const looking = useContext(Looking);
  return (
    // When the pane is too narrow for both, the control drops below its label instead of squeezing it to a word a line.
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-48 flex-1">
        <div className={`text-[13px] font-semibold transition-colors ${looking && label.toLowerCase().includes(looking) ? "text-accent" : ""}`}>{label}</div>
        <div className="text-xs text-muted">{detail}</div>
      </div>
      {children}
    </div>
  );
}

function Playback() {
  const { crossfade, autoplay, doubleClick, resumeQueue, pauseOnDevice } = useSettings();
  const set = useSettings.setState;
  return (
    <div className={card}>
      <Row label="Autoplay" detail={autoplay ? "When the queue runs out, similar songs keep playing" : "Music stops when the queue runs out"}>
        <Switch label="Autoplay" on={autoplay} onChange={(autoplay) => set({ autoplay })} />
      </Row>
      <Row label="Double-Click a Song" detail={doubleClick === "play" ? "Plays it, with the rest of the list after it" : "Adds it to the end of the queue"}>
        <Segments label="Double-Click a Song" value={doubleClick} onPick={(doubleClick) => set({ doubleClick })} options={[["play", "Play"], ["queue", "Add to Queue"]]} />
      </Row>
      <Row label="On Launch" detail={resumeQueue ? "Your last queue is back, paused where you left it" : "The queue starts empty"}>
        <Segments label="On Launch" value={resumeQueue ? "resume" : "empty"} onPick={(v) => set({ resumeQueue: v === "resume" })} options={[["resume", "Resume Queue"], ["empty", "Start Empty"]]} />
      </Row>
      <Row label="Pause When Headphones Disconnect" detail="Pauses when an audio device is plugged in or out">
        <Switch label="Pause When Headphones Disconnect" on={pauseOnDevice} onChange={(pauseOnDevice) => set({ pauseOnDevice })} />
      </Row>
      <Row label="Crossfade" detail={crossfade ? "Songs fade into each other" : "Off: songs play back to back with no gap"}>
        <div className="flex items-center gap-3">
          <input type="range" aria-label="Crossfade" min={0} max={12} step={1} value={crossfade} onChange={(e) => set({ crossfade: +e.target.value })} style={fill(crossfade, 0, 12)} className="w-36" />
          <span className="w-10 text-right text-xs tabular-nums">{crossfade ? `${crossfade} s` : "Off"}</span>
        </div>
      </Row>
    </div>
  );
}

function AudioPane() {
  const { quality, ahead, browse, normalize, eq } = useSettings();
  const set = useSettings.setState;
  const preset = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === eq[i]))?.[0];
  return (
    <>
      <div className={`${card} mb-8`}>
        <Row label="Streaming Quality" detail={quality === "high" ? "The best stream there is for each song" : "Smaller streams, for slow or metered connections"}>
          <Segments label="Streaming Quality" value={quality} onPick={(quality) => set({ quality })} options={[["high", "High"], ["low", "Data Saver"]]} />
        </Row>
        <Row label="Fetch Ahead" detail="How many upcoming songs load while this one plays">
          <Segments label="Fetch Ahead" value={ahead} onPick={(ahead) => set({ ahead })} options={[[0, "Off"], [1, "1"], [3, "3"], [5, "5"], [25, "All"]]} />
        </Row>
        <Row label="Fetch While Browsing" detail="Songs you rest on start loading. Off saves data">
          <Switch label="Fetch While Browsing" on={browse} onChange={(browse) => set({ browse })} />
        </Row>
        <Row label="Normalise Volume" detail="Turns loud songs down to the level of the rest">
          <Switch label="Normalise Volume" on={normalize} onChange={(normalize) => set({ normalize })} />
        </Row>
      </div>
      <section>
        <h3 className={`${subhead} mb-3`}>Equalizer</h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(EQ_PRESETS).map(([name, g]) => (
            <button key={name} aria-pressed={preset === name} onClick={() => set({ eq: g })} className={`press h-7 rounded-lg px-3 text-xs font-semibold transition-colors ${preset === name ? "bg-ink text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`}>
              {name}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-between rounded-xl bg-ink/[0.04] px-8 py-5">
          {EQ_BANDS.map((f, i) => (
            <div key={f} className="flex flex-col items-center gap-2">
              <span className="text-xs tabular-nums text-muted">{eq[i] > 0 ? `+${eq[i]}` : eq[i]}</span>
              {/* A rotated range, so the track's left-to-right fill reads bottom to top. */}
              <div className="relative h-36 w-6">
                <input
                  type="range"
                  aria-label={`${f < 1000 ? f : `${f / 1000}k`} Hz`}
                  min={-12}
                  max={12}
                  step={1}
                  value={eq[i]}
                  onChange={(e) => set({ eq: eq.map((v, j) => (j === i ? +e.target.value : v)) })}
                  style={fill(eq[i], -12, 12)}
                  className="absolute top-1/2 left-1/2 w-36 -translate-x-1/2 -translate-y-1/2 -rotate-90 knob"
                />
              </div>
              <span className="text-xs font-semibold tabular-nums">{f < 1000 ? f : `${f / 1000}k`}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// A small row of choices, one picked, like the system's segmented controls. The thumb slides to it.
function Segments<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number }>();
  useLayoutEffect(() => {
    const b = box.current?.querySelector<HTMLElement>("[aria-checked=true]");
    setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth } : undefined);
  }, [value]);
  return (
    <div ref={box} role="radiogroup" aria-label={label} className="relative flex shrink-0 rounded-lg bg-ink/[0.07] p-0.5">
      {thumb && <span aria-hidden className="absolute inset-y-0.5 left-0 rounded-md bg-[light-dark(#fff,#4a4a4f)] shadow-sm transition-[translate,width] duration-200 ease-out" style={{ translate: `${thumb.x}px`, width: thumb.w }} />}
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onPick(v)} className={`relative h-7 rounded-md px-3 text-xs font-semibold transition-colors ${value === v ? "" : "text-muted hover:text-ink"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-ink/20"}`}>
      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ease-out ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

// Languages lyrics translate into, named in your own. Chinese is the two scripts Google offers.
const LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "nl", "sv", "pl", "tr", "ru", "uk", "el", "ar", "he", "hi", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];
const names = new Intl.DisplayNames([navigator.language], { type: "language" });
const languageName = (code: string) => names.of({ "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" }[code] ?? code) ?? code;

const LYRIC_SOURCES: [LyricsSource, string, string][] = [
  ["apple", "Apple Music", "Timed word by word"],
  ["lrclib", "LRCLIB", "A free library anyone can add to"],
  ["netease", "NetEase Cloud Music", "Strong on Chinese, Japanese and Korean songs"],
];

function LyricsPane() {
  const { lyricsPeek, lyricsWords, lyricsStill, translateTo, lyricsOff } = useSettings();
  const set = useSettings.setState;
  const mine = Object.entries(useMine((s) => s.songs)).sort((a, b) => b[1].at - a[1].at);
  return (
    <>
      <div className={`${card} mb-6`}>
        <Row label="Lyrics on the Player Bar" detail="The line being sung, under the song’s name">
          <Switch label="Lyrics on the Player Bar" on={lyricsPeek} onChange={(lyricsPeek) => set({ lyricsPeek })} />
        </Row>
        <Row label="Word by Word on Every Song" detail={lyricsWords ? "Songs that only time their lines get their words timed by estimate" : "Only songs whose lyrics time each word"}>
          <Switch label="Word by Word on Every Song" on={lyricsWords} onChange={(lyricsWords) => set({ lyricsWords })} />
        </Row>
        <Row label="Reduce Lyric Motion" detail={lyricsStill ? "Lines jump to the one being sung, and words stay put" : "Lines glide and words move, whatever the system’s Reduce Motion is set to"}>
          <Switch label="Reduce Lyric Motion" on={lyricsStill} onChange={(lyricsStill) => set({ lyricsStill })} />
        </Row>
        <Row label="Translate To" detail="What Translate turns lyrics in other languages into">
          <div className="relative">
            <select
              value={translateTo}
              onChange={(e) => set({ translateTo: e.target.value })}
              aria-label="Translate To"
              className="press h-9 appearance-none rounded-full bg-ink/[0.07] pr-9 pl-4 text-sm font-semibold outline-none hover:bg-ink/[0.12] focus-visible:outline-2 focus-visible:outline-accent"
            >
              <option value="">System ({languageName(translateTarget(""))})</option>
              {LANGUAGES.map((code) => <option key={code} value={code}>{languageName(code)}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
          </div>
        </Row>
      </div>
      <section className="mb-6">
        <h3 className={`${subhead} mb-1`}>Sources</h3>
        <p className="max-w-xl text-xs leading-relaxed text-muted">Your own lyrics come first, then the first of these that has the song, in this order. Translation and romanisation are by Google, and only happen when you switch them on.</p>
        <div className={card}>
          {LYRIC_SOURCES.map(([id, label, detail]) => (
            <Row key={id} label={label} detail={detail}>
              <Switch label={label} on={!lyricsOff.includes(id)} onChange={(on) => set({ lyricsOff: on ? lyricsOff.filter((k) => k !== id) : [...lyricsOff, id] })} />
            </Row>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h3 className={`${subhead} mb-3`}>Your Lyrics</h3>
        {mine.length ? (
          <div className={card}>
            {mine.map(([key, m]) => (
              <div key={key} className="flex h-14 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{m.title}</div>
                  <div className="truncate text-xs text-muted">{m.artist}</div>
                </div>
                <button onClick={() => useStore.setState({ dialog: { kind: "edit", key, title: m.title, artist: m.artist, text: m.text } })} className={quiet}>Edit</button>
                <button onClick={() => removeMine(key)} className={quiet}>Remove</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">Lyrics you write or fix land here. Right-click any song and choose Edit Lyrics.</p>
        )}
      </section>
    </>
  );
}

function Group({ title, about, children }: { title: string; about: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className={subhead}>{title}</h3>
      <p className="mt-0.5 mb-3.5 text-[13px] text-muted">{about}</p>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-3 gap-3">{children}</div>
    </section>
  );
}

function Choice({ label, on, onPick, children }: { label: string; on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button role="radio" aria-checked={on} onClick={onPick} className="press group text-left">
      <div className={`relative flex aspect-[2.45] overflow-hidden rounded-lg transition-shadow duration-150 ${on ? "ring-2 ring-ink" : "ring-1 ring-ink/10 group-hover:ring-ink/30"}`}>
        {children}
        <span className={`absolute top-2 right-2 grid size-[18px] place-items-center rounded-full bg-ink text-paper shadow-sm transition-[opacity,scale] duration-150 ease-out ${on ? "" : "scale-50 opacity-0"}`}><Check size={11} strokeWidth={3.5} /></span>
      </div>
      <div className={`mt-2 text-[13px] ${on ? "font-semibold" : "text-muted"}`}>{label}</div>
    </button>
  );
}

// A window in miniature: the lights and a sidebar of lines, then a title over four tiles. Its greys are
// light-dark(), so a color-scheme here repaints it; tint stands in for the artwork colour.
function Mini({ scheme, tint }: { scheme?: "light" | "dark"; tint?: string }) {
  const bit = "bg-[light-dark(#d9dbda,#262828)]";
  return (
    <div style={{ colorScheme: scheme }} className="flex flex-1 bg-[light-dark(#ebedec,#0e100f)]">
      <div className="flex w-[36%] flex-col gap-1.5 bg-[light-dark(#fefefe,#1b1d1c)] p-2">
        <div className="mb-1.5 flex gap-[3px]">{["#ff5f57", "#febc2e", "#28c840"].map((c) => <i key={c} className="size-[5px] rounded-full" style={{ background: c }} />)}</div>
        {[60, 44, 54].map((w) => <i key={w} className="h-1 rounded-full bg-[light-dark(#e4e4e4,#3d3e3e)]" style={{ width: `${w}%` }} />)}
        <i className="mt-auto h-3 rounded-[3px] bg-[light-dark(#d6d6d6,#484948)]" style={tint ? { background: tint } : undefined} />
      </div>
      <div className="flex flex-1 flex-col gap-[5px] p-2">
        <i className={`h-[5px] w-2/5 rounded-full ${bit}`} />
        <div className="grid grid-cols-2 gap-1">{[0, 1, 2, 3].map((i) => <i key={i} className={`h-3.5 rounded-[3px] ${bit}`} style={tint && !i ? { background: tint } : undefined} />)}</div>
      </div>
    </div>
  );
}

function exportLibrary() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(useLibrary.getState())], { type: "application/json" }));
  a.download = `Sleeve Library ${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  notify({ text: "Library Exported", detail: "Saved to your Downloads folder" });
}

function LibraryPane() {
  const { liked, saved, playlists, followed, hidden, blocked } = useLibrary();
  const file = useRef<HTMLInputElement>(null);
  const csvFile = useRef<HTMLInputElement>(null);
  const stats = [["Liked songs", liked.length, LIKED], ["Playlists", playlists.length, tint("a")], ["Albums", saved.length, tint("b")], ["Artists", followed.length, tint("c")]] as const;
  return (
    <>
      <dl className="grid grid-cols-4 gap-3">
        {stats.map(([label, n, bg]) => (
          <div key={label} className={`flex flex-col-reverse rounded-xl p-4 text-white ${bg}`}>
            <dt className="mt-0.5 text-xs font-semibold text-white/85">{label}</dt>
            <dd className="text-3xl font-bold tracking-tight tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <div className={`${card} mt-6`}>
        {canHaveFiles && (
          <Row label="Import from Spotify" detail="Your playlists, liked songs, albums and artists, all at once">
            <button onClick={() => useStore.setState({ dialog: { kind: "spotify" } })} className={quiet}><ArrowDownToLine size={16} /> Import…</button>
          </Row>
        )}
        <Row label="Import a Playlist" detail="A CSV file, or a link to a playlist on another service">
          <div className="flex gap-2">
            <button onClick={() => (canHaveFiles ? void pickPlaylists() : csvFile.current?.click())} className={quiet}><Upload size={16} /> File…</button>
            <button onClick={() => useStore.setState({ dialog: { kind: "link" } })} className={quiet}><Link2 size={16} /> Link…</button>
          </div>
        </Row>
        <Row label="Back Up Your Library" detail="Everything in Your Library as one file, to keep or to move to another computer">
          <div className="flex gap-2">
            <button onClick={exportLibrary} className={quiet}><Download size={16} /> Export</button>
            <button onClick={() => file.current?.click()} className={quiet}>Restore…</button>
          </div>
        </Row>
      </div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && restore(e.target.files[0]), (e.target.value = ""))} />
      <input ref={csvFile} type="file" accept=".csv,text/csv" hidden onChange={(e) => (e.target.files?.[0] && void importPlaylistFile(e.target.files[0]), (e.target.value = ""))} />
      {canHaveFiles && <LocalFolders />}
      <section className="mt-8">
        <h3 className={`${subhead} mb-1`}>Hidden Songs</h3>
        <p className="mb-3 text-xs text-muted">Skipped when a playlist or radio plays on by itself. They still play when you pick them.</p>
        {hidden.length ? (
          <div className={card}>
            {hidden.map((t) => (
              <div key={t.id} className="flex h-14 items-center gap-3">
                <img src={art(t.thumb, 96)} alt="" loading="lazy" className="size-10 rounded-lg bg-ink/[0.06] object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{t.title}</div>
                  <div className="truncate text-xs text-muted">{t.artists.map((a) => a.name).join(", ")}</div>
                </div>
                <button onClick={() => toggleHide(t)} className={quiet}>Unhide</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">None. Right-click a song and choose Hide Song.</p>
        )}
      </section>
      <section className="mt-8">
        <h3 className={`${subhead} mb-1`}>Artists You Don’t Play</h3>
        <p className="mb-3 text-xs text-muted">Their songs are skipped and left out of radio.</p>
        {blocked.length ? (
          <div className={card}>
            {blocked.map((a) => (
              <div key={a.id ?? a.name} className="flex h-14 items-center gap-3">
                <div className="min-w-0 flex-1 truncate font-semibold">{a.name}</div>
                <button onClick={() => toggleBlock(a)} className={quiet}>Allow</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">None. On an artist’s page, choose ••• then Don’t Play This Artist.</p>
        )}
      </section>
    </>
  );
}

// What's kept on this computer, by kind. Everything with something in it starts ticked; untick what to
// keep, then clear the rest. The ring is the legend's total, with what's staying faded.
function Storage() {
  const songs = useOffline((s) => s.songs);
  const searches = useRecentSearches((s) => s.items);
  const [m, setM] = useState<number[]>();
  const [off, setOff] = useState<string[]>([]);
  const kept = (prefix: string) => idbBytes(prefix).then((n) => Math.max(0, n - 2), () => 0); // an empty list is "[]"
  const measure = () => void Promise.all([downloadedSize().catch(() => [0, 0]), kept("lyrics:"), kept("artist:")]).then(([[songs, art], lyrics, artists]) => setM([art, songs, lyrics, artists]));
  useEffect(measure, [songs]);
  const kinds = [
    { label: "Cover Artwork", colour: "#4fc3dc", size: m?.[0], clear: forgetArt },
    { label: "Audio Tracks", colour: "#6e5ce6", size: m?.[1], clear: removeAllDownloads },
    { label: "Lyrics", colour: "#d6458a", size: m?.[2], clear: forgetLyrics },
    { label: "Catalog & Search", colour: "#e5a03a", size: m && m[3] + (searches.length && new Blob([JSON.stringify(searches)]).size), clear: () => (useRecentSearches.setState({ items: [] }), idbDelete("artist:")) },
  ].slice(canDownload ? 0 : 2).map((k) => ({ ...k, size: k.size ?? 0, on: !!k.size && !off.includes(k.label) }));
  const total = kinds.reduce((n, k) => n + k.size, 0);
  const picked = kinds.filter((k) => k.on);
  const gap = kinds.filter((k) => k.size).length > 1 ? 1.2 : 0;
  const [num, unit] = bytes(total).split(" ");
  let at = 0;
  const clear = () => warn(`Clear ${new Intl.ListFormat("en").format(picked.map((k) => k.label.toLowerCase()))}?`, "Clear", () => void Promise.all(picked.map((k) => k.clear())).then(() => (measure(), notify({ text: "Cache Cleared" })), report), picked.some((k) => k.clear === removeAllDownloads) ? "Downloaded songs will stream again, so they need the internet." : "It’s fetched again when it’s needed.");
  return (
    <>
      <h3 className={subhead}>Cache</h3>
      <p className="mt-0.5 mb-3 text-[13px] text-muted">What’s kept on this computer so things open quickly. Untick what to keep.</p>
      <div className="flex flex-wrap items-center gap-x-14 gap-y-6 @max-2xl:gap-x-8">
        <div className="min-w-48 flex-1">
          {kinds.map((k) => (
            <label key={k.label} className={`flex h-[39px] items-center gap-3 transition-opacity duration-150 ${k.on ? "" : "opacity-45"} ${k.size ? "cursor-pointer" : ""}`}>
              <input type="checkbox" checked={k.on} disabled={!k.size} onChange={() => setOff((o) => (o.includes(k.label) ? o.filter((l) => l !== k.label) : [...o, k.label]))} className="peer sr-only" />
              <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-ink/[0.08] text-paper transition-colors duration-150 peer-checked:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent">{k.on && <Check size={11} strokeWidth={3.5} />}</span>
              <i className="size-[7px] shrink-0 rounded-full" style={{ background: k.colour }} />
              <span className="truncate text-[14px] font-semibold">{k.label}</span>
              <span className="rounded-[5px] bg-ink/[0.08] px-1.5 py-px text-[10px] font-medium text-muted tabular-nums">{total ? Math.round((k.size / total) * 100) : 0}%</span>
              <span className="ml-auto pl-3 text-[13px] font-semibold tabular-nums">{m ? bytes(k.size) : ""}</span>
            </label>
          ))}
        </div>
        <figure className="flex shrink-0 flex-col items-center gap-2.5">
          <div className="relative size-[120px]">
            <svg viewBox="0 0 36 36" className="size-full -rotate-90">
              <circle cx="18" cy="18" r="16.05" fill="none" strokeWidth="3.9" className="stroke-ink/[0.07]" />
              {kinds.map((k) => {
                const len = total ? (k.size / total) * 100 : 0;
                const seg = <circle key={k.label} cx="18" cy="18" r="16.05" fill="none" strokeWidth="3.9" pathLength={100} stroke={k.colour} strokeOpacity={k.on ? 1 : 0.3} strokeDasharray={`${Math.max(0, len - gap)} 100`} strokeDashoffset={-at} className="transition-[stroke-dasharray,stroke-dashoffset,stroke-opacity] duration-500 ease-out" />;
                at += len;
                return seg;
              })}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center leading-none">
              <div className="text-[22px] font-bold tracking-tight tabular-nums">{m ? num : "…"}</div>
              <div className="mt-1 text-[10px] font-medium text-muted">{m ? unit : ""}</div>
            </div>
          </div>
          <figcaption className="text-xs text-muted">Storage Usage</figcaption>
        </figure>
      </div>
      <button onClick={clear} disabled={!picked.length} className={`${quiet} mt-4`}>Clear Selected…</button>
      {canDownload && <Downloads />}
    </>
  );
}

// What's downloaded, in Settings → Storage, and the room it takes.
function Downloads() {
  const { songs, lists, waiting } = useOffline();
  const [size, setSize] = useState<number>();
  useEffect(() => void downloadedSize().then(([s, a]) => setSize(s + a), () => {}), [songs]);
  const entries = Object.entries(lists).sort((a, b) => b[1].at - a[1].at);
  const n = Object.keys(songs).length;
  return (
    <section className="mt-8">
      <h3 className={`${subhead} mb-1`}>Downloads</h3>
      <p className="mb-3 text-xs text-muted">
        {entries.length ? `${count(n)}${size !== undefined ? `, ${bytes(size)}` : ""}${waiting.length ? `, ${waiting.length} still to come` : ""}. They play without a connection, and only in Sleeve.` : "Download a playlist or album with its arrow button and it plays without a connection."}
      </p>
      {entries.length > 0 && (
        <>
          <div className={`${card} mb-3`}>
            {entries.map(([key, l]) => (
              <div key={key} className="flex h-14 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{l.title}</div>
                  <div className="truncate text-xs text-muted">{count(listTracks(key).length)}</div>
                </div>
                <button onClick={() => unsave(key)} className={quiet}>Remove</button>
              </div>
            ))}
          </div>
          <button onClick={() => warn("Remove all downloads?", "Remove All", () => (removeAllDownloads(), notify({ text: "Downloads Removed" })), "Their songs will stream again, so they need the internet.")} className={quiet}>Remove All…</button>
        </>
      )}
    </section>
  );
}

// The folders Local Files reads, in Settings → Library.
function LocalFolders() {
  const folders = useLocal((s) => s.folders);
  const scanning = useLocal((s) => s.scanning);
  const songs = useLocal((s) => Object.keys(s.files).length);
  return (
    <section className="mt-8">
      <h3 className={`${subhead} mb-1`}>Local Files</h3>
      <p className="mb-3 text-xs text-muted">{folders.length ? `${count(songs)} from these folders${scanning ? ", looking for changes…" : ""}. They’re read again each time Sleeve opens.` : "Music on this Mac plays alongside everything else. Add a folder and its songs land in Local Files."}</p>
      {folders.length > 0 && (
        <div className={`${card} mb-3`}>
          {folders.map((f) => (
            <div key={f} className="flex h-14 items-center gap-3">
              <FolderIcon size={18} className="shrink-0 text-muted" />
              <div title={f} className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{f.split(/[\\/]/).filter(Boolean).at(-1) ?? f}</div>
                <div className="truncate text-xs text-muted">{f}</div>
              </div>
              <button onClick={() => warn(`Remove the “${f.split(/[\\/]/).filter(Boolean).at(-1) ?? f}” folder?`, "Remove", () => removeFolder(f), "Its songs leave your library. The files stay on your disk.")} className={quiet}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => void addFolder()} className={solid}><Plus size={16} /> Add Folder…</button>
        {folders.length > 0 && <button onClick={() => void rescan()} disabled={scanning} className={quiet}>Look for New Songs</button>}
      </div>
    </section>
  );
}

// Click a shortcut, then press the new one: Esc keeps what it was, Delete takes it off. One already
// in use moves here.
function Shortcuts() {
  const keymap = useSettings((s) => s.keymap);
  const [editing, setEditing] = useState<string>();
  useEffect(() => {
    if (!editing) return;
    setRecording(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      const combo = comboFrom(e);
      if (!combo || ["meta", "control", "mod+meta", "mod+control"].includes(combo)) return; // a modifier on its own: wait for the key
      if (combo === "backspace" || combo === "delete") bind(editing, "");
      else if (combo !== "escape") {
        const took = bind(editing, combo);
        if (took) notify({ text: `${showCombo(combo)} Moved Here`, detail: `${took} has no shortcut now` });
      }
      setEditing(undefined);
    };
    addEventListener("keydown", onKey, true);
    return () => (setRecording(false), removeEventListener("keydown", onKey, true));
  }, [editing]);
  return (
    <>
      <div className={card}>
        {KEYS.map(({ id, label }) => {
          const combo = comboOf(id);
          return (
            <div key={id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <span className="text-[13px]">{label}</span>
              <button onClick={() => setEditing(editing === id ? undefined : id)} aria-label={`Change shortcut for ${label}`} className={`press min-w-12 rounded-md px-2 py-0.5 text-center font-mono text-xs transition-colors ${editing === id ? "bg-accent text-white" : "bg-ink/[0.07] hover:bg-ink/[0.12]"} ${combo || editing === id ? "" : "text-muted"}`}>
                {editing === id ? "Press keys…" : combo ? showCombo(combo) : "None"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">Click a shortcut, then press the keys you want. Esc keeps it, Delete removes it.</p>
      {Object.keys(keymap).length > 0 && <button onClick={resetKeys} className={`${quiet} mt-4`}>Restore Defaults</button>}
    </>
  );
}

const bytes = (n: number) => (n < 1e3 ? `${n} B` : n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${n < 1e7 ? (n / 1e6).toFixed(1) : Math.round(n / 1e6)} MB` : `${(n / 1e9).toFixed(1)} GB`);

// The big resets in one place, each asking first.
function DangerZone() {
  const red = `${btn} bg-[#ff375f]/12 text-[#ff375f] hover:bg-[#ff375f]/20`;
  return (
    <div className="divide-y divide-[#ff375f]/15 rounded-2xl bg-[#ff375f]/[0.06] px-4">
      <Row label="Reset All Settings" detail="Every preference here goes back to how it started. Your music and linked accounts stay">
        <button onClick={() => warn("Reset all settings?", "Reset", resetSettings, "Appearance, playback, lyrics and shortcuts go back to their defaults.")} className={red}>Reset…</button>
      </Row>
      <Row label="Clear Listening History" detail="Every play, Wrapped and Recently Played on Home">
        <button onClick={() => warn("Clear your listening history?", "Clear History", clearHistory, "Every play goes, and Recently Played on Home with it.")} className={red}>Clear…</button>
      </Row>
      <Row label="Delete All Playlists" detail="Playlists and folders you made. Liked Songs and albums stay">
        <button onClick={() => warn("Delete all your playlists?", "Delete All", deleteAllPlaylists, "Every playlist and folder goes. You can undo it from the message that follows.")} className={red}>Delete…</button>
      </Row>
      <Row label="Clear Your Library" detail="Liked songs, playlists, albums, artists, pins and what you’ve hidden">
        <button onClick={() => warn("Clear your whole library?", "Clear Library", clearLibrary, "Everything in Your Library goes. Local folders and downloads stay on this computer.")} className={red}>Clear…</button>
      </Row>
    </div>
  );
}

function Privacy() {
  const history = useSettings((s) => s.history);
  const priv = usePrivate((s) => s.on);
  return (
    <>
      <div className={card}>
        <Row label="Private Session" detail={priv ? "What you play now isn’t kept, for 6 hours or until Sleeve quits" : "Plays nothing into your history until Sleeve quits"}>
          <Switch label="Private Session" on={priv} onChange={(on) => usePrivate.setState({ on })} />
        </Row>
        <Row label="Listening History" detail={history ? "Songs you play for 30 s are kept, on this computer only" : "Nothing you play is kept"}>
          <div className="flex items-center gap-3">
            <button onClick={() => open({ name: "wrapped" })} className={quiet}>Wrapped</button>
            <Switch label="Listening History" on={history} onChange={(history) => useSettings.setState({ history })} />
          </div>
        </Row>
      </div>
      <p className="mt-6 max-w-xl text-xs leading-relaxed text-muted">Sleeve sends nothing about you anywhere. Your history and settings never leave this computer; with an account, only your library syncs.</p>
    </>
  );
}

function Startup() {
  const { loginHidden, closeToTray, menuBar } = useSettings();
  const set = useSettings.setState;
  const [login, setLogin] = useState<boolean>();
  useEffect(() => void import("@tauri-apps/plugin-autostart").then((a) => a.isEnabled()).then(setLogin, () => setLogin(false)), []);
  const toggleLogin = (on: boolean) =>
    void import("@tauri-apps/plugin-autostart").then((a) => (on ? a.enable() : a.disable())).then(() => setLogin(on), report);
  const isMac = /Mac/.test(navigator.userAgent);
  return (
    <div className={card}>
      <Row label="Open at Login" detail="Sleeve starts when you log in">
        <Switch label="Open at Login" on={!!login} onChange={toggleLogin} />
      </Row>
      <Row label="Open in the Background" detail={login ? "Opened at login, the window stays out of the way until you click Sleeve" : "Once Open at Login is on"}>
        <Switch label="Open in the Background" on={loginHidden} onChange={(loginHidden) => set({ loginHidden })} />
      </Row>
      {isMac ? (
        <Row label="Menu Bar Player" detail={menuBar === "off" ? "No player in the menu bar" : `Click the icon for the player and a search that plays anything${menuBar === "song" ? ", with the song beside it" : menuBar === "lyrics" ? ", with the line being sung beside it" : ""}`}>
          <Segments label="Menu Bar Player" value={menuBar} options={[["off", "Off"], ["icon", "Icon"], ["song", "Song"], ["lyrics", "Lyrics"]]} onPick={(menuBar) => set({ menuBar })} />
        </Row>
      ) : (
        <Row label="Tray Player" detail="Click the tray icon for the player and a search that plays anything">
          <Switch label="Tray Player" on={menuBar !== "off"} onChange={(on) => set({ menuBar: on ? "icon" : "off" })} />
        </Row>
      )}
      <Row label={isMac ? "Keep in the Menu Bar" : "Close to Tray"} detail={closeToTray ? `Closing the window keeps Sleeve playing, with its icon in the ${isMac ? "menu bar" : "tray"}` : "Closing the window quits Sleeve"}>
        <Switch label={isMac ? "Keep in the Menu Bar" : "Close to Tray"} on={closeToTray} onChange={(closeToTray) => set({ closeToTray })} />
      </Row>
    </div>
  );
}

// The open-source parts Sleeve is built on, and their licences.
const LICENCES: [string, string][] = [
  ["Tauri and its plugins", "MIT or Apache-2.0"],
  ["React", "MIT"],
  ["YouTube.js (youtubei.js)", "MIT"],
  ["Supabase Auth", "MIT"],
  ["Zustand", "MIT"],
  ["Lucide icons", "ISC"],
  ["yaml", "ISC"],
  ["Lofty (song tags)", "MIT or Apache-2.0"],
  ["Tailwind CSS", "MIT"],
];

const openLink = (url: string) => void (canHaveFiles ? import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)) : window.open(url, "_blank", "noopener"));

function About() {
  return (
    <div>
      <div className="flex flex-col items-center rounded-2xl bg-ink/[0.04] px-6 py-8 text-center">
        <img src={appIcon} alt="" className="size-16 rounded-2xl" />
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">Sleeve</span>
          <span className="flex items-center gap-1.5 rounded-full bg-ink/[0.07] px-2 py-0.5 text-xs font-semibold tabular-nums"><span className="size-1.5 rounded-full bg-[#30d158]" />v{version}</span>
        </div>
        <p className="mt-1 text-[13px] text-muted">Your library from anywhere, in one free player.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button onClick={() => openLink("https://github.com/mikec-1/Sleeve")} className={quiet}><CodeXml size={15} /> GitHub</button>
          <button onClick={() => openLink("https://github.com/mikec-1/Sleeve/issues")} className={quiet}><LifeBuoy size={15} /> Report a Problem</button>
          <button onClick={() => ((sessionStorage.welcome = 1), location.reload())} className={quiet}>Show the Welcome Again</button>
        </div>
      </div>
      <section className="mt-8">
        <h3 className={`${subhead} mb-1`}>Licences</h3>
        <p className="mb-3 text-xs text-muted">Sleeve is built on these open-source projects. Thank you.</p>
        <div className={card}>
          {LICENCES.map(([name, licence]) => (
            <div key={name} className="flex h-10 items-center justify-between gap-6">
              <span className="text-[13px]">{name}</span>
              <span className="text-xs text-muted">{licence}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// The "E" Spotify and Apple Music put on explicit songs, before the artists.
export const Explicit = () => (
  <span aria-label="Explicit" title="Explicit" className="mr-1.5 inline-grid size-[15px] -translate-y-px place-items-center rounded-[3px] bg-current/20 align-middle text-[10px] leading-none font-bold">
    <span className="text-ink/75">E</span>
  </span>
);

// Each artist their own link, with commas between. One YT Music didn't link finds its page by search.
export function Artists({ list }: { list: Track["artists"] }) {
  return list.map((a, i) => (
    <Fragment key={i}>
      {i > 0 && ", "}
      <button onClick={(e) => (e.stopPropagation(), goToArtist(a))} {...warm(a)} className="relative hover:text-ink hover:underline">
        {a.name}
      </button>
    </Fragment>
  ));
}
const goToArtist = (a: Artist) => open({ name: "artist", id: a.id ?? "", by: a.name });

// The queue beside the page, opened from the player bar (like Spotify's). Drag a row, or use its menu, to reorder.
const QUEUE_MIN = 260, QUEUE_MAX = 560;
const resizeQueue = (w: number) => useSettings.setState({ queueWidth: Math.round(Math.min(QUEUE_MAX, Math.max(QUEUE_MIN, w))) });

export function QueuePanel() {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const added = useStore((s) => s.added);
  const more = useStore((s) => s.more), repeat = useStore((s) => s.repeat), autoplay = useSettings((s) => s.autoplay);
  const ends = more === "finding" ? "Finding similar songs…" : more === "none" ? "Nothing similar found. Music stops after this." : repeat === "one" ? "This song repeats." : repeat === "all" ? "The queue starts over when it ends." : autoplay ? "When the queue ends, similar songs play." : "Music stops when the queue ends.";
  const [drag, setDrag] = useState<number>();
  const [over, setOver] = useState<number>();
  const mine = queue.slice(index + 1, index + 1 + added);
  const rest = queue.slice(index + 1 + added);
  // What the queue was started from, named as in Spotify's "Next from": a list in your library by its name, an album or artist that isn't by its songs'.
  const from = useStore((s) => s.source), l = useLibrary(), id = from?.slice(from.indexOf(":") + 1);
  const fromName = !from ? undefined : from === "liked" ? "Liked Songs" : from === "local" ? "Local Files" : from.startsWith("playlist:") ? l.playlists.find((p) => p.id === id)?.name
    : from.startsWith("folder:") ? l.folders.find((f) => f.id === id)?.name : from.startsWith("album:") ? l.saved.find((a) => a.id === id)?.title ?? queue[0]?.album
    : from.startsWith("artist:") ? l.followed.find((a) => a.id === id)?.name ?? queue[0]?.artists[0]?.name : undefined;
  const isRadio = useStore((s) => s.radio), title = isRadio ? `${fromName ?? queue[0]?.title} Radio` : fromName; // as Spotify says "Next from: … Radio"
  const cut = isRadio ? -1 : rest.findIndex((t) => t.auto), next = cut < 0 ? rest : rest.slice(0, cut), auto = cut < 0 ? [] : rest.slice(cut); // what Autoplay added goes under its own heading, as in Spotify

  const row = (t: Track, i: number) => (
    <li
      key={t.id + i}
      draggable={i !== index}
      onDragStart={(e) => ((e.dataTransfer.effectAllowed = "move"), setDrag(i))}
      onDragOver={(e) => drag !== undefined && i > index && (e.preventDefault(), setOver(i))}
      // Clear here too: the move re-keys the rows, so dragend never reaches the moved one.
      onDrop={() => (drag !== undefined && moveInQueue(drag, i), setDrag(undefined), setOver(undefined))}
      onDragEnd={() => (setDrag(undefined), setOver(undefined))}
      onContextMenu={(e) => (e.preventDefault(), trackMenu(t, i === index ? undefined : { queue: i }))}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-ink/[0.04] ${drag === i ? "opacity-40" : ""} ${
        over === i && drag !== undefined && drag !== i ? (drag > i ? "shadow-[inset_0_2px_var(--color-accent)]" : "shadow-[inset_0_-2px_var(--color-accent)]") : ""
      }`}
    >
      <button onClick={() => jump(i)} aria-label={`Play ${t.title}`} className="hit" />
      <div className="relative shrink-0">
        <img src={art(t.thumb, 96)} alt="" loading="lazy" className="size-10 rounded-md bg-ink/[0.06] object-cover" />
        {t.rec && (
          <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-accent text-paper ring-2 ring-paper">
            <Sparkle size={11} aria-label="Recommended" className="fill-current" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${i === index ? "text-accent" : ""}`}>{t.title}</div>
        {/* Artists come first; "Recommended" gives way when the row is narrow. */}
        <div className="flex text-sm whitespace-nowrap text-muted">
          <span className="min-w-0 truncate">{t.explicit && <Explicit />}<Artists list={t.artists} /></span>
          {t.rec && <span className="min-w-0 shrink-[999] truncate font-semibold text-accent">&nbsp;· Recommended</span>}
        </div>
      </div>
      {i !== index && (
        <>
          <button onClick={() => removeFromQueue(i)} aria-label={`Remove ${t.title} from queue`} className="press relative grid size-7 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
            <X size={16} />
          </button>
          <GripVertical size={16} aria-hidden className="relative -mr-1.5 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100" />
        </>
      )}
    </li>
  );
  const heading = "px-3 pt-5 pb-1.5 text-sm font-bold";
  const width = useSettings((s) => s.queueWidth);
  const [resizing, setResizing] = useState(false);
  const sizing = (on: boolean) => (setResizing(on), (document.documentElement.style.cursor = on ? "col-resize" : ""));

  return (
    <aside aria-label="Queue" style={{ width }} className="relative flex shrink-0 animate-enter flex-col rounded-2xl bg-paper">
      {/* Drag its left edge to resize, like the sidebar (App.tsx); arrows work too. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Queue"
        aria-valuenow={width}
        aria-valuemin={QUEUE_MIN}
        aria-valuemax={QUEUE_MAX}
        tabIndex={0}
        onPointerDown={(e) => e.button === 0 && (e.currentTarget.setPointerCapture(e.pointerId), sizing(true))}
        onPointerMove={(e) => resizing && resizeQueue(e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX)}
        onLostPointerCapture={() => sizing(false)}
        onKeyDown={(e) => {
          const by = { ArrowLeft: 16, ArrowRight: -16 }[e.key];
          if (by) resizeQueue(width + by), e.preventDefault();
        }}
        className={`absolute inset-y-0 -left-2 z-10 w-2 cursor-col-resize outline-none before:absolute before:inset-y-6 before:left-[3px] before:w-0.5 before:rounded-full before:bg-accent before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100 ${resizing ? "before:opacity-100" : "before:opacity-0"}`}
      />
      <div className="flex items-center gap-2 px-5 pt-4">
        <h2 className="flex-1 text-xl font-bold tracking-tight">Queue</h2>
        {index + 1 < queue.length && (
          <button onClick={clearQueue} className="press h-8 rounded-full px-3 text-sm font-semibold text-muted hover:bg-ink/[0.06] hover:text-ink">
            Clear
          </button>
        )}
        <button onClick={() => useSettings.setState({ queue: false })} aria-label="Close Queue" className="press -mr-2 grid size-8 place-items-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-ink">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-b-2xl px-2 pb-4">
        <h3 className={heading}>Now Playing</h3>
        {queue[index] ? <ol>{row(queue[index], index)}</ol> : <p className="px-3 text-sm text-muted">Nothing playing.</p>}
        {mine.length > 0 && (
          <>
            <h3 className={heading}>Next in Queue</h3>
            <ol>{mine.map((t, i) => row(t, index + 1 + i))}</ol>
          </>
        )}
        {(next.length > 0 || !auto.length) && <h3 className={`${heading} truncate`}>{title && next.length ? `Next from: ${title}` : "Next Up"}</h3>}
        {/* The next hundred, so a queue of thousands opens at once. */}
        {next.length ? <ol>{next.slice(0, 100).map((t, i) => row(t, index + 1 + added + i))}</ol> : !auto.length && <p className="px-3 text-sm text-muted">{ends}</p>}
        {next.length > 100 && <p className="px-3 pt-2 text-sm text-muted">{plural(next.length - 100, "more song")}</p>}
        {auto.length > 0 && next.length <= 100 && (
          <>
            <h3 className={`${heading} flex items-baseline gap-2`}>Autoplay<span className="text-xs font-medium text-muted">Similar songs, after your queue</span></h3>
            <ol>{auto.slice(0, 100 - next.length).map((t, i) => row(t, index + 1 + added + next.length + i))}</ol>
          </>
        )}
      </div>
    </aside>
  );
}

// A list of songs, under a header of its columns: #, Title, Album, Date Added (added: your own lists) and
// length. The dividers between Title, Album and Date Added drag to share out the width (kept for every
// list; a double-click puts it back). from: the library key it's from (play() records it); origin: each
// row's place in the list it's kept in, when shown in another order (for its menu); onMove: rows drag to
// reorder; times: when each was played (History), shown in place of its length; header false: without
// the header (an artist's few top songs). plain: an album's own songs, numbered, without covers or album.
// Hidden songs and blocked artists' are dimmed.
type TrackListProps = { tracks: Track[]; numbered?: boolean; plain?: boolean; playlist?: string; from?: string; origin?: number[]; onMove?: (from: number[], to: number) => void; times?: number[]; added?: boolean; header?: boolean; onPlay?: (i: number) => void };
function TrackList({ tracks, numbered, plain, playlist, from, origin, onMove, times, added, header = true, onPlay = (i) => play(tracks, i, from) }: TrackListProps) {
  const current = useStore((s) => s.queue[s.index]), on = (t: Track) => !!current && sameSong(current, t);
  useLibrary((s) => s.hidden), useLibrary((s) => s.blocked), useOnline(); // re-dim as they change
  const saved = useOffline((s) => s.songs);
  useOffline((s) => s.art); // a cover just kept is drawn from disk
  const cols = useSettings((s) => s.trackCols);
  useEffect(() => void (tracks[0] && browsing(tracks[0])), [tracks[0]?.id]); // the song a page opens on is the one most likely played
  const [drag, setDrag] = useState<number>();
  const [over, setOver] = useState<number>();
  // Picked rows, as in Finder: click one, ⌘-click to add or take away, shift-click or drag for a run, or
  // drag a box from empty space. ↑ and ↓ move (shift: stretch the run), ⌥↑ ⌥↓ Home End go to the ends,
  // typing a title goes to it, ⌘⌫ removes them from here (asking first). Double-click plays. anchor: where a
  // run starts; lead: its moving end; sweeping: a drag-select under way from a row; held: a picked row
  // pressed again in a list that reorders, picked alone if let go without a drag; boxing: a box being drawn.
  const [sel, setSel] = useState<Set<number>>(new Set());
  const anchor = useRef(0);
  const lead = useRef(0);
  const [boxing, setBoxing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [sweeping, setSweeping] = useState(false);
  const held = useRef<number>(undefined);
  const list = useRef<HTMLOListElement>(null);
  const run = (a: number, b: number) => new Set(Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k));
  // Only the rows in view and a screenful either side are drawn (start–stop, moved ten rows at a time), so a
  // list of thousands scrolls smoothly; the rest is empty space as tall as they'd be. rowH: a row's height,
  // measured. Songs on screen without a cover get theirs first.
  const [[start, stop], setShown] = useState([0, 60]);
  const rowH = useRef(56);
  const now = useRef(tracks);
  now.current = tracks;
  useLayoutEffect(() => {
    const page = list.current?.closest<HTMLElement>("main > div");
    if (!page) return setShown([0, Infinity]);
    const update = () => {
      rowH.current = list.current?.querySelector("li")?.getBoundingClientRect().height || rowH.current;
      const top = list.current!.getBoundingClientRect().top - page.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / rowH.current)), last = Math.max(0, Math.ceil((page.clientHeight - top) / rowH.current));
      coversFor(now.current.slice(first, last), true);
      const a = Math.max(0, Math.floor((first - 20) / 10) * 10), b = Math.ceil((last + 20) / 10) * 10;
      setShown((s) => (s[0] === a && s[1] === b ? s : [a, b]));
    };
    update();
    const sizes = new ResizeObserver(update);
    sizes.observe(page), sizes.observe(list.current!);
    page.addEventListener("scroll", update, { passive: true });
    return () => (sizes.disconnect(), page.removeEventListener("scroll", update));
  }, []);
  // Row i brought into view, drawn or not.
  const reveal = (i: number) => {
    const page = list.current?.closest<HTMLElement>("main > div"), o = list.current?.getBoundingClientRect();
    if (!page || !o) return;
    const p = page.getBoundingClientRect(), top = o.top + i * rowH.current - p.top;
    page.scrollTop += top < 0 ? top : Math.max(0, top + rowH.current - p.height);
  };
  // A new list, not the same one made again on a render, starts with nothing picked.
  const ids = tracks.map((t) => t.id).join("\n");
  useEffect(() => setSel(new Set()), [ids]);
  // ⌘A picks the list the pointer is over, or the one already picked in.
  const hot = useRef(false);
  const typed = useRef({ text: "", at: 0 });
  useEffect(() => {
    const up = () => setSweeping(false);
    // Rows are found under the pointer: WebKit keeps sending a press's moves to the row it began on.
    const sweep = (e: PointerEvent) => {
      if (!sweeping || !(e.buttons & 1)) return;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("li[data-i]");
      if (row && list.current?.contains(row)) setSel(run(anchor.current, (lead.current = +row.dataset.i!)));
    };
    const away = (e: PointerEvent) => {
      const t = e.target as Element, page = list.current?.closest<HTMLElement>("main > div");
      if (list.current?.contains(t) || t.closest?.("[role=menu]")) return;
      // Empty space on this list's page, level with it or below it (and below no later list): a box.
      const empty = e.button === 0 && page?.contains(t) && !t.closest("button, a, input, textarea, select, li, [role=separator]") && [...page.querySelectorAll("ol[data-rows]")].filter((o) => o.getBoundingClientRect().top <= e.clientY).pop() === list.current;
      if (empty && page) draw(e, page, e.metaKey || e.ctrlKey || e.shiftKey ? sel : new Set());
      else if (sel.size) setSel(new Set());
    };
    const keys = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as Element).closest?.("input, textarea, [role=dialog]") || !(sel.size || hot.current)) return;
      const mod = e.metaKey || e.ctrlKey, end = tracks.length - 1;
      const by = (e.altKey ? { ArrowDown: end, ArrowUp: -end } : { ArrowDown: 1, ArrowUp: -1 })[e.key] ?? { Home: -end, End: end }[e.key];
      const land = (i: number) => {
        e.preventDefault(), (lead.current = i);
        if (e.shiftKey) setSel(run(anchor.current, i));
        else (anchor.current = i), setSel(new Set([i]));
        reveal(i);
      };
      if (e.key === "Escape") setSel(new Set());
      else if (e.key === "a" && mod) e.preventDefault(), setSel(run(0, end));
      else if (e.key === "Enter" && sel.size) onPlay(Math.min(...sel));
      else if ((e.key === "Backspace" || e.key === "Delete") && mod && sel.size) {
        e.preventDefault();
        const at = [...sel].sort((a, b) => a - b), ts = at.map((k) => tracks[k]);
        if (playlist) unlist(playlist, at.map((k) => origin?.[k] ?? k), ts);
        else if (from === "liked") unlike(ts);
        else if (from === "local") unfile(ts);
      } else if (by && (sel.size || e.key === "Home" || e.key === "End")) land(Math.max(0, Math.min(end, lead.current + by)));
      // Typing a title goes to the first that starts with it, as in Finder; a pause starts a new word.
      else if (e.key.length === 1 && e.key !== " " && !mod && !e.altKey) {
        const t = typed.current, q = (t.text = (e.timeStamp - t.at < 1000 ? t.text : "") + e.key.toLowerCase());
        t.at = e.timeStamp;
        const i = tracks.findIndex((x) => x.title.toLowerCase().startsWith(q));
        if (i >= 0) land(i);
      }
    };
    addEventListener("pointerup", up), addEventListener("pointermove", sweep), addEventListener("pointerdown", away), document.addEventListener("keydown", keys); // before App's shortcuts (on window), so ↑ ↓ move a selection
    return () => (removeEventListener("pointerup", up), removeEventListener("pointermove", sweep), removeEventListener("pointerdown", away), document.removeEventListener("keydown", keys));
  }, [sel, sweeping, tracks, onPlay]);
  // The box, kept to the page and redrawn as the pointer moves and every frame (so it follows the scroll).
  // Held past the page's top or bottom, the page scrolls, faster the further out. The rows it touches are
  // worked out from their height, as most aren't drawn. add: the rows picked already, kept with ⌘ or shift.
  const draw = (e: PointerEvent, page: HTMLElement, add: Set<number>) => {
    const x0 = e.clientX, y0 = e.clientY + page.scrollTop;
    let x = x0, y = e.clientY, was = "", frame = 0;
    const paint = () => {
      const p = page.getBoundingClientRect(), o = list.current?.getBoundingClientRect();
      const [left, right] = [Math.max(p.left, Math.min(x0, x)), Math.min(p.right, Math.max(x0, x))];
      const [top, bottom] = [Math.max(p.top, Math.min(y0 - page.scrollTop, y)), Math.min(p.bottom, Math.max(y0 - page.scrollTop, y))];
      if (box.current) Object.assign(box.current.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      const row = (y: number) => Math.max(0, Math.min(tracks.length - 1, Math.floor((y - o!.top) / rowH.current)));
      const [a, b] = o && right > o.left && left < o.right && bottom > o.top && top < o.bottom ? [row(top), row(bottom)] : [0, -1];
      if (`${a} ${b}` !== was) (was = `${a} ${b}`), setSel(new Set([...add, ...(b >= a ? run(a, b) : [])])), b >= a && (anchor.current = lead.current = a);
    };
    const move = (e: PointerEvent) => ((x = e.clientX), (y = e.clientY), paint());
    const step = () => {
      const p = page.getBoundingClientRect();
      page.scrollTop += Math.max(-40, Math.min(40, y < p.top + 16 ? (y - p.top - 16) / 2 : y > p.bottom - 16 ? (y - p.bottom + 16) / 2 : 0));
      paint(), (frame = requestAnimationFrame(step));
    };
    const done = (e: PointerEvent) => (cancelAnimationFrame(frame), move(e), removeEventListener("pointermove", move), removeEventListener("pointerup", done), document.documentElement.classList.remove("select-none"), setBoxing(false));
    addEventListener("pointermove", move), addEventListener("pointerup", done);
    document.documentElement.classList.add("select-none");
    setBoxing(true), setSel(new Set(add)), (frame = requestAnimationFrame(step));
  };
  const pick = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    held.current = undefined;
    lead.current = i;
    if (e.shiftKey) return setSel(run(anchor.current, i));
    anchor.current = i;
    if (e.metaKey || e.ctrlKey) return setSel((s) => (s.has(i) ? (s.delete(i), new Set(s)) : new Set(s).add(i)));
    // A row already picked stays with the others, so they can be dragged to a new place together.
    if (onMove && sel.has(i)) return void (held.current = i);
    setSweeping(true);
    setSel(new Set([i]));
  };
  const menu = (i: number) => {
    if (sel.has(i) && sel.size > 1) {
      const at = [...sel].sort((a, b) => a - b);
      return tracksMenu(at.map((k) => tracks[k]), playlist ? { id: playlist, at: at.map((k) => origin?.[k] ?? k) } : undefined);
    }
    anchor.current = lead.current = i;
    setSel(new Set([i]));
    trackMenu(tracks[i], playlist ? { playlist, index: origin?.[i] ?? i } : undefined);
  };
  const num = numbered || plain;
  // Which of Title, Album and Date Added show (by their place in trackCols), and the grid they make.
  const flex = [0, ...(plain ? [] : [1]), ...(added ? [2] : [])];
  const grid = { gridTemplateColumns: `${num ? "28px " : ""}${flex.map((c) => `minmax(0,${cols[c]}fr)`).join(" ")} 32px 56px` };
  return (
    <>
      {header && <TrackHeader grid={grid} num={!!num} flex={flex} played={!!times} />}
      {boxing && createPortal(<div ref={box} className="pointer-events-none fixed z-50 rounded-[3px] border border-ink/25 bg-ink/[0.08]" />, document.body)}
      <ol ref={list} data-rows onPointerEnter={() => (hot.current = true)} onPointerLeave={() => (hot.current = false)} style={{ paddingTop: start * rowH.current, paddingBottom: Math.max(0, tracks.length - stop) * rowH.current }} className="select-none">
        {tracks.slice(start, stop).map((t, k) => {
          const i = start + k, off = skipped(t);
          const dim = off || unavailable(t);
          return (
            <li
              key={t.id + i}
              // Not mid-sweep: the row a press just picked would start a move in place of the sweep.
              draggable={!!onMove && sel.has(i) && !sweeping}
              onPointerDown={(e) => pick(e, i)}
              {...warmSong(t)}
              onClick={(e) => e.detail === 1 && held.current === i && setSel(new Set([i]))}
              data-i={i}
              onDragStart={(e) => ((e.dataTransfer.effectAllowed = "move"), setDrag(i))}
              onDragOver={(e) => drag !== undefined && (e.preventDefault(), setOver(i))}
              // Cleared here too: the move re-keys the rows, so dragend never reaches the moved one.
              onDrop={() => (drag !== undefined && !sel.has(i) && onMove?.(sel.has(drag) ? [...sel].sort((a, b) => a - b) : [drag], i), setDrag(undefined), setOver(undefined))}
              onDragEnd={() => (setDrag(undefined), setOver(undefined))}
              onContextMenu={(e) => (e.preventDefault(), menu(i))}
              aria-selected={sel.has(i)}
              style={grid}
              className={`group relative grid items-center gap-4 rounded-xl px-3 py-1.5 transition-colors ${sel.has(i) ? "bg-accent/20" : "hover:bg-ink/[0.04]"} ${drag === i ? "opacity-40" : ""} ${
                over === i && drag !== undefined && drag !== i ? (drag > i ? "shadow-[inset_0_2px_var(--color-accent)]" : "shadow-[inset_0_-2px_var(--color-accent)]") : ""
              }`}
            >
              <button onClick={(e) => e.detail === 0 && onPlay(i)} onDoubleClick={() => (useSettings.getState().doubleClick === "queue" ? enqueue([t], false) : onPlay(i))} aria-label={`Play ${t.title}`} className="hit" />
              {num && <span className="text-center text-lg font-bold text-muted tabular-nums">{i + 1}</span>}
              <div className="flex min-w-0 items-center gap-3">
                {!plain && <img src={art(t.thumb, 96)} alt="" loading="lazy" draggable={false} className={`size-10 shrink-0 rounded-lg bg-ink/[0.06] object-cover ${dim ? "opacity-40" : ""}`} />}
                <div className={`min-w-0 ${dim ? "opacity-45" : ""}`}>
                  <div className={`truncate font-semibold ${on(t) ? "text-accent" : ""}`}>
                    {off && <EyeOff size={14} aria-label="Hidden" className="mr-1.5 inline -translate-y-px text-muted" />}
                    <SongName t={t} />
                  </div>
                  <div className="truncate text-sm text-muted">
                    {saved[t.id] && <CircleArrowDown size={14} aria-label="Downloaded" className="mr-1 inline -translate-y-px fill-accent text-paper" />}
                    {t.explicit && <Explicit />}
                    <Artists list={t.artists} />
                  </div>
                </div>
              </div>
              {!plain && (
                <div className={`min-w-0 truncate text-sm text-muted ${dim ? "opacity-45" : ""}`}>
                  {t.album && <button onClick={() => goToAlbum(t)} className="relative max-w-full truncate text-left hover:text-ink hover:underline">{t.album}</button>}
                </div>
              )}
              {added && <div className="min-w-0 truncate text-sm text-muted">{t.at && t.at > 1e11 ? ago(t.at) : ""}</div>}
              <LikeButton track={t} mine={!!playlist || from === "liked" || from === "local"} />
              <div className="flex justify-end text-sm text-muted tabular-nums">{on(t) ? <AudioLines size={16} className="text-accent" /> : times ? new Date(times[i]).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : t.duration}</div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

const COLUMN_NAMES = ["Title", "Album", "Date Added"];
// The header over a list's columns, the same grid as its rows. Dragging a divider moves width between the
// two columns beside it; arrows do it from the keyboard.
function TrackHeader({ grid, num, flex, played }: { grid: CSSProperties; num: boolean; flex: number[]; played: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const resizing = useRef<{ x: number; cols: [number, number, number]; per: number }>(undefined);
  const move = (left: number, right: number, by: number) => {
    const cols = [...(resizing.current?.cols ?? useSettings.getState().trackCols)] as [number, number, number];
    const total = flex.reduce((n, c) => n + cols[c], 0);
    const least = total * 0.12; // no column narrower than an eighth or so
    const d = Math.max(least - cols[left], Math.min(cols[right] - least, by));
    cols[left] += d, cols[right] -= d;
    useSettings.setState({ trackCols: cols });
  };
  const divider = (k: number) => {
    const [left, right] = [flex[k - 1], flex[k]];
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${COLUMN_NAMES[left]} and ${COLUMN_NAMES[right]}`}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0 || !row.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const cols = useSettings.getState().trackCols;
          // How wide one share is: the row less its fixed columns, padding and gaps, over the shares shown.
          const fixed = (num ? 28 : 0) + 32 + 56 + 24 + 16 * (flex.length + (num ? 2 : 1));
          resizing.current = { x: e.clientX, cols, per: (row.current.clientWidth - fixed) / flex.reduce((n, c) => n + cols[c], 0) };
          document.documentElement.style.cursor = "col-resize";
        }}
        onPointerMove={(e) => resizing.current && move(left, right, (e.clientX - resizing.current.x) / resizing.current.per)}
        onLostPointerCapture={() => ((resizing.current = undefined), (document.documentElement.style.cursor = ""))}
        onDoubleClick={() => useSettings.setState({ trackCols: TRACK_COLS })}
        onKeyDown={(e) => {
          const by = { ArrowLeft: -0.25, ArrowRight: 0.25 }[e.key];
          if (by) move(left, right, by), e.preventDefault();
        }}
        // Centred in the 16 px gap before its column.
        className="absolute -inset-y-1.5 -left-[14px] z-10 w-3 cursor-col-resize outline-none before:absolute before:inset-y-1.5 before:left-[5px] before:w-0.5 before:rounded-full before:bg-ink/15 before:transition-colors hover:before:bg-accent focus-visible:before:bg-accent"
      />
    );
  };
  return (
    <div ref={row} style={grid} className="mb-1 grid h-9 items-center gap-4 border-b border-ink/10 px-3 text-[13px] font-semibold text-muted select-none">
      {num && <span className="text-center">#</span>}
      {flex.map((c, k) => (
        <div key={c} className="relative min-w-0">
          {k > 0 && divider(k)}
          <span className="block truncate">{COLUMN_NAMES[c]}</span>
        </div>
      ))}
      <span />
      <span className="flex justify-end">{played ? "Played" : <Clock3 size={15} aria-label="Length" />}</span>
    </div>
  );
}

// When a song was added: how long ago this week, the date before that.
function ago(at: number) {
  const s = (Date.now() - at) / 1000;
  const n = (x: number, unit: string) => `${Math.floor(x)} ${unit}${Math.floor(x) === 1 ? "" : "s"} ago`;
  if (s < 60) return "Just now";
  if (s < 3600) return n(s / 60, "minute");
  if (s < 86_400) return n(s / 3600, "hour");
  if (s < 7 * 86_400) return n(s / 86_400, "day");
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// An album's page. A song kept without the link to it looks it up by name and artist, then keeps the link.
function goToAlbum(t: Track) {
  if (t.albumId) return open({ name: "collection", id: t.albumId });
  if (!t.album) return;
  albumByName(t.album, t.artists[0]?.name).then(
    (id) => (id ? (patch(t.id, { albumId: id }), open({ name: "collection", id })) : notify({ text: "No Page for This Album", detail: t.album })),
    () => notify({ text: "Couldn’t Find This Album", detail: t.album }),
  );
}

// Mixtape's rule: inside your library (Liked Songs, your playlists, your files) a row has a heart; anywhere
// else a plus, which turns to a filled check once the song is in your library in any way.
const inPlaylists = new WeakMap<LibraryData["playlists"], Set<string>>();
function held(t: Track, s: LibraryData) {
  let keys = inPlaylists.get(s.playlists);
  if (!keys) inPlaylists.set(s.playlists, (keys = new Set(s.playlists.flatMap((p) => p.tracks.flatMap((x) => [x.id, songOf(x)])))));
  return !!t.file || keys.has(t.id) || keys.has(songOf(t));
}
export function LikeButton({ track, mine }: { track: Track; mine?: boolean }) {
  const liked = useLibrary((s) => !!likedAs(track, s.liked));
  const saved = useLibrary((s) => liked || held(track, s));
  // The plus saves to Liked Songs and its toast offers View; the check opens Saved In.
  const press = () => {
    if (!mine && saved) return savedIn(track);
    toggleLike(track);
    if (!mine) useStore.setState((s) => ({ toast: s.toast && { ...s.toast, undo: undefined, action: { label: "View", run: () => savedIn(track) } } }));
  };
  return (
    <button
      onClick={press}
      aria-label={mine ? (liked ? `Unlike ${track.title}` : `Like ${track.title}`) : saved ? `Where ${track.title} is saved` : `Add ${track.title} to Liked Songs`}
      aria-pressed={mine ? liked : saved}
      className={`press relative grid size-8 place-items-center rounded-full text-muted hover:text-ink ${!mine || liked ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
    >
      {mine ? <Heart size={18} className={liked ? "fill-accent text-accent" : ""} /> : saved ? <Tick /> : <CirclePlus size={18} strokeWidth={1.75} />}
    </button>
  );
}

// A row of album (or playlist) cards that scrolls sideways, or a grid of them. remember: opening one
// from search adds it to Recent Searches.
const ROW = "-mx-8 -mt-1 flex gap-5 overflow-x-auto px-8 pt-1 pb-2 [scrollbar-width:none]";
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-6";
function Albums({ items, grid, remember }: { items: Album[]; grid?: boolean; remember?: boolean }) {
  const pick = (a: Album) => remember && addRecentSearch({ id: a.id, kind: "album", title: a.title, subtitle: a.by, thumb: a.thumb });
  return (
    <div className={grid ? GRID : ROW}>
      {items.map((a) => (
        <div key={a.id} onContextMenu={(e) => (e.preventDefault(), albumMenu(a))} className={`group relative ${grid ? "" : "w-44 shrink-0"}`}>
          <button onClick={() => (pick(a), open({ name: "collection", id: a.id }))} className="press block w-full rounded-xl text-left">
            <div className="overflow-hidden rounded-xl bg-ink/[0.06]">
              <img src={art(a.thumb, 400)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
            </div>
            <div className="mt-2.5 truncate font-semibold">{a.title}</div>
            <div className="truncate text-sm text-muted">{[a.kind, a.year ?? a.by].filter(Boolean).join(" · ")}</div>
          </button>
          {/* Sits on the cover's bottom-right corner. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
            <button
              onClick={() => (pick(a), playCollection(a.id))}
              aria-label={`Play ${a.title}`}
              className="pointer-events-auto absolute right-2 bottom-2 grid size-11 translate-y-1 place-items-center rounded-full bg-white text-black opacity-0 shadow-lg shadow-black/25 transition-[opacity,translate,scale] duration-200 ease-(--ease-out) group-hover:translate-y-0 group-hover:opacity-100 focus-visible:opacity-100 active:scale-95"
            >
              <Play size={18} className="ml-0.5 fill-current" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
// Spotify's saved mark: a small accent disc with a check.
const Tick = () => <span className="grid size-[18px] place-items-center rounded-full bg-accent text-paper"><Check size={12} strokeWidth={3.5} /></span>;
const savedIn = (track: Track) => useStore.setState({ dialog: { kind: "saved", track }, toast: undefined });

// Where a song is saved (Mixtape's Saved In, Spotify's Add to Playlist): what holds it, ticked, then every
// other playlist. Ticks wait for Done; Cancel, Escape or a click outside drop them. Rows stay where they
// opened, so they don't jump. Docks bottom-left over the sidebar, above the player bar, at one height.
function SavedIn({ d: { track: t } }: { d: Extract<Dialog, { kind: "saved" }> }) {
  const liked = useLibrary((s) => !!likedAs(t, s.liked));
  const playlists = useLibrary((s) => s.playlists);
  const holds = (p: { tracks: Track[] }) => p.tracks.some((x) => sameSong(x, t));
  const [first, setFirst] = useState(() => new Set([...(liked ? ["liked"] : []), ...playlists.filter(holds).map((p) => p.id)]));
  const [picked, setPicked] = useState(first);
  const pick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const done = () => { if (picked.has("liked") !== liked) toggleLike(t); playlists.forEach((p) => picked.has(p.id) !== holds(p) && flip(p)); closeDialog(); };
  const [q, setQ] = useState("");
  const [name, setName] = useState<string>(); // set while naming a new playlist
  const create = () => { const id = newPlaylist([t], undefined, name!.trim()); setFirst((f) => new Set([...f, id])); setPicked((f) => new Set([...f, id])); setName(undefined); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), name === undefined ? closeDialog() : setName(undefined));
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [name]);
  const found = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase());
  // Most recently changed first (the last song added, or when it was made), fixed at open like the sections.
  const [order] = useState(() => playlists.map((p) => [p.id, p.tracks.reduce((n, x) => Math.max(n, x.at ?? 0), p.at ?? 0)] as const).sort((a, b) => b[1] - a[1]).map(([id]) => id));
  const shown = playlists.filter((p) => found(p.name)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const flip = (p: (typeof playlists)[number]) => (holds(p) ? removeFromPlaylist(p.id, p.tracks.flatMap((x, i) => (sameSong(x, t) ? [i] : []))) : addToPlaylist(p.id, [t]));
  const row = (key: string, cover: ReactNode, name: string, detail: string, on: boolean, press?: () => void) => (
    <li key={key}>
      <button onClick={press} disabled={!press} aria-pressed={on} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-ink/[0.05]">
        <div className="size-10 shrink-0 overflow-hidden rounded-md">{cover}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs text-muted">{detail}</div>
        </div>
        <span className="mr-1 grid size-[18px] shrink-0 place-items-center">{on ? <Tick /> : <span className="size-[17px] rounded-full ring-[1.5px] ring-ink/30 ring-inset" />}</span>
      </button>
    </li>
  );
  const likedRow = found("Liked Songs") && row("liked", <PlaylistCover id="liked" tracks={[]} />, "Liked Songs", plural(useLibrary.getState().liked.length, "song"), picked.has("liked"), () => pick("liked"));
  const list = (ps: typeof playlists) => ps.map((p) => row(p.id, <PlaylistCover id={p.id} tracks={p.tracks} cover={p.cover} />, p.name, plural(p.tracks.length, "song"), picked.has(p.id), () => pick(p.id)));
  const head = (text: string) => <li className="px-2 pt-3 pb-1 text-xs font-semibold text-muted">{text}</li>;
  const mine = shown.filter((p) => first.has(p.id)), rest = shown.filter((p) => !first.has(p.id));
  const bar = document.querySelector("[data-player]")?.getBoundingClientRect() ?? { left: 8, top: innerHeight - 84 };
  const place: CSSProperties = { left: bar.left, bottom: innerHeight - bar.top + 8, height: Math.min(520, bar.top - 16) };
  return createPortal(
    <div onPointerDown={(e) => e.target === e.currentTarget && closeDialog()} className="fixed inset-0 z-50">
      <div role="dialog" aria-label="Saved In" onKeyDown={(e) => e.stopPropagation()} style={place} className="fixed flex w-[340px] animate-enter flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-2xl ring-1 shadow-black/30 ring-ink/10">
        <header className="flex items-start gap-2 px-4 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold tracking-tight">Saved In</h2>
            <p className="truncate text-sm text-muted">{t.title} • {t.artists.map((a) => a.name).join(", ")}</p>
          </div>
        </header>
        <div className="relative mx-4 mt-3">
          <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a playlist" aria-label="Find a playlist" autoComplete="off" spellCheck={false} className="h-9 w-full rounded-lg bg-ink/[0.06] pr-3 pl-9 text-sm outline-none placeholder:text-muted focus:ring-2 focus:ring-accent" />
        </div>
        <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <li>
            {name === undefined ? (
              <button onClick={() => setName("")} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm font-semibold hover:bg-ink/[0.05]">
                <span className="grid size-10 place-items-center rounded-md bg-ink/[0.06]"><Plus size={18} /></span> New Playlist
              </button>
            ) : (
              <form onSubmit={(e) => (e.preventDefault(), name.trim() && create())} className="flex items-center gap-3 px-2 py-1.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-ink/[0.06]"><Plus size={18} /></span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name.trim() && setName(undefined)} placeholder="Playlist name" aria-label="New playlist name" autoComplete="off" spellCheck={false} className="h-10 min-w-0 flex-1 bg-transparent text-sm font-semibold caret-accent outline-none placeholder:font-normal placeholder:text-muted" />
                <button disabled={!name.trim()} className="press px-1 text-sm font-semibold text-accent transition-colors disabled:text-muted/50">Create</button>
              </form>
            )}
          </li>
          {(t.file || (first.has("liked") && likedRow) || mine.length > 0) && head("Saved in")}
          {t.file && row("local", <span className="grid size-full place-items-center bg-ink/[0.06]"><HardDrive size={18} /></span>, "Local Files", "On this computer", true)}
          {first.has("liked") && likedRow}
          {list(mine)}
          {((!first.has("liked") && likedRow) || rest.length > 0) && head("Recently updated")}
          {!first.has("liked") && likedRow}
          {list(rest)}
        </ul>
        <footer className="flex justify-end gap-2 border-t border-ink/10 px-4 py-3">
          <button onClick={closeDialog} className={quiet}>Cancel</button>
          <button onClick={done} className={`${btn} bg-accent text-paper`}>Done</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ArtistCards({ items, grid, remember }: { items: SearchArtist[]; grid?: boolean; remember?: boolean }) {
  return (
    <div className={grid ? GRID : ROW}>
      {items.map((a) => (
        <button
          key={a.id}
          onClick={() => (remember && addRecentSearch({ id: a.id, kind: "artist", title: a.name, thumb: a.thumb }), open({ name: "artist", id: a.id, by: a.name }))}
          {...warm(a)}
          className={`press group text-center ${grid ? "" : "w-36 shrink-0"}`}
        >
          <div className="aspect-square w-full overflow-hidden rounded-full bg-ink/[0.06]">
            {a.thumb && <img src={art(a.thumb, 300)} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />}
          </div>
          <div className="mt-2.5 truncate font-semibold">{a.name}</div>
          <div className="text-xs text-muted">Artist</div>
        </button>
      ))}
    </div>
  );
}
