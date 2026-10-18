import { Fragment, useEffect, useState, type ReactNode } from "react";
import { AudioLines, ChevronDown, Play } from "lucide-react";
import { open, play, report, useStore } from "./store";
import { albumTracks, art, artist, home, search, type Album, type Track } from "./yt";

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
  const { data, error, loading } = useAsync(() => (term ? search(term) : undefined), [term]);
  const top = data?.top;

  return (
    <div className="animate-enter px-12 pt-24">
      {/* The placeholder doubles as the page title. */}
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        spellCheck={false}
        className="w-full bg-transparent text-display outline-none placeholder:text-ink"
      />
      {!query && <p className="mt-4 text-lg text-muted">Songs and artists from everywhere.</p>}
      {error && <p className="mt-6 text-muted">{error}</p>}

      {data && term && (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-40" : ""}`}>
          {top && (
            <button onClick={() => open({ name: "artist", id: top.id })} className="group mt-14 flex items-center gap-8 text-left">
              <div className="size-40 shrink-0 overflow-hidden rounded-full bg-ink/[0.06]">
                <img src={art(top.thumb, 400)} alt="" className="size-full object-cover transition-transform duration-300 ease-(--ease-out) group-hover:scale-[1.03]" />
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

const playAlbum = (id: string) => albumTracks(id).then((t) => play(t, 0), report);

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
  const { data, error } = useAsync(home, []);
  if (error) return <p className="mt-6 text-muted">Couldn't load your start page. Search still works.</p>;
  if (!data)
    return (
      <div className="animate-pulse">
        <div className="mt-12 h-[clamp(300px,42vh,440px)] rounded-[28px] bg-ink/[0.05]" />
        <div className="mt-16 h-64 rounded-2xl bg-ink/[0.04]" />
      </div>
    );

  const [hero, ...releases] = data.releases.length ? data.releases : data.more;
  return (
    <div className="animate-enter">
      {hero && (
        <button
          onClick={() => playAlbum(hero.id)}
          className="group relative isolate mt-12 flex h-[clamp(300px,42vh,440px)] w-full items-center overflow-hidden rounded-[28px] text-left text-white transition-transform duration-200 ease-(--ease-out) active:scale-[0.99]"
        >
          <img src={art(hero.thumb, 120)} alt="" className="absolute inset-0 -z-10 size-full scale-150 object-cover blur-3xl saturate-150" />
          <div className="absolute inset-0 -z-10 bg-linear-to-r from-black/60 via-black/30 to-black/0" />
          <div className="min-w-0 flex-1 p-10 lg:p-14">
            <h2 className="line-clamp-3 text-[clamp(40px,5.5vw,84px)] leading-[0.92] font-extrabold tracking-[-0.04em]">{hero.title}</h2>
            <div className="mt-4 truncate text-lg text-white/80">{hero.by}</div>
            <span className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 font-semibold text-ink transition-transform duration-200 ease-(--ease-out) group-hover:scale-[1.04]">
              <Play size={16} className="fill-current" /> Play
            </span>
          </div>
          <img
            src={art(hero.thumb, 900)}
            alt=""
            className="mr-10 aspect-square h-[78%] shrink-0 rounded-2xl object-cover shadow-2xl shadow-black/40 transition-transform duration-300 ease-(--ease-out) group-hover:scale-[1.02] lg:mr-14"
          />
        </button>
      )}
      {data.picks.length > 0 && (
        <Section title="Quick picks">
          <TrackGrid tracks={data.picks} />
        </Section>
      )}
      {releases.length > 0 && (
        <Section title="New releases">
          <Albums items={releases} />
        </Section>
      )}
      {data.trending.length > 0 && (
        <Section title="Trending">
          <TrackGrid tracks={data.trending} numbered />
        </Section>
      )}
      {data.more.length > 0 && data.releases.length > 0 && (
        <Section title="New albums & singles">
          <Albums items={data.more} />
        </Section>
      )}
    </div>
  );
}

// Songs in columns of four that scroll sideways, like a record shelf.
function TrackGrid({ tracks, numbered }: { tracks: Track[]; numbered?: boolean }) {
  const current = useStore((s) => s.queue[s.index]?.id);
  return (
    <ol className="-mx-12 grid auto-cols-[clamp(280px,31%,380px)] grid-flow-col grid-rows-4 gap-x-4 overflow-x-auto px-9 pb-2 [scrollbar-width:none]">
      {tracks.map((t, i) => (
        <li key={t.id + i} className="group relative flex items-center gap-3.5 rounded-xl p-2 transition-colors hover:bg-ink/[0.04]">
          <button onClick={() => play(tracks, i)} aria-label={`Play ${t.title}`} className="absolute inset-0 rounded-xl" />
          {numbered && <span className="w-7 shrink-0 text-center text-2xl font-extrabold tracking-tight text-muted tabular-nums">{i + 1}</span>}
          <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-ink/[0.06] pointer-events-none">
            <img src={art(t.thumb, 120)} alt="" className="size-full object-cover" />
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
  if (error) return <p className="px-12 pt-28 text-muted">{error}</p>;
  if (!data) return <div className="h-[min(68vh,620px)] animate-pulse bg-ink/[0.03]" />;

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
          <button onClick={() => play(data.songs, 0)} className="press mt-7 flex h-11 items-center gap-2 rounded-full bg-accent px-6 font-semibold text-white">
            <Play size={16} className="fill-current" /> Play
          </button>
        </div>
      </header>

      <div className="px-12">
        {data.about && <p className="mt-10 line-clamp-3 max-w-2xl text-[15px] leading-relaxed text-ink/65">{data.about}</p>}
        {data.songs.length > 0 && (
          <Section title="Top songs">
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

  return (
    <div
      inert={!open}
      className={`fixed inset-0 z-30 overflow-hidden bg-accent ${
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
          <h2 className="mb-4 text-2xl font-bold tracking-tight">Up next</h2>
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

function TrackList({ tracks, numbered, onPlay = (i) => play(tracks, i) }: { tracks: Track[]; numbered?: boolean; onPlay?: (i: number) => void }) {
  const current = useStore((s) => s.queue[s.index]?.id);
  return (
    <ol>
      {tracks.map((t, i) => (
        <li
          key={t.id + i}
          className={`group relative grid items-center gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-ink/[0.04] ${numbered ? "grid-cols-[28px_40px_1fr_1fr_48px]" : "grid-cols-[40px_1fr_1fr_48px]"}`}
        >
          <button onClick={() => onPlay(i)} aria-label={`Play ${t.title}`} className="absolute inset-0 rounded-xl" />
          {numbered && <span className="text-center text-lg font-bold text-muted tabular-nums">{i + 1}</span>}
          <img src={art(t.thumb, 96)} alt="" className="size-10 rounded-md bg-ink/[0.06] object-cover" />
          <div className="min-w-0">
            <div className={`truncate font-semibold ${current === t.id ? "text-accent" : ""}`}>{t.title}</div>
            <div className="truncate text-sm text-muted">
              <Artists list={t.artists} />
            </div>
          </div>
          <div className="truncate text-sm text-muted">{t.album}</div>
          <div className="flex justify-end text-sm text-muted tabular-nums">{current === t.id ? <AudioLines size={16} className="text-accent" /> : t.duration}</div>
        </li>
      ))}
    </ol>
  );
}

function Albums({ items }: { items: Album[] }) {
  return (
    <div className="-mx-12 flex gap-6 overflow-x-auto px-12 pb-2 [scrollbar-width:none]">
      {items.map((a) => (
        <button key={a.id} onClick={() => playAlbum(a.id)} className="group press w-48 shrink-0 rounded-xl text-left">
          <div className="overflow-hidden rounded-xl bg-ink/[0.06]">
            <img src={art(a.thumb, 400)} alt="" className="aspect-square w-full object-cover transition-transform duration-300 ease-(--ease-out) group-hover:scale-[1.03]" />
          </div>
          <div className="mt-3 truncate font-semibold">{a.title}</div>
          <div className="truncate text-sm text-muted">{a.year ?? a.by}</div>
        </button>
      ))}
    </div>
  );
}
