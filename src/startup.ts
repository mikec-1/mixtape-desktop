import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import { Menu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { TrayIcon } from "@tauri-apps/api/tray";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, monitorFromPoint, PhysicalPosition, type PhysicalSize } from "@tauri-apps/api/window";
import { audio, cycleRepeat, fillUpNext, lyricNow, next, prev, spectrum, subscribeAudio, toggle, likedAs, toggleLike, toggleMini, toggleShuffle, useLibrary, useSettings, useStore } from "./store";

// Settings → Startup, for the main window. Opened at login the window starts hidden (lib.rs), and shows
// unless you'd rather it stayed in the background. Close to Tray hides the window on close, and keeps
// the menu-bar (or tray) icon, with the menu bar player and a menu like the Music app's Dock menu.
const win = getCurrentWindow();
if (!(await win.isVisible()) && !useSettings.getState().loginHidden) void win.show();

const show = () => void win.show().then(() => win.setFocus());
const isMac = /Mac/.test(navigator.userAgent);

// The menu, as it should look right now. key says when it needs remaking.
function now() {
  const { queue, index, shuffle, repeat } = useStore.getState();
  const t = queue[index];
  const liked = !!t && !!likedAs(t);
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

// While something plays, the menu-bar icon is four bars that move with the music (bass on the left, treble on
// the right, as on iOS), or hold still with Reduce Motion. A template image, like the logo, so the menu bar colours it.
const draw = (levels: number[]) => {
  const c = new OffscreenCanvas(44, 44), g = c.getContext("2d")!;
  levels.forEach((v, i) => {
    const h = 10 + 26 * v;
    g.beginPath(), g.roundRect(5 + i * 9.5, 22 - h / 2, 5.5, h, 2.75), g.fill();
  });
  return c;
};
const still = isMac ? Image.new(draw([0.4, 0.8, 0.2, 0.5]).getContext("2d")!.getImageData(0, 0, 44, 44).data.buffer, 44, 44) : undefined;

// What shows beside the icon (Mac only): the song, or the line being sung, while it plays.
function title() {
  const { queue, index } = useStore.getState(), t = queue[index], mode = useSettings.getState().menuBar;
  if (!isMac || !t || audio.paused || (mode !== "song" && mode !== "lyrics")) return "";
  const text = (mode === "lyrics" && lyricNow()) || `${t.title} · ${t.artists.map((a) => a.name).join(", ")}`;
  return text.length > 36 ? `${text.slice(0, 35).trimEnd()}…` : text;
}

// The menu bar player (bar.tsx): a click on the icon opens it under the icon (above it, in a taskbar at the
// bottom of the screen), and it hides when you click anywhere else. Made once, hidden, so it opens at once.
let bar: WebviewWindow | undefined;
let hid = 0;
async function pop({ position: p, size }: { position: PhysicalPosition; size: PhysicalSize }) {
  // The click that hid it (by taking its focus away) shouldn't open it again.
  if (!bar || Date.now() - hid < 300) return;
  if (await bar.isVisible()) return void bar.hide();
  const m = await monitorFromPoint(p.x, p.y), k = m?.scaleFactor ?? 1, area = m?.workArea ?? { position: p, size };
  const w = 340 * k, h = (await bar.outerSize()).height, gap = 6 * k; // it sizes itself to fit (bar.tsx fit)
  const x = Math.min(Math.max(p.x + size.width / 2 - w / 2, area.position.x + gap), area.position.x + area.size.width - w - gap);
  const y = p.y < area.position.y + area.size.height / 2 ? p.y + size.height + gap : p.y - h - gap;
  await bar.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
  await bar.show();
}

let tray: Promise<TrayIcon> | undefined;
let stop: (() => void) | undefined;
async function makeTray(player: boolean) {
  let state = now();
  // On a Mac, a black-and-white template icon, so it matches the other menu-bar icons in light and dark.
  const icon = isMac ? await Image.fromPath(await resolveResource("icons/tray.png")) : ((await defaultWindowIcon()) ?? undefined);
  let shown = await menu(state);
  // A left click opens the player (on a Mac as the button goes down, like the menu bar's own), a right click the
  // menu. With the player off, any click opens the menu.
  const made = await TrayIcon.new({
    icon, iconAsTemplate: isMac, tooltip: "Sleeve", menu: shown, showMenuOnLeftClick: !player,
    action: (e) => player && e.type === "Click" && e.button === "Left" && e.buttonState === (isMac ? "Down" : "Up") && void pop(e.rect),
  });
  if (player) bar = new WebviewWindow("bar", { title: "Sleeve", url: "/", visible: false, focus: false, width: 340, height: 548, resizable: false, decorations: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, shadow: true });
  const offBlur = bar?.onFocusChanged(({ payload }) => !payload && ((hid = Date.now()), void bar?.hide()));
  // Up to 30 a second, each frame drawn here and shown by lib.rs's dance (Tauri's set_icon stuttered and lost
  // clicks), and only when a bar moves a pixel, so the icon is left alone to take clicks as much as it can.
  let said = "", dance: ReturnType<typeof setInterval> | undefined, busy = false, levels = [0, 0, 0, 0], drawn = "";
  const beat = () => {
    levels = spectrum().map((v, i) => levels[i] + (v - levels[i]) * (v > levels[i] ? 0.7 : 0.3)); // up fast, down gently
    const key = levels.map((v) => Math.round(v * 26)).join();
    if (busy || key === drawn) return;
    (busy = true), (drawn = key);
    void draw(levels).convertToBlob().then((b) => b.arrayBuffer()).then((b) => dance && invoke("dance", { id: made.id, frame: [...new Uint8Array(b)] })).finally(() => (busy = false));
  };
  const hold = () => (clearInterval(dance), (dance = undefined), (drawn = ""));
  const update = () => {
    const was = state;
    state = now();
    const text = title();
    if (text !== said) void made.setTitle((said = text) && ` ${text}`);
    // Bars while playing, the logo when not.
    const moving = isMac && !state.paused && !useSettings.getState().reduceMotion;
    if (moving && !dance) dance = setInterval(beat, 1000 / 30);
    if (!moving && dance) hold();
    if (state.key === was.key) return;
    if (isMac && !moving) void (state.paused ? Promise.resolve(icon!) : still!).then((i) => made.setIconWithAsTemplate(i, true));
    void menu(state).then(async (m) => (await made.setMenu(m), void shown.close(), (shown = m)));
    void made.setTooltip(state.t ? `${state.t.title} · ${state.t.artists.map((a) => a.name).join(", ")}` : "Sleeve");
  };
  update();
  const offs = [useStore.subscribe(update), useLibrary.subscribe(update), useSettings.subscribe(update), subscribeAudio(update)];
  stop = () => (offs.forEach((off) => off()), hold(), void offBlur?.then((off) => off()), void bar?.close(), (bar = undefined));
  return made;
}
// There's an icon when the menu bar player is on, or closing the window leaves Sleeve playing (then just the menu).
let made = "";
const applyTray = () => {
  const { menuBar, closeToTray } = useSettings.getState(), want = menuBar !== "off" ? "player" : closeToTray ? "menu" : "";
  if (want === made) return;
  if (tray) stop?.(), void tray.then((t) => t.close()), (tray = undefined);
  if ((made = want)) tray = makeTray(want === "player");
};
applyTray();
useSettings.subscribe(applyTray);

void win.onCloseRequested((e) => {
  if (!useSettings.getState().closeToTray) return;
  e.preventDefault();
  void win.hide();
});

fillUpNext();
