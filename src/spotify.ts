import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { table, useAccount } from "./account";
import { addPlays, follow, idb, likedAs, newPlaylist, notify, plural, useLibrary } from "./store";
import { bareTitle, importRows, pool, readLink } from "./import";
import { length } from "./deezer";
import { searchKind, type Album, type Track } from "./yt";

// Signing in to Spotify (PKCE, back to account.rs on the one port registered with Spotify) to bring over
// your playlists, Liked Songs, albums and artists, and your recent plays into History. Spotify only tells
// apps your last 50 plays, so while you're signed in new ones are fetched at launch and every half hour,
// and with an account the server fetches them too, even while Mixtape is closed (spotify_history).
const CLIENT = "0e312a528cc34744b92021bed3f6edc9";
const PORT = 43821;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read user-follow-read user-read-recently-played";

// lastPlay: the newest play brought over, in ms. at: when this refresh token was handed out. linked: the
// account it's kept with.
type Auth = { refresh?: string; access?: string; expires?: number; name?: string; lastPlay?: number; at?: number; linked?: string };
export const useSpotify = create<Auth>()(persist(() => ({}), { name: "spotify", storage: createJSONStorage(() => idb) }));

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));

async function grant(body: Record<string, string>) {
  const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", body: new URLSearchParams({ client_id: CLIENT, ...body }) });
  const d = await r.json().catch(() => ({}));
  // Spent: another device (or the server) refreshed it and got a newer one, kept with your account. Or
  // signed out on Spotify's side (access removed): sign out here too. Offline just fails.
  if (d.error === "invalid_grant" && body.refresh_token) {
    if (await link().then(() => useSpotify.getState().refresh !== body.refresh_token, () => false)) return grant({ ...body, refresh_token: useSpotify.getState().refresh! });
    disconnect();
  }
  if (!r.ok) throw new Error(d.error_description ?? `Spotify answered ${r.status}`);
  const fresh = d.refresh_token && d.refresh_token !== useSpotify.getState().refresh;
  useSpotify.setState((s) => ({ access: d.access_token, expires: Date.now() + d.expires_in * 1000 - 60_000, refresh: d.refresh_token ?? s.refresh, ...(fresh && { at: Date.now() }) }));
  if (fresh) void link().catch(() => {});
}

export async function connect() {
  const verifier = random(), state = random();
  const challenge = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await invoke("oauth_start", { port: PORT });
  await (await import("@tauri-apps/plugin-opener")).openUrl(`https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: CLIENT, response_type: "code", redirect_uri: REDIRECT, code_challenge_method: "S256", code_challenge: challenge, scope: SCOPES, state })}`);
  const back = new URLSearchParams(await invoke<string>("oauth_wait"));
  void (await import("@tauri-apps/api/window")).getCurrentWindow().setFocus().catch(() => {});
  const code = back.get("code");
  if (!code || back.get("state") !== state) throw new Error(back.get("error") === "access_denied" ? "You didn’t allow it on Spotify" : "Signing in didn’t finish");
  await grant({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier });
  // Plays from before signing in come over with the import, if you pick them.
  useSpotify.setState({ name: (await api("/me")).display_name, lastPlay: Date.now(), at: Date.now() });
  void link().catch(() => {});
}
// Everywhere: it's taken off your account too.
export function disconnect() {
  const { linked } = useSpotify.getState();
  if (linked && linked === useAccount.getState().user?.id) void table(`spotify_connections?user_id=eq.${linked}`, { method: "DELETE" }).catch(() => {});
  useSpotify.setState({}, true);
}

// Spotify follows your account, as in Mixtape: whichever device signed in (or refreshed) last keeps its
// sign-in with your account, so another device picks it up, and the server brings your plays into History
// every half hour (supabase/functions/spotify_history). Gone from the account: disconnected elsewhere.
async function link() {
  const user = useAccount.getState().user?.id;
  if (!user) return;
  const s = useSpotify.getState();
  const [row] = await table<{ refresh_token: string; updated_at: string }[]>("spotify_connections?select=refresh_token,updated_at");
  if (row && row.refresh_token !== s.refresh && (!s.refresh || Date.parse(row.updated_at) > (s.at ?? 0))) {
    useSpotify.setState({ refresh: row.refresh_token, access: undefined, expires: 0, at: Date.parse(row.updated_at), linked: user });
    if (!s.refresh) useSpotify.setState({ name: (await api("/me")).display_name });
  } else if (!row && s.linked === user) disconnect();
  else if (s.refresh && row?.refresh_token !== s.refresh) {
    await table("spotify_connections", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: user, refresh_token: s.refresh, scope: SCOPES, updated_at: new Date(s.at ?? Date.now()).toISOString() }) });
    useSpotify.setState({ linked: user });
  } else if (s.refresh && s.linked !== user) useSpotify.setState({ linked: user });
}

// One refresh at a time: Spotify may hand back a new refresh token, and the old one stops working.
let refreshing: Promise<void> | undefined;
async function api(path: string): Promise<any> {
  const { refresh, expires = 0 } = useSpotify.getState();
  if (!refresh) throw new Error("Sign in to Spotify first");
  if (Date.now() > expires) await (refreshing ??= grant({ grant_type: "refresh_token", refresh_token: refresh }).finally(() => (refreshing = undefined)));
  const r = await fetch(path.startsWith("https:") ? path : `https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${useSpotify.getState().access}` } });
  // Too many at once: wait as long as Spotify says, if that's not long.
  const wait = Number(r.headers.get("Retry-After") ?? 1);
  if (r.status === 429 && wait <= 30) return new Promise((ok) => setTimeout(ok, wait * 1000)).then(() => api(path));
  const d = await r.json().catch(() => undefined);
  if (!r.ok) throw new Error(d?.error?.message ?? `Spotify answered ${r.status}`);
  return d;
}
// Every page of a list, six at a time; key: where the list sits in the answer (followed artists come under
// "artists", and page by cursor, so one after another).
async function all<T>(path: string, key?: string) {
  const list = (d: any) => (key ? d[key] : d);
  const first = list(await api(path)), out: T[] = first.items;
  if (first.next?.includes("offset=")) {
    const offsets = Array.from({ length: Math.ceil(first.total / first.limit) - 1 }, (_, i) => (i + 1) * first.limit);
    out.push(...(await pool(offsets, (o) => api(first.next.replace(/offset=\d+/, `offset=${o}`)).then((d) => list(d).items as T[]), () => {})).flat());
  } else for (let next = first.next; next; ) {
    const page = list(await api(next));
    out.push(...page.items), (next = page.next);
  }
  return out.filter(Boolean);
}

type Pics = { images?: { url: string }[] | null };
const pic = (x?: Pics) => x?.images?.[0]?.url;
type SpTrack = { id: string | null; uri: string; name: string; type?: string; explicit?: boolean; artists: { name: string }[]; album?: { name: string } & Pics; duration_ms: number; external_ids?: { isrc?: string } };
// A song as Spotify has it, so a whole library comes over at once. Like Mixtape, it's found on YouTube the
// first time it's played (deezer.ts youtubeId). A file on Spotify has no id, only its uri.
const track = (t: SpTrack): Track => ({
  id: `sp:${t.id ?? t.uri}`,
  title: t.name,
  artists: t.artists.map((a) => ({ name: a.name })),
  album: t.album?.name ?? "",
  thumb: pic(t.album),
  duration: length(Math.round(t.duration_ms / 1000)),
  ...(t.explicit && { explicit: true as const }),
  ...(t.external_ids?.isrc && { isrc: t.external_ids.isrc }),
});
// Spotify blanks a song it no longer has: no name, artist or length, only its cover. Those stay behind.
const real = (t?: SpTrack | null): t is SpTrack => t?.type === "track" && !!t.name;
const squash = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export type SpPlaylist = { id: string; name: string; images?: { url: string }[] | null; items?: { total: number }; tracks?: { total: number }; owner?: { id: string; display_name?: string } };
// What there is to bring over, for the sheet to list.
export async function contents() {
  const [playlists, liked, albums, artists] = await Promise.all([all<SpPlaylist>("/me/playlists?limit=50"), api("/me/tracks?limit=1"), api("/me/albums?limit=1"), api("/me/following?type=artist&limit=1")]);
  return { playlists, liked: liked.total as number, albums: albums.total as number, artists: artists.artists.total as number };
}

// The last 50 plays (or those since after), put in History.
async function recent(after?: number) {
  const items: { track: SpTrack; played_at: string }[] = (await api(`/me/player/recently-played?limit=50${after ? `&after=${after}` : ""}`)).items.filter((p: { track?: SpTrack }) => real(p.track));
  const plays = items.map((p) => ({ t: track(p.track), at: Date.parse(p.played_at) }));
  await addPlays(plays);
  if (plays.length) useSpotify.setState((s) => ({ lastPlay: Math.max(s.lastPlay ?? 0, ...plays.map((p) => p.at)) }));
  return plays;
}
// The plays the server kept since the newest one here (it may have caught more than Spotify's last 50
// while Mixtape was closed), then Spotify's latest.
async function fromAccount(after = 0) {
  const rows = await table<{ played_at: string; track: SpTrack }[]>(`spotify_plays?select=played_at,track&played_at=gt.${encodeURIComponent(new Date(after).toISOString())}&order=played_at`);
  const plays = rows.filter((r) => r.track?.name).map((r) => ({ t: track(r.track), at: Date.parse(r.played_at) }));
  await addPlays(plays);
  if (plays.length) useSpotify.setState((s) => ({ lastPlay: Math.max(s.lastPlay ?? 0, ...plays.map((p) => p.at)) }));
}
const syncRecent = async () => {
  if (useAccount.getState().user) await link().catch(() => {});
  if (!useSpotify.getState().refresh) return;
  if (useSpotify.getState().linked) await fromAccount(useSpotify.getState().lastPlay).catch(() => {});
  await recent(useSpotify.getState().lastPlay).catch(() => {});
};
if ("__TAURI_INTERNALS__" in window) {
  setTimeout(() => (void syncRecent(), setInterval(syncRecent, 30 * 60_000)), 15_000);
  useAccount.subscribe((a, was) => a.user?.id !== was.user?.id && a.user && void syncRecent());
}

export type Pick = { playlists: SpPlaylist[]; liked: boolean; albums: boolean; artists: boolean; recent: boolean };
export async function importSpotify(pick: Pick) {
  // Each step shows the cover of the first thing in it, and the last toast the first one shown.
  let stopped = false, shown = 0, first: string | undefined;
  const say = (text: string, thumb?: string) => ((first ??= thumb), notify({ text, sticky: true, thumb }));
  const step = (text: string, of: number, thumb?: string) => (first ??= thumb, (done: number) =>
    Date.now() - shown > 250 && !stopped && ((shown = Date.now()), notify({ text, detail: `${done} of ${of}`, sticky: true, thumb, action: { label: "Cancel", run: () => (stopped = true) } })));
  const brought: string[] = [];
  try {
    // Songs first, since they come over as they are; then artists and albums, which are looked up.
    if (pick.recent) {
      say("Importing Recent Plays…");
      const plays = await recent();
      (first ??= plays[0]?.t.thumb), brought.push(plural(plays.length, "play"));
    }
    if (pick.liked) {
      say("Importing Liked Songs…");
      const liked = (await all<{ added_at: string; track: SpTrack }>("/me/tracks?limit=50")).filter((s) => real(s.track)).map((s) => ({ ...track(s.track), at: Date.parse(s.added_at) }));
      useLibrary.setState((s) => ({ liked: [...liked.filter((t) => !likedAs(t, s.liked)), ...s.liked] }));
      (first ??= liked[0]?.thumb), brought.push(plural(liked.length, "liked song"));
    }
    // Playlists you only follow can't be read through the API, so they're read from their page (the first 100
    // songs) and matched like a CSV.
    for (const p of pick.playlists) {
      say(`Importing ${p.name}…`, pic(p));
      const songs = await all<{ item?: SpTrack | null; track?: SpTrack | null }>(`/playlists/${p.id}/items?limit=100`)
        .then((es) => es.flatMap((e) => (real(e.item ?? e.track) ? [track((e.item ?? e.track)!)] : [])))
        .catch(() => undefined);
      if (songs) songs.length && newPlaylist(songs, undefined, p.name, pic(p));
      else {
        const l = await readLink(`https://open.spotify.com/playlist/${p.id}`).catch(() => undefined);
        if (l && "rows" in l && l.rows.length) importRows(p.name, l.rows, pic(p));
      }
    }
    if (pick.playlists.length) brought.push(plural(pick.playlists.length, "playlist"));
    // Artists and albums by their exact name on YouTube Music; ones it doesn't have are left out.
    if (pick.artists) {
      const artists = await all<{ name: string } & Pics>("/me/following?type=artist&limit=50", "artists");
      const each = step("Importing Artists…", artists.length, pic(artists[0]));
      each(0);
      const found = await pool(artists, async (a) => (await searchKind(a.name, "artist").catch(() => [])).find((x) => squash(x.name) === squash(a.name)), each, () => stopped);
      const got = found.filter((a) => !!a);
      follow(got), brought.push(plural(got.length, "artist"));
    }
    if (pick.albums && !stopped) {
      const albums = (await all<{ added_at: string; album: { name: string; artists: { name: string }[] } & Pics }>("/me/albums?limit=50")).map((s) => ({ ...s.album, at: Date.parse(s.added_at) }));
      const each = step("Importing Albums…", albums.length, pic(albums[0]));
      each(0);
      const found = await pool(albums, async (a) => {
        const by = squash(a.artists[0]?.name ?? "");
        const hit = (await searchKind(`${a.name} ${a.artists[0]?.name ?? ""}`, "album").catch(() => [])).find((x) => squash(bareTitle(x.title)) === squash(bareTitle(a.name)) && squash(x.by ?? "").includes(by));
        return hit && { ...hit, at: a.at };
      }, each, () => stopped);
      const got: Album[] = found.filter((a) => !!a);
      useLibrary.setState((s) => ({ saved: [...got.filter((a) => !s.saved.some((x) => x.id === a.id)), ...s.saved] }));
      brought.push(plural(got.length, "album"));
    }
    notify({ text: stopped ? "Import Cancelled" : "Imported from Spotify", detail: brought.join(", ") || undefined, thumb: first });
  } catch (e) {
    notify({ text: "Couldn’t Import from Spotify", detail: String(e instanceof Error ? e.message : e) });
  }
}
