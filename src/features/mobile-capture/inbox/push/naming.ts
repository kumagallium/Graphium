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

import {
  GRAPHIUM_CAPTURE_EXTENSION,
  captureKindFromName,
  isGraphiumCaptureName,
} from "../capture-file";

/**
 * 送信名にフォルダを埋め込むときの区切り。正規化後の名前は
 * `graphium-<日時>-<連番>` なので、この並びには現れない。
 */
const FOLDER_MARK = "~~";

/**
 * フォルダ名を送信名に埋め込める形にする。`/`（サブフォルダ）や日本語をそのまま
 * ファイル名に置けないので URL エンコードする。
 */
function encodeFolderSegment(folder: string): string {
  return encodeURIComponent(folder.trim());
}

/**
 * 送信名からフォルダを取り出し、フォルダ抜きの名前と一緒に返す。
 * 埋め込みが無ければ folder は undefined、name はそのまま。
 *
 * 受信側はこれで「素材の名前」と「入れるフォルダ」を分ける — 名前にエンコード済みの
 * 文字列が残ったままだと、素材一覧に読めない名前が並んでしまう。
 */
export function parseInboxFolder(name: string): { folder?: string; name: string } {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const at = base.lastIndexOf(FOLDER_MARK);
  if (at < 0) return { name };
  const encoded = base.slice(at + FOLDER_MARK.length);
  if (!encoded) return { name: base.slice(0, at) + ext };
  let folder: string | undefined;
  try {
    folder = decodeURIComponent(encoded).trim() || undefined;
  } catch {
    // 壊れたエンコードは「フォルダ指定なし」として扱う（取り込み自体は通す）
    folder = undefined;
  }
  return { folder, name: base.slice(0, at) + ext };
}

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
  // 音声（iOS ボイスメモ = m4a / caf、アプリ内録音 = m4a / weba / oga）。
  // webm / ogg は動画コンテナと拡張子を共有するので、音声側は `.weba` / `.oga`
  // （MDN の音声用拡張子）に寄せる — 受信側は拡張子だけで音声だと判る。
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/aac": "aac",
  "audio/x-caf": "caf",
  "audio/webm": "weba",
  "audio/ogg": "oga",
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
  /**
   * 入れるフォルダ（任意）。生のメディアにはメタを運ぶ経路が無いので名前に埋め込む。
   * メモ / URL は JSON の中に持たせるため、ここでは付けない。
   */
  folder?: string;
}): string {
  const stamp = formatCaptureTimestamp(opts.when);
  const seq = String(opts.seq).padStart(2, "0");
  if (isGraphiumCaptureName(opts.originalName)) {
    const kind = captureKindFromName(opts.originalName) ?? "capture";
    return `graphium-${stamp}-${seq}-${kind}${GRAPHIUM_CAPTURE_EXTENSION}`;
  }
  const ext = extensionForCapture(opts.mime, opts.originalName);
  const folder = opts.folder?.trim();
  const mark = folder ? `${FOLDER_MARK}${encodeFolderSegment(folder)}` : "";
  return `graphium-${stamp}-${seq}${mark}.${ext}`;
}
