// ──────────────────────────────────────────────
// スラッシュメニュー用ラベル挿入アイテム
//
// /手順, /使用, /属性, /結果 で
// 対応するラベル付きブロック（H2 見出し or 箇条書き）を挿入する
// ──────────────────────────────────────────────

import type { CoreLabel } from "./labels";
import { t, getDisplayLabel } from "../../i18n";

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
  blockType: "heading" | "bulletListItem" | "table";
  onItemClick: (editor: any) => void;
};

function createLabelSlashItem(
  title: string,
  label: CoreLabel,
  blockType: "heading" | "bulletListItem" | "table",
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

      let newBlock: any;
      if (blockType === "heading") {
        newBlock = { type: "heading", props: { level: 2 } };
      } else if (blockType === "table") {
        // パターンテーブル: パターン名・条件列を持つ 3x2 テーブル
        newBlock = {
          type: "table",
          content: {
            type: "tableContent",
            rows: [
              { cells: [
                [{ type: "text", text: "パターン名", styles: {} }],
                [{ type: "text", text: "条件1", styles: {} }],
                [{ type: "text", text: "条件2", styles: {} }],
              ]},
              { cells: [
                [{ type: "text", text: "", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
                [{ type: "text", text: "", styles: {} }],
              ]},
            ],
          },
        };
      } else {
        newBlock = { type: "bulletListItem" };
      }

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

/** スラッシュメニューに追加するラベルアイテム一覧 */
export const labelSlashMenuItems: LabelSlashItem[] = [
  createLabelSlashItem("手順", "[手順]", "heading", [
    "手順",
    "てじゅん",
    "ステップ",
    "操作",
    "step",
    "procedure",
    "process",
    "method",
    "protocol",
  ]),
  createLabelSlashItem("使用するもの", "[使用したもの]", "bulletListItem", [
    "使用",
    "しよう",
    "材料",
    "試薬",
    "reagent",
    "reagents",
    "material",
    "materials",
    "used",
    "ingredient",
  ]),
  createLabelSlashItem("属性", "[属性]", "bulletListItem", [
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
  createLabelSlashItem("結果", "[結果]", "bulletListItem", [
    "結果",
    "けっか",
    "データ",
    "産物",
    "出力",
    "result",
    "results",
    "output",
    "data",
    "outcome",
  ]),
];
