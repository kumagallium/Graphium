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
  title: t("slash.callout"),
  subtext: t("slash.calloutSub"),
  group: t("slash.advancedGroup"),
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
