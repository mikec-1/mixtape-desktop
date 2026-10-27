import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GoTrueClient, User } from "@supabase/auth-js";
import { artistKey, clearHistory, deliberate, idbGet, idbPut, notify, open, plays, useLibrary, useRecents, useRecentSearches, useSettings, type Library, type Play, type Playlist, type View } from "./store";
import { useMine, type Mine } from "./lyrics";

// Accounts: the desktop app needs one; the web works without. Signed in, your library syncs between your
// devices through Supabase (supabase/migrations: one table of items and a sync function; docs/accounts.md
// sets it up). It stays local-first: every change is made here at once and sent a moment later; changes
// made offline go when you're back. The sign-in library loads only once you sign in.
const BASE = import.meta.env.VITE_SUPABASE_URL;
// The project's public key: the newer "publishable" kind (sb_publishable_…) or the older anon one. It
// only ever goes in the apikey header; Authorization carries a signed-in user's token, or nothing.
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const canSignIn = !!(BASE && KEY);
export const inApp = "__TAURI_INTERNALS__" in window;
// The app and the website won't open past sign-in without an account (when there are accounts to have).
export const mustSignIn = canSignIn;

// welcomed: this account has been through the welcome (Bring your music, Pick a few artists), on any computer.
export type Profile = { name: string; handle?: string; avatar?: string; welcomed?: boolean };
type Account = { user?: { id: string; email?: string }; owner?: boolean; profile?: Profile; out?: boolean; state: "idle" | "syncing" | "error"; synced?: number; error?: string };
export const useAccount = create<Account>()(persist((): Account => ({ state: "idle" }), { name: "account", partialize: ({ user, profile, synced }) => ({ user, profile, synced }) }));
// The owner's account gets the developer tools: replaying the welcome (Settings → About, ⌘⇧O). The database
// decides (supabase owners table), asked on each sign-in; anything that reaches the server checks there again.
export const useOwner = () => useAccount((s) => !!s.owner);
export const setProfile = (p: Partial<Profile>) => useAccount.setState((s) => ({ profile: { name: "", ...s.profile, ...p } }));

const STORAGE = "sleeve-auth";
let client: Promise<GoTrueClient> | undefined;
let who: User | undefined; // for a first profile: the name and picture Google or Apple gave
function auth() {
  return (client ??= import("@supabase/auth-js").then(({ GoTrueClient }) => {
    const c = new GoTrueClient({ url: `${BASE}/auth/v1`, headers: { apikey: KEY! }, storageKey: STORAGE, persistSession: true, autoRefreshToken: true, detectSessionInUrl: !inApp, flowType: "pkce" });
    // Its own calls can't be made from inside this callback, so the work waits a tick.
    c.onAuthStateChange((event, session) => {
      setTimeout(() => (session?.user ? signedIn(session.user) : (event === "SIGNED_OUT" || event === "INITIAL_SESSION") && signedOut()));
    });
    return c;
  }));
}

// Another sign-up code, for when the first didn't come.
export async function resendSignUp(email: string) {
  const { error } = await (await auth()).resend({ type: "signup", email });
  if (error) throw error;
}
// A code by email, six digits, for the address you typed; entering it signs you in (or up).
export async function sendCode(email: string) {
  const { error } = await (await auth()).signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}
export async function enterCode(email: string, token: string) {
  const { error } = await (await auth()).verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}
// Email and password. A new account may need its address confirmed first (if the project asks for that):
// then it says so, and signing in works once the link in the email is opened.
export async function signInWithPassword(email: string, password: string) {
  const { error } = await (await auth()).signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email: string, password: string) {
  const { data, error } = await (await auth()).signUp({ email, password });
  if (error) throw error;
  // With Confirm email on, Supabase doesn't say the email is taken (so nobody can probe for accounts); it hands back a user with no identities instead.
  if (data.user && !data.user.identities?.length) throw new Error("User already registered");
  return { confirm: !data.session };
}
// Google (or Apple), in your browser. In the app it comes back to src-tauri/src/account.rs, listening on
// this computer, with a code to swap for a session; the web build just goes there and back.
export async function signInWith(provider: "google" | "apple") {
  const c = await auth();
  if (!inApp) {
    const { error } = await c.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return;
  }
  const port = await invoke<number>("oauth_start");
  const { data, error } = await c.signInWithOAuth({ provider, options: { redirectTo: `http://127.0.0.1:${port}/callback`, skipBrowserRedirect: true } });
  if (error) throw error;
  await (await import("@tauri-apps/plugin-opener")).openUrl(data.url);
  const back = new URLSearchParams(await invoke<string>("oauth_wait"));
  void (await import("@tauri-apps/api/window")).getCurrentWindow().setFocus().catch(() => {});
  const code = back.get("code");
  if (!code) throw new Error(back.get("error_description") ?? "Signing in didn’t finish");
  const { error: failed } = await c.exchangeCodeForSession(code);
  if (failed) throw failed;
}
// Signing in on the website instead (the app with a site to go to): the site's own sign-in page, opened
// with the port this app listens on and a one-off state. Signed in there, you press Continue and it sends
// the session back to the listener (handBack), which checks the state.
const SITE = import.meta.env.VITE_SHARE_URL?.replace(/\/$/, "");
export const viaBrowser = inApp && !!SITE;
export async function signInInBrowser() {
  const c = await auth();
  const port = await invoke<number>("oauth_start");
  const state = crypto.randomUUID();
  await (await import("@tauri-apps/plugin-opener")).openUrl(`${SITE}/?app=${port}&state=${state}`);
  const back = new URLSearchParams(await invoke<string>("oauth_wait"));
  void (await import("@tauri-apps/api/window")).getCurrentWindow().setFocus().catch(() => {});
  if (back.get("error")) throw new Error(`The website couldn’t sign you in: ${back.get("error_description") ?? back.get("error")}`);
  if (back.get("state") !== state) throw new Error("The website answered an older sign-in. Press Sign in again.");
  if (!back.get("access_token") || !back.get("refresh_token")) throw new Error("The website didn’t send your account back. Press Sign in again.");
  const { error } = await c.setSession({ access_token: back.get("access_token")!, refresh_token: back.get("refresh_token")! });
  if (error) throw new Error(`Mixtape couldn’t use the website’s sign-in: ${error.message}`);
  // A refresh swaps the refresh token the website also had for one only this app has.
  await c.refreshSession();
}
export const cancelBrowserSignIn = () => void invoke("oauth_start").catch(() => {}); // a new start gives up on the wait
// The website's half: opened by the app (?app=<port>&state=…), it remembers that for this tab, through a
// Google round trip too. Only Mixtape's own ports.
const asked = new URLSearchParams(location.search);
if (!inApp && /^5368[2-4]$/.test(asked.get("app") ?? "") && asked.get("state")) {
  sessionStorage.handoff = JSON.stringify({ port: asked.get("app"), state: asked.get("state") });
  history.replaceState(null, "", location.pathname + location.hash);
}
export const handingOff = (): { port: string; state: string } | undefined => (sessionStorage.handoff ? JSON.parse(sessionStorage.handoff) : undefined);
export async function handBack() {
  const h = handingOff();
  if (!h) throw new Error("This page wasn’t opened by the app. Press Sign in in Mixtape again.");
  // Fresh tokens when it can (a tab signed in a while can hold an expired session), else the stored ones.
  const c = await auth(), fresh = await c.refreshSession().catch(() => undefined);
  const session = fresh?.data.session ?? (await c.getSession()).data.session;
  if (!session) throw new Error("You’re not signed in here any more. Sign in again.");
  const data = { session };
  delete sessionStorage.handoff;
  // Posted, not put in the link, so the tokens never land in the address bar or the browser's history.
  const form = Object.assign(document.createElement("form"), { method: "POST", action: `http://127.0.0.1:${h.port}/callback` });
  for (const [name, value] of Object.entries({ state: h.state, access_token: data.session.access_token, refresh_token: data.session.refresh_token })) form.append(Object.assign(document.createElement("input"), { type: "hidden", name, value }));
  document.body.append(form);
  form.submit();
}
// Your @handle: lowercase letters, numbers, dots and underscores. Claimed in public.handles, which says
// no when it's someone else's, then kept in your profile.
export const cleanHandle = (h: string) => h.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "").slice(0, 24);
export const handleFree = async (h: string) => !(await table<unknown[]>(`handles?select=user_id&handle=eq.${h}&user_id=neq.${useAccount.getState().user?.id}`)).length;
export async function claimHandle(handle: string) {
  const user_id = useAccount.getState().user?.id;
  await table("handles", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id, handle }) }).catch((e) => Promise.reject(e.code === "23505" ? new Error("Someone already has that one.") : e));
  setProfile({ handle });
}
// Signing out (or deleting your account) leaves your library on this computer (or in this browser). On
// the web, where an account is optional, it goes back to the sign-in (out), which you can skip.
const here = inApp ? "on this computer" : "in this browser";
export async function signOut() {
  await (await auth()).signOut({ scope: "local" });
  signedOut();
  useAccount.setState({ out: !inApp });
  notify({ text: "Signed Out", detail: `Your library is still ${here}` });
}
export async function deleteAccount() {
  await rpc("delete_me", {}, await token());
  await (await auth()).signOut({ scope: "local" }).catch(() => {});
  signedOut();
  useAccount.setState({ out: !inApp });
  notify({ text: "Account Deleted", detail: `Your library is still ${here}` });
}

// Also on each token refresh (hourly), which changes nothing.
function signedIn(user: User) {
  who = user;
  const was = useAccount.getState().user;
  if (was?.id !== user.id || was.email !== user.email) useAccount.setState({ user: { id: user.id, email: user.email }, out: false });
  void token().then((t) => rpc<boolean>("am_owner", {}, t)).then((owner) => useAccount.setState({ owner }), () => {});
  if (watching && was?.id === user.id) return;
  // The library here belongs to whoever last signed in on this computer (it stays after signing out). Another
  // account starts empty and gets only its own; the old one's is still in that account. A library from before
  // any account goes up into the first one.
  // Waits for both to load from disk first, or loading would bring the old one back.
  const loaded = (st: typeof useLibrary | typeof useMine) => new Promise<void>((r) => (st.persist.hasHydrated() ? r() : st.persist.onFinishHydration(() => r())));
  void Promise.all([loaded(useLibrary), loaded(useMine)]).then(() => {
    if (localStorage.libraryOwner && localStorage.libraryOwner !== user.id) {
      // Everything else the last account left here goes too: its Spotify, history, recents and scrobbling.
      useLibrary.setState(useLibrary.getInitialState()), useMine.setState({ songs: {} });
      dropSpotify(), useRecents.setState({}, true), useRecentSearches.setState({ items: [] }), clearHistory(true);
      useSettings.setState({ listenBrainzToken: "", lastfmSessionKey: "", lastfmUsername: "" });
    }
    localStorage.libraryOwner = user.id;
    watch();
    void syncNow();
  });
}
// Loaded late: spotify.ts needs this file first.
const dropSpotify = () => void import("./spotify").then((s) => s.useSpotify.setState({}, true));
function signedOut() {
  dropSpotify(); // Spotify belongs to the account, not this computer
  meta = undefined;
  seen.clear();
  clearTimeout(soon);
  void idbPut("sync", undefined);
  useAccount.setState({ user: undefined, owner: undefined, profile: undefined, synced: undefined, state: "idle", error: undefined });
}
export async function token() {
  const { data, error } = await (await auth()).getSession();
  if (error || !data.session) throw error ?? new Error("You’re signed out");
  return data.session.access_token;
}
const rpc = <T>(fn: string, args: object, bearer?: string) => call<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }, bearer);
// Your rows in the account's other tables (the Spotify ones), signed in.
export const table = async <T>(path: string, init: RequestInit = {}) => call<T>(path, init, await token());
async function call<T>(path: string, init: RequestInit, bearer?: string) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY!, ...(bearer && { authorization: `Bearer ${bearer}` }), "content-type": "application/json", ...init.headers } });
  const text = await r.text();
  if (!r.ok) {
    const { message, code } = (() => { try { return JSON.parse(text) as { message?: string; code?: string }; } catch { return {}; } })();
    throw Object.assign(new Error(message || `Sync failed (${r.status})`), { code });
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// Syncing. Your library is cut into items (a liked song, a playlist with its songs, a folder, your pins,
// your lyrics for a song, your profile), each sent whole when it changes. base is each item as this
// device last agreed it with the server, so a difference is a change made here; cursor is how far
// through the server's changes this device has read. A change from elsewhere to something not changed
// here just lands; to something changed on both, the later change wins, except a playlist's songs,
// which merge (added on either side are kept, removed on either side go). meant: the removals you made on
// purpose; the server refuses more than 50 others at once (Mixtape's guard against a library that went
// missing here wiping it everywhere), and they come back from your account.
type Meta = { user: string; cursor: number; base: Record<string, string>; dirtyAt: Record<string, number>; meant?: Record<string, 1> };
type Change = { key: string; data: unknown; c: string; at: number };
type Row = { kind: string; id: string; data: unknown; at: number; rev: number };
let meta: Meta | undefined;
async function loadMeta(user: string) {
  if (meta?.user === user) return meta;
  const kept = await idbGet<Meta>("sync");
  return (meta = kept?.user === user ? kept : { user, cursor: 0, base: {}, dirtyAt: {} });
}
let saving = 0;
const saveMeta = () => (clearTimeout(saving), (saving = window.setTimeout(() => meta && void idbPut("sync", meta), 500)));

const LISTS = [["liked", "liked"], ["hidden", "hidden"], ["saved", "saved"], ["followed", "followed"], ["blocked", "blocked"], ["folder", "folders"], ["playlist", "playlists"]] as const;
const NEWEST_FIRST = new Set(["liked", "hidden", "saved", "followed", "blocked"]);
type Entry = { id?: string; name?: string; at?: number };
const idOf = (kind: string, x: Entry) => (kind === "blocked" ? artistKey(x as { id?: string; name: string }) : x.id!);
function items() {
  const l = useLibrary.getState(), m = new Map<string, unknown>();
  for (const [kind, field] of LISTS) for (const x of l[field] as Entry[]) m.set(`${kind}:${idOf(kind, x)}`, x);
  if (l.pinned.length) m.set("pins:all", l.pinned);
  for (const [k, v] of Object.entries(useMine.getState().songs)) m.set(`lyrics:${k}`, v);
  const { profile } = useAccount.getState();
  if (profile) m.set("profile:me", profile);
  return m;
}

// An item as text with its keys in order, to compare with the server's copy (which comes back with its
// keys reordered). The library is never changed in place, so each object's text is worked out once.
const texts = new WeakMap<object, string>();
function canon(x: unknown): string {
  if (x === null || x === undefined || typeof x !== "object") return JSON.stringify(x ?? null);
  let s = texts.get(x);
  if (s === undefined) {
    s = Array.isArray(x)
      ? `[${x.map((v) => (v === undefined ? "null" : canon(v))).join(",")}]`
      : `{${Object.keys(x).sort().flatMap((k) => ((v) => (v === undefined ? [] : [`${JSON.stringify(k)}:${canon(v)}`]))((x as Record<string, unknown>)[k])).join(",")}}`;
    texts.set(x, s);
  }
  return s;
}
const parse = (s?: string) => (s && s !== "null" ? JSON.parse(s) : null);
const setBase = (m: Meta, key: string, c: string) => void (c === "null" ? delete m.base[key] : (m.base[key] = c));

// What's changed here since the last sync, each with when (for "the later change wins"): the first time
// it's seen changed, or changed again.
const seen = new Map<string, string>();
function changes(m: Meta, now = Date.now()) {
  const out: Change[] = [];
  const check = (key: string, data: unknown, c: string) => {
    if ((m.base[key] ?? "null") === c) return void (delete m.dirtyAt[key], delete m.meant?.[key], seen.delete(key));
    if (seen.get(key) !== c) {
      if (seen.has(key) || !m.dirtyAt[key]) m.dirtyAt[key] = now;
      seen.set(key, c);
      if (data === null && now - deliberate < 10_000) (m.meant ??= {})[key] = 1;
    }
    out.push({ key, data, c, at: m.dirtyAt[key] });
  };
  const local = items();
  for (const [key, v] of local) check(key, v, canon(v));
  for (const key of Object.keys(m.base)) if (!local.has(key)) check(key, null, "null");
  return out;
}

// One round: up to 500 changes out, what's new on the server in. Another round if there's more either way.
async function round(m: Meta, bearer: string) {
  const out = changes(m);
  const send = out.slice(0, 500);
  const gone = send.filter((c) => c.data === null), bulk = gone.length > 50 && gone.filter((c) => !m.meant?.[c.key]).length <= 50;
  const r = await rpc<{ items: Row[]; cursor: number; more: boolean; took: (number | null)[] }>("sync", { since: m.cursor, changes: send.map(({ key, data, at }) => ({ kind: key.slice(0, key.indexOf(":")), id: key.slice(key.indexOf(":") + 1), data, at })), ...(bulk && { bulk }) }, bearer);
  if (m !== meta) return false; // signed out meanwhile
  r.took.forEach((rev, i) => rev !== null && setBase(m, send[i].key, send[i].c));
  merge(m, r.items);
  m.cursor = r.cursor;
  saveMeta();
  return r.more || out.length > send.length || changes(m).length > 0;
}

function merge(m: Meta, rows: Row[]) {
  const local = items();
  const puts = new Map<string, unknown>();
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    const theirs = row.data ?? null, tc = canon(theirs);
    const mine = local.get(key) ?? null, mc = canon(mine);
    const bc = m.base[key] ?? "null";
    if (mc !== tc && mc === bc) puts.set(key, theirs);
    else if (mc !== tc) {
      const mineNewer = (m.dirtyAt[key] ?? 0) > row.at;
      if (row.kind === "playlist" && mine && theirs) puts.set(key, mergePlaylist(parse(bc), mine as Playlist, theirs as Playlist, mineNewer));
      else if (row.kind === "pins" && mine && theirs) puts.set(key, mergeList(parse(bc) ?? [], mine as string[], theirs as string[], mineNewer, (k) => k));
      else if (!mineNewer) puts.set(key, theirs);
    }
    setBase(m, key, tc);
  }
  apply(puts);
}

// Both sides changed a playlist: each detail from the side that changed it (the later, if both did), and
// its songs merged.
function mergePlaylist(base: Playlist | null, mine: Playlist, theirs: Playlist, mineNewer: boolean): Playlist {
  const out: Record<string, unknown> = {};
  const b = (base ?? {}) as Record<string, unknown>, m = mine as Record<string, unknown>, t = theirs as Record<string, unknown>;
  for (const k of new Set([...Object.keys(m), ...Object.keys(t)])) {
    const was = canon(b[k]);
    const v = k === "tracks" ? undefined : canon(m[k]) !== was && (canon(t[k]) === was || mineNewer) ? m[k] : t[k];
    if (v !== undefined) out[k] = v;
  }
  out.tracks = mergeList(base?.tracks ?? [], mine.tracks, theirs.tracks, mineNewer, (x) => x.id);
  return out as Playlist;
}
// A list changed on both sides since base: what either side took out goes, what either added stays (in
// its place after the song before it). The later side's order wins. A song in twice counts as two.
export function mergeList<T>(base: T[], mine: T[], theirs: T[], mineNewer: boolean, id: (x: T) => string): T[] {
  const keyed = (list: T[]) => {
    const n = new Map<string, number>();
    return list.map((x) => ((k) => (n.set(k, (n.get(k) ?? 0) + 1), [`${k}#${n.get(k)}`, x] as const))(id(x)));
  };
  const was = new Set(keyed(base).map(([k]) => k)), m = keyed(mine), t = keyed(theirs);
  const inM = new Set(m.map(([k]) => k)), inT = new Set(t.map(([k]) => k));
  const [first, second] = mineNewer ? [m, t] : [t, m];
  const out = first.filter(([k]) => !was.has(k) || (inM.has(k) && inT.has(k)));
  const placed = new Set(out.map(([k]) => k));
  second.forEach(([k, x], i) => {
    if (placed.has(k) || was.has(k)) return;
    let at = 0;
    for (let p = i - 1; p >= 0 && !at; p--) if (placed.has(second[p][0])) at = out.findIndex(([q]) => q === second[p][0]) + 1;
    out.splice(at, 0, [k, x]);
    placed.add(k);
  });
  return out.map(([, x]) => x);
}

// Changes from elsewhere into the library (no toasts, no Undo): replaced where they are, new ones in
// order of when they were added, deletions taken out.
function apply(puts: Map<string, unknown>) {
  if (!puts.size) return;
  const by = new Map<string, Map<string, unknown>>();
  for (const [key, v] of puts) {
    const kind = key.slice(0, key.indexOf(":"));
    if (!by.has(kind)) by.set(kind, new Map());
    by.get(kind)!.set(key.slice(kind.length + 1), v);
  }
  const l = useLibrary.getState(), patch: Partial<Record<keyof Library, unknown>> = {};
  for (const [kind, field] of LISTS) {
    const p = by.get(kind);
    if (!p) continue;
    const done = new Set<string>();
    const kept = (l[field] as Entry[]).flatMap((x) => {
      const id = idOf(kind, x);
      if (!p.has(id)) return [x];
      done.add(id);
      return p.get(id) ? [p.get(id) as Entry] : [];
    });
    const added = [...p].flatMap(([id, v]) => (v && !done.has(id) ? [v as Entry] : [])).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    patch[field] = !added.length ? kept : NEWEST_FIRST.has(kind) ? [...added, ...kept].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : [...kept, ...added];
  }
  if (by.has("pins")) patch.pinned = by.get("pins")!.get("all") ?? [];
  if (Object.keys(patch).length) useLibrary.setState(patch as Partial<Library>);
  const lyrics = by.get("lyrics");
  if (lyrics)
    useMine.setState((s) => {
      const songs = { ...s.songs };
      for (const [k, v] of lyrics) v ? (songs[k] = v as Mine) : delete songs[k];
      return { songs };
    });
  if (by.has("profile")) useAccount.setState({ profile: (by.get("profile")!.get("me") as Profile | null) ?? undefined });
}

// When: on sign-in and launch, coming back to the app, getting back online, each minute, and two
// seconds after you change something. One at a time; one asked for meanwhile runs after.
let running: Promise<void> | undefined;
let again = false, soon = 0, look = 0, watching = false;
export const syncSoon = (ms = 2000) => (clearTimeout(soon), (soon = window.setTimeout(() => void syncNow(), ms)));
export function syncNow(): Promise<void> {
  if (running) return (again = true), running;
  const { user } = useAccount.getState();
  if (!user || !navigator.onLine) return Promise.resolve();
  running = (async () => {
    useAccount.setState({ state: "syncing" });
    try {
      const m = await loadMeta(user.id);
      const bearer = await token();
      for (let i = 0; i < 20 && m === meta && (await round(m, bearer)); i++);
      if (m === meta) useAccount.setState({ state: "idle", synced: Date.now(), error: undefined });
      // A new account's profile: the name and picture the sign-in gave, or the start of your email.
      if (m === meta && !useAccount.getState().profile && who) {
        const d = who.user_metadata ?? {};
        setProfile({ name: d.full_name ?? d.name ?? who.email?.split("@")[0] ?? "", ...((d.avatar_url ?? d.picture) && { avatar: d.avatar_url ?? d.picture }) });
      }
    } catch (e) {
      // Deleted from another device: signed out here too, library kept.
      if ((e as { code?: string }).code === "SV001") void (await auth()).signOut({ scope: "local" }), signedOut(), notify({ text: "Your Account Was Deleted", detail: `Your library is still ${here}` });
      // Lots went missing here without you removing them: forget they were here and read everything again,
      // which puts them back.
      else if ((e as { code?: string }).code === "SV002" && meta) {
        for (const c of changes(meta)) if (c.data === null && !meta.meant?.[c.key]) delete meta.base[c.key];
        meta.cursor = 0;
        saveMeta(), (again = true);
        notify({ text: "Your Library Was Restored", detail: "Songs went missing on this computer, so they came back from your account" });
      }
      else useAccount.setState({ state: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = undefined;
      if (again) (again = false), syncSoon(0);
    }
  })();
  return running;
}
function watch() {
  if (watching) return;
  watching = true;
  setInterval(() => void syncNow(), 60_000);
  addEventListener("focus", () => void syncNow());
  addEventListener("online", () => void syncNow());
  const changed = () => useAccount.getState().user && (clearTimeout(look), (look = window.setTimeout(check, 300)));
  useLibrary.subscribe(changed);
  useMine.subscribe(changed);
  useAccount.subscribe((s, was) => s.profile !== was.profile && changed());
}
function check() {
  if (!meta) return;
  if (changes(meta).length) saveMeta(), syncSoon();
}

// Sharing: a public playlist's link, and your profile's (with your public playlists). Anyone with one can
// open it, signed in or not. A link opens the web build (VITE_SHARE_URL) when there is one; either way,
// pasted into Search it opens in Mixtape.
const SHARE = import.meta.env.VITE_SHARE_URL?.replace(/\/$/, "") ?? (inApp ? undefined : location.origin + location.pathname.replace(/\/$/, ""));
const linkTo = (path: string) => (SHARE ? `${SHARE}/#/${path}` : `mixtape:${path}`);
export const sharedLink = (id: string) => linkTo(`list/${id}`); // id: "<owner>/<playlist>"
export const playlistLink = (id: string) => sharedLink(`${useAccount.getState().user?.id}/${id}`);
export const profileLink = (user = useAccount.getState().user?.id) => linkTo(`u/${user}`);
export function fromLink(text: string): View | undefined {
  const m = /(?:#\/|mixtape:)(list|u)\/([0-9a-f-]{36})(?:\/([\w-]+))?/i.exec(text);
  if (m?.[1] === "list" && m[3]) return { name: "shared", id: `${m[2]}/${m[3]}` };
  if (m?.[1] === "u") return { name: "profile", id: m[2] };
}
export type Shared = { playlist: Playlist; owner: Profile };
export type PublicProfile = { profile: Profile; playlists: { id: string; name: string; about?: string; cover?: string; count: number; thumbs: (string | null)[] }[] };
export const sharedPlaylist = (id: string) => rpc<Shared | null>("shared_playlist", { owner: id.split("/")[0], list: id.split("/")[1] });
export const publicProfile = (user: string) => rpc<PublicProfile | null>("public_profile", { owner: user });

// Everything Mixtape keeps about you, as one file: library, your lyrics, history, settings, profile.
// Settings → Library → Restore takes it back.
export async function exportAll() {
  const history: Play[] = [];
  await plays((p) => (history.push(p), true)).catch(() => {});
  const { user, profile } = useAccount.getState();
  const data = { exported: new Date().toISOString(), account: user?.email, profile, ...useLibrary.getState(), lyrics: useMine.getState().songs, history, settings: useSettings.getState() };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = `Mixtape Data ${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  notify({ text: "Data Exported", detail: "Saved to your Downloads folder" });
}

// Launch: back in if you were signed in (or coming back from Google in the web build). A shared link
// the web build is opened with opens, and so does one followed in a tab that's already open.
if (canSignIn && (useAccount.getState().user || Object.keys(localStorage).some((k) => k.startsWith(STORAGE)) || /[?&]code=/.test(location.search) || handingOff())) setTimeout(() => void auth(), 0);
const openLinked = () => {
  const view = fromLink(location.hash);
  if (view) open(view), history.replaceState(null, "", location.pathname + location.search);
};
openLinked();
addEventListener("hashchange", openLinked);
