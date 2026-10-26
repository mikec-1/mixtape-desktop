import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { notify } from "./store";

// New versions come from the latest GitHub release (release.yml), signed so only ours install. Checked
// quietly at launch and from Settings → About; one found is downloaded first, then offered as a restart.
let ready: string | undefined;
export async function checkForUpdate(): Promise<string> {
  if (ready) return `Version ${ready} is ready.`;
  const u = await check();
  if (!u) return "You're up to date.";
  await u.downloadAndInstall();
  ready = u.version;
  notify({ text: `Mixtape ${u.version} is ready`, sticky: true, action: { label: "Restart to Update", run: () => void relaunch() } });
  return `Version ${u.version} is ready.`;
}
