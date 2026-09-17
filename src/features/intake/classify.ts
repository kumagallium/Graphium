// 投入口に集まったファイルの仕分け
//
// 「ノートになるもの（Markdown）」「素材になるもの（PDF/画像/CSV 等）」
// 「対象外（隠しファイル・未対応形式）」の 3 群に分ける。判定ロジック自体は
// markdown-import / asset-browser の既存関数を再利用し、ここでは並び替えのみ行う。
//
// 受け皿の約束は「Markdown はノートに、PDF・Office・画像・CSV は素材になります」の
// 1 文。PowerPoint (.pptx) と Excel (.xlsx) は Word (.docx) と同じく素材として
// 登録し、run-intake 側で office-import（pptx.ts / xlsx.ts）による展開まで行う。
// 旧形式（.doc / .xls / .ppt）はバイナリ形式で展開が効かないため引き続き対象外
// （件数だけ見せる）。

import { isMarkdownFile } from "../markdown-import/import";
import { DELIMITED_EXTENSIONS } from "../data-import/file-kind";
import { mimeToMediaType, isModernOfficeEntry } from "../asset-browser/media-index";
import type { IntakeFile } from "./types";

export type ClassifiedIntakeFiles = {
  notes: IntakeFile[];
  materials: IntakeFile[];
  skipped: IntakeFile[];
};

/** path のいずれかのセグメントがドット始まりか（.obsidian, .git, .DS_Store 等） */
function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

// 拡張子 → MIME の最小限の対応表。ドロップ由来の File は環境によって
// file.type が空文字になることがあり、その場合に mimeToMediaType へ渡す
// フォールバックとして使う
const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  // ここから下の画像・音声・動画は、ブラウザなら File.type が付くので
  // 元は要らなかったもの。デスクトップのネイティブ走査（native-scan.ts）は
  // MIME を持たないため、ここに無いと素材と判定されず捨てられてしまう
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  avif: "image/avif",
  heif: "image/heif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  wmv: "video/x-ms-wmv",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

/** ファイル名の拡張子から MIME タイプを推定する。不明なら空文字を返す */
export function guessMimeType(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "";
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "";
}

export function classifyIntakeFiles(files: IntakeFile[]): ClassifiedIntakeFiles {
  const notes: IntakeFile[] = [];
  const materials: IntakeFile[] = [];
  const skipped: IntakeFile[] = [];

  for (const f of files) {
    if (isHiddenPath(f.path)) {
      skipped.push(f);
      continue;
    }
    if (isMarkdownFile(f)) {
      notes.push(f);
      continue;
    }
    const mime = f.type || guessMimeType(f.name);
    const mediaType = mimeToMediaType(mime, f.name);
    // "document" は Word/Excel/PowerPoint をまとめた型だが、ちゃんと展開できるのは
    // .docx / .pptx / .xlsx まで。旧バイナリ形式（.doc / .xls / .ppt）はここで弾く
    if (
      mediaType === "pdf" ||
      mediaType === "image" ||
      mediaType === "audio" ||
      mediaType === "video" ||
      mediaType === "data" ||
      (mediaType === "document" && isModernOfficeEntry({ type: mediaType, mimeType: mime }))
    ) {
      materials.push(f);
      continue;
    }
    skipped.push(f);
  }

  return { notes, materials, skipped };
}

/**
 * 投入口が受け取る拡張子（小文字・ドット無し）。デスクトップのネイティブ走査は
 * この一覧を Rust に渡し、当たらないファイルは読み込み許可にも載せずに件数だけ数える。
 *
 * 手で書いた表ではなく classifyIntakeFiles 自身に通して導く。表を 2 つ持つと
 * 対応形式を増やしたときに片方だけ更新され、ネイティブ走査だけが黙って
 * ファイルを落とす（MIME を持たない走査で動画が捨てられていた件と同じ型の事故）。
 */
export const INTAKE_EXTENSIONS: readonly string[] = (() => {
  const candidates = new Set<string>([
    "md",
    "markdown",
    ...Object.keys(EXTENSION_TO_MIME),
    ...DELIMITED_EXTENSIONS.map((ext) => ext.replace(/^\./, "")),
  ]);
  return [...candidates].filter((ext) => {
    const name = `x.${ext}`;
    const probe: IntakeFile = {
      path: name,
      name,
      type: "",
      getFile: () => Promise.reject(new Error("probe")),
    };
    return classifyIntakeFiles([probe]).skipped.length === 0;
  });
})();
