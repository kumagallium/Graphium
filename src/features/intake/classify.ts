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
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
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
    if (isMarkdownFile(f.file)) {
      notes.push(f);
      continue;
    }
    const mime = f.file.type || guessMimeType(f.file.name);
    const mediaType = mimeToMediaType(mime, f.file.name);
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
