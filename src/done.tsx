// The website page a sign-in from the app ends on (account.ts land): the app has what it needed, so this only
// says what just happened. Drawn without the rest of the site, so it shows at once and asks for nothing.
// Each page's title and line, then the same for when it didn't work (?error).
const PAGES: Record<string, [string, string, string, string]> = {
  "/signed-in": ["You’re signed in.", "Mixtape on this computer is signed in to your account. You can close this tab and go back to the app.", "Signing in didn’t finish.", "Nothing changed. Go back to Mixtape to see what happened, and try again."],
  "/signed-up": ["Welcome to Mixtape.", "Your account’s made, and Mixtape on this computer is signed in to it. You can close this tab and go back to the app.", "Signing up didn’t finish.", "Go back to Mixtape to see what happened, and try again."],
  "/spotify/connected": ["Spotify’s connected.", "Your Spotify account is linked to Mixtape. Go back to the app to pick what comes over.", "Spotify didn’t connect.", "Your Spotify account isn’t linked. Go back to Mixtape to see what happened, and try again."],
};
export const isDone = (path: string) => path.replace(/\/$/, "") in PAGES;

export default function Done() {
  const [title, says, sorry, why] = PAGES[location.pathname.replace(/\/$/, "")];
  const [shown, line] = new URLSearchParams(location.search).has("error") ? [sorry, why] : [title, says];
  document.title = `${shown.replace(/\.$/, "")} · Mixtape`;
  return (
    <main className="dark grid min-h-screen place-items-center bg-[#0b0b0c] px-[clamp(32px,6vw,88px)] text-white [color-scheme:dark]">
      <div className="w-full max-w-[560px] animate-[rise_600ms_var(--ease-out)_both]">
        <img src="/favicon.svg" alt="Mixtape" className="mb-10 size-10" />
        <h1 className="text-[clamp(48px,6vw,84px)] leading-[0.9] font-black tracking-[-0.05em]">{shown}</h1>
        <p className="mt-5 max-w-[40ch] text-[17px] text-white/55">{line}</p>
      </div>
    </main>
  );
}
