import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { notify, useStore } from "./store";

// New versions come from the latest GitHub release (release.yml), signed so only ours install. Checked
// quietly at launch and from Settings → About; nothing downloads until you say Update. It waits at the
// top of the window (App.tsx), not as a toast, so it never sits on the player or gets replaced.
let found: Update | undefined;
const offer = (u: Update) => useStore.setState({ update: { version: u.version, notes: u.body?.trim(), run: () => install(u) } });
const install = (u: Update) => (useStore.setState({ update: { version: u.version } }), u.downloadAndInstall().then(relaunch, () => (offer(u), notify({ warn: true, text: "The update didn't download. Try again later." }))));
export async function checkForUpdate(): Promise<string> {
  found ??= (await check()) ?? undefined;
  if (!found) return "You're up to date.";
  offer(found);
  return `Version ${found.version} is out.`;
}
