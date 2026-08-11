import { ChartBlock } from "./view";
import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";

// ブロック登録エントリー
export const chartBlock: CustomBlockEntry = {
  type: "chart",
  spec: ChartBlock,
};

// スラッシュメニュー用アイテム（テーブル未選択状態のチャートブロックを挿入）
export const chartSlashItem = {
  title: t("slash.chart"),
  subtext: t("slash.chartSub"),
  group: t("slash.advancedGroup"),
  onItemClick: (editor: any) => {
    const currentBlock = editor.getTextCursorPosition().block;
    editor.insertBlocks([{ type: "chart", props: {} }], currentBlock, "after");

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
    // 挿入直後はテーブル未選択なので、ブロック側がテーブル選択 UI を表示する
  },
  aliases: [
    "chart",
    "graph",
    "plot",
    "line",
    "bar",
    "histogram",
    "チャート",
    "グラフ",
    "折れ線",
    "棒",
    "分布",
  ],
};
