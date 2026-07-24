// カスタムブロックレジストリ
// 新しいカスタムブロックを追加するときはこのファイルに登録すれば、
// メインエディタ（NoteEditor）と SidePeek の両方で自動的に表示・編集可能になる。
//
// 過去に side-peek.tsx だけ KNOWN_BLOCK_TYPES から取りこぼし、
// Peek を開いた瞬間にカスタムブロックが除去されたまま自動保存されて
// データが壊れる不具合が起きたため、登録漏れを構造的に防ぐ目的で集約する。

import type { CustomBlockEntry } from "../base/schema";
import { pdfViewerBlock } from "./pdf-viewer";
import { bookmarkBlock } from "./bookmark";
import { calloutBlock } from "./callout";
import { imageOcrBlock } from "./image-ocr";

export const customBlockEntries: CustomBlockEntry[] = [
  pdfViewerBlock,
  bookmarkBlock,
  calloutBlock,
  imageOcrBlock,
];

export const CUSTOM_BLOCK_TYPES: ReadonlySet<string> = new Set(
  customBlockEntries.map((b) => b.type),
);
