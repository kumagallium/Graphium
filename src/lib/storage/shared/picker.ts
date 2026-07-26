// shared root / blob root のフォルダ選択（Tauri 専用）

import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../../platform";

async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("Folder picker is desktop-only");
  }
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title,
  });
  if (!selected) return null;
  return typeof selected === "string" ? selected : null;
}

export function pickSharedRoot(defaultPath?: string): Promise<string | null> {
  return pickFolder("Select shared storage folder", defaultPath);
}

export function pickBlobRoot(defaultPath?: string): Promise<string | null> {
  return pickFolder("Select blob storage folder", defaultPath);
}

// モバイルキャプチャ Inbox の同期フォルダ（<root>/Inbox/ にモバイルがメディアを置く）を選ぶ。
export function pickInboxRoot(defaultPath?: string): Promise<string | null> {
  return pickFolder("Select mobile capture sync folder", defaultPath);
}
