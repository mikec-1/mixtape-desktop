import { version } from "../package.json";
import { notify, useLibrary, useSettings, useStore } from "./store";

// Crash reports (Settings → Privacy): off until you turn them on, and Mixtape asks once, after its first crash.
// Sentry only loads once they're on, and every report is scrubbed of emails, tokens, file paths and song names first.
const dsn = import.meta.env.VITE_SENTRY_DSN;
const platform = "__TAURI_INTERNALS__" in window ? (/Mac/.test(navigator.userAgent) ? "Mac" : /Win/.test(navigator.userAgent) ? "Windows" : "Linux") : "Web";
const on = () => useSettings.getState().crashReports;

// ponytail: every song name in the library is swapped out one by one; fine for one report, a Set lookup if libraries reach ~100k.
const names = () => {
  const { liked, playlists } = useLibrary.getState(), tracks = [...liked, ...playlists.flatMap((p) => p.tracks), ...useStore.getState().queue];
  return [...new Set([...tracks.flatMap((t) => [t.title, ...t.artists.map((a) => a.name)]), ...playlists.map((p) => p.name)])].filter((n) => n?.length > 2).sort((a, b) => b.length - a.length);
};
export const scrub = (text: string) => names().reduce((s, n) => s.split(JSON.stringify(n).slice(1, -1)).join("[song]"),
  text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [token]").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/((?:access_|refresh_|id_)?token|code|key|secret|session|sk|api_?key)=[^&\s"\\]+/gi, "$1=[token]").replace(/\b[\w-]{40,}\b/g, "[token]")
    .replace(/(?:file|asset):\/\/[^\s"']+|https?:\/\/asset\.localhost[^\s"']*|\/(?:Users|home|Volumes)\/[^\s"':]+|[A-Za-z]:\\\\[^\s"':]+/g, "[path]"));

let sentry: Promise<typeof import("@sentry/react")> | undefined;
export const start = () => (sentry ??= import("@sentry/react").then((S) => (S.init({
  dsn, release: version, environment: platform,
  beforeSend: (e) => (on() ? JSON.parse(scrub(JSON.stringify(e))) : null),
  beforeBreadcrumb: (b) => (on() ? b : null),
  integrations: [S.feedbackIntegration({ autoInject: false, colorScheme: "system", showBranding: false, isEmailRequired: false })],
}), S)));
export const send = (e: unknown) => void start().then((S) => S.captureException(e));

// Turning reports on (or answering the ask) sends the crash that prompted it.
export const turnOn = (e?: unknown) => (useSettings.setState({ crashReports: true }), e === undefined ? void start() : send(e));

// After a crash with reports off: true once, the first time, so Mixtape asks then and never again.
export const firstCrash = () => !on() && !localStorage.crashAsked && !!(localStorage.crashAsked = 1);
export const crashed = (e: unknown) => (on() ? send(e) : firstCrash() && notify({ warn: true, text: "Mixtape ran into a problem", detail: "Send crash reports to help fix it?", ms: 10000, action: { label: "Turn On", run: () => (turnOn(e), useStore.setState({ toast: undefined })) } }));

// Send Feedback (Settings → About): Sentry's form with reports on, your mail app otherwise.
export const feedback = () => (on() && dsn ? void start().then(async (S) => { const form = await S.getFeedback()?.createForm(); form?.appendToDom(); form?.open(); })
  : mail(`mailto:feedback@mixtaped.tech?subject=${encodeURIComponent(`Mixtape ${version} feedback`)}`));
const mail = (url: string) => void ("__TAURI_INTERNALS__" in window ? import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url)) : (location.href = url));

if (on()) void start(); // Sentry's own handlers catch what happens from here on
addEventListener("error", (e) => e instanceof ErrorEvent && !on() && crashed(e.error ?? e.message));
addEventListener("unhandledrejection", (e) => !on() && crashed(e.reason));
