import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { claimHandle, cleanHandle, handleFree, setProfile, cancelBrowserSignIn, enterCode, handBack, handingOff, publicProfile, resendSignUp, sendCode, signInInBrowser, signInWith, signInWithPassword, signOut, signUp, useAccount, viaBrowser } from "./account";

// Signing in: email and password, or Google. Making an account then asks for the
// 6-digit code Supabase emails to confirm the address ({{ .Token }} in its "Confirm signup" template).
// The app with a website to go to signs in there instead (viaBrowser), and the website, opened by the app,
// ends with a Continue button that sends you back (handingOff).
// poster: the welcome's look (hello.tsx), with its own heading; otherwise Settings → Account's.
type Mode = "in" | "up" | "code";
const HEADINGS: Record<Mode, string> = { in: "Sign in", up: "Create an account", code: "Check your email" };
// GoTrue's wording, in ours.
const say = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(m)) return "That email and password don’t match.";
  if (/already registered/i.test(m)) return "There’s already an account with this email. Sign in instead.";
  if (/expired or is invalid/i.test(m)) return "That code didn’t work. Check it, or send a new one.";
  if (/rate limit|too many|security purposes/i.test(m)) return "Too many tries. Wait a minute, then try again.";
  if (/password should|weak password/i.test(m)) return "Pick a stronger password: at least 8 characters.";
  if (/valid email|invalid format/i.test(m)) return "That doesn’t look like an email address.";
  if (/failed to fetch|network|load failed/i.test(m)) return "Can’t reach Mixtape. Check your connection.";
  return m ? (/[.!?]$/.test(m) ? m : m + ".") : "Something went wrong. Try again."; // say what actually happened
};

export function SignIn({ poster = false }: { poster?: boolean }) {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [wait, setWait] = useState(0); // seconds before another code can be sent
  const field = useRef<HTMLInputElement>(null); // the email field, focused when the form changes
  useEffect(() => void (wait && setTimeout(() => setWait(wait - 1), 1000)), [wait]);
  useEffect(() => field.current?.focus(), [mode]);
  const [sent, setSent] = useState<string>();
  const [byCode, setByCode] = useState(false); // the code came from "email me a code", not a new password account
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const { user, profile } = useAccount();
  // Handing off: whether you've picked a username yet, asked for on its own rather than waiting out a whole
  // library sync, so the right screen shows at once. null: still asking.
  const [named, setNamed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!handingOff() || !user) return;
    if (profile?.handle) return setNamed(true);
    let on = true;
    publicProfile(user.id).then((p) => on && setNamed(!!p?.profile?.handle), () => on && setNamed(false));
    return () => void (on = false);
  }, [user?.id, profile?.handle]);
  const run = (what: string, fn: () => Promise<unknown>) => {
    if (["password", "code", "email", "google"].includes(what)) sessionStorage.justIn = 1; // kept through Google's round trip
    setBusy(what), setError(""), setNote("");
    fn().catch((e) => (/email not confirmed/i.test(e?.message) ? (setSent(email.trim()), setByCode(false), setMode("code"), resendSignUp(email.trim()).then(() => setWait(30)), setNote("Confirm your email first: we sent you a new code.")) : setError(say(e)))).finally(() => setBusy(undefined));
  };
  // Signed in with a username: straight back to the app, no button to press (it stays, in case that fails).
  const sentBack = useRef(false);
  useEffect(() => {
    if (!handingOff() || !user || !(profile?.handle || named) || sentBack.current) return;
    sentBack.current = true;
    run("back", handBack);
  }, [user?.id, profile?.handle, named]);
  // Signed in just now, for the app: straight back to it. Already signed in here, you confirm the account first.
  useEffect(() => {
    if (!sessionStorage.justIn || !handingOff() || !user || !(profile?.handle || named)) return;
    delete sessionStorage.justIn;
    run("back", handBack);
  }, [user?.id, profile?.handle, named]);
  const to = (m: Mode) => (setMode(m), setError(""), setNote(""));
  // Once per code: pasting or autofill can also submit the form, and a second check of a used code fails after the first signed you in.
  const checked = useRef("");
  const verify = (c: string) => sent && checked.current !== c && ((checked.current = c), run("code", () => enterCode(sent, c).catch((e) => (setCode(""), (checked.current = ""), Promise.reject(e)))));
  const submit = () =>
    mode === "in"
      ? run("password", () => signInWithPassword(email.trim(), password))
      : run("password", () => signUp(email.trim(), password).then(({ confirm }) => (confirm ? (setSent(email.trim()), setByCode(false), setWait(30), to("code")) : undefined)));

  const s = poster
    ? {
        label: "block text-[13px] font-semibold text-white/70",
        field: "mt-1.5 h-12 w-full rounded-full bg-white/[0.08] px-5 text-[16px] outline-none ring-1 ring-white/10 transition-shadow placeholder:text-white/30 focus:ring-2 focus:ring-white disabled:opacity-50",
        primary: "press h-12 w-full rounded-full bg-white text-[15px] font-bold text-black transition-colors hover:bg-white/90 disabled:opacity-50",
        secondary: "press flex h-12 w-full items-center justify-center gap-2.5 rounded-full text-[15px] font-semibold ring-1 ring-white/25 transition-colors hover:bg-white/[0.08] disabled:opacity-50",
        link: "font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white",
        quiet: "text-white/55",
        error: "text-[#ff6b6b]",
      }
    : {
        label: "block text-sm font-semibold",
        field: "mt-1.5 h-11 w-full rounded-full bg-ink/[0.07] px-5 outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50",
        primary: "press h-11 w-full rounded-full bg-ink font-semibold text-paper disabled:opacity-50",
        secondary: "press flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-ink/[0.07] font-semibold hover:bg-ink/[0.12] disabled:opacity-50",
        link: "font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink",
        quiet: "text-muted",
        error: "text-[#ff375f]",
      };

  const heading = (text: string) => poster && <h1 className="mb-5 text-[clamp(48px,6vw,84px)] leading-[0.9] font-black tracking-[-0.05em] text-balance">{text}</h1>;
  const bad = error ? { "aria-invalid": true, "aria-describedby": "said" } : {};
  const said = (error || note) && <p id="said" role={error ? "alert" : "status"} className={`mt-4 text-sm font-medium ${error ? s.error : s.quiet}`}>{error || note}</p>;
  if (viaBrowser)
    return (
      <div className="w-full max-w-sm">
        {heading(busy ? "Over to your browser." : "All your music, free.")}
        <p className={`mb-8 text-[17px] text-balance ${s.quiet}`}>{busy ? "Sign in there and you’ll land right back here." : <>No ads. No subscription. Just music.<br />Bring your library from anywhere.</>}</p>
        {busy ? (
          <button onClick={cancelBrowserSignIn} className={s.secondary}>Cancel</button>
        ) : (
          <button onClick={() => run("browser", signInInBrowser)} className={s.primary}>Sign in or create an account</button>
        )}
        {said}
      </div>
    );
  if (handingOff() && user && !profile?.handle && named === null) return <span className="spinner mx-auto block size-6 text-white/50" />;
  if (handingOff() && user && !profile?.handle && !named) return <NameYourself s={s} heading={heading} />;
  if (handingOff() && user)
    return (
      <div className="w-full max-w-sm">
        {heading("Back to the app")}
        <p className={`mb-7 ${s.quiet}`}>Signed in as <span className="font-semibold text-ink">{user.email}</span>.</p>
        <button onClick={() => run("back", handBack)} disabled={!!busy} className={s.primary}>{busy ? "Opening the app…" : "Continue to the app"}</button>
        <button onClick={() => run("out", signOut)} disabled={!!busy} className={`${s.quiet} mt-4 text-sm hover:underline`}>Use a different account</button>
        {said}
      </div>
    );

  return (
    <div className="w-full max-w-sm">
      {heading(HEADINGS[mode])}
      {mode !== "code" ? (
        <form onSubmit={(e) => (e.preventDefault(), submit())} className="flex flex-col gap-5">
          <label className={s.label}>
            Email
            <input ref={field} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" autoComplete="email" spellCheck={false} {...bad} className={s.field} />
          </label>
          <div>
            <label htmlFor="password" className={s.label}>Password</label>
            <span className="relative block">
              <input id="password" {...bad} type={show ? "text" : "password"} required minLength={mode === "up" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} name="password" autoComplete={mode === "up" ? "new-password" : "current-password"} placeholder={mode === "up" ? "At least 8 characters" : undefined} className={`${s.field} pr-12`} />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} className={`absolute top-1.5 right-1.5 bottom-0 flex items-center px-2.5 ${s.quiet} transition-colors hover:text-current`}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
            {mode === "up" && password && <Strength password={password} quiet={s.quiet} />}
          </div>
          <button disabled={!!busy} className={`${s.primary} mt-2`}>{busy === "password" ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
        </form>
      ) : !sent ? (
        <form onSubmit={(e) => (e.preventDefault(), run("email", () => sendCode(email.trim()).then(() => (setSent(email.trim()), setByCode(true)))))} className="flex flex-col gap-5">
          <label className={s.label}>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" autoComplete="email" spellCheck={false} className={s.field} />
          </label>
          <button disabled={!!busy} className={`${s.primary} mt-2`}>{busy === "email" ? "Sending…" : "Email me a code"}</button>
        </form>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), verify(code))} className="flex flex-col gap-2">
          <label className={s.label}>
            The 6-digit code we sent to {sent}
            <input
              value={code}
              onChange={(e) => {
                const c = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(c);
                if (c.length === 6) verify(c);
              }}
              readOnly={busy === "code"}
              {...bad}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              name="code"
              className={`${s.field} text-[22px] font-bold tracking-[0.35em] tabular-nums`}
            />
          </label>
          <button type="button" onClick={() => (setSent(undefined), setCode(""), setError(""))} className={`${s.quiet} mt-1 self-start text-sm hover:underline`}>Use a different email</button>
        </form>
      )}

      {said}

      <div className={`mt-6 flex flex-col gap-2 text-sm ${s.quiet}`}>
        {mode === "code" && sent && (
          <p>No email? Check your spam, or {wait ? <span>send a new code in {wait}s</span> : <button onClick={() => run("resend", () => (byCode ? sendCode(sent) : resendSignUp(sent)).then(() => (setWait(30), setNote("Sent a new code."))))} className={s.link}>send a new code</button>}</p>
        )}
        {mode === "in" && <p>New here? <button onClick={() => to("up")} className={s.link}>Create an account</button></p>}
        {mode === "up" && <p>Have an account? <button onClick={() => to("in")} className={s.link}>Sign in</button></p>}
        {/* Email codes, off for now:
        {mode === "code" ? (
          <p>Or <button onClick={() => (to("in"), setSent(undefined))} className={s.link}>use a password</button></p>
        ) : (
          <p>Or <button onClick={() => to("code")} className={s.link}>email me a code instead</button></p>
        )} */}
      </div>

      <button onClick={() => run("google", () => signInWith("google"))} disabled={!!busy} className={`${s.secondary} mt-7`}>
        <svg viewBox="0 0 48 48" aria-hidden className="size-[18px]">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
        </svg>
        {busy === "google" ? "Finish in your browser…" : "Continue with Google"}
      </button>
    </div>
  );
}

// A new account (or one from before @handles), on the website: what to call you, and your @, like
// Spotify's last sign-up step. The name's yours to change any time; the @ is unique.
type Styles = Record<"label" | "field" | "primary" | "quiet" | "error", string>;
function NameYourself({ s, heading }: { s: Styles; heading: (t: string) => React.ReactNode }) {
  const { profile, user } = useAccount();
  const given = profile?.name && !user?.email?.toLowerCase().startsWith(profile.name.toLowerCase()) ? profile.name : ""; // a real name from Google, not the start of your email
  const [name, setName] = useState(given);
  const [handle, setHandle] = useState(() => cleanHandle(given.replace(/\s+/g, "")));
  const free = useFree(handle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = name.trim() && handle.length >= 3 && free !== false;
  const save = () => (setBusy(true), setError(""), claimHandle(handle).then(() => setProfile({ name: name.trim() })).catch((e) => setError(e.message)).finally(() => setBusy(false)));
  return (
    <form onSubmit={(e) => (e.preventDefault(), ok && save())} className="w-full max-w-sm">
      {heading("What should we call you?")}
      <p className={`mb-8 text-[17px] ${s.quiet}`}>This is how you show up to friends and on playlists you share.</p>
      <div className="flex flex-col gap-5">
        <NameFields s={s} name={name} setName={setName} handle={handle} setHandle={setHandle} free={free} autoFocus />
        <button disabled={!ok || busy} className={`${s.primary} mt-2`}>{busy ? "One moment…" : "Continue"}</button>
        {error && <p role="alert" className={`text-sm font-medium ${s.error}`}>{error}</p>}
      </div>
    </form>
  );
}

// Whether an @ is free, checked 300ms after you stop typing (undefined while checking).
function useFree(handle: string) {
  const [free, setFree] = useState<boolean>();
  useEffect(() => {
    setFree(undefined);
    if (handle.length < 3) return;
    const t = setTimeout(() => handleFree(handle).then(setFree, () => {}), 300);
    return () => clearTimeout(t);
  }, [handle]);
  return free;
}

function NameFields({ s, name, setName, handle, setHandle, free, autoFocus }: { s: Styles; name: string; setName: (v: string) => void; handle: string; setHandle: (v: string) => void; free?: boolean; autoFocus?: boolean }) {
  return (
    <>
      <label className={s.label}>
        Display name
        <input autoFocus={autoFocus} required value={name} onChange={(e) => setName(e.target.value)} name="name" autoComplete="name" maxLength={40} className={s.field} />
      </label>
      <label className={s.label}>
        Username
        <span className="relative block">
          <span className="pointer-events-none absolute top-1/2 left-4 mt-[3px] -translate-y-1/2 text-[16px] opacity-40">@</span>
          <input required value={handle} onChange={(e) => setHandle(cleanHandle(e.target.value))} name="username" autoComplete="username" spellCheck={false} minLength={3} className={`${s.field} pl-9`} />
        </span>
        <span className={`mt-2 block text-[13px] font-medium ${handle.length < 3 ? s.quiet : free === false ? s.error : free ? "text-[#3ddc84]" : s.quiet}`}>{handle.length < 3 ? "At least 3 letters or numbers." : free === false ? "Someone already has that one." : free ? "It’s yours." : "Checking…"}</span>
      </label>
    </>
  );
}

// How strong a new password is: a bar that fills red, then yellow, then green, and the one thing that would
// make it stronger. ponytail: counts length and character kinds, not a dictionary check.
function Strength({ password, quiet }: { password: string; quiet: string }) {
  const missing = [password.length >= 12 || "Make it longer", /[a-z]/.test(password) && /[A-Z]/.test(password) || "Mix in capitals", /\d/.test(password) || "Add a number", /[^a-zA-Z\d]/.test(password) || "Add a symbol"].filter((m) => m !== true);
  const score = password.length < 8 ? 0 : 4 - missing.length; // 0–4
  const [word, colour, lit] = score < 2 ? ["Weak", "#ff5a5f", 1] : score < 4 ? ["Okay", "#ffc53d", 2] : ["Strong", "#3ddc84", 3];
  const tip = password.length < 8 ? `${8 - password.length} more character${8 - password.length > 1 ? "s" : ""}` : missing[0];
  // The bar carries the colour; the words underneath stay quiet: how strong it is, then the one thing that'd help.
  return (
    <span className="mt-2.5 block text-[13px]">
      <span className="flex gap-1">
        {[1, 2, 3].map((i) => <span key={i} className="h-[3px] flex-1 rounded-full bg-current/12 transition-colors duration-300" style={i <= lit ? { background: colour } : undefined} />)}
      </span>
      <span className={`mt-2 flex justify-between ${quiet}`}><span className="font-medium text-ink">{word}</span>{tip && <span>{tip}</span>}</span>
    </span>
  );
}
