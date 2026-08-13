// インデックステーブル機能のエントリーポイント
// カスタムブロック型は使わず、標準 table ブロック + 外部ストアで実装

import { t } from "../../i18n";

export { IndexTableStoreProvider, useIndexTableStore, useIndexTableStoreOptional } from "./store";
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
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.indexTable"); },
  get subtext() { return t("slash.indexTableSub"); },
  get group() { return t("slash.advancedGroup"); },
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
                  [{ type: "text", text: t("indexTable.colName"), styles: {} }],
                  [{ type: "text", text: t("indexTable.colCond1"), styles: {} }],
                  [{ type: "text", text: t("indexTable.colCond2"), styles: {} }],
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
