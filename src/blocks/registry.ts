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
import { stepBlock } from "./step";

export const customBlockEntries: CustomBlockEntry[] = [
  pdfViewerBlock,
  bookmarkBlock,
  calloutBlock,
  stepBlock,
];

export const CUSTOM_BLOCK_TYPES: ReadonlySet<string> = new Set(
  customBlockEntries.map((b) => b.type),
);

// BlockNote 標準ブロック型（このアプリのスキーマで使うもの）
const DEFAULT_BLOCK_TYPES = [
  "paragraph", "heading", "bulletListItem", "numberedListItem",
  "checkListItem", "table", "image", "video", "audio", "file",
  "codeBlock", "quote",
] as const;

// 保存済みノートを読み込むときに「知っているブロック型」の集合。
// note-app.tsx / side-peek.tsx の sanitizeBlocks が、これに無いブロックを
// 除去して自動保存するため、カスタムブロックの登録漏れは即データ損失になる。
// 両ファイルで別々に組み立てると片方が取りこぼすので（実際に side-peek で
// 発生した）、ここ 1 箇所に集約する。
export const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...DEFAULT_BLOCK_TYPES,
  ...CUSTOM_BLOCK_TYPES,
]);
