import { Fragment, useEffect, useState, type ReactNode } from "react";
import { AudioLines, ChevronDown, Play } from "lucide-react";
import { open, play, report, useStore } from "./store";
import { albumTracks, art, artist, search, type Album, type Track } from "./yt";

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
        <div className={`transition-opacity duration-300 ${loading ? "opacity-40" : ""}`}>
          {top && (
            <button onClick={() => open({ name: "artist", id: top.id })} className="group mt-14 flex items-center gap-8 text-left">
              <div className="size-40 shrink-0 overflow-hidden rounded-full bg-ink/[0.06]">
                <img src={art(top.thumb, 400)} alt="" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
              </div>
              <div>
                <div className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">Artist</div>
                <div className="mt-1 text-6xl font-extrabold tracking-[-0.045em]">{top.name}</div>
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
          <button onClick={() => play(data.songs, 0)} className="mt-7 flex h-11 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-paper transition active:scale-95">
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

export function NowPlaying() {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  const track = queue[index];
  const upNext = queue.slice(index + 1);

  return (
    <div className="fixed inset-0 z-30 animate-enter overflow-hidden bg-paper">
      {track && <img src={art(track.thumb, 120)} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-3xl" />}
      <div className="relative grid h-full grid-cols-2 gap-16 px-16 pt-20 pb-32">
        <div className="flex min-h-0 flex-col justify-end">
          {track ? (
            <>
              <img src={art(track.thumb, 1000)} alt="" className="aspect-square w-full max-w-[min(100%,50vh)] rounded-2xl object-cover shadow-2xl shadow-black/25" />
              <h1 className="mt-10 line-clamp-2 text-[clamp(40px,5vw,72px)] leading-[0.95] font-extrabold tracking-[-0.045em]">{track.title}</h1>
              <div className="mt-3 truncate text-xl text-ink/60">
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
        className="glass absolute top-12 right-6 z-10 grid size-9 place-items-center rounded-full transition active:scale-95"
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
            <div className="truncate font-semibold">{t.title}</div>
            <div className="truncate text-sm text-muted">
              <Artists list={t.artists} />
            </div>
          </div>
          <div className="truncate text-sm text-muted">{t.album}</div>
          <div className="flex justify-end text-sm text-muted tabular-nums">{current === t.id ? <AudioLines size={16} className="text-ink" /> : t.duration}</div>
        </li>
      ))}
    </ol>
  );
}

function Albums({ items }: { items: Album[] }) {
  return (
    <div className="-mx-12 flex gap-6 overflow-x-auto px-12 pb-2 [scrollbar-width:none]">
      {items.map((a) => (
        <button key={a.id} onClick={() => albumTracks(a.id).then((t) => play(t, 0), report)} className="group w-48 shrink-0 text-left">
          <div className="overflow-hidden rounded-xl bg-ink/[0.06]">
            <img src={art(a.thumb, 400)} alt="" className="aspect-square w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
          </div>
          <div className="mt-3 truncate font-semibold">{a.title}</div>
          <div className="text-sm text-muted">{a.year}</div>
        </button>
      ))}
    </div>
  );
}
