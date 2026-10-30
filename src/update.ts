import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { version } from "../package.json";
import { notify, useSettings, useStore } from "./store";
// New versions come from the latest GitHub release (release.yml), signed so only ours install. Checked quietly
// at launch, every few hours, and from Settings → About. A small update (only the last number changes) downloads
// while you listen and goes in as you quit (lib.rs stage_update), unless Update Automatically is off. New features
// still ask: they wait at the top of the window (App.tsx), not as a toast, so they never sit on the player.
let found: Update | undefined;
let staged = "";
const offer = (u: Update) => useStore.setState({ update: { version: u.version, notes: u.body?.trim(), run: () => install(u) } });
const install = (u: Update) => (useStore.setState({ update: { version: u.version } }), (localStorage.updateNotes = u.body?.trim() ?? ""), u.downloadAndInstall().then(relaunch, () => (offer(u), notify({ warn: true, text: "The update didn't download. Try again later." }))));
const small = (v: string) => v.split(".").slice(0, 2).join() === version.split(".").slice(0, 2).join();
export async function checkForUpdate(): Promise<string> {
  found = (await check()) ?? found;
  if (!found) return "You're up to date.";
  const v = found.version;
  if (staged === v) return `Version ${v} installs when you quit Mixtape.`;
  if (!small(v) || !useSettings.getState().autoUpdate) return offer(found), `Version ${v} is out.`;
  await invoke("stage_update", { version: v }).catch(() => (offer(found!), Promise.reject()));
  (staged = v), (localStorage.updateNotes = found.body?.trim() ?? "");
  return `Version ${v} installs when you quit Mixtape.`;
}
// The first launch after one went in.
export function sayUpdated() {
  const was = localStorage.ranVersion;
  localStorage.ranVersion = version;
  if (!was || was === version) return;
  const notes = localStorage.updateNotes as string | undefined;
  delete localStorage.updateNotes;
  notify({ text: `Updated to Mixtape ${version}`, ...(notes && { action: { label: "What's New", run: () => useStore.setState({ update: { version, notes, done: true }, dialog: { kind: "update" } }) } }) });
}
