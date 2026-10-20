import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { Menu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { next, prev, toggle, useSettings } from "./store";

const isMac = /Mac/.test(navigator.userAgent);

// Settings → Startup, for the main window. Opened at login the window starts hidden (lib.rs), and shows
// unless you'd rather it stayed in the background. Close to Tray hides the window on close, and keeps
// a menu-bar (or tray) icon to bring it back and control playback; Quit there quits.
const win = getCurrentWindow();
if (!(await win.isVisible()) && !useSettings.getState().loginHidden) void win.show();

const show = () => void win.show().then(() => win.setFocus());
let tray: Promise<TrayIcon> | undefined;
async function makeTray() {
  const menu = await Menu.new({
    items: [
      { id: "show", text: "Show Sleeve", action: show },
      { item: "Separator" },
      { id: "toggle", text: "Play/Pause", action: () => void toggle() },
      { id: "next", text: "Next", action: next },
      { id: "prev", text: "Previous", action: prev },
      { item: "Separator" },
      { id: "quit", text: "Quit Sleeve", action: () => void win.destroy() }, // lib.rs exits once main is gone
    ],
  });
  // On macOS use a black-on-transparent template icon so the system colours it for
  // light and dark menu bars. On Windows keep the full-colour app icon in the tray.
  const icon = isMac
    ? await Image.fromPath(await resolveResource("icons/tray.png"))
    : (await defaultWindowIcon()) ?? undefined;
  return TrayIcon.new({ icon, iconAsTemplate: isMac, tooltip: "Sleeve", menu });
}
const applyTray = (on: boolean) => {
  if (on && !tray) tray = makeTray();
  else if (!on && tray) void tray.then((t) => t.close()), (tray = undefined);
};
applyTray(useSettings.getState().closeToTray);
useSettings.subscribe((s, was) => s.closeToTray !== was.closeToTray && applyTray(s.closeToTray));

void win.onCloseRequested((e) => {
  if (!useSettings.getState().closeToTray) return;
  e.preventDefault();
  void win.hide();
});
