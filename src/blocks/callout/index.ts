import { CalloutBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
export const calloutBlock: CustomBlockEntry = {
  type: "callout",
  spec: CalloutBlock,
};

// スラッシュメニュー用アイテム（カーソル位置に Callout を挿入）
export const calloutSlashItem = {
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.callout"); },
  get subtext() { return t("slash.calloutSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [{ type: "callout", props: { variant: "note" } }],
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

    // 挿入した Callout 本文にフォーカス
    if (inserted?.[0]) {
      setTimeout(() => {
        try {
          editor.setTextCursorPosition(inserted[0].id, "end");
          editor.focus();
        } catch {
          /* no-op */
        }
      }, 0);
    }
  },
  aliases: ["callout", "note", "info", "コールアウト", "注記", "補足", "ヒント"],
};
