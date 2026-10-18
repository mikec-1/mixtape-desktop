import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useLibrary } from "./store";

// Draw once the library is read (a few ms), so it never flashes empty.
const { persist } = useLibrary;
if (!persist.hasHydrated()) await new Promise((r) => persist.onFinishHydration(r));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
