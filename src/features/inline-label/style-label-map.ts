// ──────────────────────────────────────────────
// inline style key ↔ ラベル種別の対応表（葉モジュール）
//
// styles.ts と attribute-binding.ts / entity-merge.ts の間で実行時の循環依存が
// 生じていたため、両者が参照する STYLE_TO_LABEL と InlineLabel 型をここに切り出す。
// このモジュールは inline-label 内の他ファイルへ依存しない（葉）。
// ──────────────────────────────────────────────

/** インラインラベルの 4 種別 */
export type InlineLabel = "material" | "tool" | "attribute" | "output";

/** BlockNote style 名 → コアラベル */
export const STYLE_TO_LABEL: Record<string, InlineLabel> = {
  inlineMaterial: "material",
  inlineTool: "tool",
  inlineAttribute: "attribute",
  inlineOutput: "output",
};
