// マルチカラムレイアウト（columnList / column）の登録エントリー
//
// ⚠️ registry.ts の customBlockEntries に **両方** 必ず登録すること。
// columnList と column は別のブロック型で、どちらか一方でも
// KNOWN_BLOCK_TYPES から漏れると sanitizeBlocks（note-app.tsx / side-peek.tsx）が
// カラムを children ごと除去したまま自動保存し、カラム内の全ブロック
// （本文・表・画像）が道連れでユーザーのデータから消える。
import { createBlockSpecFromTiptapNode } from "@blocknote/core";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";
import { ColumnListNode, ColumnNode, columnPropSchema } from "./nodes";

export { columnResizeExtension } from "./column-resize";

// content は "none"（columnList / column は inline content を持たない。
// 子ブロックは PM の childContainer 経由で Block.children に入る）
const ColumnListBlock = createBlockSpecFromTiptapNode(
  { node: ColumnListNode, type: "columnList", content: "none" },
  {},
);

const ColumnBlock = createBlockSpecFromTiptapNode(
  { node: ColumnNode, type: "column", content: "none" },
  columnPropSchema,
);

export const columnListBlock: CustomBlockEntry = {
  type: "columnList",
  spec: ColumnListBlock,
};

export const columnBlock: CustomBlockEntry = {
  type: "column",
  spec: ColumnBlock,
};

// スラッシュメニュー用アイテム（現在のブロックの後ろに 2 カラムを挿入）
export const columnsSlashItem = {
  title: t("slash.columns"),
  subtext: t("slash.columnsSub"),
  group: t("slash.advancedGroup"),
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [
        {
          type: "columnList",
          children: [
            { type: "column", children: [{ type: "paragraph" }] },
            { type: "column", children: [{ type: "paragraph" }] },
          ],
        },
      ],
      currentBlock,
      "after",
    );

    // 現在のブロックが空（スラッシュだけ）なら削除して置き換える
    const content = currentBlock.content;
    const isEmpty =
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] ||
        (content[0].type === "text" &&
          content[0].text.replace("/", "").trim() === ""));
    if (isEmpty) {
      editor.removeBlocks([currentBlock]);
    }

    // カーソルを 1 カラム目の先頭段落へ
    const firstParagraph = inserted?.[0]?.children?.[0]?.children?.[0];
    if (firstParagraph) {
      editor.setTextCursorPosition(firstParagraph, "start");
    }
  },
  aliases: [
    "columns", "column", "layout", "2col",
    "カラム", "からむ", "段組み", "だんぐみ", "列", "横並び",
  ],
};
