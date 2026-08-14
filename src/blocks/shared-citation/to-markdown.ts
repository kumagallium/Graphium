// shared:// 引用カード → Markdown（純ロジック）
//
// shared:// URI はローカルアプリの外では解決できないため、リンクにはせず
// タイトル・種別・作者と ID を書誌情報風のテキスト 1 行として残す。

import { textParagraph, type BlockToMarkdown } from "../markdown-block";

export const sharedCitationToMarkdown: BlockToMarkdown = (block, ctx) => {
  const props = block.props ?? {};
  const title = String(props.cachedTitle || "(untitled)");
  const meta = [props.entryType, props.cachedAuthor]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const idPart = props.sharedId ? ` — shared://${String(props.sharedId)}` : "";
  return [textParagraph(`📎 ${title}${meta ? ` (${meta})` : ""}${idPart}`, {}, ctx.children)];
};
