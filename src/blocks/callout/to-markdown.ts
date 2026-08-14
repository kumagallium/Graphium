// Callout → Markdown（純ロジック）
//
// 枠・アイコン・バリアント色は視覚情報なので捨て、本文だけを段落として残す。

import { inlineParagraph, type BlockToMarkdown } from "../markdown-block";

export const calloutToMarkdown: BlockToMarkdown = (_block, ctx) => [
  inlineParagraph(ctx.inlines, ctx.children),
];
