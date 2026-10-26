import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// The desktop app fetches through Rust (no CORS). In a browser, calls go through the "web" Supabase function.
export const inApp = "__TAURI_INTERNALS__" in window;
export const web = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/web`;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const webHeaders = (bearer = anon) => ({ apikey: anon, authorization: `Bearer ${bearer}` });

export const fetch: typeof globalThis.fetch = inApp ? tauriFetch : async (input, init) => {
  const req = new Request(input, init);
  const headers = new Headers(req.headers);
  for (const [k, v] of Object.entries(webHeaders())) headers.set(k, v);
  return globalThis.fetch(`${web}?u=${encodeURIComponent(req.url)}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(), signal: req.signal });
};
