import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Check, ChevronDown, Ellipsis, Heart, Music, Play, Plus, Shuffle } from "lucide-react";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import { addToPlaylist, back, deletePlaylist, newPlaylist, open, play, removeFromPlaylist, renamePlaylist, report, toggleLike, toggleSave, useLibrary, useOnline, useStore } from "./store";
import { art, artist, collection, home, lastHome, search, type Album, type Track } from "./yt";

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

export function Search() {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const online = useOnline(); // a search that failed offline runs again on reconnect
  const { data, error, loading } = useAsync(() => (term ? search(term) : undefined), [term, online]);
  const top = data?.top;

  return (
    <div className="animate-enter px-12 pt-24">
      {/* The placeholder doubles as the page title. */}
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search"
        name="q"
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-transparent text-display outline-none placeholder:text-ink"
      />
      {!query && <p className="mt-4 text-lg text-muted">Songs and artists from everywhere.</p>}
      {error && <p title={error} className="mt-6 text-muted">Search didn’t go through. Check your connection and try again.</p>}

      {data && term && (
        <div aria-busy={loading} className={`transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>
          {top && (
            <button onClick={() => open({ name: "artist", id: top.id })} className="group mt-14 flex items-center gap-8 text-left">
              <div className="size-40 shrink-0 overflow-hidden rounded-full bg-ink/[0.06]">
                <img src={art(top.thumb, 400)} alt="" className="size-full object-cover" />
              </div>
              <div>
                <div className="text-6xl font-extrabold tracking-[-0.04em]">{top.name}</div>
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

const shuffled = <T,>(list: T[]) => list.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const playCollection = (id: string) => collection(id).then((c) => play(c.tracks, 0), report);
const count = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

// Right-click menus are the OS's own. ponytail: Tauri-only; the web build needs an HTML fallback.
const popup = (items: MenuOptions["items"]) => Menu.new({ items }).then((m) => m.popup(), report);

export function trackMenu(t: Track, from?: { playlist: string; index: number }) {
  const { liked, playlists } = useLibrary.getState();
  const by = t.artists.find((a) => a.id);
  popup([
    { text: liked.some((x) => x.id === t.id) ? "Remove from Liked Songs" : "Add to Liked Songs", action: () => toggleLike(t) },
    {
      text: "Add to Playlist",
      items: [
        { text: "New Playlist", action: () => open({ name: "playlist", id: newPlaylist([t]) }) },
        ...(playlists.length ? [{ item: "Separator" as const }] : []),
        ...playlists.map((p) => ({ text: p.name, action: () => addToPlaylist(p.id, [t]) })),
      ],
    },
    ...(from ? [{ text: "Remove from This Playlist", action: () => removeFromPlaylist(from.playlist, from.index) }] : []),
    ...(by ? [{ item: "Separator" as const }, { text: `Go to ${by.name}`, action: () => open({ name: "artist", id: by.id! }) }] : []),
  ]);
}

const albumMenu = (a: Album) =>
  popup([
    { text: "Play", action: () => playCollection(a.id) },
    { text: useLibrary.getState().saved.some((x) => x.id === a.id) ? "Remove from Library" : "Add to Library", action: () => toggleSave(a) },
  ]);

const LIKED = "bg-linear-to-br from-[#ff375f] to-[#b80f3c]";
const TITLE = "line-clamp-2 text-[clamp(40px,5.5vw,88px)] leading-[0.92] font-extrabold tracking-[-0.04em]";

// The top of every album and playlist page: cover and title over the artwork's own blur.
function Masthead({ cover, bg, tint = "bg-neutral-800", title, sub, meta, children }: { cover: ReactNode; bg?: string; tint?: string; title: ReactNode; sub?: ReactNode; meta: string; children: ReactNode }) {
  return (
    <header className="relative isolate overflow-hidden px-12 pt-28 pb-12 text-white [--color-ink:white]">
      {bg ? <img src={art(bg, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-150 object-cover blur-3xl saturate-150" /> : <div className={`absolute inset-0 -z-10 ${tint}`} />}
      <div className="absolute inset-0 -z-10 bg-linear-to-r from-black/70 via-black/45 to-black/20" />
      <div className="flex items-end gap-10">
        <div className="size-[clamp(180px,22vw,280px)] shrink-0 overflow-hidden rounded-2xl bg-white/10 shadow-2xl shadow-black/40">{cover}</div>
        <div className="min-w-0 flex-1">
          {title}
          {sub && <div className="mt-4 truncate text-xl font-semibold">{sub}</div>}
          <div className="mt-1.5 truncate text-white/80">{meta}</div>
          <div className="mt-7 flex gap-3">{children}</div>
        </div>
      </div>
    </header>
  );
}

const pill = "press flex h-11 items-center gap-2 rounded-full px-6 font-semibold";
function PlayButtons({ tracks }: { tracks: Track[] }) {
  return (
    <>
      <button onClick={() => play(tracks, 0)} disabled={!tracks.length} className={`${pill} bg-white text-black hover:bg-white/85 disabled:opacity-50`}>
        <Play size={16} className="fill-current" /> Play
      </button>
      <button onClick={() => play(shuffled(tracks), 0)} disabled={!tracks.length} className={`${pill} bg-white/20 hover:bg-white/30 disabled:opacity-50`}>
        <Shuffle size={16} /> Shuffle
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
    <div className="animate-enter px-12 pt-24">
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
        <div className="mt-12 h-[clamp(300px,42vh,440px)] rounded-[28px] bg-ink/[0.05]" />
        <div className="mt-16 h-64 rounded-2xl bg-ink/[0.04]" />
      </div>
    );

  // The first album or playlist on the page gets the big card instead of a spot on its shelf.
  const heroShelf = data.find((s) => s.albums.length);
  const hero = heroShelf?.albums[0];
  return (
    <div className="animate-enter">
      {hero && (
        <div className="group relative isolate mt-12 flex h-[clamp(300px,42vh,440px)] items-center overflow-hidden rounded-[28px] text-white">
          <button onClick={() => open({ name: "collection", id: hero.id })} aria-label={`Open ${hero.title}`} className="hit" />
          <img src={art(hero.thumb, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-150 object-cover blur-3xl saturate-150" />
          <div className="absolute inset-0 -z-10 bg-linear-to-r from-black/60 via-black/30 to-black/0" />
          <div className="pointer-events-none min-w-0 flex-1 p-10 lg:p-14">
            <h2 className="line-clamp-3 text-[clamp(40px,5.5vw,84px)] leading-[0.92] font-extrabold tracking-[-0.04em]">{hero.title}</h2>
            <div className="mt-4 truncate text-lg text-white/80">{hero.by}</div>
            <button onClick={() => playCollection(hero.id)} className="press pointer-events-auto mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 font-semibold text-black hover:bg-white/85">
              <Play size={16} className="fill-current" /> Play
            </button>
          </div>
          <img
            src={art(hero.thumb, 900)}
            alt=""
            className="pointer-events-none mr-10 aspect-square h-[78%] shrink-0 rounded-2xl object-cover shadow-2xl shadow-black/40 lg:mr-14"
          />
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
  if (error) return <p className="px-12 pt-28 text-muted">Couldn’t open this. Go back and try again.</p>;
  if (!data) return <Skeleton className="h-[440px] bg-ink/[0.04]" />;
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
        <button onClick={() => toggleSave({ id, title: data.title, by: data.by?.name, thumb: data.thumb })} aria-pressed={saved} className={`${pill} bg-white/20 px-5 hover:bg-white/30`}>
          {saved ? <Check size={16} strokeWidth={2.6} /> : <Plus size={16} strokeWidth={2.6} />} {saved ? "Saved" : "Save"}
        </button>
      </Masthead>
      <div className="px-12">
        {data.about && <p className="mt-8 line-clamp-2 max-w-2xl text-[15px] leading-relaxed text-ink/65">{data.about}</p>}
        <div className="mt-8">
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
    <div className="animate-enter px-12 pt-24">
      <h1 className="text-display">Library</h1>
      <div className={`group relative isolate mt-12 flex min-h-[clamp(260px,34vh,360px)] items-end overflow-hidden rounded-[28px] p-10 text-white lg:p-14 ${LIKED}`}>
        <button onClick={() => open({ name: "playlist", id: "liked" })} aria-label="Open Liked Songs" className="hit" />
        <div className="pointer-events-none min-w-0 flex-1">
          <Heart className="size-10 fill-white" strokeWidth={0} />
          <h2 className="mt-5 text-[clamp(40px,5.5vw,84px)] leading-[0.92] font-extrabold tracking-[-0.04em]">Liked Songs</h2>
          <div className="mt-3 text-lg text-white/80">{liked.length ? count(liked.length) : "Tap the heart on any song."}</div>
          {liked.length > 0 && (
            <button onClick={() => play(liked, 0)} className={`${pill} pointer-events-auto mt-7 bg-white text-black hover:bg-white/85`}>
              <Play size={16} className="fill-current" /> Play
            </button>
          )}
        </div>
        {/* The latest likes, stacked like sleeves pulled from a crate. */}
        <div className="pointer-events-none absolute top-1/2 right-10 hidden -translate-y-1/2 lg:right-14 lg:flex">
          {liked.slice(0, 4).map((t, i) => (
            <img
              key={t.id}
              src={art(t.thumb, 400)}
              alt=""
              style={{ zIndex: 4 - i, rotate: `${i * 4 - 3}deg` }}
              className="-ml-28 size-[clamp(150px,20vh,210px)] rounded-xl object-cover shadow-2xl shadow-black/40 transition-[rotate] duration-300 ease-(--ease-out) first:ml-0 group-hover:rotate-0"
            />
          ))}
        </div>
      </div>

      <Section title="Playlists">
        <div className="-mx-12 -mt-1 flex gap-6 overflow-x-auto px-12 pt-1 pb-2 [scrollbar-width:none]">
          <button onClick={() => open({ name: "playlist", id: newPlaylist() })} className="press w-48 shrink-0 text-left">
            <div className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-ink/15 text-muted transition-colors hover:border-ink/35 hover:text-ink">
              <Plus size={36} strokeWidth={1.75} />
            </div>
            <div className="mt-3 font-semibold">New Playlist</div>
          </button>
          {[...playlists].reverse().map((p) => (
            <button
              key={p.id}
              onClick={() => open({ name: "playlist", id: p.id })}
              onContextMenu={(e) => (e.preventDefault(), popup([{ text: "Delete Playlist", action: () => deletePlaylist(p.id) }]))}
              className="press w-48 shrink-0 text-left"
            >
              <div className="aspect-square overflow-hidden rounded-xl bg-ink/[0.06]">
                <PlaylistCover id={p.id} tracks={p.tracks} />
              </div>
              <div className="mt-3 truncate font-semibold">{p.name}</div>
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
    <div className="grid size-full place-items-center text-ink/35">
      <Music className="size-1/3" strokeWidth={1.5} />
    </div>
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const liked = useLibrary((s) => s.liked);
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  if (id !== "liked" && !playlist) return <p className="px-12 pt-28 text-muted">This playlist was deleted.</p>;
  const tracks = playlist?.tracks ?? liked;

  return (
    <div className="animate-enter">
      <Masthead
        cover={<PlaylistCover id={id} tracks={tracks} />}
        bg={playlist && tracks[0]?.thumb}
        tint={playlist ? undefined : LIKED}
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
            className="press grid size-11 place-items-center rounded-full bg-white/20 hover:bg-white/30"
          >
            <Ellipsis size={20} />
          </button>
        )}
      </Masthead>
      <div className="mt-8 px-12">
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
    <ol className="-mx-12 grid auto-cols-[clamp(280px,31%,380px)] grid-flow-col grid-rows-4 gap-x-4 overflow-x-auto px-9 pb-2 [scrollbar-width:none]">
      {tracks.map((t, i) => (
        <li key={t.id + i} onContextMenu={(e) => (e.preventDefault(), trackMenu(t))} className="group relative flex items-center gap-3.5 rounded-2xl p-2 transition-colors hover:bg-ink/[0.04]">
          <button onClick={() => play(tracks, i)} aria-label={`Play ${t.title}`} className="hit" />
          {numbered && <span className="w-7 shrink-0 text-center text-2xl font-extrabold tracking-tight text-muted tabular-nums">{i + 1}</span>}
          <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06] pointer-events-none">
            <img src={art(t.thumb, 120)} alt="" loading="lazy" className="size-full object-cover" />
            <div className={`absolute inset-0 grid place-items-center bg-black/35 text-white transition-opacity duration-150 ${current === t.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              {current === t.id ? <AudioLines size={20} /> : <Play size={18} className="fill-current" />}
            </div>
          </div>
          <div className="min-w-0">
            <div className={`truncate font-semibold ${current === t.id ? "text-accent" : ""}`}>{t.title}</div>
            <div className="truncate text-sm text-muted">
              <Artists list={t.artists} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Artist({ id }: { id: string }) {
  const { data, error } = useAsync(() => artist(id), [id]);
  if (error) return <p title={error} className="px-12 pt-28 text-muted">Couldn’t load this artist. Go back and try again.</p>;
  if (!data) return <Skeleton className="h-[min(68vh,620px)] bg-ink/[0.03]" />;

  return (
    <div className="animate-enter">
      <header className={`relative flex items-end ${data.banner ? "h-[min(68vh,620px)]" : "pt-32"}`}>
        {data.banner && (
          <img
            src={art(data.banner, 2160, 900)}
            alt=""
            className="absolute inset-0 size-full object-cover object-[50%_25%] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]"
          />
        )}
        <div className="relative px-12">
          <h1 className="text-display">{data.name}</h1>
          <button onClick={() => play(data.songs, 0)} disabled={!data.songs.length} className="press mt-7 flex h-11 items-center gap-2 rounded-full bg-accent px-6 font-semibold text-paper disabled:opacity-50">
            <Play size={16} className="fill-current" /> Play
          </button>
        </div>
      </header>

      <div className="px-12">
        {data.about && <p className="mt-10 line-clamp-3 max-w-2xl text-[15px] leading-relaxed text-ink/65">{data.about}</p>}
        {data.songs.length > 0 && (
          <Section title="Top Songs">
            <TrackList tracks={data.songs} numbered />
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

// A sheet that rises from the player bar. Always mounted so it can slide both ways; transitions, not
// keyframes, so a quick open-close reverses from wherever it is.
export function NowPlaying() {
  const open = useStore((s) => s.nowPlaying);
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const track = queue[index];
  const upNext = queue.slice(index + 1);
  const close = useRef<HTMLButtonElement>(null);

  // Focus moves into the sheet, and back to wherever it was when the sheet closes.
  useEffect(() => {
    if (!open) return;
    const was = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => was?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div
      inert={!open}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      className={`fixed inset-0 z-30 overflow-hidden bg-accent-deep ${
        open
          ? "visible translate-y-0 [transition:transform_450ms_var(--ease-drawer)]"
          : "invisible translate-y-full [transition:transform_300ms_var(--ease-drawer),visibility_0s_300ms]"
      }`}
    >
      {track && <img src={art(track.thumb, 120)} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-35 blur-3xl saturate-150" />}
      <div className="absolute inset-0 bg-linear-to-t from-black/45 to-black/5" />
      {/* Everything on the sheet is white: the palette is remapped rather than restyled. */}
      <div className="relative grid h-full grid-cols-2 gap-16 px-16 pt-20 pb-32 text-white [--color-accent:white] [--color-ink:white] [--color-muted:rgb(255_255_255/0.68)]">
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
        <div className="flex min-h-0 flex-col justify-end">
          <h2 className="mb-4 text-2xl font-bold tracking-tight">Up Next</h2>
          {upNext.length ? (
            <div className="min-h-0 overflow-y-auto">
              <TrackList tracks={upNext} onPlay={(i) => play(queue, index + 1 + i)} />
            </div>
          ) : (
            <p className="text-muted">Nothing queued.</p>
          )}
        </div>
      </div>
      <button
        ref={close}
        onClick={() => useStore.setState({ nowPlaying: false })}
        aria-label="Close"
        className="glass press absolute top-12 right-6 z-10 grid size-9 place-items-center rounded-full"
      >
        <ChevronDown size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="mb-5 text-2xl font-bold tracking-tight">{title}</h2>
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

function TrackList({ tracks, numbered, plain, playlist, onPlay = (i) => play(tracks, i) }: { tracks: Track[]; numbered?: boolean; plain?: boolean; playlist?: string; onPlay?: (i: number) => void }) {
  const current = useStore((s) => s.queue[s.index]?.id);
  return (
    <ol>
      {tracks.map((t, i) => (
        <li
          key={t.id + i}
          onContextMenu={(e) => (e.preventDefault(), trackMenu(t, playlist ? { playlist, index: i } : undefined))}
          className={`group relative grid items-center gap-4 rounded-2xl px-3 py-2 transition-colors [contain-intrinsic-size:auto_60px] [content-visibility:auto] hover:bg-ink/[0.04] ${plain ? "grid-cols-[28px_1fr_32px_48px]" : numbered ? "grid-cols-[28px_40px_1fr_1fr_32px_48px]" : "grid-cols-[40px_1fr_1fr_32px_48px]"}`}
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
    <div className="-mx-12 -mt-1 flex gap-6 overflow-x-auto px-12 pt-1 pb-2 [scrollbar-width:none]">
      {items.map((a) => (
        <div key={a.id} onContextMenu={(e) => (e.preventDefault(), albumMenu(a))} className="group relative w-48 shrink-0">
          <button onClick={() => open({ name: "collection", id: a.id })} className="press block w-full rounded-xl text-left">
            <div className="overflow-hidden rounded-xl bg-ink/[0.06]">
              <img src={art(a.thumb, 400)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
            </div>
            <div className="mt-3 truncate font-semibold">{a.title}</div>
            <div className="truncate text-sm text-muted">{a.year ?? a.by}</div>
          </button>
          <button
            onClick={() => playCollection(a.id)}
            aria-label={`Play ${a.title}`}
            className="absolute top-[140px] right-2 grid size-11 translate-y-1 place-items-center rounded-full bg-white text-black opacity-0 shadow-lg shadow-black/25 transition-[opacity,translate,scale] duration-200 ease-(--ease-out) group-hover:translate-y-0 group-hover:opacity-100 focus-visible:opacity-100 active:scale-95"
          >
            <Play size={18} className="ml-0.5 fill-current" />
          </button>
        </div>
      ))}
    </div>
  );
}
