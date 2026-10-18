// Injected into the hidden "potoken" window on https://www.youtube.com: BotGuard only hands out real
// integrity tokens on that origin, so PO tokens are minted here and sent to the app over Tauri events.
// BotGuard glue adapted from bgutils-js (MIT).
(() => {
  if (window.__poMinter) return;
  const KEY = "O43z0dpjhgX20SCx4KAo";
  const headers = {
    "content-type": "application/json+protobuf",
    "x-goog-api-key": "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw",
    "x-user-agent": "grpc-web-javascript/0.1",
  };
  const post = async (name, body) =>
    (await fetch(`/api/jnn/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) })).json();
  const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const toWebsafe = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_");

  async function createMinter() {
    const raw = await post("Create", [KEY]);
    const challenge = typeof raw[1] === "string"
      ? JSON.parse(new TextDecoder().decode(fromB64(raw[1]).map((b) => b + 97)))
      : raw[0];
    const [, script, , , program, globalName] = challenge;
    new Function(script.find((v) => typeof v === "string"))();
    const noop = () => {};
    const snapshot = await new Promise((resolve) =>
      window[globalName].a(program, resolve, true, undefined, noop, [[], []], undefined, false, Array(5).fill(noop)));
    const signals = [];
    const bgResponse = await new Promise((resolve) => snapshot(resolve, [undefined, undefined, signals, undefined]));
    const [integrityToken, ttl] = await post("GenerateIT", [KEY, bgResponse]);
    if (typeof integrityToken !== "string") throw new Error("BotGuard attestation rejected");
    const mint = await signals[0](fromB64(integrityToken));
    return { mint, expires: Date.now() + (ttl - 300) * 1000 };
  }

  let minter;
  const getMinter = () => {
    if (!minter) {
      minter = createMinter();
      minter.then((m) => setTimeout(() => (minter = undefined), m.expires - Date.now()), () => (minter = undefined));
    }
    return minter;
  };
  window.__poMinter = getMinter(); // warm up before the first play

  const { listen, emit } = window.__TAURI__.event;
  listen("po-mint", async ({ payload: { videoId, reply } }) => {
    try {
      const { mint } = await getMinter();
      emit(reply, { token: toWebsafe(await mint(new TextEncoder().encode(videoId))) });
    } catch (e) {
      emit(reply, { error: String(e) });
    }
  });
})();
