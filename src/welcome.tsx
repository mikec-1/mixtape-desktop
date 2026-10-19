import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, FolderPlus, Upload, type LucideIcon } from "lucide-react";
import { follow, useLibrary } from "./store";
import { canSignIn, useAccount } from "./account";
import { addFolder, canHaveFiles, useLocal } from "./local";
import { quiet, restore, SignIn, solid } from "./views";
import { art, findArtist } from "./yt";

// The first time Sleeve opens: sign in or carry on without, pick a few artists, bring your music. Each
// can be skipped; none comes back (Settings has all of it).
export function Welcome({ onDone }: { onDone: () => void }) {
  const signedIn = useAccount((s) => !!s.user);
  const [step, setStep] = useState(canSignIn && !signedIn ? 0 : 1);
  useEffect(() => void (signedIn && setStep((s) => Math.max(s, 1))), [signedIn]);
  const finish = () => ((localStorage.onboarded = 1), onDone());
  return (
    <div role="dialog" aria-modal aria-label="Welcome to Sleeve" data-tauri-drag-region className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-paper px-8 pt-16 pb-10">
      <div key={step} className="flex w-full max-w-3xl animate-enter flex-col items-center text-center">
        {step === 0 ? (
          <Step title="Welcome to Sleeve" about="Sign in and your library, playlists and lyrics are the same on every computer you use.">
            <SignIn />
            <button onClick={() => setStep(1)} className="mt-6 font-semibold text-muted hover:text-ink">Continue Without an Account</button>
          </Step>
        ) : step === 1 ? (
          <PickArtists onNext={() => setStep(2)} />
        ) : (
          <BringMusic onDone={finish} />
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
        <button onClick={next} disabled={!picked.length} className={solid}>{picked.length ? `Follow ${picked.length}` : "Continue"}</button>
        <button onClick={onNext} className={quiet}>Skip</button>
      </div>
    </Step>
  );
}

function BringMusic({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const songs = useLocal((s) => Object.keys(s.files).length);
  const restored = useLibrary((s) => s.liked.length + s.playlists.length > 0);
  return (
    <Step title="Bring your music" about="Play the songs on this computer alongside everything else, or pick up a library you exported from Sleeve.">
      <div className="grid w-full max-w-lg gap-3 text-left">
        {canHaveFiles && <Choice icon={FolderPlus} title="Add Your Music Folder" detail={songs ? `${songs} songs in your Local Files` : "Its songs land in Local Files"} done={songs > 0} onClick={() => void addFolder()} />}
        <Choice icon={Upload} title="Restore a Sleeve Export" detail={restored ? "Your library is back" : "Liked songs, playlists and more, from a file"} done={restored} onClick={() => file.current?.click()} />
      </div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && void restore(e.target.files[0]), (e.target.value = ""))} />
      <button onClick={onDone} className={`${solid} mt-10`}>Start Listening</button>
    </Step>
  );
}

function Choice({ icon: Icon, title, detail, done, onClick }: { icon: LucideIcon; title: string; detail: string; done: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex items-center gap-4 rounded-2xl bg-ink/[0.05] p-4 hover:bg-ink/[0.08]">
      <span className={`grid size-11 shrink-0 place-items-center rounded-full ${done ? "bg-accent text-paper" : "bg-ink/[0.07]"}`}>{done ? <Check size={20} strokeWidth={2.6} /> : <Icon size={20} />}</span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-sm text-muted">{detail}</span>
      </span>
    </button>
  );
}
