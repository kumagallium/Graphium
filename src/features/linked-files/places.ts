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
/** ファイル選択の結果。failed は届かなかった・ファイルでなかった件数 */
export type PickedFiles = { files: PickedFile[]; failed: number };
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

/** 進行中の呼び出しがあれば同じ Promise を返す（終わったら・失敗したら消す）。 */
let listInFlight: Promise<PlaceInfo[]> | null = null;

export function listPlaces(): Promise<PlaceInfo[]> {
  if (!isTauri()) return Promise.resolve([]);
  if (listInFlight) return listInFlight;
  const p = invoke<PlaceInfo[]>("place_list").finally(() => {
    if (listInFlight === p) listInFlight = null;
  });
  listInFlight = p;
  return p;
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

/** Rust がファイル選択（複数選択できる）を開く。キャンセルは null。 */
export async function pickPlaceFiles(): Promise<PickedFiles | null> {
  if (!isTauri()) return desktopOnly();
  return invoke<PickedFiles | null>("place_pick_files");
}

const statInFlight = new Map<string, Promise<LinkStat[]>>();

/** 大きさと更新日時をまとめて見る。結果は items と同じ順。同じ引数で進行中なら同じ Promise を返す。 */
export function statLinks(items: { placeId: string; relPath: string }[]): Promise<LinkStat[]> {
  if (!isTauri()) return Promise.resolve(items.map(() => ({ state: "unregistered" as const })));
  const key = JSON.stringify(items.map((i) => [i.placeId, i.relPath]));
  const running = statInFlight.get(key);
  if (running) return running;
  const p = statLinksNow(items).finally(() => {
    if (statInFlight.get(key) === p) statInFlight.delete(key);
  });
  statInFlight.set(key, p);
  return p;
}

async function statLinksNow(items: { placeId: string; relPath: string }[]): Promise<LinkStat[]> {
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

/** 読む目的。preview = PDF・画像を見せる、data = 区切りファイルを表に取り込む（Rust 側の許可リストと対） */
export type LinkedReadPurpose = "preview" | "data";

/** Rust 側 place_read_file が種類を理由に断るときの Err の接頭辞（形は `PLACE_READ_NOT_ALLOWED:<拡張子>`） */
export const PLACE_READ_NOT_ALLOWED_PREFIX = "PLACE_READ_NOT_ALLOWED";
/** 大きすぎて断るときの Err の接頭辞（形は `PLACE_READ_TOO_LARGE:<上限バイト数>`） */
export const PLACE_READ_TOO_LARGE_PREFIX = "PLACE_READ_TOO_LARGE";

/**
 * 利用者が開いたときだけ、置き場の 1 ファイルの中身を読む（コピー・キャッシュは作らない）。
 * 呼ぶのは「中身を表示」「表に取り込む」「取り込み直し」の操作の中だけ。自動では呼ばない。
 */
export async function readLinkedFile(
  placeId: string,
  relPath: string,
  purpose: LinkedReadPurpose,
): Promise<ArrayBuffer> {
  if (!isTauri()) return desktopOnly();
  return invoke<ArrayBuffer>("place_read_file", { placeId, relPath, purpose });
}

/**
 * 読めなかった理由を、利用者向け文言のキーと差し込み値にする。
 * 到達できない・見つからない・未登録は Rust 側の既存メッセージ（place_open と同じ）で見分ける。
 */
export function readErrorMessageKey(e: unknown): { key: string; params?: Record<string, string> } {
  const text = e instanceof Error ? e.message : String(e);
  if (text.startsWith(`${PLACE_READ_NOT_ALLOWED_PREFIX}:`)) {
    return { key: "linkedFile.read.notAllowed", params: { ext: text.slice(PLACE_READ_NOT_ALLOWED_PREFIX.length + 1) } };
  }
  if (text.startsWith(`${PLACE_READ_TOO_LARGE_PREFIX}:`)) {
    const max = Number(text.slice(PLACE_READ_TOO_LARGE_PREFIX.length + 1));
    return {
      key: "linkedFile.read.tooLarge",
      params: { max: Number.isFinite(max) ? String(Math.round(max / (1024 * 1024))) : "" },
    };
  }
  if (text.includes("届きません")) return { key: "linkedFile.read.unreachable" };
  if (text.includes("見つかりません")) return { key: "linkedFile.read.missing" };
  if (text.includes("登録されていません")) return { key: "linkedFile.read.unregistered" };
  return { key: "linkedFile.read.failed" };
}
