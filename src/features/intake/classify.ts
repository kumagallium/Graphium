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
    if (mimeToMediaType(f.file.type, f.file.name) !== "other") {
      materials.push(f);
      continue;
    }
    skipped.push(f);
  }

  return { notes, materials, skipped };
}
