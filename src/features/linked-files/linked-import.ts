// リンクした素材（データの置き場のファイル）を「表に取り込む」ための道具。
//
// 中身を読むのは利用者が押したときだけ。読んだ本文は取り込み画面に渡すだけで、
// 素材としては登録しない（コピーを作らない）。取り込んだ時点の大きさ・更新日時を表の出所に
// 残し、あとで元が変わっていれば知らせる。

import { readDataFileText } from "../data-import/read-file";
import { readMediaIndex, type MediaLink } from "../asset-browser/media-index";
import type { TableSource } from "../../lib/document-types";
import { sanitizeMediaLink } from "./link-url";
import { PLACE_READ_NOT_REFERENCED, listPlaces, readLinkedFile, statLinks } from "./places";
import { t } from "../../i18n";

/** 表に取り込める拡張子（Rust 側 place_read_file の data 許可リストと同じ） */
const IMPORTABLE_EXTS = ["csv", "tsv", "txt", "dat"];

/** その名前のリンクした素材を「表に取り込む」対象にするか */
export function isLinkedDataImportable(name: string): boolean {
  const m = name.toLowerCase().match(/\.([^./\\]+)$/);
  return !!m && IMPORTABLE_EXTS.includes(m[1]);
}

/** LinkedFileView → note-app への「取り込み画面を開いて」の合図（素材ピークは note-app の外にあるため） */
export const LINKED_DATA_IMPORT_EVENT = "graphium:linked-data-import";

export type LinkedImportRequest = {
  fileId: string;
  name: string;
  placeId: string;
  relPath: string;
  /** 受け付けた（読み終えた）・受け付けなかったときに呼ぶ。押したボタンを押せるように戻すため */
  onSettled?: () => void;
};

export function requestLinkedDataImport(req: LinkedImportRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LinkedImportRequest>(LINKED_DATA_IMPORT_EVENT, { detail: req }));
}

export type LinkedText = { text: string; size: number; mtimeMs: number };

/**
 * 区切りファイルを本文として読む。読む直前の大きさ・更新日時も一緒に返す（表の出所に残す）。
 * 失敗は投げる（呼び出し側が readErrorMessageKey で文言にする）
 */
export async function readLinkedText(placeId: string, relPath: string): Promise<LinkedText> {
  const [stat] = await statLinks([{ placeId, relPath }]);
  const buf = await readLinkedFile(placeId, relPath, "data");
  const text = await readDataFileText(new Blob([buf]));
  return { text, size: stat?.size ?? buf.byteLength, mtimeMs: stat?.mtimeMs ?? 0 };
}

/**
 * 素材の fileId がリンクした素材ならその控えを返す。普通の素材・見つからないときは null。
 * noteId を渡すと、そのノートが使っている素材（usedIn に載っている）のときだけ返し、そうでなければ投げる
 * （表の出所の fileId は共有されたノートなどで書き換えられうる。別のリンクを読み直させない）
 */
export async function findLinkOf(fileId: string, noteId?: string): Promise<MediaLink | null> {
  const index = await readMediaIndex();
  const entry = index?.media.find((m) => m.fileId === fileId);
  const link = entry ? sanitizeMediaLink(entry.link) : null;
  if (link && noteId !== undefined && !entry!.usedIn.some((u) => u.noteId === noteId)) {
    throw new Error(PLACE_READ_NOT_REFERENCED);
  }
  return link;
}

/** 取り込み画面に出す「読んだファイル: 置き場の名前 / 場所」。置き場の名前が引けなければ id を出す */
export async function readFromLabel(placeId: string, relPath: string): Promise<string> {
  let place = placeId;
  try {
    place = (await listPlaces()).find((p) => p.id === placeId)?.name ?? placeId;
  } catch {
    // 名前が引けなくても、場所は出す
  }
  return t("linkedFile.read.readFrom", { place, path: relPath });
}

/** 表の出所が覚えている、取り込んだ時点の元ファイルの大きさ・更新日時（リンクした素材から取り込んだときだけ） */
export function linkedSnapshotOf(source: TableSource): { size: number; mtimeMs: number } | null {
  const d = source.derivation;
  if (d && typeof d.fromSize === "number" && typeof d.fromMtimeMs === "number") {
    return { size: d.fromSize, mtimeMs: d.fromMtimeMs };
  }
  if (source.linkedStat) return source.linkedStat;
  return null;
}

/** 元のファイルの fileId（絞り込んだ表は写しではなく元の側） */
export function linkedOriginFileIdOf(source: TableSource): string | undefined {
  return source.derivation ? source.derivation.fromFileId : source.fileId;
}

/** 取り込んだ時点から元データが変わっているか。調べられない（置き場に届かない等）ときは false */
export async function isLinkedSourceChanged(source: TableSource): Promise<boolean> {
  const snap = linkedSnapshotOf(source);
  const fileId = linkedOriginFileIdOf(source);
  if (!snap || !fileId) return false;
  const link = await findLinkOf(fileId);
  if (!link) return false;
  const [stat] = await statLinks([{ placeId: link.placeId, relPath: link.relPath }]);
  if (!stat || stat.state !== "ok") return false;
  return stat.size !== snap.size || stat.mtimeMs !== snap.mtimeMs;
}
