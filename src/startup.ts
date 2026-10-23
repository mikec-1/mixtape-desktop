import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { IconMenuItem, Menu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  audio,
  clearQueue,
  cycleRepeat,
  jump,
  libraryKey,
  next,
  open,
  play,
  prev,
  setMuted,
  setVolume,
  sleepIn,
  subscribeAudio,
  toggle,
  toggleLike,
  toggleMini,
  toggleSheet,
  toggleShuffle,
  useLibrary,
  useSettings,
  useStore,
} from "./store";
import { art, type Track } from "./yt";

const isMac = /Mac/.test(navigator.userAgent);

// Settings → Startup, for the main window. Opened at login the window starts hidden (lib.rs), and shows
// unless you'd rather it stayed in the background. Close to Tray hides the window on close, and keeps
// a rich menu-bar (or tray) icon to bring it back and control playback; Quit there quits.
const win = getCurrentWindow();
if (!(await win.isVisible()) && !useSettings.getState().loginHidden) void win.show();

const show = () => void win.show().then(() => win.setFocus());

// Cache up to 20 rendered artwork icons so switching between tracks stays instant without leaking memory.
const artCache = new Map<string, Image>();
async function getTrackIcon(track?: Track): Promise<Image | undefined> {
  if (!track?.thumb) return undefined;
  const key = track.thumb;
  if (artCache.has(key)) return artCache.get(key);
  try {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    const loaded = new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = fail;
      img.src = art(track.thumb, 32) ?? track.thumb!;
    });
    // Never let an image load hang menu construction
    await Promise.race([loaded, new Promise((_, reject) => setTimeout(reject, 1200))]);

    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    // Crisp circular crop for macOS menu item icons
    ctx.beginPath();
    ctx.arc(8, 8, 8, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, 0, 0, 16, 16);
    const rgba = ctx.getImageData(0, 0, 16, 16).data;
    const tauriImg = await Image.new(new Uint8Array(rgba.buffer), 16, 16);

    if (artCache.size >= 20) {
      const [firstKey, firstVal] = artCache.entries().next().value ?? [];
      if (firstKey) {
        artCache.delete(firstKey);
        void firstVal?.close();
      }
    }
    artCache.set(key, tauriImg);
    return tauriImg;
  } catch {
    return undefined;
  }
}

// Fingerprint of the playback, queue and library state. Ignores continuous playback time so the menu
// only rebuilds when tracks, states or playlists actually change.
function getMenuFingerprint() {
  const s = useStore.getState();
  const track = s.queue[s.index];
  const liked = track ? useLibrary.getState().liked.some((l) => l.id === track.id) : false;
  const plCount = useLibrary.getState().playlists.length;
  const isPaused = audio.paused;
  return `${track?.id}:${track?.title}:${isPaused}:${s.shuffle}:${s.repeat}:${s.sleep}:${liked}:${s.queue.length}:${plCount}:${audio.volume}:${audio.muted}`;
}

async function buildMenu(): Promise<Menu> {
  const s = useStore.getState();
  const track = s.queue[s.index];
  const isPaused = audio.paused;
  const isLiked = track ? useLibrary.getState().liked.some((l) => l.id === track.id) : false;
  const upcoming = s.queue.slice(s.index + 1);
  const playlists = useLibrary.getState().playlists;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = [];

  // --- 1. Now Playing Header ---
  if (track) {
    const icon = await getTrackIcon(track);
    const titleText = track.title.length > 34 ? `${track.title.slice(0, 32)}…` : track.title;
    if (icon) {
      items.push(
        await IconMenuItem.new({
          id: "now_playing_title",
          text: titleText,
          icon,
          action: () => {
            show();
            toggleSheet("playing");
          },
        }),
      );
    } else {
      items.push({
        id: "now_playing_title",
        text: `${titleText}`,
        action: () => {
          show();
          toggleSheet("playing");
        },
      });
    }

    const artistNames = track.artists?.map((a) => a.name).join(", ") || "Unknown Artist";
    const meta = `${artistNames}${track.album ? ` • ${track.album}` : ""}`;
    const metaText = meta.length > 38 ? `${meta.slice(0, 36)}…` : meta;
    items.push({
      id: "now_playing_artist",
      text: `     ${metaText}`,
      action: () => {
        show();
        if (track.artists?.[0]?.id) open({ name: "artist", id: track.artists[0].id });
      },
    });

    if (track.duration) {
      items.push({
        id: "now_playing_duration",
        text: `     ⏱  ${track.duration}`,
        enabled: false,
      });
    }

    items.push({
      id: "toggle_like",
      text: isLiked ? "♥  Liked in Library" : "♡  Add to Liked Songs",
      action: () => toggleLike(track),
    });

    items.push({
      id: "open_lyrics",
      text: "Open Lyrics",
      action: () => {
        show();
        toggleSheet("lyrics");
      },
    });
  } else {
    items.push({
      id: "idle_title",
      text: "Nothing Playing",
      enabled: false,
    });
    items.push({
      id: "idle_play",
      text: "Open Sleeve & Play",
      action: show,
    });
  }

  items.push({ item: "Separator" });

  // --- 2. Playback Controls ---
  items.push({
    id: "toggle_playback",
    text: isPaused ? "▶  Play" : "⏸  Pause",
    action: () => void toggle(),
  });
  items.push({
    id: "next_track",
    text: "Next",
    action: next,
  });
  items.push({
    id: "prev_track",
    text: "Previous",
    action: prev,
  });

  items.push({ item: "Separator" });

  // --- 3. Collapsible Up Next Queue ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queueItems: any[] = [];
  if (upcoming.length === 0) {
    queueItems.push({ text: "Queue is empty", enabled: false });
  } else {
    const preview = upcoming.slice(0, 15);
    preview.forEach((t, i) => {
      const artNames = t.artists?.map((a) => a.name).join(", ") || "";
      const label = `${t.title} — ${artNames}${t.rec ? " ✨" : ""}`;
      const line = label.length > 40 ? `${label.slice(0, 38)}…` : label;
      queueItems.push({
        text: `${i + 1}.  ${line}`,
        action: () => void jump(s.index + 1 + i),
      });
    });
    if (upcoming.length > 15) {
      queueItems.push({ item: "Separator" });
      queueItems.push({
        text: `... and ${upcoming.length - 15} more in queue`,
        action: () => {
          show();
          useSettings.setState({ queue: true });
        },
      });
    }
    queueItems.push({ item: "Separator" });
    queueItems.push({
      text: "Clear Up Next",
      action: () => void clearQueue(),
    });
  }

  items.push({
    text: `Up Next (${upcoming.length})`,
    items: queueItems,
  });

  // --- 4. Modes & Audio Controls ---
  const sleepText = s.sleep ? (s.sleep === "track" ? " (At End)" : " (Active)") : "";
  items.push({
    text: "Modes & Audio",
    items: [
      {
        text: s.shuffle === "smart" ? "✨  Smart Shuffle (Active)" : s.shuffle ? "🔀  Shuffle (On)" : "🔀  Shuffle (Off)",
        action: () => void toggleShuffle(),
      },
      {
        text: s.repeat === "one" ? "🔂  Repeat: One" : s.repeat === "all" ? "🔁  Repeat: All" : "🔁  Repeat: Off",
        action: () => void cycleRepeat(),
      },
      { item: "Separator" },
      {
        text: `Volume (${Math.round((audio.muted ? 0 : audio.volume) * 100)}%)`,
        items: [
          { text: "100%", action: () => setVolume(1.0) },
          { text: "75%", action: () => setVolume(0.75) },
          { text: "50%", action: () => setVolume(0.5) },
          { text: "25%", action: () => setVolume(0.25) },
          { item: "Separator" },
          { text: audio.muted ? "🔊  Unmute" : "🔇  Mute", action: () => setMuted(!audio.muted) },
        ],
      },
      {
        text: `Sleep Timer${sleepText}`,
        items: [
          { text: s.sleep ? "Turn Off Sleep Timer" : "Off", action: () => sleepIn(undefined) },
          { item: "Separator" },
          { text: "In 15 Minutes", action: () => sleepIn(15) },
          { text: "In 30 Minutes", action: () => sleepIn(30) },
          { text: "In 45 Minutes", action: () => sleepIn(45) },
          { text: "In 1 Hour", action: () => sleepIn(60) },
          { text: "At End of Track", action: () => sleepIn("track") },
        ],
      },
    ],
  });

  // --- 5. Library & Playlists Submenu ---
  const liked = useLibrary.getState().liked;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const librarySubItems: any[] = [
    {
      text: `Liked Songs (${liked.length})`,
      action: () => {
        show();
        open({ name: "playlist", id: "liked" });
      },
    },
  ];

  if (playlists.length > 0) {
    const plItems = playlists.slice(0, 15).map((p) => ({
      text: `${p.name} (${p.tracks.length} songs)`,
      action: () => void play(p.tracks, 0, libraryKey("playlist", p.id)),
    }));
    librarySubItems.push({
      text: `Your Playlists (${playlists.length})`,
      items: plItems,
    });
  }

  librarySubItems.push(
    {
      text: "Listening History",
      action: () => {
        show();
        open({ name: "history" });
      },
    },
    {
      text: "Local Files",
      action: () => {
        show();
        open({ name: "local" });
      },
    },
  );

  items.push({
    text: "Library & Playlists",
    items: librarySubItems,
  });

  items.push({ item: "Separator" });

  // --- 6. Window & App Controls ---
  items.push({
    id: "toggle_mini",
    text: "Mini Player",
    action: () => void toggleMini(),
  });
  items.push({
    id: "show_sleeve",
    text: "Show Sleeve",
    action: show,
  });
  items.push({ item: "Separator" });
  items.push({
    id: "quit_sleeve",
    text: "Quit Sleeve",
    action: () => void win.destroy(),
  });

  return Menu.new({ items });
}

let activeTray: TrayIcon | undefined;
let activeMenu: Menu | undefined;
let unsubscribe: (() => void) | undefined;
let updating = false;
let queuedUpdate = false;
let lastFp = "";

async function refreshTray() {
  if (!activeTray) return;
  if (updating) {
    queuedUpdate = true;
    return;
  }
  updating = true;
  try {
    do {
      queuedUpdate = false;
      const s = useStore.getState();
      const track = s.queue[s.index];
      const isPaused = audio.paused;

      // Update macOS menu bar title and tooltip
      if (isMac) {
        const titlePart = track ? (track.title.length > 22 ? `${track.title.slice(0, 20)}…` : track.title) : "";
        const barTitle = track ? ` ${isPaused ? "⏸ " : ""}${titlePart}` : "";
        await activeTray.setTitle(barTitle).catch(() => {});
      }
      const artists = track?.artists?.map((a) => a.name).join(", ");
      const tip = track ? `${track.title} • ${artists}` : "Sleeve";
      await activeTray.setTooltip(tip).catch(() => {});

      // Build and apply the rich menu
      const nextMenu = await buildMenu();
      const oldMenu = activeMenu;
      await activeTray.setMenu(nextMenu);
      activeMenu = nextMenu;
      void oldMenu?.close();
    } while (queuedUpdate);
  } finally {
    updating = false;
  }
}

async function makeTray(): Promise<TrayIcon> {
  const initialMenu = await buildMenu();
  activeMenu = initialMenu;

  const icon = isMac
    ? await Image.fromPath(await resolveResource("icons/tray.png"))
    : (await defaultWindowIcon()) ?? undefined;

  const s = useStore.getState();
  const track = s.queue[s.index];
  const isPaused = audio.paused;
  const barTitle = isMac && track ? ` ${isPaused ? "⏸ " : ""}${track.title.slice(0, 20)}` : "";
  const tip = track ? `${track.title} • ${track.artists?.map((a) => a.name).join(", ")}` : "Sleeve";

  const tray = await TrayIcon.new({
    icon,
    iconAsTemplate: isMac,
    title: barTitle || undefined,
    tooltip: tip,
    menu: initialMenu,
  });

  activeTray = tray;
  lastFp = getMenuFingerprint();

  // Watch for state changes that affect the menu
  const check = () => {
    if (!activeTray) return;
    const fp = getMenuFingerprint();
    if (fp !== lastFp) {
      lastFp = fp;
      void refreshTray();
    }
  };

  const unStore = useStore.subscribe(check);
  const unLib = useLibrary.subscribe(check);
  const unAudio = subscribeAudio(check);
  unsubscribe = () => {
    unStore();
    unLib();
    unAudio();
  };

  return tray;
}

let trayPromise: Promise<TrayIcon> | undefined;

const applyTray = (on: boolean) => {
  if (on && !trayPromise) {
    trayPromise = makeTray();
  } else if (!on && trayPromise) {
    unsubscribe?.();
    unsubscribe = undefined;
    void trayPromise.then((t) => {
      void t.close();
      void activeMenu?.close();
      activeMenu = undefined;
      activeTray = undefined;
    });
    trayPromise = undefined;
  }
};

applyTray(useSettings.getState().closeToTray);
useSettings.subscribe((s, was) => s.closeToTray !== was.closeToTray && applyTray(s.closeToTray));

void win.onCloseRequested((e) => {
  if (!useSettings.getState().closeToTray) return;
  e.preventDefault();
  void win.hide();
});
