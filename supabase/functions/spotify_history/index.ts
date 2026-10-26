// spotify_history: copies everyone's recently played Spotify songs into spotify_plays, so History has them
// even when no device was open. Ported from Mixtape's, minus its monthly top list.
//
// Run every half hour by pg_cron, signed with the Vault secret job_secret. Spotify only returns the last 50
// plays, so anything older than that between runs is lost.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CLIENT_ID = "0e312a528cc34744b92021bed3f6edc9";
const SCOPE = "user-read-recently-played";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let secret: PromiseLike<string | null> | null = null;

Deno.serve(async (req) => {
  secret ??= admin.rpc("job_secret").then(({ data }) => data as string | null);
  const expected = await secret;
  if (!expected || req.headers.get("x-job-secret") !== expected) return new Response("forbidden", { status: 403 });

  const { data: rows } = await admin.from("spotify_connections").select("user_id, refresh_token, scope").eq("history_sync", true);
  const due = (rows ?? []).filter((r) => (r.scope ?? "").split(" ").includes(SCOPE));
  const results = await Promise.all(due.map((r) => sync(r.user_id, r.refresh_token).catch((e) => (console.error(`spotify_history ${r.user_id}: ${e}`), 0))));
  return Response.json({ users: due.length, plays: results.reduce((a, b) => a + b, 0) });
});

async function sync(userID: string, refreshToken: string): Promise<number> {
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  // A 400 here usually means the grant is past Spotify's six months; the app asks to reconnect.
  if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
  const token = await tokenRes.json();

  // Only replace the token we used, so a device that refreshed meanwhile keeps its newer one.
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await admin.from("spotify_connections")
      .update({ refresh_token: token.refresh_token, scope: token.scope, updated_at: new Date().toISOString() })
      .eq("user_id", userID).eq("refresh_token", refreshToken);
  }

  const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!res.ok) throw new Error(`recently-played ${res.status}`);
  const { items } = await res.json();

  // Spotify's own song object, trimmed to what the app reads (spotify.ts track()).
  const plays = (items ?? []).filter((i: any) => i.track?.type === "track" && i.track.name && i.played_at).map(({ played_at, track: t }: any) => ({
    user_id: userID,
    played_at,
    track: { id: t.id, uri: t.uri, name: t.name, type: t.type, explicit: t.explicit, duration_ms: t.duration_ms, external_ids: t.external_ids, artists: (t.artists ?? []).map((a: any) => ({ name: a.name })), album: t.album && { name: t.album.name, images: t.album.images } },
  }));
  if (plays.length === 0) return 0;

  const { error } = await admin.from("spotify_plays").upsert(plays, { onConflict: "user_id,played_at", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return plays.length;
}
