import { useState } from "react";
import { enterCode, sendCode, signInWith, signInWithPassword, signUp } from "./account";

// Signing in: email and password (or making an account with them), a one-time code by email, or Google.
// poster: the welcome's look (hello.tsx), with its own heading; otherwise Settings → Account's.
type Mode = "in" | "up" | "code";
const HEADINGS: Record<Mode, string> = { in: "Sign in", up: "Create an account", code: "Sign in with a code" };
// GoTrue's wording, in ours.
const say = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(m)) return "That email and password don’t match.";
  if (/already registered/i.test(m)) return "There’s already an account with this email. Sign in instead.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first: open the link we sent you.";
  if (/expired or is invalid/i.test(m)) return "That code didn’t work. Check it, or send a new one.";
  return m;
};

export function SignIn({ poster = false }: { poster?: boolean }) {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState<string>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const run = (what: string, fn: () => Promise<unknown>) => {
    setBusy(what), setError(""), setNote("");
    fn().catch((e) => setError(say(e))).finally(() => setBusy(undefined));
  };
  const to = (m: Mode) => (setMode(m), setError(""), setNote(""));
  const verify = (c: string) => sent && run("code", () => enterCode(sent, c).catch((e) => (setCode(""), Promise.reject(e))));
  const submit = () =>
    mode === "in"
      ? run("password", () => signInWithPassword(email.trim(), password))
      : run("password", () => signUp(email.trim(), password).then(({ confirm }) => confirm && (to("in"), setNote(`Almost there: open the link we sent to ${email.trim()}, then sign in.`))));

  const s = poster
    ? {
        label: "block text-[13px] font-medium",
        field: "mt-1 h-11 w-full rounded-none border-b-[1.5px] border-[#111] bg-transparent text-[17px] outline-none placeholder:text-[#111]/30 focus:border-[#ff4a1c] disabled:opacity-50",
        primary: "h-12 w-full bg-[#111] text-[15px] font-semibold text-[#efe9dd] transition-colors duration-200 hover:bg-[#ff4a1c] disabled:opacity-50",
        secondary: "flex h-12 w-full items-center justify-center gap-2.5 border-[1.5px] border-[#111] text-[15px] font-semibold transition-colors duration-200 hover:bg-[#111] hover:text-[#efe9dd] disabled:opacity-50",
        link: "font-semibold underline decoration-[1.5px] underline-offset-[5px] hover:text-[#ff4a1c]",
        quiet: "text-[#111]/60",
        error: "text-[#d6300a]",
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

  return (
    <div className="w-full max-w-sm">
      {poster && <h1 className="mb-8 text-[clamp(44px,5.4vw,76px)] leading-[0.9] font-black tracking-[-0.055em]">{HEADINGS[mode]}</h1>}
      {mode !== "code" ? (
        <form onSubmit={(e) => (e.preventDefault(), submit())} className="flex flex-col gap-5">
          <label className={s.label}>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" autoComplete="email" spellCheck={false} className={s.field} />
          </label>
          <label className={s.label}>
            Password
            <input type="password" required minLength={mode === "up" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} name="password" autoComplete={mode === "up" ? "new-password" : "current-password"} placeholder={mode === "up" ? "At least 8 characters" : undefined} className={s.field} />
          </label>
          <button disabled={!!busy} className={`${s.primary} mt-2`}>{busy === "password" ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
        </form>
      ) : !sent ? (
        <form onSubmit={(e) => (e.preventDefault(), run("email", () => sendCode(email.trim()).then(() => setSent(email.trim()))))} className="flex flex-col gap-5">
          <label className={s.label}>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" autoComplete="email" spellCheck={false} className={s.field} />
          </label>
          <button disabled={!!busy} className={`${s.primary} mt-2`}>{busy === "email" ? "Sending…" : "Email me a code"}</button>
        </form>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), verify(code))} className="flex flex-col gap-2">
          <label className={s.label}>
            The code we sent to {sent}
            <input
              value={code}
              onChange={(e) => {
                const c = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(c);
                if (c.length === 6) verify(c);
              }}
              disabled={busy === "code"}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="Code"
              name="code"
              className={`${s.field} text-[22px] font-bold tracking-[0.35em] tabular-nums`}
            />
          </label>
          <button type="button" onClick={() => (setSent(undefined), setCode(""), setError(""))} className={`${s.quiet} mt-1 self-start text-sm hover:underline`}>Use a different email</button>
        </form>
      )}

      {(error || note) && <p role={error ? "alert" : "status"} className={`mt-4 text-sm font-medium ${error ? s.error : s.quiet}`}>{error || note}</p>}

      <div className={`mt-6 flex flex-col gap-2 text-sm ${s.quiet}`}>
        {mode === "in" && <p>New here? <button onClick={() => to("up")} className={s.link}>Create an account</button></p>}
        {mode === "up" && <p>Have an account? <button onClick={() => to("in")} className={s.link}>Sign in</button></p>}
        {mode === "code" ? (
          <p>Or <button onClick={() => (to("in"), setSent(undefined))} className={s.link}>use a password</button></p>
        ) : (
          <p>Or <button onClick={() => to("code")} className={s.link}>email me a code instead</button></p>
        )}
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
