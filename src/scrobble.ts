import { fetch } from "@tauri-apps/plugin-http";
import md5 from "js-md5";
import { idbGet, idbPut, notify, usePrivate, useSettings } from "./store";
import type { Artist, Track } from "./yt";

const LASTFM_KEY = import.meta.env.VITE_LASTFM_KEY || "";
const LASTFM_SECRET = import.meta.env.VITE_LASTFM_SECRET || "";

// Sign Last.fm API parameters with the shared secret
function lastfmSign(params: Record<string, string>) {
  const sorted = Object.keys(params)
    .filter((k) => k !== "format" && k !== "callback" && k !== "api_sig")
    .sort();
  let str = "";
  for (const k of sorted) str += k + params[k];
  str += LASTFM_SECRET;
  return (md5 as any)(str);
}

// Start Last.fm desktop authentication: fetch token and open browser auth page
export async function lastfmAuthStart(): Promise<string> {
  if (!LASTFM_KEY || !LASTFM_SECRET) {
    throw new Error("Last.fm API key or secret is missing from .env");
  }
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=auth.getToken&api_key=${LASTFM_KEY}&format=json`);
  if (!res.ok) throw new Error(`Last.fm token error: ${res.status}`);
  const data = (await res.json()) as { token?: string; message?: string };
  if (!data.token) throw new Error(data.message || "Failed to obtain token from Last.fm");
  const url = `https://www.last.fm/api/auth?api_key=${LASTFM_KEY}&token=${data.token}`;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
  return data.token;
}

// Complete Last.fm authentication: exchange token for session key
export async function lastfmAuthFinish(token: string): Promise<{ username: string; sessionKey: string }> {
  const params: Record<string, string> = {
    method: "auth.getSession",
    api_key: LASTFM_KEY,
    token,
  };
  params.api_sig = lastfmSign(params);
  params.format = "json";

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`);
  if (!res.ok) throw new Error(`Last.fm session error: ${res.status}`);
  const data = (await res.json()) as { session?: { name: string; key: string }; message?: string };
  if (!data.session?.key) throw new Error(data.message || "Failed to authenticate session with Last.fm");
  const username = data.session.name;
  const sessionKey = data.session.key;
  useSettings.setState({ lastfmSessionKey: sessionKey, lastfmUsername: username });
  notify({ text: `Connected to Last.fm as ${username}` });
  return { username, sessionKey };
}

export function lastfmSignOut() {
  useSettings.setState({ lastfmSessionKey: "", lastfmUsername: "" });
  notify({ text: "Disconnected from Last.fm" });
}

type OfflineScrobble = {
  artist: string;
  track: string;
  album?: string;
  timestamp: number;
  duration?: number;
};

// Retry any scrobbles that failed while offline
async function drainOfflineScrobbles() {
  const sessionKey = useSettings.getState().lastfmSessionKey;
  if (!sessionKey || !LASTFM_KEY || !LASTFM_SECRET) return;
  const queue = (await idbGet<OfflineScrobble[]>("lastfm-offline-scrobbles").catch(() => undefined)) || [];
  if (!queue.length) return;

  const remaining: OfflineScrobble[] = [];
  for (const item of queue) {
    try {
      const params: Record<string, string> = {
        method: "track.scrobble",
        api_key: LASTFM_KEY,
        sk: sessionKey,
        artist: item.artist,
        track: item.track,
        timestamp: String(item.timestamp),
      };
      if (item.album) params.album = item.album;
      if (item.duration) params.duration = String(Math.round(item.duration));
      params.api_sig = lastfmSign(params);
      params.format = "json";

      const body = new URLSearchParams(params).toString();
      const res = await fetch("https://ws.audioscrobbler.com/2.0/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  await idbPut("lastfm-offline-scrobbles", remaining).catch(() => {});
}

// ListenBrainz submission helper
async function submitListenBrainz(
  token: string,
  listenType: "playing_now" | "single",
  track: Track,
  listenedAt?: number,
) {
  const artistName = track.artists.map((a: Artist) => a.name).join(", ") || track.artists[0]?.name || "Unknown Artist";
  const payload: any = {
    track_metadata: {
      artist_name: artistName,
      track_name: track.title,
      additional_info: {
        media_player: "Sleeve",
        submission_client: "Sleeve",
      },
    },
  };
  if (track.album) payload.track_metadata.release_name = track.album;
  if (listenType === "single" && listenedAt) {
    payload.listened_at = Math.floor(listenedAt / 1000);
  }

  const res = await fetch("https://api.listenbrainz.org/1/submit-listens", {
    method: "POST",
    headers: {
      Authorization: `Token ${token.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      listen_type: listenType,
      payload: [payload],
    }),
  });
  return res.ok;
}

// Discord Rich Presence helper
async function setDiscordRpc(track: Track, duration?: number) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const artist = track.artists.map((a: Artist) => a.name).join(", ") || "";
  const start = Date.now();
  const end = duration && duration > 0 ? start + Math.round(duration * 1000) : undefined;
  await invoke("discord_set", {
    title: track.title,
    artist,
    art: track.thumb,
    start,
    end,
  }).catch(() => {});
}

export async function clearDiscordRpc() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("discord_clear").catch(() => {});
}

// Send "now playing" notification when a track starts
export function sendNowPlaying(track: Track, duration?: number) {
  if (usePrivate.getState().on) return;
  const { listenBrainzToken, lastfmSessionKey, discordRpc } = useSettings.getState();

  // 1. ListenBrainz
  if (listenBrainzToken) {
    submitListenBrainz(listenBrainzToken, "playing_now", track).catch(() => {});
  }

  // 2. Last.fm
  if (lastfmSessionKey && LASTFM_KEY && LASTFM_SECRET) {
    const artist = track.artists.map((a: Artist) => a.name).join(", ") || track.artists[0]?.name || "Unknown Artist";
    const params: Record<string, string> = {
      method: "track.updateNowPlaying",
      api_key: LASTFM_KEY,
      sk: lastfmSessionKey,
      artist,
      track: track.title,
    };
    if (track.album) params.album = track.album;
    if (duration && duration > 0) params.duration = String(Math.round(duration));
    params.api_sig = lastfmSign(params);
    params.format = "json";

    const body = new URLSearchParams(params).toString();
    fetch("https://ws.audioscrobbler.com/2.0/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }).catch(() => {});
  }

  // 3. Discord Rich Presence
  if (discordRpc) {
    setDiscordRpc(track, duration).catch(() => {});
  }
}

// Submit a completed scrobble
export async function sendScrobble(track: Track, startedAt: number, duration?: number) {
  if (usePrivate.getState().on) return;
  const { listenBrainzToken, lastfmSessionKey } = useSettings.getState();

  // 1. ListenBrainz
  if (listenBrainzToken) {
    submitListenBrainz(listenBrainzToken, "single", track, startedAt).catch(() => {});
  }

  // 2. Last.fm
  if (lastfmSessionKey && LASTFM_KEY && LASTFM_SECRET) {
    const artist = track.artists.map((a: Artist) => a.name).join(", ") || track.artists[0]?.name || "Unknown Artist";
    const timestamp = Math.floor(startedAt / 1000);
    const params: Record<string, string> = {
      method: "track.scrobble",
      api_key: LASTFM_KEY,
      sk: lastfmSessionKey,
      artist,
      track: track.title,
      timestamp: String(timestamp),
    };
    if (track.album) params.album = track.album;
    if (duration && duration > 0) params.duration = String(Math.round(duration));
    params.api_sig = lastfmSign(params);
    params.format = "json";

    const body = new URLSearchParams(params).toString();
    try {
      const res = await fetch("https://ws.audioscrobbler.com/2.0/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new Error(`Last.fm scrobble failed: ${res.status}`);
      void drainOfflineScrobbles();
    } catch {
      const queue = (await idbGet<OfflineScrobble[]>("lastfm-offline-scrobbles").catch(() => undefined)) || [];
      queue.push({
        artist,
        track: track.title,
        album: track.album,
        timestamp,
        duration,
      });
      await idbPut("lastfm-offline-scrobbles", queue).catch(() => {});
    }
  }
}
