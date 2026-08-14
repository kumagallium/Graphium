// URL ブックマークカード → Markdown（純ロジック）
//
// カード（OGP 画像・説明・favicon）は視覚情報なので捨て、リンク 1 行に落とす。

import { linkParagraph, type BlockToMarkdown } from "../markdown-block";

export const bookmarkToMarkdown: BlockToMarkdown = (block, ctx) => {
  const props = block.props ?? {};
  const label = String(props.title || props.domain || props.url || "");
  return [linkParagraph(label, props.url || undefined, ctx.children)];
};
