// インデックステーブル機能のエントリーポイント

import { IndexTableBlock } from "./index-table-block";
import type { CustomBlockEntry } from "../../base/schema";

// ブロック登録エントリー
export const indexTableBlock: CustomBlockEntry = {
  type: "indexTable",
  spec: IndexTableBlock,
};

// スラッシュメニュー用の挿入アイテム
export const indexTableSlashItem = {
  title: "インデックステーブル",
  subtext: "試料・サンプル管理用のテーブルを挿入",
  group: "実験ブロック",
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [
        {
          type: "indexTable",
          props: { linkedNotes: "{}" },
          content: {
            type: "tableContent",
            rows: [
              {
                cells: [
                  [{ type: "text", text: "名前", styles: {} }],
                  [{ type: "text", text: "条件1", styles: {} }],
                  [{ type: "text", text: "条件2", styles: {} }],
                ],
              },
              {
                cells: [
                  [{ type: "text", text: "", styles: {} }],
                  [{ type: "text", text: "", styles: {} }],
                  [{ type: "text", text: "", styles: {} }],
                ],
              },
            ],
          },
        },
      ],
      currentBlock,
      "after"
    );

    if (inserted?.[0]) {
      editor.setTextCursorPosition(inserted[0], "end");
    }

    // 現在のブロックが空（スラッシュだけ）なら削除
    const content = currentBlock.content;
    if (
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] ||
        (content[0].type === "text" &&
          content[0].text.replace("/", "").trim() === ""))
    ) {
      editor.removeBlocks([currentBlock]);
    }
  },
  aliases: [
    "インデックス",
    "index",
    "indextable",
    "試料",
    "サンプル",
    "sample",
    "samples",
  ],
};
