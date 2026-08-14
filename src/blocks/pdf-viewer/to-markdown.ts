// PDF ビューア → Markdown（純ロジック）
//
// PDF 本体は持ち出せないので、ファイル名リンク 1 行に落とす。
// URL はアプリ内スキーム（local-media:// 等）のこともあるため、外部で解決できる
// 保証はない。それでも「どのファイルを見ていたか」は残す。

import { linkParagraph, type BlockToMarkdown } from "../markdown-block";

export const pdfViewerToMarkdown: BlockToMarkdown = (block, ctx) => {
  const props = block.props ?? {};
  const label = String(props.name || props.url || "PDF");
  return [linkParagraph(label, props.url || undefined, ctx.children)];
};
