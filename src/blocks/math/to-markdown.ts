// 数式ブロック → Markdown（純ロジック）
//
// 数式は「見た目」ではなく内容なので、描画結果ではなく LaTeX ソースを残す。
// $$ ... $$ にしておけば他の Markdown ツールでもそのまま数式として読める。

import { mathBlockToMarkdown } from "../../features/math/markdown-math";
import { textParagraph, type BlockToMarkdown } from "../markdown-block";

export const mathToMarkdown: BlockToMarkdown = (block, ctx) => {
  const md = mathBlockToMarkdown(String(block.props?.latex ?? ""));
  return [textParagraph(md, {}, ctx.children)];
};
