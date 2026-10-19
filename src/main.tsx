import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// One page, two windows: the mini player (store.ts toggleMini) is labelled "mini" and draws only mini.tsx.
const mini = "__TAURI_INTERNALS__" in window && (await import("@tauri-apps/api/window")).getCurrentWindow().label === "mini";
let Root;
if (mini) Root = (await import("./mini")).default;
else {
  Root = (await import("./App")).default;
  // Draw once the library, your own lyrics, what's downloaded and your files are read (a few ms), so none
  // flashes in late, and offline the first covers come from disk.
  const [{ useLibrary }, { useMine }, { useOffline, ready }, { useLocal }] = await Promise.all([import("./store"), import("./lyrics"), import("./offline"), import("./local")]);
  for (const { persist } of [useLibrary, useMine, useOffline, useLocal]) if (!persist.hasHydrated()) await new Promise((r) => persist.onFinishHydration(r));
  await ready;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
