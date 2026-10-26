import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, FileSpreadsheet, FolderPlus, Music2, Upload, type LucideIcon } from "lucide-react";
import { follow, useLibrary } from "./store";
import { pickPlaylists } from "./import";
import { canSignIn, useAccount } from "./account";
import { addFolder, canHaveFiles, useLocal } from "./local";
import { restore, solid, SpotifyImport } from "./views";
import { Hello } from "./hello";
import { art, findArtist } from "./yt";

// The first time it opens: sign in or carry on without, bring your music, pick a few artists. Each
// can be skipped; none comes back (Settings has all of it).
// preview: shown again from Settings → About, so it starts at sign-in even when you're signed in.
export function Welcome({ onDone, preview }: { onDone: () => void; preview?: boolean }) {
  const signedIn = useAccount((s) => !!s.user);
  const [step, setStep] = useState(preview || (canSignIn && !signedIn) ? 0 : 1);
  const [spotify, setSpotify] = useState<"open" | "done">(); // Spotify's import, as a page of its own
  const [kept] = useState(() => useLibrary.getState().liked.length + useLibrary.getState().playlists.length);
  const was = useRef(signedIn);
  useEffect(() => void (signedIn && !was.current && setStep((s) => Math.max(s, 1)), (was.current = signedIn)), [signedIn]);
  const finish = () => ((localStorage.onboarded = 1), onDone());
  // Back goes as far as sign-in only while it's still yours to do.
  const first = preview || (canSignIn && !signedIn) ? 0 : 1;
  if (step === 0) return <Hello onSkip={() => setStep(1)} />;
  return (
    <div role="dialog" aria-modal aria-label="Welcome" data-tauri-drag-region className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-paper px-8 pt-16 pb-10">
      {(step > first || spotify === "open") && <button onClick={() => (spotify === "open" ? setSpotify(undefined) : setStep(step - 1))} aria-label="Back" className="press absolute top-12 left-6 grid size-9 place-items-center rounded-full text-muted hover:bg-ink/[0.07] hover:text-ink"><ChevronLeft size={22} /></button>}
      <div key={spotify === "open" ? "spotify" : step} className="flex w-full max-w-3xl animate-enter flex-col items-center text-center">
        {step === 1 && spotify === "open" ? (
          <Step title="Import from Spotify" about="Sign in, then pick what comes over. It all lands in your library.">
            <SpotifyImport inline={(imported) => setSpotify(imported ? "done" : undefined)} />
          </Step>
        ) : step === 1 ? (
          <BringMusic kept={kept} spotified={spotify === "done"} onNext={() => setStep(2)} onSpotify={() => setSpotify("open")} />
        ) : (
          <PickArtists onNext={finish} />
        )}
      </div>
      <div aria-hidden className="mt-auto flex gap-2 pt-10">
        {[0, 1, 2].slice(canSignIn ? 0 : 1).map((i) => <span key={i} className={`size-2 rounded-full transition-colors ${i === step ? "bg-ink" : "bg-ink/15"}`} />)}
      </div>
    </div>
  );
}

function Step({ title, about, children }: { title: string; about: string; children: ReactNode }) {
  return (
    <>
      <h1 className="text-[clamp(40px,6vw,72px)] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance">{title}</h1>
      <p className="mt-3 mb-9 max-w-lg text-lg text-balance text-muted">{about}</p>
      {children}
    </>
  );
}

// Artists most people know, across styles; their pictures come in as YouTube Music answers.
const PICKS = ["Taylor Swift", "The Weeknd", "Billie Eilish", "Drake", "Bad Bunny", "Dua Lipa", "Kendrick Lamar", "SZA", "Arctic Monkeys", "BTS", "Daft Punk", "Frank Ocean", "Coldplay", "Rosalía", "Tyler, The Creator", "Lana Del Rey", "Fred again..", "Beyoncé"];
type Found = Awaited<ReturnType<typeof findArtist>> | null;

function PickArtists({ onNext }: { onNext: () => void }) {
  const [found, setFound] = useState<Record<string, Found>>({});
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    for (const name of PICKS) findArtist(name).then((a) => setFound((f) => ({ ...f, [name]: a ?? null })), () => setFound((f) => ({ ...f, [name]: null })));
  }, []);
  const next = () => (follow(picked.flatMap((n) => (found[n] ? [found[n]!] : []))), onNext());
  // Picking is the last step, so its buttons start the app.
  return (
    <Step title="Pick a few artists" about="They go in your library, so their music is never far away.">
      <ul className="grid w-full max-w-2xl grid-cols-6 gap-5">
        {PICKS.map((name) => {
          const a = found[name], on = picked.includes(name);
          return (
            <li key={name}>
              <button onClick={() => setPicked((p) => (on ? p.filter((x) => x !== name) : [...p, name]))} disabled={!a} aria-pressed={on} className="press flex w-full flex-col items-center gap-2 disabled:cursor-default">
                <span className={`relative aspect-square w-full overflow-hidden rounded-full bg-ink/[0.06] transition-shadow duration-200 ${a === undefined ? "animate-pulse" : ""} ${on ? "shadow-[0_0_0_3px_var(--color-accent)]" : ""}`}>
                  {a?.thumb && <img src={art(a.thumb, 240)} alt="" className="size-full object-cover" />}
                  {on && (
                    <span className="absolute inset-0 grid animate-enter place-items-center bg-accent/50">
                      <Check size={36} strokeWidth={3} className="text-white" />
                    </span>
                  )}
                </span>
                <span className={`line-clamp-2 text-[13px] leading-tight font-semibold ${a === null ? "text-muted" : ""}`}>{name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-9 flex gap-3">
        <button onClick={next} className={solid}>{picked.length ? `Follow ${picked.length} and Start Listening` : "Start Listening"}</button>
      </div>
    </Step>
  );
}

function BringMusic({ kept: was, spotified, onNext, onSpotify }: { kept: number; spotified: boolean; onNext: () => void; onSpotify: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const songs = useLocal((s) => Object.keys(s.files).length);
  const kept = useLibrary((s) => s.liked.length + s.playlists.length);
  // Ticked only for what you did here, not for a library that was already there.
  const [before] = useState(songs);
  const added = songs - before, restored = !spotified && kept > was;
  return (
    <Step title="Bring your music" about="Your playlists and liked songs from another app, or the songs on this computer. You can add more any time.">
      <div className="grid w-full max-w-lg gap-3 text-left">
        {canHaveFiles && <Choice icon={Music2} title="Import from Spotify" detail={spotified ? "Coming over now" : "Playlists, liked songs, albums and artists"} done={spotified} onClick={onSpotify} />}
        {canHaveFiles && <Choice icon={FileSpreadsheet} title="Import Playlist Files" detail="CSVs from Apple Music, Deezer or Exportify" done={false} onClick={() => void pickPlaylists()} />}
        {canHaveFiles && <Choice icon={FolderPlus} title="Add Your Music Folder" detail={added > 0 ? `${added} song${added > 1 ? "s" : ""} added to Local Files` : "Its songs land in Local Files"} done={added > 0} onClick={() => void addFolder()} />}
        <Choice icon={Upload} title="Restore an Export" detail={restored ? "Your library is back" : "Liked songs, playlists and more, from a file"} done={restored} onClick={() => file.current?.click()} />
      </div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && void restore(e.target.files[0]), (e.target.value = ""))} />
      <button onClick={onNext} className={`${solid} mt-10`}>{added > 0 || restored || spotified ? "Continue" : "Skip for Now"}</button>
    </Step>
  );
}

function Choice({ icon: Icon, title, detail, done, onClick }: { icon: LucideIcon; title: string; detail: string; done: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex items-center gap-4 rounded-2xl bg-ink/[0.05] p-4 text-left hover:bg-ink/[0.08]">
      {/* Keyed so finishing one swaps in a fresh chip that pops, rings out and draws its tick. */}
      <span key={String(done)} className={`grid size-11 shrink-0 place-items-center rounded-full ${done ? "animate-done bg-accent text-paper" : "bg-ink/[0.07]"}`}>{done ? <Check size={20} strokeWidth={2.6} className="tick" /> : <Icon size={20} />}</span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-sm text-muted">{detail}</span>
      </span>
    </button>
  );
}
