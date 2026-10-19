import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AudioLines, CaseSensitive, Check, ChevronDown, Copy, Download, Ellipsis, GripVertical, Heart, ImageDown, Languages, Maximize2, Music, PencilLine, Play, Plus, Quote, Radio, Shuffle, Sparkle, Upload, X } from "lucide-react";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import { EQ_BANDS, EQ_PRESETS, addToPlaylist, audio, back, clearQueue, deletePlaylist, enqueue, jump, moveInQueue, newPlaylist, notify, open, play, removeFromPlaylist, radioFrom, removeFromQueue, renamePlaylist, report, restoreLibrary, shufflePlay, startRadio, subscribeAudio, toggle, toggleLike, toggleSave, useLibrary, useOnline, useSettings, useStore, type Dialog } from "./store";
import { asText, estimateWords, groups, isRtl, lineNow, lrcTime, lyricsNow, removeMine, sampleSpring, saveMine, songKey, springProgress, titleOf, translateTarget, useExtras, useLine, useLyrics, useMine, wordProgress, type Group, type Lyrics, type Word } from "./lyrics";
import { art, artist, collection, home, lastHome, search, type Album, type Track } from "./yt";
import { version } from "../package.json";

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

export function Search() {
  const query = useStore((s) => s.query);
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const online = useOnline(); // a search that failed offline runs again on reconnect
  const { data, error, loading } = useAsync(() => (term ? search(term) : undefined), [term, online]);
  const top = data?.top;

  return (
    <div className="animate-enter px-8 pt-14">
      {/* The placeholder doubles as the page title. */}
      <input
        autoFocus
        value={query}
        onChange={(e) => useStore.setState({ query: e.target.value })}
        placeholder="Search"
        aria-label="Search"
        name="q"
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-transparent text-display outline-none placeholder:text-ink"
      />
      {!query && (
        <>
          <p className="mt-3 text-lg text-muted">Songs and artists from everywhere.</p>
          <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {genres.map(([name, colour]) => (
              <button
                key={name}
                onClick={() => useStore.setState({ query: `${name} hits` })}
                style={{ background: colour }}
                className="press relative aspect-[16/10] overflow-hidden rounded-2xl p-4 text-left text-xl font-extrabold tracking-tight text-white hover:brightness-110"
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p title={error} className="mt-6 text-muted">Search didn’t go through. Check your connection and try again.</p>}

      {data && term && (
        <div aria-busy={loading} className={`transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>
          {top && (
            <button onClick={() => open({ name: "artist", id: top.id })} className="group mt-10 flex items-center gap-6 text-left">
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
            <TrackList tracks={data.songs} />
          </Section>
        </div>
      )}
    </div>
  );
}

const playCollection = (id: string) => collection(id).then((c) => play(c.tracks, 0), report);
const count = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

// Right-click menus are the OS's own. ponytail: Tauri-only; the web build needs an HTML fallback.
export const popup = (items: MenuOptions["items"]) => Menu.new({ items }).then((m) => m.popup(), report);

// from: the row is in one of your playlists, or in the queue (an index into the whole queue).
export function trackMenu(t: Track, from?: { playlist: string; index: number } | { queue: number }) {
  const { liked, playlists } = useLibrary.getState();
  const by = t.artists.find((a) => a.id);
  const q = from && "queue" in from ? from.queue : -1;
  const { index, queue } = useStore.getState();
  popup([
    ...(q < 0
      ? [
          { text: "Play Next", action: () => enqueue([t], true) },
          { text: "Add to Queue", action: () => enqueue([t], false) },
        ]
      : [
          ...(q > index + 1 ? [{ text: "Move Up", action: () => moveInQueue(q, q - 1) }] : []),
          ...(q < queue.length - 1 ? [{ text: "Move Down", action: () => moveInQueue(q, q + 1) }] : []),
          { text: "Remove from Queue", action: () => removeFromQueue(q) },
        ]),
    { text: "Start Radio", action: () => startRadio(t) },
    { text: "Edit Lyrics…", action: () => editLyrics(t) },
    { item: "Separator" as const },
    { text: liked.some((x) => x.id === t.id) ? "Remove from Liked Songs" : "Add to Liked Songs", action: () => toggleLike(t) },
    {
      text: "Add to Playlist",
      items: [
        { text: "New Playlist", action: () => open({ name: "playlist", id: newPlaylist([t]) }) },
        ...(playlists.length ? [{ item: "Separator" as const }] : []),
        ...playlists.map((p) => ({ text: p.name, action: () => addToPlaylist(p.id, [t]) })),
      ],
    },
    ...(from && "playlist" in from ? [{ text: "Remove from This Playlist", action: () => removeFromPlaylist(from.playlist, from.index) }] : []),
    ...(by ? [{ item: "Separator" as const }, { text: `Go to ${by.name}`, action: () => open({ name: "artist", id: by.id! }) }] : []),
  ]);
}

const albumMenu = (a: Album) =>
  popup([
    { text: "Play", action: () => playCollection(a.id) },
    { text: "Play Next", action: () => collection(a.id).then((c) => enqueue(c.tracks, true), report) },
    { text: "Add to Queue", action: () => collection(a.id).then((c) => enqueue(c.tracks, false), report) },
    { text: useLibrary.getState().saved.some((x) => x.id === a.id) ? "Remove from Library" : "Add to Library", action: () => toggleSave(a) },
  ]);

const LIKED = "bg-linear-to-br from-[#ff375f] to-[#b80f3c]";
// A playlist with no artwork yet still gets its own colour, picked from its id.
const tints = ["from-[#ff375f] to-[#ff9f0a]", "from-[#0a84ff] to-[#30d158]", "from-[#bf5af2] to-[#ff375f]", "from-[#ff9f0a] to-[#ffd60a]", "from-[#5e5ce6] to-[#64d2ff]", "from-[#30d158] to-[#0a84ff]"];
const tint = (id: string) => `bg-linear-135 ${tints[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % tints.length]}`;
const TITLE = "line-clamp-2 text-[clamp(36px,6.5cqw,80px)] leading-[0.92] font-extrabold tracking-[-0.04em]";

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
function PlayButtons({ tracks }: { tracks: Track[] }) {
  return (
    <>
      <button onClick={() => play(tracks, 0)} disabled={!tracks.length} className={`${pill} bg-white text-black hover:bg-white/85 disabled:opacity-50`}>
        <Play size={16} className="fill-current" /> Play
      </button>
      <button onClick={() => shufflePlay(tracks)} disabled={!tracks.length} className={`${pill} bg-white/20 hover:bg-white/30 disabled:opacity-50`}>
        <Shuffle size={16} /> Shuffle
      </button>
      <button onClick={() => radioFrom(tracks)} disabled={!tracks.length} aria-label="Radio" title="Radio" className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-50">
        <Radio size={16} />
      </button>
    </>
  );
}

const Skeleton = ({ className }: { className: string }) => (
  <div role="status" className={`animate-pulse ${className}`}>
    <span className="sr-only">Loading…</span>
  </div>
);

// YT Music's own start page, artwork first.
export function Home() {
  return (
    <div className="animate-enter px-8 pt-14">
      <h1 className="text-display">Home</h1>
      <Shelves />
    </div>
  );
}

function Shelves() {
  const online = useOnline();
  const [tries, setTries] = useState(0);
  const { data: fresh, error } = useAsync(home, [online, tries]);
  const data = fresh ?? lastHome;
  if (!data && error)
    return (
      <div className="mt-6 flex items-center gap-4">
        <p className="text-muted">Couldn’t load your start page. Search still works.</p>
        <button onClick={() => setTries((n) => n + 1)} className="press h-9 rounded-full bg-ink/[0.07] px-4 text-sm font-semibold hover:bg-ink/[0.12]">
          Try Again
        </button>
      </div>
    );
  if (!data)
    return (
      <div role="status" className="animate-pulse">
        <span className="sr-only">Loading…</span>
        <div className="mt-8 h-[clamp(260px,38vh,380px)] rounded-3xl bg-ink/[0.05]" />
        <div className="mt-12 h-56 rounded-2xl bg-ink/[0.04]" />
      </div>
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
            <h2 className="line-clamp-3 text-[clamp(36px,6cqw,76px)] leading-[0.92] font-extrabold tracking-[-0.04em]">{hero.title}</h2>
            <div className="mt-3 truncate text-lg text-white/80">{hero.by}</div>
            <button onClick={() => playCollection(hero.id)} className={`${pill} pointer-events-auto mt-6 inline-flex bg-white text-black hover:bg-white/85`}>
              <Play size={16} className="fill-current" /> Play
            </button>
          </div>
          <img src={art(hero.thumb, 900)} alt="" className="pointer-events-none mr-8 aspect-square h-[78%] shrink-0 rounded-2xl object-cover shadow-2xl shadow-black/40 @4xl:mr-10" />
        </div>
      )}
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
export function CollectionPage({ id }: { id: string }) {
  const { data, error } = useAsync(() => collection(id), [id]);
  const saved = useLibrary((s) => s.saved.some((a) => a.id === id));
  if (error) return <p className="px-8 pt-20 text-muted">Couldn’t open this. Go back and try again.</p>;
  if (!data) return <Skeleton className="h-[380px] bg-ink/[0.04]" />;
  const isAlbum = id.startsWith("MPRE");

  return (
    <div className="animate-enter">
      <Masthead
        cover={<img src={art(data.thumb, 600)} alt="" className="size-full object-cover" />}
        bg={data.thumb}
        title={<h1 className={TITLE}>{data.title}</h1>}
        sub={data.by && <Artists list={[data.by]} />}
        meta={[data.kind, ...data.meta].filter(Boolean).join(" · ")}
      >
        <PlayButtons tracks={data.tracks} />
        <button onClick={() => toggleSave({ id, title: data.title, by: data.by?.name, thumb: data.thumb })} aria-pressed={saved} className={`${pill} bg-white/20 px-4 hover:bg-white/30`}>
          {saved ? <Check size={16} strokeWidth={2.6} /> : <Plus size={16} strokeWidth={2.6} />} {saved ? "Saved" : "Save"}
        </button>
      </Masthead>
      <div className="px-8">
        {data.about && <p className="mt-6 line-clamp-2 max-w-2xl text-[15px] leading-relaxed text-ink/65">{data.about}</p>}
        <div className="mt-6">
          <TrackList tracks={data.tracks} numbered={isAlbum} plain={isAlbum} />
        </div>
      </div>
    </div>
  );
}

// Liked Songs and the playlists you make.
export function Library() {
  const { liked, saved, playlists } = useLibrary();
  return (
    <div className="animate-enter px-8 pt-14">
      <h1 className="text-display">Library</h1>
      <div className={`group relative isolate mt-8 flex min-h-[clamp(230px,30vh,320px)] items-end overflow-hidden rounded-3xl p-8 text-white @4xl:p-10 ${LIKED}`}>
        <button onClick={() => open({ name: "playlist", id: "liked" })} aria-label="Open Liked Songs" className="hit" />
        <div className="pointer-events-none min-w-0 flex-1">
          <Heart className="size-9 fill-white" strokeWidth={0} />
          <h2 className="mt-4 text-[clamp(36px,6cqw,76px)] leading-[0.92] font-extrabold tracking-[-0.04em]">Liked Songs</h2>
          <div className="mt-2 text-lg text-white/80">{liked.length ? count(liked.length) : "Tap the heart on any song."}</div>
          {liked.length > 0 && (
            <button onClick={() => play(liked, 0)} className={`${pill} pointer-events-auto mt-6 bg-white text-black hover:bg-white/85`}>
              <Play size={16} className="fill-current" /> Play
            </button>
          )}
        </div>
        {/* The latest likes, stacked like sleeves pulled from a crate. */}
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

      <Section title="Playlists">
        <div className="-mx-8 -mt-1 flex gap-5 overflow-x-auto px-8 pt-1 pb-2 [scrollbar-width:none]">
          <button onClick={() => open({ name: "playlist", id: newPlaylist() })} className="press w-44 shrink-0 text-left">
            <div className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-ink/15 text-muted transition-colors hover:border-ink/35 hover:text-ink">
              <Plus size={32} strokeWidth={1.75} />
            </div>
            <div className="mt-2.5 font-semibold">New Playlist</div>
          </button>
          {[...playlists].reverse().map((p) => (
            <button
              key={p.id}
              onClick={() => open({ name: "playlist", id: p.id })}
              onContextMenu={(e) => (e.preventDefault(), popup([{ text: "Delete Playlist", action: () => deletePlaylist(p.id) }]))}
              className="press w-44 shrink-0 text-left"
            >
              <div className="aspect-square overflow-hidden rounded-xl bg-ink/[0.06]">
                <PlaylistCover id={p.id} tracks={p.tracks} />
              </div>
              <div className="mt-2.5 truncate font-semibold">{p.name}</div>
              <div className="truncate text-sm text-muted">{count(p.tracks.length)}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Albums & Playlists">
        {saved.length ? <Albums items={saved} /> : <p className="text-muted">Save an album or playlist and it lands here.</p>}
      </Section>
    </div>
  );
}

function PlaylistCover({ id, tracks }: { id: string; tracks: Track[] }) {
  if (id === "liked")
    return (
      <div className={`grid size-full place-items-center ${LIKED}`}>
        <Heart className="size-[36%] fill-white text-white" strokeWidth={0} />
      </div>
    );
  const thumbs = [...new Set(tracks.map((t) => t.thumb).filter(Boolean))].slice(0, 4);
  if (thumbs.length === 4)
    return (
      <div className="grid size-full grid-cols-2">
        {thumbs.map((src) => <img key={src} src={art(src, 300)} alt="" className="size-full object-cover" />)}
      </div>
    );
  if (thumbs[0]) return <img src={art(thumbs[0], 600)} alt="" className="size-full object-cover" />;
  return (
    <div className={`grid size-full place-items-center text-white/85 ${tint(id)}`}>
      <Music className="size-1/3" strokeWidth={1.5} />
    </div>
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const liked = useLibrary((s) => s.liked);
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  if (id !== "liked" && !playlist) return <p className="px-8 pt-20 text-muted">This playlist was deleted.</p>;
  const tracks = playlist?.tracks ?? liked;

  return (
    <div className="animate-enter">
      <Masthead
        cover={<PlaylistCover id={id} tracks={tracks} />}
        bg={playlist && tracks[0]?.thumb}
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
                className={`${TITLE} -my-2 w-full bg-transparent py-2 caret-white outline-none`}
              />
            </h1>
          ) : (
            <h1 className={TITLE}>Liked Songs</h1>
          )
        }
        meta={`${playlist ? "Playlist" : "Library"} · ${count(tracks.length)}`}
      >
        <PlayButtons tracks={tracks} />
        {playlist && (
          <button
            onClick={() => popup([{ text: "Delete Playlist", action: () => (back(), deletePlaylist(id)) }])}
            aria-label="More"
            title="More"
            aria-haspopup="menu"
            className="press grid size-10 place-items-center rounded-full bg-white/20 hover:bg-white/30"
          >
            <Ellipsis size={20} />
          </button>
        )}
      </Masthead>
      <div className="mt-6 px-8">
        {tracks.length ? (
          <TrackList tracks={tracks} playlist={playlist?.id} />
        ) : (
          <p className="text-muted">{playlist ? "Right-click any song and choose Add to Playlist." : "Tap the heart on any song and it lands here."}</p>
        )}
      </div>
    </div>
  );
}

// Songs in columns of four that scroll sideways, like a record shelf.
function TrackGrid({ tracks, numbered }: { tracks: Track[]; numbered?: boolean }) {
  const current = useStore((s) => s.queue[s.index]?.id);
  return (
    <ol className="-mx-8 grid auto-cols-[clamp(260px,31%,360px)] grid-flow-col grid-rows-4 gap-x-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
      {tracks.map((t, i) => (
        <li key={t.id + i} onContextMenu={(e) => (e.preventDefault(), trackMenu(t))} className="group relative flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-ink/[0.04]">
          <button onClick={() => play(tracks, i)} aria-label={`Play ${t.title}`} className="hit" />
          {numbered && <span className="w-7 shrink-0 text-center text-xl font-extrabold tracking-tight text-muted tabular-nums">{i + 1}</span>}
          <div className="pointer-events-none relative size-12 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06]">
            <img src={art(t.thumb, 120)} alt="" loading="lazy" className="size-full object-cover" />
            <div className={`absolute inset-0 grid place-items-center bg-black/35 text-white transition-opacity duration-150 ${current === t.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              {current === t.id ? <AudioLines size={18} /> : <Play size={16} className="fill-current" />}
            </div>
          </div>
          <div className="min-w-0">
            <div className={`truncate font-semibold ${current === t.id ? "text-accent" : ""}`}>{t.title}</div>
            <div className="truncate text-sm text-muted">
              {t.rec && <Sparkle size={14} aria-label="Recommended" className="mr-1.5 inline -translate-y-px fill-accent text-accent drop-shadow-[0_0_4px_var(--color-accent)]" />}
              <Artists list={t.artists} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// The banner runs edge to edge and fades into the page; the about text floats on it.
export function Artist({ id }: { id: string }) {
  const { data, error } = useAsync(() => artist(id), [id]);
  const [all, setAll] = useState(false);
  if (error) return <p title={error} className="px-8 pt-20 text-muted">Couldn’t load this artist. Go back and try again.</p>;
  if (!data) return <Skeleton className="h-[min(60vh,540px)] bg-ink/[0.03]" />;

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
          <h1 className="text-display">{data.name}</h1>
          <div className="mt-6 flex gap-2.5">
            <button onClick={() => play(data.songs, 0)} disabled={!data.songs.length} className={`${pill} bg-accent text-paper disabled:opacity-50`}>
              <Play size={16} className="fill-current" /> Play
            </button>
            <button onClick={() => shufflePlay(data.songs)} disabled={!data.songs.length} aria-label="Shuffle" title="Shuffle" className="press grid size-10 place-items-center rounded-full bg-ink/[0.08] hover:bg-ink/[0.14] disabled:opacity-50">
              <Shuffle size={17} />
            </button>
            <button onClick={() => radioFrom(data.songs)} disabled={!data.songs.length} aria-label="Artist radio" title="Artist radio" className="press grid size-10 place-items-center rounded-full bg-ink/[0.08] hover:bg-ink/[0.14] disabled:opacity-50">
              <Radio size={17} />
            </button>
          </div>
        </div>
        {data.about && (
          <aside className="glass relative mb-1 hidden w-72 shrink-0 rounded-2xl p-5 @3xl:block">
            <h2 className="font-bold">About</h2>
            <p className="mt-1.5 line-clamp-5 text-sm leading-relaxed text-ink/75">{data.about}</p>
          </aside>
        )}
      </header>

      <div className="px-8">
        {data.about && <p className="mt-8 line-clamp-3 max-w-2xl text-[15px] leading-relaxed text-ink/65 @3xl:hidden">{data.about}</p>}
        {data.songs.length > 0 && (
          <Section
            title="Popular Songs"
            action={data.songs.length > 5 && <button onClick={() => setAll(!all)} className="press text-sm font-semibold text-muted hover:text-ink">{all ? "Show less" : "Show all"}</button>}
          >
            <TrackList tracks={all ? data.songs : data.songs.slice(0, 5)} numbered onPlay={(i) => play(data.songs, i)} />
          </Section>
        )}
        {data.albums.length > 0 && (
          <Section title="Albums">
            <Albums items={data.albums} />
          </Section>
        )}
        {data.singles.length > 0 && (
          <Section title="Singles & EPs">
            <Albums items={data.singles} />
          </Section>
        )}
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
                <h1 className="mt-10 line-clamp-2 text-[clamp(40px,5vw,72px)] leading-[0.95] font-extrabold tracking-[-0.04em]">{track.title}</h1>
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
  if (!track) return null;
  return (
    <>
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
export function editLyrics(t: Track) {
  const key = songKey(t);
  const now = lyricsNow(t);
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
  return (
    <div onPointerDown={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && onClose())}
        className={`flex max-h-full animate-enter flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-2xl ring-1 shadow-black/30 ring-ink/10 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  return dialog?.kind === "edit" ? <LyricsEditor d={dialog} /> : dialog?.kind === "card" ? <LyricCard d={dialog} /> : null;
}
const closeDialog = () => useStore.setState({ dialog: undefined });

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
const fit = (ctx: CanvasRenderingContext2D, s: string, w: number) => {
  if (ctx.measureText(s).width <= w) return s;
  while (s && ctx.measureText(`${s}…`).width > w) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
};
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
// ponytail: mirrors the bindings in App.tsx by hand; generate both from one table when remapping lands.
const keys: [string, string[]][] = [
  ["Play or pause", ["Space"]],
  ["Back or forward 5 seconds", ["←", "→"]],
  ["Previous or next song", [`${mod}←`, `${mod}→`]],
  ["Volume down or up", [`${mod}↓`, `${mod}↑`]],
  ["Shuffle, then Smart Shuffle", [`${mod}S`]],
  ["Repeat all, one or off", [`${mod}R`]],
  ["Like the playing song", [`${mod}L`]],
  ["Search", [`${mod}K`]],
  ["Go back or forward", [`${mod}[`, `${mod}]`]],
  ["Home, Search, Library", [`${mod}1`, `${mod}2`, `${mod}3`]],
  ["New playlist", [`${mod}N`]],
  ["Settings", [`${mod},`]],
  ["Show or hide the sidebar", [`${mod}B`]],
  ["Close full screen", ["Esc"]],
];

// The file comes from anywhere, so check its shape before it replaces the library.
async function restore(file: File) {
  const ids = (x: unknown) => Array.isArray(x) && x.every((y) => typeof y?.id === "string");
  try {
    const { liked, saved, playlists } = JSON.parse(await file.text());
    if (!ids(liked) || !ids(saved) || !ids(playlists) || !playlists.every((p: { tracks: unknown }) => ids(p.tracks))) throw 0;
    restoreLibrary({ liked, saved, playlists });
  } catch {
    notify({ text: "Couldn’t Restore", detail: `${file.name} isn’t a Sleeve library export` });
  }
}

const panes = [
  { id: "appearance", label: "Appearance" },
  { id: "playback", label: "Playback" },
  { id: "lyrics", label: "Lyrics" },
  { id: "library", label: "Library" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
] as const;

const btn = "press flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50";
const solid = `${btn} bg-ink text-paper`;
const quiet = `${btn} bg-ink/[0.07] hover:bg-ink/[0.12]`;

// Its own list of panes beside the content, like System Settings.
export function Settings() {
  const [pane, setPane] = useState<(typeof panes)[number]["id"]>("appearance");
  return (
    <div className="animate-enter px-8 pt-14">
      <h1 className="text-display">Settings</h1>
      <div className="mt-10 flex items-start gap-10">
        <nav aria-label="Settings" className="sticky top-14 flex w-40 shrink-0 flex-col gap-1">
          {panes.map(({ id, label }) => (
            <button key={id} onClick={() => setPane(id)} aria-current={pane === id ? "page" : undefined} className={`flex h-9 items-center rounded-xl px-3 font-semibold transition-colors ${pane === id ? "bg-ink/[0.08]" : "text-muted hover:bg-ink/[0.04] hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div key={pane} className="max-w-3xl min-w-0 flex-1 animate-enter">
          {pane === "appearance" ? <Appearance /> : pane === "playback" ? <Playback /> : pane === "lyrics" ? <LyricsPane /> : pane === "library" ? <LibraryPane /> : pane === "shortcuts" ? <Shortcuts /> : <About />}
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const { theme, artworkAccent } = useSettings();
  const set = useSettings.setState;
  return (
    <>
      <Group title="Theme">
        <Choice label="System" on={theme === "system"} onPick={() => set({ theme: "system" })}>
          <Preview scheme="light" />
          <div className="absolute inset-0 [clip-path:inset(0_0_0_50%)]"><Preview scheme="dark" /></div>
        </Choice>
        <Choice label="Light" on={theme === "light"} onPick={() => set({ theme: "light" })}><Preview scheme="light" /></Choice>
        <Choice label="Dark" on={theme === "dark"} onPick={() => set({ theme: "dark" })}><Preview scheme="dark" /></Choice>
      </Group>
      <Group title="Colour">
        <Choice label="From Artwork" on={artworkAccent} onPick={() => set({ artworkAccent: true })}><Preview tint="#ff8a3d" /></Choice>
        <Choice label="Sleeve Pink" on={!artworkAccent} onPick={() => set({ artworkAccent: false })}><Preview /></Choice>
      </Group>
    </>
  );
}

const fill = (v: number, min: number, max: number) => ({ "--p": `${((v - min) / (max - min)) * 100}%` }) as CSSProperties;

function Row({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-6 py-3">
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-sm text-muted">{detail}</div>
      </div>
      {children}
    </div>
  );
}

function Playback() {
  const { quality, normalize, crossfade, eq } = useSettings();
  const set = useSettings.setState;
  const preset = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === eq[i]))?.[0];
  return (
    <>
      <div className="mb-10 divide-y divide-ink/10">
        <Row label="Audio Quality" detail={quality === "high" ? "The best stream there is for each song" : "Smaller streams, for slow or metered connections"}>
          <div role="radiogroup" aria-label="Audio Quality" className="flex rounded-full bg-ink/[0.07] p-1">
            {(["high", "low"] as const).map((q) => (
              <button key={q} role="radio" aria-checked={quality === q} onClick={() => set({ quality: q })} className={`h-7 rounded-full px-3 text-sm font-semibold transition-colors ${quality === q ? "bg-paper shadow-sm" : "text-muted hover:text-ink"}`}>
                {q === "high" ? "High" : "Data Saver"}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Normalise Volume" detail="Turns loud songs down to the level of the rest">
          <Switch label="Normalise Volume" on={normalize} onChange={(normalize) => set({ normalize })} />
        </Row>
        <Row label="Crossfade" detail={crossfade ? "Songs fade into each other" : "Off: songs play back to back with no gap"}>
          <div className="flex items-center gap-3">
            <input type="range" aria-label="Crossfade" min={0} max={12} step={1} value={crossfade} onChange={(e) => set({ crossfade: +e.target.value })} style={fill(crossfade, 0, 12)} className="w-40" />
            <span className="w-10 text-right text-sm tabular-nums">{crossfade ? `${crossfade} s` : "Off"}</span>
          </div>
        </Row>
      </div>
      <section>
        <h2 className="mb-3 text-xl font-bold tracking-tight">Equalizer</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(EQ_PRESETS).map(([name, g]) => (
            <button key={name} aria-pressed={preset === name} onClick={() => set({ eq: g })} className={`press h-8 rounded-full px-3.5 text-sm font-semibold transition-colors ${preset === name ? "bg-ink text-paper" : "bg-ink/[0.07] hover:bg-ink/[0.12]"}`}>
              {name}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-between rounded-2xl bg-ink/[0.04] px-8 py-6">
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

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-ink/20"}`}>
      <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ease-out ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

// Languages lyrics translate into, named in your own. Chinese is the two scripts Google offers.
const LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "nl", "sv", "pl", "tr", "ru", "uk", "el", "ar", "he", "hi", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];
const names = new Intl.DisplayNames([navigator.language], { type: "language" });
const languageName = (code: string) => names.of({ "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" }[code] ?? code) ?? code;

function LyricsPane() {
  const { lyricsPeek, lyricsWords, lyricsStill, translateTo } = useSettings();
  const set = useSettings.setState;
  const mine = Object.entries(useMine((s) => s.songs)).sort((a, b) => b[1].at - a[1].at);
  return (
    <>
      <div className="mb-6 divide-y divide-ink/10">
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
      <p className="max-w-xl text-sm leading-relaxed text-muted">
        Lyrics are your own first, then Apple Music’s word by word, then LRCLIB, a free library anyone can add to, then NetEase Cloud Music. Translation and romanisation are by Google, and only happen when you switch them on.
      </p>
      <section className="mt-10">
        <h2 className="mb-3 text-xl font-bold tracking-tight">Your Lyrics</h2>
        {mine.length ? (
          <div className="divide-y divide-ink/10">
            {mine.map(([key, m]) => (
              <div key={key} className="flex h-14 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{m.title}</div>
                  <div className="truncate text-sm text-muted">{m.artist}</div>
                </div>
                <button onClick={() => useStore.setState({ dialog: { kind: "edit", key, title: m.title, artist: m.artist, text: m.text } })} className={quiet}>Edit</button>
                <button onClick={() => removeMine(key)} className={quiet}>Remove</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">Lyrics you write or fix land here. Right-click any song and choose Edit Lyrics.</p>
        )}
      </section>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-bold tracking-tight">{title}</h2>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

function Choice({ label, on, onPick, children }: { label: string; on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button role="radio" aria-checked={on} onClick={onPick} className="group text-left">
      <div className={`relative aspect-[16/10] overflow-hidden rounded-xl ring-1 ring-ink/10 outline-offset-2 transition-[outline-color] ${on ? "outline-2 outline-accent" : "outline-2 outline-transparent group-hover:outline-ink/20"}`}>
        {children}
      </div>
      <div className={`mt-2 text-sm ${on ? "font-bold" : "text-muted"}`}>{label}</div>
    </button>
  );
}

// Sleeve in miniature: the icon rail, the page with its big title and coloured card, the player.
// Tokens are light-dark(), so a color-scheme here repaints it; tint stands in for the artwork colour.
function Preview({ scheme, tint = "#ff375f" }: { scheme?: "light" | "dark"; tint?: string }) {
  return (
    <div style={{ colorScheme: scheme }} className="absolute inset-0 flex gap-[2.5%] bg-base p-[2.5%] text-ink">
      <div className="flex w-[9%] flex-col items-center gap-[8%] rounded-[4px] bg-paper pt-[30%]">
        {[1, 0.25, 0.25].map((o, i) => <div key={i} className="aspect-square w-[40%] rounded-full bg-ink" style={{ opacity: o }} />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3%]">
        <div className="flex-1 rounded-[4px] bg-paper p-[5%]">
          <div className="h-[16%] w-[45%] rounded-[2px] bg-ink" />
          <div className="mt-[6%] flex h-[48%] items-center justify-end rounded-[4px] p-[4%]" style={{ background: `linear-gradient(135deg, ${tint}, color-mix(in oklab, ${tint} 55%, black))` }}>
            <div className="aspect-square h-full rounded-[2px] bg-white/30" />
          </div>
        </div>
        <div className="flex h-[13%] items-center gap-[4%] rounded-[4px] bg-paper px-[3%]" style={{ backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${tint} 30%, transparent), transparent)` }}>
          <div className="aspect-square h-[60%] rounded-[2px]" style={{ background: tint }} />
          <div className="aspect-square h-[55%] rounded-full" style={{ background: tint }} />
          <div className="h-[12%] flex-1 rounded-full bg-ink/20" />
        </div>
      </div>
    </div>
  );
}

function exportLibrary() {
  const { liked, saved, playlists } = useLibrary.getState();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ liked, saved, playlists })], { type: "application/json" }));
  a.download = `Sleeve Library ${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  notify({ text: "Library Exported", detail: "Saved to your Downloads folder" });
}

function LibraryPane() {
  const { liked, saved, playlists } = useLibrary();
  const file = useRef<HTMLInputElement>(null);
  const stats = [["Liked songs", liked.length, LIKED], ["Playlists", playlists.length, tint("a")], ["Albums", saved.length, tint("b")]] as const;
  return (
    <>
      <dl className="grid grid-cols-3 gap-3">
        {stats.map(([label, n, bg]) => (
          <div key={label} className={`flex flex-col-reverse rounded-2xl p-5 text-white ${bg}`}>
            <dt className="mt-1 font-semibold text-white/85">{label}</dt>
            <dd className="text-5xl font-extrabold tracking-[-0.04em] tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex gap-2">
        <button onClick={exportLibrary} className={solid}>
          <Download size={16} /> Export
        </button>
        <button onClick={() => file.current?.click()} className={quiet}>
          <Upload size={16} /> Restore from File…
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && restore(e.target.files[0]), (e.target.value = ""))} />
      </div>
    </>
  );
}

function Shortcuts() {
  return (
    <div className="divide-y divide-ink/10">
      {keys.map(([label, combo]) => (
        <div key={label} className="flex h-12 items-center justify-between gap-6">
          <span>{label}</span>
          <span className="flex gap-1.5">
            {combo.map((k) => <kbd key={k} className="min-w-7 rounded-md bg-ink/[0.07] px-2 py-0.5 text-center font-mono text-xs">{k}</kbd>)}
          </span>
        </div>
      ))}
    </div>
  );
}

function About() {
  return (
    <div>
      <div className="text-5xl font-extrabold tracking-[-0.04em]">Sleeve</div>
      <div className="mt-2 text-muted">Version {version}</div>
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

export function Artists({ list }: { list: Track["artists"] }) {
  return list.map((a, i) => (
    <Fragment key={i}>
      {i > 0 && ", "}
      {a.id ? (
        <button onClick={(e) => (e.stopPropagation(), open({ name: "artist", id: a.id! }))} className="relative hover:text-ink hover:underline">
          {a.name}
        </button>
      ) : (
        a.name
      )}
    </Fragment>
  ));
}

// The queue beside the page, opened from the player bar (like Spotify's). Drag a row, or use its menu, to reorder.
const QUEUE_MIN = 260, QUEUE_MAX = 560;
const resizeQueue = (w: number) => useSettings.setState({ queueWidth: Math.round(Math.min(QUEUE_MAX, Math.max(QUEUE_MIN, w))) });

export function QueuePanel() {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const added = useStore((s) => s.added);
  const [drag, setDrag] = useState<number>();
  const [over, setOver] = useState<number>();
  const mine = queue.slice(index + 1, index + 1 + added);
  const rest = queue.slice(index + 1 + added);

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
          <span className="min-w-0 truncate"><Artists list={t.artists} /></span>
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
        <h3 className={heading}>Next Up</h3>
        {rest.length ? <ol>{rest.map((t, i) => row(t, index + 1 + added + i))}</ol> : <p className="px-3 text-sm text-muted">When the queue ends, similar songs play.</p>}
      </div>
    </aside>
  );
}

function TrackList({ tracks, numbered, plain, playlist, onPlay = (i) => play(tracks, i) }: { tracks: Track[]; numbered?: boolean; plain?: boolean; playlist?: string; onPlay?: (i: number) => void }) {
  const current = useStore((s) => s.queue[s.index]?.id);
  return (
    <ol>
      {tracks.map((t, i) => (
        <li
          key={t.id + i}
          onContextMenu={(e) => (e.preventDefault(), trackMenu(t, playlist ? { playlist, index: i } : undefined))}
          className={`group relative grid items-center gap-4 rounded-xl px-3 py-1.5 transition-colors [contain-intrinsic-size:auto_56px] [content-visibility:auto] hover:bg-ink/[0.04] ${plain ? "grid-cols-[28px_1fr_32px_48px]" : numbered ? "grid-cols-[28px_40px_1fr_1fr_32px_48px]" : "grid-cols-[40px_1fr_1fr_32px_48px]"}`}
        >
          <button onClick={() => onPlay(i)} aria-label={`Play ${t.title}`} className="hit" />
          {numbered && <span className="text-center text-lg font-bold text-muted tabular-nums">{i + 1}</span>}
          {!plain && <img src={art(t.thumb, 96)} alt="" loading="lazy" className="size-10 rounded-lg bg-ink/[0.06] object-cover" />}
          <div className="min-w-0">
            <div className={`truncate font-semibold ${current === t.id ? "text-accent" : ""}`}>{t.title}</div>
            <div className="truncate text-sm text-muted">
              <Artists list={t.artists} />
            </div>
          </div>
          {!plain && <div className="truncate text-sm text-muted">{t.album}</div>}
          <LikeButton track={t} />
          <div className="flex justify-end text-sm text-muted tabular-nums">{current === t.id ? <AudioLines size={16} className="text-accent" /> : t.duration}</div>
        </li>
      ))}
    </ol>
  );
}

function LikeButton({ track }: { track: Track }) {
  const liked = useLibrary((s) => s.liked.some((t) => t.id === track.id));
  return (
    <button
      onClick={() => toggleLike(track)}
      aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
      aria-pressed={liked}
      className={`press relative grid size-8 place-items-center rounded-full text-muted hover:text-ink ${liked ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
    >
      <Heart size={16} className={liked ? "fill-accent text-accent" : ""} />
    </button>
  );
}

function Albums({ items }: { items: Album[] }) {
  return (
    <div className="-mx-8 -mt-1 flex gap-5 overflow-x-auto px-8 pt-1 pb-2 [scrollbar-width:none]">
      {items.map((a) => (
        <div key={a.id} onContextMenu={(e) => (e.preventDefault(), albumMenu(a))} className="group relative w-44 shrink-0">
          <button onClick={() => open({ name: "collection", id: a.id })} className="press block w-full rounded-xl text-left">
            <div className="overflow-hidden rounded-xl bg-ink/[0.06]">
              <img src={art(a.thumb, 400)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
            </div>
            <div className="mt-2.5 truncate font-semibold">{a.title}</div>
            <div className="truncate text-sm text-muted">{a.year ?? a.by}</div>
          </button>
          {/* Sits on the cover's bottom-right corner: 176px cover − 44px button − 8px inset. */}
          <button
            onClick={() => playCollection(a.id)}
            aria-label={`Play ${a.title}`}
            className="absolute top-[124px] right-2 grid size-11 translate-y-1 place-items-center rounded-full bg-white text-black opacity-0 shadow-lg shadow-black/25 transition-[opacity,translate,scale] duration-200 ease-(--ease-out) group-hover:translate-y-0 group-hover:opacity-100 focus-visible:opacity-100 active:scale-95"
          >
            <Play size={18} className="ml-0.5 fill-current" />
          </button>
        </div>
      ))}
    </div>
  );
}
