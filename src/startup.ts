import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Menu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { next, prev, toggle, useSettings } from "./store";

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
  return TrayIcon.new({ icon: (await defaultWindowIcon()) ?? undefined, iconAsTemplate: false, tooltip: "Sleeve", menu });
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
