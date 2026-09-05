// 投入口に集まったファイルの仕分け
//
// 「ノートになるもの（Markdown）」「素材になるもの（PDF/画像/CSV 等）」
// 「対象外（隠しファイル・未対応形式）」の 3 群に分ける。判定ロジック自体は
// markdown-import / asset-browser の既存関数を再利用し、ここでは並び替えのみ行う。

import { isMarkdownFile } from "../markdown-import/import";
import { mimeToMediaType } from "../asset-browser/media-index";
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
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
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
    if (isMarkdownFile(f.file)) {
      notes.push(f);
      continue;
    }
    if (mimeToMediaType(f.file.type || guessMimeType(f.file.name), f.file.name) !== "other") {
      materials.push(f);
      continue;
    }
    skipped.push(f);
  }

  return { notes, materials, skipped };
}
