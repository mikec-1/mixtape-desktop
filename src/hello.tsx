import { useEffect, useRef, useState } from "react";
import { canSignIn, inApp, mustSignIn, useAccount } from "./account";
import { SignIn } from "./signin";

// The first thing a new library shows: sign in, or carry on without (on the web; the app needs an account,
// so it has no skip and shows again whenever you're signed out). Behind it, a wall of what the world is
// playing right now (Apple's top albums), drifting in columns. leaving: you just signed in, so it says hi
// and fades into the app (App.tsx).
export function Hello({ onSkip, leaving }: { onSkip?: () => void; leaving?: false | "wait" | "hi" | "out" }) {
  const name = useAccount((s) => s.profile?.name.split(" ")[0]);
  return (
    <div data-tauri-drag-region className={`dark fixed inset-0 z-[100] overflow-hidden bg-[#0b0b0c] text-white [color-scheme:dark] [--color-ink:#fff] [--color-muted:rgb(255_255_255/0.55)] [--color-paper:#0b0b0c] ${leaving ? "pointer-events-none" : ""} ${leaving === "out" ? "animate-[fade_450ms_var(--ease-out)_reverse_both]" : ""}`}>
      <Wall />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-r from-[#0b0b0c] from-35% via-[#0b0b0c]/85 via-55% to-[#0b0b0c]/10" />
      <div data-tauri-drag-region className="@container relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto px-[clamp(32px,6vw,88px)] pt-16 pb-10">
        <div key={leaving ? leaving === "wait" ? "wait" : "hi" : "in"} className="my-auto animate-[rise_600ms_var(--ease-out)_both] py-8">
          {leaving === "wait" ? null : leaving ? (
            // A long name shrinks to fit its line (a black letter is about half as wide as it's tall), and breaks if it still can't.
            <h1 style={name ? { fontSize: `min(clamp(48px,6vw,84px), ${185 / (name.length + 1)}cqi)` } : undefined} className="text-[clamp(48px,6vw,84px)] leading-[0.9] font-black tracking-[-0.05em] [overflow-wrap:anywhere]">{name ? `Hi, ${name}.` : "You’re in."}</h1>
          ) : canSignIn ? (
            <SignIn poster />
          ) : (
            <h1 className="text-[clamp(48px,6vw,84px)] leading-[0.9] font-black tracking-[-0.05em]">All your music, free.</h1>
          )}
        </div>
        {!leaving && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm text-white/50">
            <p className="max-w-[36ch]">{!canSignIn ? `Your library stays ${inApp ? "on this computer" : "in this browser"}.` : mustSignIn ? "Your account keeps your library the same on every computer." : "An account keeps your library the same on every computer. It’s optional."}</p>
            {onSkip && <button onClick={onSkip} className="shrink-0 font-semibold text-white hover:underline">{canSignIn ? "Not now" : "Continue"}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// What's playing most on Apple Music where you are (your language setting's region), kept for a day so the
// wall shows at once. That chart won't open in a browser, so the website shows the region's iTunes chart.
// ponytail: an unknown region falls back to the US.
const region = (navigator.language.split("-")[1] ?? "us").toLowerCase();
// Only the genres most people listen to: no kids' songs, soundtracks, worship or Christmas albums.
const LIKED = /hip-hop|rap|pop|r&b|alternative|dance|electronic|latin|afro/i;
async function chart(cc: string): Promise<string[]> {
  if (inApp) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const { feed } = await (await fetch(`https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/100/albums.json`)).json() as { feed: { results: { artworkUrl100: string; genres: { name: string }[] }[] } };
    return feed.results.filter((r) => LIKED.test(r.genres[0]?.name)).map((r) => r.artworkUrl100);
  }
  const { feed } = await (await fetch(`https://itunes.apple.com/${cc}/rss/topalbums/limit=200/json`)).json() as { feed: { entry: { "im:image": { label: string }[]; category: { attributes: { label: string } } }[] } };
  return feed.entry.filter((e) => LIKED.test(e.category.attributes.label)).map((e) => e["im:image"].at(-1)!.label);
}
const big = (url: string) => url.replace(/\/\d+x\d+bb\./, "/400x400bb.");
// The last wall, however old: shown at once, and all there is when Apple can't be reached.
const kept = (): { at: number; covers: string[] } | undefined => { try { return JSON.parse(localStorage.wall ?? "null") ?? undefined; } catch { return undefined; } };
// For a network that blocks Apple (a university's, say) on a first launch: a recent chart's covers, shipped in public/wall.
const SHIPPED = Array.from({ length: 19 }, (_, i) => `${import.meta.env.BASE_URL}wall/${i + 1}.jpg`);
const COLS = 5;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches; // Reduce Motion: still drifting, a bit slower

function Wall() {
  const [covers, setCovers] = useState(() => kept()?.covers ?? []);
  const seen = useRef(false); // any cover showing yet
  useEffect(() => {
    // A network that drops Apple's requests rather than refusing them leaves covers loading for good: nothing in
    // five seconds, and the shipped ones show instead.
    const late = setTimeout(() => !seen.current && setCovers(SHIPPED), 5000);
    if ((kept()?.at ?? 0) > Date.now() - 864e5) return () => clearTimeout(late);
    // A day old: fetched again for next time. Nothing to show yet: the shipped ones, if Apple is out of reach.
    const fill = () => setCovers((c) => (c.length ? c : SHIPPED));
    chart(region).catch(() => chart("us")).then((all) => {
      if (!all.length) return fill();
      const c = all.map(big);
      localStorage.wall = JSON.stringify({ at: Date.now(), covers: c });
      setCovers((was) => (was.length ? was : c));
    }, fill);
    return () => clearTimeout(late);
  }, []);
  const all = Array.from({ length: Math.max(60, covers.length) }, (_, i) => covers[i % covers.length] ?? ""); // a short chart repeats, so no column runs out
  const cols = Array.from({ length: COLS }, (_, i) => all.filter((_, j) => j % COLS === i));
  return (
    <div aria-hidden className="pointer-events-none absolute -inset-y-1/4 right-0 flex w-[min(78%,1100px)] -rotate-6 scale-125 gap-4 opacity-90">
      {cols.map((col, i) => (
        // Each column twice over, so sliding it by half loops without a seam; neighbours go opposite ways.
        <div key={i} className="flex h-max flex-1 flex-col self-start animate-[wall_linear_infinite]" style={{ animationDuration: `${(32 + i * 6) * (calm ? 1.6 : 1)}s`, animationDirection: i % 2 ? "reverse" : "normal" }}>
          {[...col, ...col].map((src, j) => (
            <span key={j} className="mb-4 aspect-square w-full shrink-0 overflow-hidden rounded-xl outline-1 -outline-offset-1 outline-white/10">
              {src && <img src={src} alt="" loading="lazy" decoding="async" onLoad={(e) => ((seen.current = true), (e.currentTarget.style.opacity = "1"))} onError={(e) => !SHIPPED.includes(src) && (e.currentTarget.src = SHIPPED[(i * 7 + j) % SHIPPED.length])} className="size-full object-cover opacity-0 transition-opacity duration-700" />}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
