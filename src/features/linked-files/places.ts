// データの置き場の Tauri コマンドの薄い包み。
// 置き場の絶対パスは Rust 側だけが持つ。ここでは id と相対パスしか扱わない。

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/platform";

export type PlaceInfo = { id: string; name: string; root: string; reachable: boolean; shared: boolean };
export type PickedFile = {
  /** null = どの置き場の中でもない */
  placeId: string | null;
  relPath: string | null;
  name: string;
  size: number;
  mtimeMs: number;
};
export type LinkStat = {
  state: "ok" | "missing" | "unreachable" | "unregistered";
  size?: number;
  mtimeMs?: number;
};

/** place_stat_many 1 回で渡す最大件数（Rust 側の上限） */
export const STAT_CHUNK = 2000;

function desktopOnly(): never {
  throw new Error("desktop only");
}

export async function listPlaces(): Promise<PlaceInfo[]> {
  if (!isTauri()) return [];
  return invoke<PlaceInfo[]>("place_list");
}

/** Rust がフォルダ選択を開く。キャンセルは null。 */
export async function registerPlace(): Promise<PlaceInfo | null> {
  if (!isTauri()) return desktopOnly();
  return invoke<PlaceInfo | null>("place_register");
}

export async function renamePlace(id: string, name: string): Promise<PlaceInfo> {
  if (!isTauri()) return desktopOnly();
  return invoke<PlaceInfo>("place_rename", { id, name });
}

/** 登録を外すだけ（目印もファイルも消さない）。 */
export async function removePlace(id: string): Promise<void> {
  if (!isTauri()) return desktopOnly();
  await invoke<void>("place_remove", { id });
}

/** Rust がファイル選択を開く。キャンセルは null。 */
export async function pickPlaceFile(): Promise<PickedFile | null> {
  if (!isTauri()) return desktopOnly();
  return invoke<PickedFile | null>("place_pick_file");
}

/** 大きさと更新日時をまとめて見る。結果は items と同じ順。 */
export async function statLinks(items: { placeId: string; relPath: string }[]): Promise<LinkStat[]> {
  if (!isTauri()) return items.map(() => ({ state: "unregistered" as const }));
  const out: LinkStat[] = [];
  for (let i = 0; i < items.length; i += STAT_CHUNK) {
    const part = await invoke<LinkStat[]>("place_stat_many", { items: items.slice(i, i + STAT_CHUNK) });
    out.push(...part);
  }
  return out;
}

export async function openLinkedFile(placeId: string, relPath: string): Promise<void> {
  if (!isTauri()) return desktopOnly();
  await invoke<void>("place_open", { placeId, relPath });
}

export async function revealLinkedFile(placeId: string, relPath: string): Promise<void> {
  if (!isTauri()) return desktopOnly();
  await invoke<void>("place_reveal", { placeId, relPath });
}
