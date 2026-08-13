import { StepBlock, buildDefaultStepTitle, selectStepTitle } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
// ⚠️ registry.ts の customBlockEntries に必ず登録すること（CUSTOM_BLOCK_TYPES は
// そこから導出される）。未登録だと sanitizeBlocks（note-app.tsx / side-peek.tsx）が
// 未知ブロックとして step を除去したまま自動保存し、ユーザーのデータが失われる。
// step は children を持つので、除去されると中の本文・表・画像も道連れになる。
export const stepBlock: CustomBlockEntry = {
  type: "step",
  spec: StepBlock,
};

// スラッシュメニュー用アイテム（カーソル位置に step を挿入）
export const stepSlashItem = {
  // ラベルは getter で遅延評価する。トップレベルで t() を呼ぶと最初の読み込み時の
  // 言語で固定され、言語を切り替えても古いラベルが残る（項目は作り直されないため）。
  get title() { return t("slash.step"); },
  get subtext() { return t("slash.stepSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    // タイトルは「ステップ N」を実テキストで入れる（空だとグラフにノードが
    // 立たない）。空の子を 1 つ持たせて、すぐ中身を書き始められるようにする
    const inserted = editor.insertBlocks(
      [
        {
          type: "step",
          content: [
            { type: "text", text: buildDefaultStepTitle(editor.document ?? []), styles: {} },
          ],
          children: [{ type: "paragraph" }],
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

    // 挿入した step のタイトルを全選択で渡す（打てばそのまま置き換わる）
    if (inserted?.[0]) {
      selectStepTitle(editor, inserted[0].id);
    }
  },
  aliases: ["step", "procedure", "ステップ", "手順", "工程", "てじゅん"],
};
