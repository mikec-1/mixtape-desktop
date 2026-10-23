import React, { type ComponentType, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Artwork that won't load (a moved file, a dead link) shows as no artwork: black (index.css), not a broken image.
addEventListener("error", (e) => e.target instanceof HTMLImageElement && e.target.removeAttribute("src"), true);

let Root: ComponentType;
try {
  // One page, three windows: the mini player (store.ts toggleMini) is labelled "mini" and draws only
  // mini.tsx, the menu bar player (startup.ts) "bar" and bar.tsx.
  const label = "__TAURI_INTERNALS__" in window && (await import("@tauri-apps/api/window")).getCurrentWindow().label;
  if (label === "mini") Root = (await import("./mini")).default;
  else if (label === "bar") Root = (await import("./bar")).default;
  else {
    Root = (await import("./App")).default;
    void import("./startup").catch(console.error); // never holds the window up
    // Draw once the library, your own lyrics, what's downloaded and your files are read (a few ms), so none
    // flashes in late, and offline the first covers come from disk. A store that can't be read (it never
    // says it's done) doesn't hold the window up past a second.
    const [{ useLibrary }, { useMine }, { useOffline, ready }, { useLocal }] = await Promise.all([import("./store"), import("./lyrics"), import("./offline"), import("./local")]);
    const read = Promise.all([useLibrary, useMine, useOffline, useLocal].map(({ persist }) => persist.hasHydrated() || new Promise((r) => persist.onFinishHydration(r))).concat(ready));
    await Promise.race([read, new Promise((r) => setTimeout(r, 1000))]);
  }
} catch (e) {
  // Never a blank window: say what went wrong.
  console.error(e);
  Root = () => <Broken error={e} />;
}

function Broken({ error }: { error: unknown }) {
  return (
    <div className="grid h-full place-items-center bg-paper p-10 text-center">
      <div className="max-w-lg">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em]">Sleeve couldn’t start</h1>
        <p className="mt-3 break-words text-muted">{error instanceof Error ? error.message : String(error)}</p>
        {import.meta.env.DEV && <p className="mt-3 text-sm text-muted">Just updated? Run <code className="rounded bg-ink/[0.07] px-1.5 py-0.5">pnpm install</code>, then start Sleeve again. The details are in the console (⌥⌘I).</p>}
        <button onClick={() => location.reload()} className="press mt-6 h-9 rounded-full bg-ink px-4 text-sm font-semibold text-paper">Try Again</button>
      </div>
    </div>
  );
}

// And one that breaks while drawing says so too, rather than leaving the window empty.
class Guard extends React.Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return "error" in this.state ? <Broken error={this.state.error} /> : this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Guard>
      <Root />
    </Guard>
  </React.StrictMode>,
);
