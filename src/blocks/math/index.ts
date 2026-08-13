import { MathBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
export const mathBlock: CustomBlockEntry = {
  type: "math",
  spec: MathBlock,
};

// スラッシュメニュー用アイテム（カーソル位置に空の数式ブロックを挿入）
export const mathSlashItem = {
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.math"); },
  get subtext() { return t("slash.mathSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    editor.insertBlocks([{ type: "math", props: { latex: "" } }], currentBlock, "after");

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
    // 挿入直後の数式ブロックは latex が空なので、ブロック側が自動で編集状態になる
  },
  aliases: ["math", "formula", "equation", "latex", "tex", "数式", "すうしき", "式", "計算式"],
};
