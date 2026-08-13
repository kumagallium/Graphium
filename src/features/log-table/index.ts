// 日時が自動で入るテーブル（旧・記録テーブル）のエントリーポイント
// カスタムブロック型は使わず、標準 table ブロック + 外部ストアで実装する
// （テーブルは Markdown 書き出しでそのまま残る）。どのテーブルがこのふるまいを
// 持つかは tableMeta（列の datetime-auto）が持つ。
//
// 「同じ対象を、時刻付きで、同じ項目で繰り返し測る」ための表。
// 頭痛ダイアリー・植物の生育記録・実験の経時観察などを 1 つの形で扱う。

import { t } from "../../i18n";
import { formatDateTime } from "../../lib/format-datetime";

export {
  applyLogTableTimestamps,
  resetLogTableRowTracking,
  primeLogTableRowTracking,
} from "./auto-timestamp";

// 記録テーブル登録用のグローバルコールバック
// スラッシュメニューから呼ばれるため、React Context にアクセスできない
let _registerCallback: ((blockId: string) => void) | null = null;

export function setRegisterLogTableCallback(
  fn: ((blockId: string) => void) | null
) {
  _registerCallback = fn;
}

/** ヘッダ + 現在日時入りの最初のデータ行を持つ table content を作る */
function buildInitialRows() {
  const cell = (text: string) => [{ type: "text", text, styles: {} }];
  return [
    {
      cells: [
        cell(t("logTable.colDateTime")),
        cell(t("logTable.colValue")),
        cell(t("logTable.colNote")),
      ],
    },
    {
      cells: [cell(formatDateTime(new Date())), cell(""), cell("")],
    },
  ];
}

// スラッシュメニュー用の挿入アイテム
export const logTableSlashItem = {
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.logTable"); },
  get subtext() { return t("slash.logTableSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [
        {
          type: "table",
          content: {
            type: "tableContent",
            rows: buildInitialRows(),
          },
        },
      ],
      currentBlock,
      "after"
    );

    // 挿入されたテーブルを記録テーブルとして登録
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
    "log",
    "logtable",
    "diary",
    "journal",
    "observation",
    "記録",
    "きろく",
    "ダイアリー",
    "日誌",
    "観察",
  ],
};
