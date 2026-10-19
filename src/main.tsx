import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// One page, two windows: the mini player (store.ts toggleMini) is labelled "mini" and draws only mini.tsx.
const mini = "__TAURI_INTERNALS__" in window && (await import("@tauri-apps/api/window")).getCurrentWindow().label === "mini";
let Root;
if (mini) Root = (await import("./mini")).default;
else {
  Root = (await import("./App")).default;
  // Draw once the library is read (a few ms), so it never flashes empty.
  const { persist } = (await import("./store")).useLibrary;
  if (!persist.hasHydrated()) await new Promise((r) => persist.onFinishHydration(r));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
