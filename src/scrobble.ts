import { fetch } from "@tauri-apps/plugin-http";
import { md5 } from "js-md5";
import { idbGet, idbPut, notify, usePrivate, useSettings } from "./store";
import type { Track } from "./yt";

// Sends what you play to Last.fm and ListenBrainz, and shows it on Discord. Scrobbles that fail (offline)
// wait in IndexedDB and go with the next one that gets through.
const KEY = import.meta.env.VITE_LASTFM_KEY || "";
const SECRET = import.meta.env.VITE_LASTFM_SECRET || "";
const LASTFM = "https://ws.audioscrobbler.com/2.0/";

const by = (t: Track) => t.artists.map((a) => a.name).join(", ") || "Unknown Artist";

// Last.fm signs every call: the params sorted and run together, then the secret, md5'd.
function signed(params: Record<string, string>) {
  const sig = md5(Object.keys(params).sort().map((k) => k + params[k]).join("") + SECRET);
  return new URLSearchParams({ ...params, api_key: KEY, api_sig: sig, format: "json" });
}
async function lastfm(params: Record<string, string>, post = true) {
  const body = signed({ ...params, api_key: KEY });
  const r = post ? await fetch(LASTFM, { method: "POST", body }) : await fetch(`${LASTFM}?${body}`);
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.message || `Last.fm: ${r.status}`);
  return data;
}

// Sign-in: Last.fm's desktop flow. Start opens its page in the browser; finish runs after you allow it there.
export async function lastfmAuthStart() {
  if (!KEY || !SECRET) throw new Error("Last.fm isn't set up in this build");
  const { token } = await lastfm({ method: "auth.getToken" }, false);
  await (await import("@tauri-apps/plugin-opener")).openUrl(`https://www.last.fm/api/auth?api_key=${KEY}&token=${token}`);
  return token as string;
}
export async function lastfmAuthFinish(token: string) {
  const { session } = await lastfm({ method: "auth.getSession", token }, false);
  useSettings.setState({ lastfmSessionKey: session.key, lastfmUsername: session.name });
  notify({ text: `Connected to Last.fm as ${session.name}` });
}
export function lastfmSignOut() {
  useSettings.setState({ lastfmSessionKey: "", lastfmUsername: "" });
}

type Listen = { track: Track; at: number; secs?: number }; // at: when it started, in ms
const toLastfm = ({ track, at, secs }: Listen) => ({
  artist: by(track), track: track.title, timestamp: String(Math.floor(at / 1000)),
  ...(track.album && { album: track.album }), ...(secs && { duration: String(Math.round(secs)) }),
});
const toBrainz = ({ track, at }: Partial<Listen> & { track: Track }) => ({
  ...(at && { listened_at: Math.floor(at / 1000) }),
  track_metadata: { artist_name: by(track), track_name: track.title, release_name: track.album, additional_info: { media_player: "Mixtape" } },
});
async function brainz(token: string, listen_type: "playing_now" | "single" | "import", payload: object[]) {
  const r = await fetch("https://api.listenbrainz.org/1/submit-listens", {
    method: "POST",
    headers: { Authorization: `Token ${token.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ listen_type, payload }),
  });
  if (!r.ok) throw new Error(`ListenBrainz: ${r.status}`);
}

export function sendNowPlaying(track: Track, secs?: number, at = 0) {
  if (usePrivate.getState().on) return;
  const { listenBrainzToken: lb, lastfmSessionKey: sk, discordRpc } = useSettings.getState();
  if (lb) brainz(lb, "playing_now", [toBrainz({ track })]).catch(() => {});
  if (sk && KEY) {
    const { timestamp: _, ...p } = toLastfm({ track, at: 0, secs });
    lastfm({ method: "track.updateNowPlaying", sk, ...p }).catch(() => {});
  }
  if (discordRpc) showDiscord(track, secs, at);
}

// Each service keeps its own waiting list, so one being down doesn't hold up the other.
async function send(service: "lastfm" | "brainz", listen?: Listen) {
  const { listenBrainzToken: lb, lastfmSessionKey: sk } = useSettings.getState();
  const idb = `scrobbles-${service}`;
  const queue = [...((await idbGet<Listen[]>(idb)) ?? []), ...(listen ? [listen] : [])];
  if (!queue.length) return;
  try {
    if (service === "brainz") await brainz(lb, queue.length > 1 ? "import" : "single", queue.map(toBrainz));
    // Last.fm takes up to 50 in one call, as track[0], artist[0]…
    else for (let i = 0; i < queue.length; i += 50) {
      const batch = Object.assign({}, ...queue.slice(i, i + 50).map((l, n) => Object.fromEntries(Object.entries(toLastfm(l)).map(([k, v]) => [`${k}[${n}]`, v]))));
      await lastfm({ method: "track.scrobble", sk, ...batch });
    }
    await idbPut(idb, []);
  } catch {
    await idbPut(idb, queue.slice(-1000)); // ponytail: oldest dropped past 1000; Last.fm refuses >2 weeks old anyway
  }
}
export function sendScrobble(track: Track, at: number, secs?: number) {
  if (usePrivate.getState().on) return;
  const { listenBrainzToken, lastfmSessionKey } = useSettings.getState();
  if (listenBrainzToken) void send("brainz", { track, at, secs });
  if (lastfmSessionKey && KEY) void send("lastfm", { track, at, secs });
}

// Discord: at is how far into the song you are, so its elapsed timer matches after a resume.
async function showDiscord(t: Track, secs: number | undefined, at: number) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const start = Date.now() - at * 1000;
  invoke("discord_set", { title: t.title, artist: by(t), art: t.thumb, start, end: secs ? start + secs * 1000 : undefined }).catch(() => {});
}
export async function clearDiscordRpc() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  (await import("@tauri-apps/api/core")).invoke("discord_clear").catch(() => {});
}
