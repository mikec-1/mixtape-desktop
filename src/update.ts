import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { notify } from "./store";

// New versions come from the latest GitHub release (release.yml), signed so only ours install. Checked
// quietly at launch and from Settings → About; nothing downloads until you say Update.
let found: Update | undefined;
const install = (u: Update) => (notify({ text: `Updating to ${u.version}…` }), u.downloadAndInstall().then(relaunch, () => notify({ text: "The update didn't download. Try again later." })));
export async function checkForUpdate(): Promise<string> {
  found ??= (await check()) ?? undefined;
  if (!found) return "You're up to date.";
  const u = found;
  notify({ text: `Mixtape ${u.version} is out`, sticky: true, action: { label: "Update", run: () => void install(u) } });
  return `Version ${u.version} is out.`;
}
