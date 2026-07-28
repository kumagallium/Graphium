// inbox ファイル名の拡張子から MIME を推定する。
//
// inbox のファイルは名前を持つので拡張子を優先する。判定不能時は importer 側で
// マジックバイト sniff(materialize-blobs の sniffMimeType)にフォールバックする。
// iPhone のカメラ/ボイスメモ由来(heic / mov / m4a / caf)を含める。

import { GRAPHIUM_CAPTURE_MIME, isGraphiumCaptureName } from "./capture-file";
import type { CaptureKind } from "./types";

const EXT_TO_MIME: Record<string, string> = {
  // 画像
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  // 動画
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  // 音声(iOS ボイスメモ = m4a / caf)
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  caf: "audio/x-caf",
  // その他
  pdf: "application/pdf",
};

/** ファイル名の拡張子から MIME を返す。未知/拡張子なしは null。 */
export function mimeFromExtension(filename: string): string | null {
  // Graphium ネイティブ捕獲ファイル（メモ / URL の JSON）は複合拡張子
  // `.graphium.json` なので、単一拡張子の表より先にフルネームで判定する。
  // 汎用の `.json` はここに載せない（無関係な JSON を乗っ取らない）。
  if (isGraphiumCaptureName(filename)) return GRAPHIUM_CAPTURE_MIME;
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * MIME の先頭セグメントから CaptureKind を導出する。
 * image/audio/video 以外（pdf 等）は分類対象外として undefined を返す。
 */
export function kindFromMime(mime: string): CaptureKind | undefined {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return undefined;
}
