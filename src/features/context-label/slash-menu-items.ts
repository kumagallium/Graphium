// ──────────────────────────────────────────────
// スラッシュメニュー用ラベル挿入アイテム
//
// /手順, /使用, /属性, /結果 で
// 対応するラベル付きブロック（H2 見出し or 箇条書き）を挿入する
// ──────────────────────────────────────────────

import type { CoreLabel } from "./labels";
import { t, getDisplayLabel, getDisplayLabelName } from "../../i18n";

// ラベル設定のグローバルコールバック
// note-app.tsx 側で useLabelStore().setLabel を登録する
let _setLabelCallback: ((blockId: string, label: string) => void) | null =
  null;

export function setSlashMenuLabelCallback(
  fn: typeof _setLabelCallback
) {
  _setLabelCallback = fn;
}

type LabelSlashItem = {
  title: string;
  subtext: string;
  group: string;
  aliases: string[];
  label: CoreLabel;
  blockType: "heading" | "bulletListItem";
  onItemClick: (editor: any) => void;
};

function createLabelSlashItem(
  title: string,
  label: CoreLabel,
  blockType: "heading" | "bulletListItem",
  aliases: string[]
): LabelSlashItem {
  return {
    title,
    subtext: t("labelUi.insertLabeledBlock", { label: getDisplayLabel(label) }),
    group: t("slashMenu.group"),
    aliases,
    label,
    blockType,
    onItemClick: (editor: any) => {
      const currentBlock = editor.getTextCursorPosition().block;

      const newBlock: any = blockType === "heading"
        ? { type: "heading", props: { level: 2 } }
        : { type: "bulletListItem" };

      const inserted = editor.insertBlocks(
        [newBlock],
        currentBlock,
        "after"
      );
      if (inserted?.[0]) {
        editor.setTextCursorPosition(inserted[0], "end");
        setTimeout(() => {
          _setLabelCallback?.(inserted[0].id, label);
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
  };
}

/**
 * スラッシュメニューに追加するラベルアイテム一覧を構築（ロケール変更に対応）
 *
 * 工程（手順）と、その中の計画 / 結果はここに無い。工程は step ブロックが表し、
 * 計画 / 結果は step の中の本文ブロックに付けるモード帯のマーカーで、どちらも
 * ドラッグハンドルのメニューから操作する。ここに残すと「ラベル付き見出し」と
 * 「step ブロック」の二通りの作り方が並んでしまう。
 */
export function buildLabelSlashMenuItems(): LabelSlashItem[] {
  return [
    createLabelSlashItem(getDisplayLabelName("material"), "material", "bulletListItem", [
      "使用",
      "しよう",
      "材料",
      "ざいりょう",
      "試薬",
      "原料",
      "reagent",
      "reagents",
      "material",
      "materials",
      "input",
    ]),
    createLabelSlashItem(getDisplayLabelName("tool"), "tool", "bulletListItem", [
      "ツール",
      "つーる",
      "装置",
      "器具",
      "道具",
      "機器",
      "tool",
      "tools",
      "equipment",
      "instrument",
    ]),
    createLabelSlashItem(getDisplayLabelName("attribute"), "attribute", "bulletListItem", [
      "属性",
      "ぞくせい",
      "条件",
      "パラメータ",
      "仕様",
      "property",
      "properties",
      "attribute",
      "attributes",
      "condition",
      "parameter",
      "spec",
    ]),
    createLabelSlashItem(getDisplayLabelName("output"), "output", "bulletListItem", [
      "アウトプット",
      "あうとぷっと",
      "結果",
      "けっか",
      "データ",
      "産物",
      "出力",
      "output",
      "outputs",
      "result",
      "results",
      "data",
      "outcome",
    ]),
  ];
}
