import { audio, back, cycleRepeat, forward, go, newPlaylist, next, nudgeVolume, open, prev, toggle, toggleLike, toggleShuffle, useSettings, useStore } from "./store";

// Every shortcut, in one table: App.tsx runs them, Settings → Shortcuts lists them and remaps them
// (useSettings keymap, by id; "" is none). Combos are "mod+" (⌘, Ctrl on Windows) and the key, lowercase.
// Find on this page if it has a search field (or its button), else the Search tab.
export const findSearch = () => {
  const el = document.querySelector<HTMLElement>("[data-find]");
  if (el instanceof HTMLInputElement) el.select();
  else if (el) el.click();
  else {
    go("search");
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>("input[name=q]")?.select());
  }
};
const seek = (by: number) => (audio.currentTime = Math.min(audio.duration || 0, Math.max(0, audio.currentTime + by)));
export const ZOOMS = [0.9, 1, 1.1, 1.25];
const zoomBy = (step: number) => useSettings.setState((s) => {
  const i = ZOOMS.indexOf(s.zoom);
  return { zoom: ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 1 : i) + step))] };
});
const toggleSidebar = () => useSettings.setState((s) => ({ sidebar: !s.sidebar }));

export const KEYS: { id: string; label: string; combo: string; run: () => unknown }[] = [
  { id: "play", label: "Play or pause", combo: " ", run: toggle },
  { id: "back5", label: "Back 5 seconds", combo: "arrowleft", run: () => seek(-5) },
  { id: "ahead5", label: "Forward 5 seconds", combo: "arrowright", run: () => seek(5) },
  { id: "prev", label: "Previous song", combo: "mod+arrowleft", run: prev },
  { id: "next", label: "Next song", combo: "mod+arrowright", run: next },
  { id: "quieter", label: "Volume down", combo: "mod+arrowdown", run: () => nudgeVolume(-0.1) },
  { id: "louder", label: "Volume up", combo: "mod+arrowup", run: () => nudgeVolume(0.1) },
  { id: "shuffle", label: "Shuffle, then Smart Shuffle", combo: "mod+s", run: toggleShuffle },
  { id: "repeat", label: "Repeat all, one or off", combo: "mod+r", run: cycleRepeat },
  { id: "like", label: "Like the playing song", combo: "mod+l", run: () => {
    const { queue, index } = useStore.getState();
    if (queue[index]) toggleLike(queue[index]);
  } },
  { id: "search", label: "Search", combo: "mod+k", run: findSearch },
  { id: "find", label: "Search, again", combo: "mod+f", run: findSearch },
  { id: "goBack", label: "Go back", combo: "mod+[", run: back },
  { id: "goForward", label: "Go forward", combo: "mod+]", run: forward },
  { id: "home", label: "Home", combo: "mod+1", run: () => go("home") },
  { id: "searchTab", label: "Search tab", combo: "mod+2", run: findSearch },
  { id: "library", label: "Library", combo: "mod+3", run: () => go("library") },
  { id: "new", label: "New playlist", combo: "mod+n", run: () => open({ name: "playlist", id: newPlaylist() }) },
  { id: "settings", label: "Settings", combo: "mod+,", run: () => go("settings") },
  { id: "sidebar", label: "Show or hide the sidebar", combo: "mod+b", run: toggleSidebar },
  { id: "zoomIn", label: "Bigger", combo: "mod+=", run: () => zoomBy(1) },
  { id: "zoomOut", label: "Smaller", combo: "mod+-", run: () => zoomBy(-1) },
  { id: "zoomReset", label: "Actual size", combo: "mod+0", run: () => useSettings.setState({ zoom: 1 }) },
  { id: "close", label: "Close full screen", combo: "escape", run: () => useStore.setState({ sheet: undefined }) },
];

export const comboOf = (id: string) => useSettings.getState().keymap[id] ?? KEYS.find((k) => k.id === id)!.combo;
export const actionFor = (combo: string) => KEYS.find((k) => comboOf(k.id) === combo);
// The combo a key press makes, or undefined with Shift or Option (left to the system and fields).
export const comboFrom = (e: KeyboardEvent) => (e.shiftKey || e.altKey ? undefined : (e.metaKey || e.ctrlKey ? "mod+" : "") + e.key.toLowerCase());

const mac = /Mac/.test(navigator.userAgent);
const names: Record<string, string> = { " ": "Space", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", escape: "Esc", enter: "Return", backspace: "⌫", tab: "Tab" };
export const showCombo = (combo: string) => {
  const key = combo.replace(/^mod\+/, "");
  return (combo.startsWith("mod+") ? (mac ? "⌘" : "Ctrl+") : "") + (names[key] ?? key.toUpperCase());
};

// Sets id's shortcut, taking it from whichever action had it. Returns that action's label.
export function bind(id: string, combo: string) {
  const taken = KEYS.find((k) => k.id !== id && comboOf(k.id) === combo);
  useSettings.setState((s) => ({ keymap: { ...s.keymap, [id]: combo, ...(taken && { [taken.id]: "" }) } }));
  return taken?.label;
}
export const resetKeys = () => useSettings.setState({ keymap: {} });
// While Settings → Shortcuts waits for a new combo, presses go to it, not to the actions.
export let recording = false;
export const setRecording = (on: boolean) => void (recording = on);
