import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { comboOf, KEYS } from "./keys";
import { toggleMini, useSettings, useStore } from "./store";
import { pickPlaylists } from "./import";
import { addFolder } from "./local";

// The Mac menu bar, laid out like Mixtape's: every shortcut in keys.ts under a menu, with its combo as the
// menu's own (so a remapped one moves here too). Bare keys (Space, arrows) get none, or they'd stop working in text
// fields. Built again when you remap a shortcut.
const keyNames: Record<string, string> = { arrowleft: "Left", arrowright: "Right", arrowup: "Up", arrowdown: "Down", "[": "BracketLeft", "]": "BracketRight", "=": "Equal", "-": "Minus", ",": "Comma" };
const item = (id: string, text?: string) => {
  const k = KEYS.find((x) => x.id === id)!, combo = comboOf(id);
  const accelerator = combo.startsWith("mod+") ? `CmdOrCtrl+${keyNames[combo.slice(4)] ?? combo.slice(4).toUpperCase()}` : undefined;
  return MenuItem.new({ text: text ?? k.label, accelerator, action: () => void k.run() });
};
const run = (text: string, action: () => unknown, accelerator?: string) => MenuItem.new({ text, accelerator, action: () => void action() });
const line = () => PredefinedMenuItem.new({ item: "Separator" });
const sub = async (text: string, items: Promise<unknown>[]) => Submenu.new({ text, items: (await Promise.all(items)) as never });

async function build() {
  const menu = await Menu.new({
    items: await Promise.all([
      sub("Mixtape", [PredefinedMenuItem.new({ item: { About: null } }), line(), item("settings", "Settings…"), line(), PredefinedMenuItem.new({ item: "Services" }), line(), PredefinedMenuItem.new({ item: "Hide" }), PredefinedMenuItem.new({ item: "HideOthers" }), PredefinedMenuItem.new({ item: "ShowAll" }), line(), PredefinedMenuItem.new({ item: "Quit" })]),
      sub("File", [item("new", "New Playlist"), line(), run("Import from Spotify…", () => useStore.setState({ dialog: { kind: "spotify" } })), run("Import Playlist Files…", pickPlaylists), run("Add Music Folder…", addFolder), line(), PredefinedMenuItem.new({ item: "CloseWindow" })]),
      sub("Edit", [PredefinedMenuItem.new({ item: "Undo" }), PredefinedMenuItem.new({ item: "Redo" }), line(), PredefinedMenuItem.new({ item: "Cut" }), PredefinedMenuItem.new({ item: "Copy" }), PredefinedMenuItem.new({ item: "Paste" }), PredefinedMenuItem.new({ item: "SelectAll" }), line(), item("find", "Find…")]),
      sub("View", [item("home", "Home"), item("searchTab", "Search"), item("library", "Library"), line(), item("goBack", "Back"), item("goForward", "Forward"), line(), item("sidebar", "Show or Hide Sidebar"), line(), item("zoomReset", "Actual Size"), item("zoomIn", "Zoom In"), item("zoomOut", "Zoom Out"), line(), PredefinedMenuItem.new({ item: "Fullscreen" })]),
      sub("Controls", [item("play", "Play or Pause"), item("next", "Next"), item("prev", "Previous"), line(), item("ahead5", "Forward 5 Seconds"), item("back5", "Back 5 Seconds"), line(), item("shuffle", "Shuffle"), item("repeat", "Repeat"), line(), item("louder", "Volume Up"), item("quieter", "Volume Down"), line(), item("like", "Like Song"), item("search", "Search…")]),
      sub("Window", [PredefinedMenuItem.new({ item: "Minimize" }), PredefinedMenuItem.new({ item: "Maximize" }), line(), run("Mini Player", toggleMini, "Alt+CmdOrCtrl+M"), line(), run("Bring All to Front", () => getCurrentWindow().setFocus())]),
      sub("Help", [run("Mixtape on GitHub", () => openUrl("https://github.com/mikec-1/Sleeve")), run("Report a Problem", () => openUrl("https://github.com/mikec-1/Sleeve/issues/new"))]),
    ]),
  });
  await menu.setAsAppMenu();
}

void build();
useSettings.subscribe((s, was) => s.keymap !== was.keymap && void build());
