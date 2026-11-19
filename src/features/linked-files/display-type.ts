// リンクした素材を「どの種類の一覧に並べるか」。
// 索引の type は "url" のまま（実体の無い素材として安全に扱うため）。
// 一覧の振り分けと件数だけ、ファイル名の拡張子から決めた種類を使う。
// 「実体が無い」の判断（削除・ダウンロード・共有・ハッシュ・OCR など）は entry.type を見続けること。

import { mimeToMediaType, type MediaIndexEntry, type MediaType } from "../asset-browser/media-index";
import { isLinkedEntry, isPlaceUrl } from "./link-url";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** 拡張子（小文字・ドット無し）→ MIME。素材の種類判定に必要なものだけ。 */
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: DOCX,
  doc: "application/msword",
  xlsx: XLSX,
  xls: "application/vnd.ms-excel",
  pptx: PPTX,
  ppt: "application/vnd.ms-powerpoint",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  heic: "image/heic",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  aac: "audio/aac",
};

function mimeFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return EXT_MIME[name.slice(dot + 1).toLowerCase()] ?? "";
}

/**
 * 一覧の種類ごとの振り分け・件数に使う種類。
 * リンクした素材は拡張子から決める（決まらなければ "url" のまま）。それ以外は entry.type。
 */
export function displayTypeOf(entry: MediaIndexEntry): MediaType {
  if (!isLinkedEntry(entry)) return entry.type;
  const type = mimeToMediaType(mimeFromFileName(entry.name), entry.name);
  return type === "other" ? "url" : type;
}

/** 種類の判定（Word/Excel/PowerPoint の絞り込み）に使う MIME。リンクした素材は拡張子から補う。 */
export function displayMimeOf(entry: MediaIndexEntry): string {
  if (!isLinkedEntry(entry)) return entry.mimeType;
  return mimeFromFileName(entry.name) || entry.mimeType;
}

/**
 * 素材の一覧（種類ごと）にその素材が並ぶか。アーカイブの除外は呼び出し側で行う。
 * ドキュメントの一覧には PDF も含める（UI 上の統合。内部の type は維持）。
 */
export function isInMediaList(entry: MediaIndexEntry, listType: MediaType): boolean {
  const shown = displayTypeOf(entry);
  if (listType !== "document") return shown === listType;
  return shown === "document" || shown === "pdf";
}

/**
 * 素材ピッカーで選んだときの挿入の形。
 * リンクした素材（置き場のファイル）は中身を読めないので、画像・PDF・データ表の取り込みにはせず、
 * 常に @名前 のリンクとして入れる（URL の素材と同じ "link"）。控えが壊れた置き場の URL も同じ。
 */
export function resolvePickerDisplayMode(
  entry: MediaIndexEntry,
  requested: "embed" | "link",
): "embed" | "link" {
  if (entry.type === "url" && isPlaceUrl(entry.url)) return "link";
  return requested;
}
