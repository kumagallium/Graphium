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
  title: t("slash.math"),
  subtext: t("slash.mathSub"),
  group: t("slash.advancedGroup"),
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
