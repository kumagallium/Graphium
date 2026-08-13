import { CalcBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
export const calcBlock: CustomBlockEntry = {
  type: "calc",
  spec: CalcBlock,
};

// スラッシュメニュー用アイテム（カーソル位置に空の計算ブロックを挿入）
export const calcSlashItem = {
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.calc"); },
  get subtext() { return t("slash.calcSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    editor.insertBlocks(
      [{ type: "calc", props: { source: "", results: "" } }],
      currentBlock,
      "after",
    );

    // 現在のブロックが空（スラッシュだけ）なら削除して置き換える
    const content = currentBlock.content;
    const isEmpty =
      Array.isArray(content) &&
      content.length <= 1 &&
      (!content[0] ||
        (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""));
    if (isEmpty) {
      editor.removeBlocks([currentBlock]);
    }
  },
  aliases: [
    "calc",
    "calculator",
    "calculation",
    "numi",
    "計算",
    "けいさん",
    "電卓",
    "秤量",
    "ひょうりょう",
  ],
};
