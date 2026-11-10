// 文字の範囲に付くラベル（インプット・ツール・パラメータ・アウトプット）の色。
//
// エディタの描画（styles.ts）と、MCP の会話内プレビュー（src/mcp/apps/）の両方が使う。
// プレビューはエディタ（@blocknote/core）を持ち込めないので、色だけをこのファイルに分けてある。

export const INLINE_LABEL_COLORS = {
  // Inline 4 種の色（既存のラベルバッジ色と揃える）
  material: { bg: "rgba(75, 122, 82, 0.18)", border: "#4B7A52" }, // Input
  tool: { bg: "rgba(192, 139, 62, 0.18)", border: "#c08b3e" }, // Tool
  attribute: { bg: "rgba(160, 160, 160, 0.18)", border: "#8a8a8a" }, // Parameter
  output: { bg: "rgba(194, 99, 86, 0.18)", border: "#c26356" }, // Output
} as const;

export type InlineLabelKind = keyof typeof INLINE_LABEL_COLORS;

/** ノート JSON の text の styles に入るキー → ラベル */
export const INLINE_LABEL_STYLE_KEYS: Record<string, InlineLabelKind> = {
  inlineMaterial: "material",
  inlineTool: "tool",
  inlineAttribute: "attribute",
  inlineOutput: "output",
};
