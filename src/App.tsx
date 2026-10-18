import { useRef, useState } from "react";
import { fetchAudio, playAudio, search, type Track } from "./yt";

// YT Music thumbnails come at 60px; ask for a sharper size.
const big = (url?: string) => url?.replace(/=w\d+-h\d+/, "=w544-h544");

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [current, setCurrent] = useState<Track>();
  const [status, setStatus] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const latest = useRef<string>("");

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus("Searching…");
    try {
      setResults(await search(query));
      setStatus("");
    } catch (err) {
      setStatus(String(err));
    }
  }

  async function play(t: Track) {
    latest.current = t.id;
    setCurrent(t);
    setStatus("Loading stream…");
    try {
      const track = await fetchAudio(t.id);
      if (latest.current !== t.id) return; // user already picked another song
      await playAudio(audio.current!, track);
      setStatus("");
    } catch (err) {
      setStatus(String(err));
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
      <main className="mx-auto max-w-3xl px-6 pt-14 pb-40">
        <h1 className="text-5xl font-bold tracking-tight">Search</h1>
        <form onSubmit={onSearch} className="mt-6">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Songs, artists…"
            className="w-full rounded-2xl border border-neutral-200 bg-white px-5 py-3.5 text-lg shadow-sm outline-none transition focus:border-neutral-400 focus:shadow-md"
          />
        </form>
        {status && <p className="mt-4 text-sm text-neutral-500">{status}</p>}

        <ul className="mt-6 space-y-1">
          {results.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => play(t)}
                className={`flex w-full items-center gap-4 rounded-xl p-2 text-left transition hover:bg-neutral-200/60 active:scale-[0.99] ${current?.id === t.id ? "bg-neutral-200/60" : ""}`}
              >
                <img src={t.thumb} alt="" className="size-12 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="truncate text-sm text-neutral-500">{t.artists}</div>
                </div>
                <span className="text-sm tabular-nums text-neutral-400">{t.duration}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>

      <div className="fixed inset-x-0 bottom-5 flex justify-center px-5">
        <div className="flex w-full max-w-3xl items-center gap-4 rounded-2xl border border-white/60 bg-white/70 p-3 shadow-xl shadow-black/10 backdrop-blur-xl">
          {current ? (
            <>
              <img src={big(current.thumb)} alt="" className="size-12 rounded-lg object-cover" />
              <div className="min-w-0 w-48">
                <div className="truncate font-medium">{current.title}</div>
                <div className="truncate text-sm text-neutral-500">{current.artists}</div>
              </div>
            </>
          ) : (
            <div className="w-64 pl-2 text-sm text-neutral-400">Nothing playing</div>
          )}
          <audio ref={audio} controls className="h-10 flex-1" />
        </div>
      </div>
    </div>
  );
}
