import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, FileSpreadsheet, FolderPlus, Music2, Upload, type LucideIcon } from "lucide-react";
import { follow, useLibrary } from "./store";
import { pickPlaylists } from "./import";
import { canSignIn, setProfile, useAccount } from "./account";
import { addFolder, canHaveFiles, useLocal } from "./local";
import { pickExport, restore, solid, SpotifyImport } from "./views";
import { Hello } from "./hello";
import { art, artist, findArtist, type SearchArtist } from "./yt";

// The first time it opens: sign in or carry on without, bring your music, pick a few artists. Each
// can be skipped; none comes back (Settings has all of it).
// preview: shown again from Settings → About, so it starts at sign-in even when you're signed in.
export function Welcome({ onDone, preview }: { onDone: () => void; preview?: boolean }) {
  const signedIn = useAccount((s) => !!s.user);
  const [step, setStep] = useState(preview || (canSignIn && !signedIn) ? 0 : 1);
  const [spotify, setSpotify] = useState<"open" | "busy" | "done" | "cancelled" | "failed">(); // Spotify's import: its own page, then how it went
  const was = useRef(signedIn);
  useEffect(() => void (signedIn && !was.current && setStep((s) => Math.max(s, 1)), (was.current = signedIn)), [signedIn]);
  // The end says welcome, holds a moment, then fades into the app.
  const [bye, setBye] = useState<"hi" | "out">();
  const finish = () => {
    localStorage.onboarded = 1;
    if (signedIn) setProfile({ welcomed: true });
    setBye("hi");
    setTimeout(() => setBye("out"), 1300);
    setTimeout(onDone, 1750);
  };
  // Back goes as far as sign-in only while it's still yours to do.
  const first = preview || (canSignIn && !signedIn) ? 0 : 1;
  if (step === 0) return <Hello onSkip={() => setStep(1)} />;
  if (bye)
    return (
      <div data-tauri-drag-region className={`fixed inset-0 z-50 grid place-items-center bg-paper ${bye === "out" ? "animate-[fade_450ms_var(--ease-out)_reverse_both]" : ""}`}>
        <h1 className="animate-[rise_600ms_var(--ease-out)_both] text-center text-[clamp(48px,7vw,96px)] leading-[0.9] font-black tracking-[-0.05em]">Welcome to <span className="text-accent">Mixtape</span>.</h1>
      </div>
    );
  return (
    <div role="dialog" aria-modal aria-label="Welcome" data-tauri-drag-region className="fixed inset-0 z-50 flex flex-col items-center overflow-x-hidden overflow-y-auto bg-paper px-8 pt-16 pb-10">
      {(step > first || spotify === "open") && <button onClick={() => (spotify === "open" ? setSpotify(undefined) : setStep(step - 1))} aria-label="Back" className="press absolute top-12 left-6 grid size-9 place-items-center rounded-full text-muted hover:bg-ink/[0.07] hover:text-ink"><ChevronLeft size={22} /></button>}
      <div key={spotify === "open" ? "spotify" : step} className={`${spotify === "open" ? "" : "my-auto"} flex w-full max-w-3xl animate-enter flex-col items-center text-center`}>
        {step === 1 && spotify === "open" ? (
          <Step title="Import from Spotify" about={<>Sign in, then pick what you want to bring with you.<br />Everything is saved to your library.</>}>
            <SpotifyImport inline={(job) => (setSpotify(job ? "busy" : undefined), void job?.then(setSpotify))} />
          </Step>
        ) : step === 1 ? (
          <BringMusic spotify={spotify} onNext={() => setStep(2)} onSpotify={() => setSpotify("open")} />
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

function Step({ title, about, children }: { title: string; about: ReactNode; children: ReactNode }) {
  return (
    <>
      <h1 className="text-[clamp(40px,6vw,72px)] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance">{title}</h1>
      <p className="mt-3 mb-9 max-w-lg text-lg text-balance text-muted">{about}</p>
      {children}
    </>
  );
}

// Artists most people know, by style; their pictures come in as YouTube Music answers. Past these, the row
// keeps going with who fans of the ones on it also like.
const GENRES: Record<string, string[]> = {
  "For You": ["Taylor Swift", "The Weeknd", "Billie Eilish", "Drake", "Bad Bunny", "Dua Lipa", "Kendrick Lamar", "SZA", "Arctic Monkeys", "BTS", "Daft Punk", "Frank Ocean", "Coldplay", "Rosalía", "Tyler, The Creator", "Lana Del Rey", "Fred again..", "Beyoncé", "Olivia Rodrigo", "Travis Scott", "Doja Cat"],
  Pop: ["Taylor Swift", "Dua Lipa", "Sabrina Carpenter", "Ariana Grande", "Harry Styles", "Olivia Rodrigo", "Chappell Roan", "Charli xcx", "Ed Sheeran", "Lady Gaga", "Billie Eilish", "Miley Cyrus", "Tate McRae", "Bruno Mars", "Rihanna", "Justin Bieber"],
  "Hip-Hop": ["Kendrick Lamar", "Drake", "Travis Scott", "Tyler, The Creator", "J. Cole", "Kanye West", "Playboi Carti", "Future", "21 Savage", "Metro Boomin", "Nicki Minaj", "Doechii", "A$AP Rocky", "Eminem", "Lil Uzi Vert", "Central Cee"],
  "R&B": ["SZA", "Frank Ocean", "The Weeknd", "Daniel Caesar", "Brent Faiyaz", "Summer Walker", "Jorja Smith", "H.E.R.", "Steve Lacy", "Kehlani", "Giveon", "Victoria Monét", "Usher", "Alicia Keys", "Sade", "Tems"],
  Rock: ["Arctic Monkeys", "Radiohead", "The Strokes", "Foo Fighters", "Red Hot Chili Peppers", "Queens of the Stone Age", "Nirvana", "Fleetwood Mac", "The Killers", "Linkin Park", "Paramore", "Green Day", "Royal Blood", "Muse", "The Rolling Stones", "Led Zeppelin"],
  Indie: ["Tame Impala", "Phoebe Bridgers", "Mitski", "boygenius", "Clairo", "Mac DeMarco", "Beach House", "The 1975", "Vampire Weekend", "Bon Iver", "Japanese Breakfast", "Arlo Parks", "Wet Leg", "beabadoobee", "Hozier", "Lorde"],
  Electronic: ["Fred again..", "Daft Punk", "Disclosure", "Calvin Harris", "Skrillex", "Fisher", "Peggy Gou", "Jamie xx", "Four Tet", "Kaytranada", "Bicep", "ODESZA", "Swedish House Mafia", "Charlotte de Witte", "Justice", "Aphex Twin"],
  Latin: ["Bad Bunny", "Rosalía", "Karol G", "Peso Pluma", "Feid", "J Balvin", "Rauw Alejandro", "Shakira", "Myke Towers", "Bizarrap", "Quevedo", "Anitta", "Young Miko", "Ozuna", "Tainy", "Daddy Yankee"],
  "K-Pop": ["BTS", "BLACKPINK", "NewJeans", "Stray Kids", "SEVENTEEN", "TWICE", "aespa", "LE SSERAFIM", "IVE", "Jungkook", "Jennie", "ROSÉ", "ENHYPEN", "ATEEZ", "ILLIT", "TXT"],
  Afrobeats: ["Burna Boy", "Wizkid", "Rema", "Tems", "Ayra Starr", "Davido", "Asake", "Tyla", "Omah Lay", "CKay", "Fireboy DML", "Olamide", "Victony", "Uncle Waffles", "Kizz Daniel", "Black Sherif"],
  Country: ["Morgan Wallen", "Zach Bryan", "Luke Combs", "Chris Stapleton", "Kacey Musgraves", "Lainey Wilson", "Jelly Roll", "Shaboozey", "Tyler Childers", "Luke Bryan", "Kane Brown", "Carrie Underwood", "Dolly Parton", "Post Malone", "Megan Moroney", "Sturgill Simpson"],
};
type Pick = SearchArtist;
// Same artist, same size and place in the river, every time.
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const RIVER = 450, LANES = [78, 225, 372]; // the river's height, and its three lanes' middles, at the smallest size
// A taller window gets a bigger river: everything grows together, up to 1.6×.
const zoom = () => Math.min(Math.max((innerHeight - 380) / RIVER, 1), 1.6);
type Body = { x: number; y: number; s: number };

function PickArtists({ onNext }: { onNext: () => void }) {
  const [genre, setGenre] = useState("For You");
  const [shown, setShown] = useState<(Pick | string)[]>(GENRES["For You"]); // names until YouTube Music answers
  const [picked, setPicked] = useState<Pick[]>([]);
  const [z, setZ] = useState(zoom);
  useEffect(() => {
    const fit = () => setZ(zoom());
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  const view = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null), asked = useRef(new Set<string>()), growing = useRef(false);
  // The river is moved by hand, not scrolled: one offset that drifts on, follows a drag or a sideways swipe, and coasts after a flick.
  const go = useRef({ at: 0, speed: 0, held: 0, down: undefined as number | undefined, from: 0, moved: false, t: 0 });
  const grow = useRef(() => {});
  // Each bubble has a home along the river and floats near it; they nudge each other apart, so a picked one,
  // grown bigger, pushes its neighbours aside like Apple Music's.
  const els = useRef(new Map<string, HTMLElement>()), bodies = useRef(new Map<string, Body>());
  const keyOf = (a: Pick | string) => (typeof a === "string" ? a : a.id);
  // Homes never overlap: bubbles take turns along three lanes, each lane starting a little later, so they sit
  // like a loose honeycomb.
  const ends = [0, 66, 33];
  const homes = shown.map((a, i) => {
    const key = keyOf(a), h = hash(key), r = (44 + (h % 3) * 7) * z, lane = i % 3, x = 160 + ends[lane] * z + r;
    ends[lane] += r * 2 / z + 34;
    return { key, r, h, x, y: (LANES[lane] - 10 + ((h >> 4) % 20)) * z };
  });
  const live = useRef({ homes, picked, z });
  live.current = { homes, picked, z };
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const g = go.current, dt = Math.min(now - last, 50), el = track.current, box = view.current;
      last = now;
      if (el && box) {
        if (g.down === undefined) {
          g.at += g.speed * dt;
          g.speed *= Math.pow(0.995, dt); // a flick slows to a stop
          if (now > g.held && Math.abs(g.speed) < 0.03) g.at += 0.028 * dt;
        }
        const { homes, picked, z } = live.current, end = Math.max(0, ...homes.slice(-3).map((b) => b.x)) + 200, max = Math.max(0, end - box.clientWidth);
        g.at = Math.min(Math.max(g.at, 0), max);
        el.style.transform = `translate3d(${-g.at}px,0,0)`;
        if (max - g.at < 1400) grow.current();
        // Only the bubbles near the window float; the rest wait at home.
        // Those out of sight wait at home, so when new ones push them along they come back settled, not in a heap.
        const near = homes.filter((b) => b.x > g.at - 400 && b.x < g.at + box.clientWidth + 400);
        for (const b of homes) if (!near.includes(b)) bodies.current.set(b.key, { x: b.x, y: b.y, s: picked.some((a) => a.id === b.key) ? 1.22 : 1 });
        const k = 1 - Math.pow(0.9, dt / 16);
        for (const b of near) {
          const p = bodies.current.get(b.key) ?? { x: b.x, y: b.y, s: 0.3 }; // new ones grow in where they belong
          const on = picked.some((a) => a.id === b.key);
          p.x += (b.x - p.x) * k * 0.6;
          p.y += (b.y + Math.sin(now / 1400 + b.h) * 5 * z - p.y) * k * 0.6;
          p.s += ((on ? 1.22 : 1) - p.s) * k;
          bodies.current.set(b.key, p);
        }
        for (let n = 0; n < 3; n++)
          for (let i = 0; i < near.length; i++)
            for (let j = i + 1; j < near.length; j++) {
              const a = bodies.current.get(near[i].key)!, c = bodies.current.get(near[j].key)!;
              const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 1, min = (near[i].r + 12 * z) * a.s + (near[j].r + 12 * z) * c.s + 6; // with room for the names
              if (d >= min) continue;
              const push = (min - d) / 2 / d;
              a.x -= dx * push, a.y -= dy * push, c.x += dx * push, c.y += dy * push;
            }
        for (const b of near) {
          const p = bodies.current.get(b.key)!, node = els.current.get(b.key);
          p.y = Math.min(Math.max(p.y, b.r * p.s + 4), RIVER * z - b.r * p.s - 26 * z);
          if (node) node.style.transform = `translate3d(${p.x - b.r}px,${p.y - b.r}px,0) scale(${p.s})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const ids = (list: (Pick | string)[]) => new Set(list.flatMap((a) => (typeof a === "string" ? [] : [a.id])));
  // Names become artists as their answers come in; ones YouTube Music doesn't know, or already in the river, drop out.
  useEffect(() => {
    for (const name of GENRES[genre]) findArtist(name).then((a) => setShown((l) => (a && !ids(l).has(a.id) ? l.map((x) => (x === name ? a : x)) : l.filter((x) => x !== name))), () => setShown((l) => l.filter((x) => x !== name)));
  }, [genre]);
  // Someone's fans also like: put next to them when picked, or on the end as you get there.
  const fansOf = async (a: Pick, after?: string) => {
    if (asked.current.has(a.id)) return;
    asked.current.add(a.id);
    const fans = (await artist(a.id).catch(() => undefined))?.fans ?? [];
    setShown((l) => {
      const have = ids(l), more = fans.filter((f) => !have.has(f.id) && !f.thumb?.includes("/ytc/")) // ytc is YouTube's made-up letter picture, for channels with no photo.slice(0, after ? 6 : 15);
      more.length -= more.length % 3; // in threes, so every bubble after them keeps its lane and just slides along
      const at = after ? l.findIndex((x) => typeof x !== "string" && x.id === after) + 1 : l.length;
      return at > 0 ? [...l.slice(0, at), ...more, ...l.slice(at)] : [...l, ...more];
    });
  };
  grow.current = () => {
    if (growing.current) return;
    const next = [...picked, ...shown.filter((x): x is Pick => typeof x !== "string")].find((a) => !asked.current.has(a.id));
    if (next) (growing.current = true), void fansOf(next).finally(() => (growing.current = false));
  };
  // A genre flows in just out of sight on the right, so the river turns to it without a jump.
  const pickGenre = (x: string) => {
    if (x === genre) return;
    const edge = go.current.at + (view.current?.clientWidth ?? 1000) + 500; // past where bubbles float, so they arrive settled
    setGenre(x);
    setShown((l) => {
      const i = homes.findIndex((b) => b.x > edge), at = i < 0 ? l.length : i, have = new Set(l.map((a) => (typeof a === "string" ? a : a.name)));
      const more = GENRES[x].filter((n) => !have.has(n));
      more.length -= more.length % 3;
      return [...l.slice(0, at), ...more, ...l.slice(at)];
    });
  };
  const toggle = (a: Pick) => (picked.some((p) => p.id === a.id) ? setPicked((p) => p.filter((x) => x.id !== a.id)) : (setPicked((p) => [...p, a]), void fansOf(a, a.id)));
  const next = () => (follow(picked), onNext());
  const g = go.current;
  return (
    <Step title="Pick a few artists" about="They go in your library, so their music is never far away. Pick one to see more like them.">
      <div role="tablist" aria-label="Genres" className="-mt-3 flex max-w-[calc(100vw-48px)] gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {Object.keys(GENRES).map((x) => <button key={x} role="tab" aria-selected={x === genre} onClick={() => pickGenre(x)} className={`press shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 ${x === genre ? "bg-ink text-paper" : "bg-ink/[0.06] hover:bg-ink/[0.1]"}`}>{x}</button>)}
      </div>
      <div
        ref={view}
        onWheel={(e) => Math.abs(e.deltaX) > Math.abs(e.deltaY) && ((g.at += e.deltaX), (g.speed = 0), (g.held = performance.now() + 1500))}
        onPointerDown={(e) => (Object.assign(g, { down: e.clientX, from: g.at, moved: false, speed: 0, t: performance.now() }), view.current!.setPointerCapture(e.pointerId))}
        onPointerMove={(e) => {
          if (g.down === undefined || (!g.moved && Math.abs(e.clientX - g.down) < 5)) return;
          const now = performance.now(), at = g.from - (e.clientX - g.down);
          g.speed = (at - g.at) / Math.max(now - g.t, 1);
          Object.assign(g, { moved: true, at, t: now });
        }}
        onPointerUp={(e) => {
          const hit = g.moved ? undefined : (document.elementsFromPoint(e.clientX, e.clientY).find((n) => n instanceof HTMLButtonElement && view.current!.contains(n)) as HTMLButtonElement | undefined);
          Object.assign(g, { down: undefined, held: performance.now() + 1500 });
          hit?.click(); // capture sends the click to the river, so pass it on to the bubble under the pointer
        }}
        onPointerCancel={() => (g.down = undefined)}
        className="mt-6 w-screen shrink-0 cursor-grab touch-pan-y overflow-hidden select-none [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)] active:cursor-grabbing"
        style={{ height: RIVER * z }}
      >
        <div ref={track} className="relative h-full will-change-transform">
          {shown.map((a, i) => {
            const real = typeof a !== "string", { key, r } = homes[i], b = bodies.current.get(key) ?? { ...homes[i], s: 1 }, name = real ? a.name : a, on = real && picked.some((p) => p.id === a.id);
            return (
              <button
                key={key}
                ref={(n) => void (n ? els.current.set(key, n) : els.current.delete(key))}
                onClick={() => real && toggle(a)}
                disabled={!real}
                aria-pressed={on}
                className="group absolute top-0 left-0 flex flex-col items-center outline-none disabled:cursor-default"
                style={{ width: r * 2, transform: `translate3d(${b.x - r}px,${b.y - r}px,0) scale(${b.s})` }} // where it floats now, so a re-render never snaps it home
              >
                <span className="flex w-full animate-pop flex-col items-center" style={{ animationDelay: `${(i % 12) * 30}ms` }}>
                  <span className={`relative block aspect-square w-full overflow-hidden rounded-full bg-ink/[0.06] shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] transition-[box-shadow,filter] duration-300 group-hover:brightness-105 group-focus-visible:shadow-[0_0_0_3px_var(--color-ink)] ${on ? "shadow-[0_0_0_2.5px_var(--color-paper),0_0_0_5px_var(--color-accent),0_12px_28px_-10px_var(--color-accent)]" : ""} ${real ? "" : "animate-pulse"}`}>
                    {real && a.thumb && <img src={art(a.thumb, 240)} alt="" draggable={false} className="size-full object-cover" />}
                    {on && <span className="absolute inset-0 grid animate-enter place-items-center bg-accent/40"><Check size={r * 0.55} strokeWidth={3} className="tick text-white" /></span>}
                  </span>
                  <span className={`mt-1.5 w-[130%] truncate text-center leading-tight font-semibold transition-colors ${on ? "text-accent" : "text-ink/80"}`} style={{ fontSize: 12 * z }}>{name}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-6 flex gap-3">
        <button onClick={next} className={solid}>{picked.length ? `Follow ${picked.length} and Start Listening` : "Start Listening"}</button>
      </div>
    </Step>
  );
}

function BringMusic({ spotify, onNext, onSpotify }: { spotify?: string; onNext: () => void; onSpotify: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const songs = useLocal((s) => Object.keys(s.files).length);
  const [before] = useState(songs);
  const playlists = useLibrary((s) => s.playlists);
  // Each ticks from what its own import says came in, and adds up over several goes.
  const [csv, setCsv] = useState<string[]>([]), [restored, setRestored] = useState(false), [folder, setFolder] = useState(false), [busy, setBusy] = useState<string>();
  const run = <T,>(key: string, job: () => Promise<T>, then: (r: T) => void) => () => busy !== key && (setBusy(key), void job().then(then).finally(() => setBusy((b) => (b === key ? undefined : b))));
  // Undo takes a playlist away, and with it its tick.
  const lists = playlists.filter((p) => csv.includes(p.id)).map((p) => p.name);
  const added = songs - before, any = added > 0 || folder || lists.length > 0 || restored || spotify === "busy" || spotify === "done";
  const many = (n: number, one: string) => `${n} ${one}${n > 1 ? "s" : ""}`;
  return (
    <Step title="Bring your music" about="Your playlists and liked songs from another app, or the songs on this computer. You can add more any time.">
      <div className="grid w-full max-w-lg gap-3 text-left">
        {canHaveFiles && <Choice icon={Music2} title="Import from Spotify" busy={spotify === "busy"} detail={spotify === "busy" ? "Coming over now. You can carry on" : spotify === "done" ? "Your Spotify library is here" : spotify === "failed" ? "That didn’t work. Click to try again" : spotify === "cancelled" ? "Cancelled. Click to try again" : "Playlists, liked songs, albums and artists"} done={spotify === "done"} onClick={onSpotify} />}
        {canHaveFiles && <Choice icon={FileSpreadsheet} title="Import Playlist Files" busy={busy === "csv"} detail={busy === "csv" ? "Importing…" : lists.length ? `${lists.length > 2 ? many(lists.length, "playlist") : lists.join(", ")} added. Click to add more` : "CSVs from Apple Music, Deezer or Exportify"} done={lists.length > 0} onClick={run("csv", pickPlaylists, (n) => setCsv((c) => [...c, ...n]))} />}
        {canHaveFiles && <Choice icon={FolderPlus} title="Add Your Music Folder" busy={busy === "folder"} detail={busy === "folder" ? "Looking for songs…" : added > 0 ? `${many(added, "song")} added to Local Files` : folder ? "In your Local Files" : "Its songs land in Local Files"} done={added > 0 || folder} onClick={run("folder", addFolder, (ok) => ok && setFolder(true))} />}
        <Choice icon={Upload} title="Restore an Export" busy={busy === "restore"} detail={busy === "restore" ? "Restoring…" : restored ? "Your library is back" : "Liked songs, playlists and more, from a file"} done={restored} onClick={run("restore", () => pickExport(file.current), (ok) => ok && setRestored(true))} />
      </div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && void restore(e.target.files[0]).then((ok) => ok && setRestored(true)), (e.target.value = ""))} />
      <button onClick={onNext} className={`${solid} mt-10`}>{any ? "Continue" : "Skip for Now"}</button>
    </Step>
  );
}

function Choice({ icon: Icon, title, detail, done, busy, onClick }: { icon: LucideIcon; title: string; detail: string; done: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-busy={busy} className={`press flex items-center gap-4 rounded-2xl p-4 text-left transition-colors ${done ? "bg-accent/[0.09] hover:bg-accent/[0.13]" : "bg-ink/[0.05] hover:bg-ink/[0.08]"}`}>
      {/* Finishing one mounts the accent chip over the grey one, so it fills in and draws its tick. */}
      <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-ink/[0.07]">
        {done ? <span className="absolute inset-0 grid animate-done place-items-center rounded-full bg-accent text-paper"><Check size={20} strokeWidth={2.6} className="tick" /></span> : busy ? <span className="spinner block size-5 text-muted" /> : <Icon size={20} />}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-sm text-muted">{detail}</span>
      </span>
    </button>
  );
}
