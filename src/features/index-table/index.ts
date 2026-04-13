// インデックステーブル機能のエントリーポイント
// カスタムブロック型は使わず、標準 table ブロック + 外部ストアで実装

import { t } from "../../i18n";

export { IndexTableStoreProvider, useIndexTableStore } from "./store";
export { IndexTableIconLayer } from "./icon-layer";
export { setIndexTableCallbacks } from "./context";

// インデックステーブル登録用のグローバルコールバック
// スラッシュメニューから呼ばれるため、React Context にアクセスできない
let _registerCallback: ((blockId: string) => void) | null = null;

export function setRegisterIndexTableCallback(
  fn: ((blockId: string) => void) | null
) {
  _registerCallback = fn;
}

// スラッシュメニュー用の挿入アイテム
export const indexTableSlashItem = {
  title: t("slash.indexTable"),
  subtext: t("slash.indexTableSub"),
  group: t("slash.advancedGroup"),
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [
        {
          type: "table",
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

    // 挿入されたテーブルをインデックステーブルとして登録
    if (inserted?.[0]) {
      const blockId = inserted[0].id;
      setTimeout(() => {
        _registerCallback?.(blockId);
      }, 0);
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
