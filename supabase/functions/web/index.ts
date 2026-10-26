// web: what the browser build can't do itself. ?u=<url> passes a call to one of the sites the app talks to
// (the browser blocks them cross-origin; the desktop app goes through Rust instead). ?play=<video id> fetches
// a signed link to the song for a signed-in user, and ?stream= plays it through the resolver
// (resolver.mixtaped.tech), as mixtape-web does: <audio> can't send a sign-in, so the link is good for
// that one song for 6 hours. Secrets: RESOLVER_URL, RESOLVER_TOKEN (the token never leaves here).

const HOSTS = /(^|\.)(youtube\.com|google\.com|googleapis\.com|ytimg\.com|deezer\.com|itunes\.apple\.com|music\.apple\.com|rss\.marketingtools\.apple\.com|lrclib\.net|lrc\.red|binimum\.org|music\.163\.com|shazam\.com|listenbrainz\.org|audioscrobbler\.com)$/;
const key = crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("RESOLVER_TOKEN")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sign = async (vid: string, exp: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(`${vid}.${exp}`))))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
const resolver = () => ({ base: Deno.env.get("RESOLVER_URL")!.replace(/\/+$/, ""), auth: { Authorization: `Bearer ${Deno.env.get("RESOLVER_TOKEN")}` } });
const DROP = ["host", "origin", "referer", "authorization", "apikey", "x-client-info", "cookie", "content-length"];

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") ?? "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Expose-Headers": "x-duration" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const q = new URL(req.url).searchParams;

  const vid = q.get("play");
  if (vid) {
    if (!/^[\w-]{11}$/.test(vid)) return new Response("bad id", { status: 400, headers: cors });
    const user = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: req.headers.get("authorization") ?? "" } });
    if (!user.ok) return new Response("sign in to play", { status: 401, headers: cors });
    const { base, auth } = resolver();
    const resolved = await fetch(`${base}/resolve?${new URLSearchParams({ q: vid, vid, dur: "0", explicit: "0" })}`, { headers: auth, signal: AbortSignal.timeout(20000) });
    if (!resolved.ok) return new Response("not found", { status: resolved.status, headers: cors });
    const { videoID, duration } = await resolved.json(), exp = String(Math.floor(Date.now() / 1000) + 6 * 3600);
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/web?${new URLSearchParams({ stream: videoID, exp, sig: await sign(videoID, exp) })}`;
    return Response.json({ url, duration: duration ?? 0 }, { headers: cors });
  }

  const stream = q.get("stream"), exp = q.get("exp") ?? "";
  if (stream) {
    if (!/^[\w-]{11}$/.test(stream) || Number(exp) * 1000 < Date.now() || q.get("sig") !== (await sign(stream, exp))) return new Response("expired", { status: 403, headers: cors });
    const { base, auth } = resolver(), range = req.headers.get("range");
    const audio = await fetch(`${base}/stream/${stream}.m4a`, { headers: range ? { ...auth, range } : auth });
    const out = new Headers(cors);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) audio.headers.get(h) && out.set(h, audio.headers.get(h)!);
    if (!out.has("content-type")) out.set("content-type", "audio/mp4");
    return new Response(audio.body, { status: audio.status, headers: out });
  }

  const target = q.get("u");
  if (!target || new URL(target).protocol !== "https:" || !HOSTS.test(new URL(target).hostname)) return new Response("not allowed", { status: 403, headers: cors });
  const headers = new Headers(req.headers);
  for (const h of DROP) headers.delete(h);
  const res = await fetch(target, { method: req.method, headers, body: req.method === "GET" ? undefined : await req.arrayBuffer() });
  const out = new Headers(cors);
  for (const h of ["content-type", "cache-control"]) res.headers.get(h) && out.set(h, res.headers.get(h)!);
  return new Response(res.body, { status: res.status, headers: out });
});
