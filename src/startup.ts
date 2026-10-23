import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { Menu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { audio, cycleRepeat, next, prev, subscribeAudio, toggle, toggleLike, toggleMini, toggleShuffle, useLibrary, useSettings, useStore } from "./store";

// Settings → Startup, for the main window. Opened at login the window starts hidden (lib.rs), and shows
// unless you'd rather it stayed in the background. Close to Tray hides the window on close, and keeps
// a menu-bar (or tray) icon to bring it back and control playback, like the Music app's Dock menu.
const win = getCurrentWindow();
if (!(await win.isVisible()) && !useSettings.getState().loginHidden) void win.show();

const show = () => void win.show().then(() => win.setFocus());
const isMac = /Mac/.test(navigator.userAgent);

// The menu, as it should look right now. key says when it needs remaking.
function now() {
  const { queue, index, shuffle, repeat } = useStore.getState();
  const t = queue[index];
  const liked = !!t && useLibrary.getState().liked.some((l) => l.id === t.id);
  return { t, liked, shuffle, repeat, paused: audio.paused, key: [t?.id, liked, shuffle, repeat, audio.paused].join() };
}
function menu({ t, liked, shuffle, repeat, paused }: ReturnType<typeof now>) {
  return Menu.new({
    items: [
      ...(t
        ? [
            { text: t.title, enabled: false },
            { text: t.artists.map((a) => a.name).join(", "), enabled: false },
            { text: liked ? "Remove from Liked Songs" : "Add to Liked Songs", action: () => void toggleLike(t) },
            { item: "Separator" as const },
          ]
        : []),
      { text: paused ? "Play" : "Pause", action: () => void toggle() },
      { text: "Next", action: next },
      { text: "Previous", action: prev },
      { item: "Separator" },
      { text: "Shuffle", checked: !!shuffle, action: () => void toggleShuffle() },
      { text: `Repeat: ${repeat === "one" ? "One" : repeat === "all" ? "All" : "Off"}`, action: cycleRepeat },
      { item: "Separator" },
      { text: "Mini Player", action: () => void toggleMini() },
      { text: "Show Sleeve", action: show },
      { item: "Separator" },
      { text: "Quit Sleeve", action: () => void win.destroy() }, // lib.rs exits once main is gone
    ],
  });
}

let tray: Promise<TrayIcon> | undefined;
let stop: (() => void) | undefined;
async function makeTray() {
  let state = now();
  // On a Mac, a black-and-white template icon, so it matches the other menu-bar icons in light and dark.
  const icon = isMac ? await Image.fromPath(await resolveResource("icons/tray.png")) : ((await defaultWindowIcon()) ?? undefined);
  let shown = await menu(state);
  const made = await TrayIcon.new({ icon, iconAsTemplate: isMac, tooltip: "Sleeve", menu: shown });
  const update = () => {
    const was = state;
    state = now();
    if (state.key === was.key) return;
    void menu(state).then(async (m) => (await made.setMenu(m), void shown.close(), (shown = m)));
    void made.setTooltip(state.t ? `${state.t.title} · ${state.t.artists.map((a) => a.name).join(", ")}` : "Sleeve");
  };
  const offs = [useStore.subscribe(update), useLibrary.subscribe(update), subscribeAudio(update)];
  stop = () => offs.forEach((off) => off());
  return made;
}
const applyTray = (on: boolean) => {
  if (on && !tray) tray = makeTray();
  else if (!on && tray) stop?.(), void tray.then((t) => t.close()), (tray = undefined);
};
applyTray(useSettings.getState().closeToTray);
useSettings.subscribe((s, was) => s.closeToTray !== was.closeToTray && applyTray(s.closeToTray));

void win.onCloseRequested((e) => {
  if (!useSettings.getState().closeToTray) return;
  e.preventDefault();
  void win.hide();
});
