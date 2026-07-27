// Inbox へ送るファイル名の正規化。
//
// iOS の file input / カメラは `image.jpg` のような汎用名を返すことがあり、
// Inbox はフラットな 1 ディレクトリなので、`graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>`
// に付け替えてから送る（設計: docs/internal/mobile-capture-transport-design-2026-07.md §13.5）。
// 拡張子は **MIME 優先**（元名は当てにならない）。MIME が未知のときだけ元名の
// 拡張子にフォールバックし、それも無ければ "bin"。
//
// 注意: 同名衝突は致命ではない（Drive は同名ファイルを許容し、デスクトップの
// 取り込みは checksum で重複排除する）ので、秒単位のタイムスタンプ + 連番で足りる。
// 設計 §13.5 の share-to-inbox（Web Share 経路）は未着地なので、正規化の実体は
// この push/ に置く。Web Share 経路を実装するときはここから import して共用する。

import {
  GRAPHIUM_CAPTURE_EXTENSION,
  captureKindFromName,
  isGraphiumCaptureName,
} from "../capture-file";

// MIME → 正規拡張子。inbox/mime.ts の EXT_TO_MIME と対で保守する
//（iPhone カメラ/ボイスメモ由来の heic / mov / m4a / caf を含む）。
const MIME_TO_EXT: Record<string, string> = {
  // 画像
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  // 動画
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  // 音声（iOS ボイスメモ = m4a / caf）
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/aac": "aac",
  "audio/x-caf": "caf",
  // その他
  "application/pdf": "pdf",
};

/** 元ファイル名から拡張子を取り出す（小文字化・英数のみ・8 文字以下）。無効なら null。 */
function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
  return ext;
}

/**
 * 送信ファイルの拡張子を決める。MIME 優先 → 元名の拡張子 → "bin"。
 * MIME の codecs パラメータ等（`video/mp4;codecs=...`）は無視する。
 */
export function extensionForCapture(mime: string, originalName: string): string {
  const bare = mime.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXT[bare] ?? extensionFromName(originalName) ?? "bin";
}

/** タイムスタンプ部 `YYYYMMDD-HHmmss`（ローカル時刻 — ユーザーの体感の撮影時刻に合わせる）。 */
export function formatCaptureTimestamp(when: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}` +
    `-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`
  );
}

/**
 * 正規化した Inbox ファイル名 `graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>` を作る。
 * seq は 1 始まり・2 桁ゼロ詰め（100 以上はそのまま）。
 *
 * Graphium ネイティブ捕獲ファイル（メモ / URL の JSON。capture-file.ts）は
 * 専用形 `graphium-<YYYYMMDD-HHmmss>-<連番>-<kind>.graphium.json` にする —
 * kind を名前に残すことで、受信側が中身を読む前にアイコンを出せ、
 * `.graphium.json` の専用拡張子が汎用 `.json` との誤爆を防ぐ。
 */
export function normalizeCaptureName(opts: {
  mime: string;
  originalName: string;
  when: Date;
  seq: number;
}): string {
  const stamp = formatCaptureTimestamp(opts.when);
  const seq = String(opts.seq).padStart(2, "0");
  if (isGraphiumCaptureName(opts.originalName)) {
    const kind = captureKindFromName(opts.originalName) ?? "capture";
    return `graphium-${stamp}-${seq}-${kind}${GRAPHIUM_CAPTURE_EXTENSION}`;
  }
  const ext = extensionForCapture(opts.mime, opts.originalName);
  return `graphium-${stamp}-${seq}.${ext}`;
}
