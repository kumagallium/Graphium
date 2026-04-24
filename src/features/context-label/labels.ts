// ──────────────────────────────────────────────
// コンテキストラベル定義（内部キー方式）
// thought-provenance-spec.md § 0-A / design-registry.md L-002 に準拠
//
// Phase 2 (2026-04-24): 日本語表示文字列から内部キーへ移行。
//   [手順] → "procedure"、[材料] → "material" ...
// 表示は i18n 層（getDisplayLabel）で解決する。
// 旧ノート JSON は document-migration.ts の v2 → v3 変換で正規化する。
// ──────────────────────────────────────────────

// Layer 1: コアラベル（PROV-DM 直結、5 種）
export type CoreLabel =
  | "procedure"
  | "material"
  | "tool"
  | "attribute"
  | "result";

export const CORE_LABELS: CoreLabel[] = [
  "procedure",
  "material",
  "tool",
  "attribute",
  "result",
];

// PROV-DM ロールのマッピング
export const CORE_LABEL_PROV: Record<CoreLabel, string> = {
  procedure: "prov:Activity",
  material: "prov:used",     // Entity subtype: material
  tool: "prov:used",         // Entity subtype: tool
  attribute: "prov:Entity",  // 親ノードの属性（prov:Entity として出力）
  result: "prov:wasGeneratedBy",
};

// Entity サブタイプ（MatPROV 互換: material / tool）
export type EntitySubtype = "material" | "tool";
export const LABEL_TO_ENTITY_SUBTYPE: Partial<Record<CoreLabel, EntitySubtype>> = {
  material: "material",
  tool: "tool",
};

// Layer 2: エイリアス（旧表記・英語別名 → コアラベルに正規化）
// 旧ブラケット日本語は v2 → v3 マイグレーション後は残らないが、
// エクスポート／他システムからの入力や未移行データへの防御として維持する。
export const ALIAS_MAP: Record<string, CoreLabel> = {
  // 旧ブラケット日本語（v2 以前のノート・エクスポート）
  "[手順]": "procedure",
  "[材料]": "material",
  "[ツール]": "tool",
  "[属性]": "attribute",
  "[結果]": "result",
  // 旧エイリアス（ブラケット日本語系）
  "[操作]": "procedure",
  "[産物]": "result",
  "[使用したもの]": "material",
  "[使用するもの]": "material",
  "[条件]": "attribute",
  "[パラメータ]": "attribute",
  "[仕様]": "attribute",
  "[試薬]": "material",
  "[原料]": "material",
  "[装置]": "tool",
  "[器具]": "tool",
  "[道具]": "tool",
  "[機器]": "tool",
  // 英語エイリアス（ブラケット付き）
  "[step]": "procedure",
  "[Step]": "procedure",
  "[Procedure]": "procedure",
  "[procedure]": "procedure",
  "[mat]": "material",
  "[Materials]": "material",
  "[materials]": "material",
  "[Material]": "material",
  "[material]": "material",
  "[Reagents]": "material",
  "[Input]": "material",
  "[input]": "material",
  "[tool]": "tool",
  "[Tool]": "tool",
  "[Tools]": "tool",
  "[tools]": "tool",
  "[Equipment]": "tool",
  "[equipment]": "tool",
  "[attr]": "attribute",
  "[Attributes]": "attribute",
  "[attributes]": "attribute",
  "[Parameter]": "attribute",
  "[parameter]": "attribute",
  "[result]": "result",
  "[Result]": "result",
  "[Results]": "result",
  "[results]": "result",
  "[output]": "result",
  "[Output]": "result",
  // 括弧なし小文字エイリアス（外部 API・プロンプト出力の寄り道）
  step: "procedure",
  procedure: "procedure",
  material: "material",
  materials: "material",
  tool: "tool",
  tools: "tool",
  equipment: "tool",
  attr: "attribute",
  attribute: "attribute",
  attributes: "attribute",
  parameter: "attribute",
  result: "result",
  results: "result",
  output: "result",
};

// 構造ラベル（リンク生成に使う特殊ラベル、PROV-DM 直結のコアラベルではない）
export const STRUCTURAL_LABELS = ["prev-procedure"] as const;
export type StructuralLabel = typeof STRUCTURAL_LABELS[number];

// Layer 3: フリーラベル例（PROV に変換しない。表示は i18n 側で解決）
export const FREE_LABEL_EXAMPLES: string[] = [
  "free.purpose",
  "free.discussion",
  "free.question",
  "free.evidence",
  "free.background",
  "free.reference",
  "free.impression",
];

// attribute は常に末端ノード（子にラベル付きブロックを持てない）
export const LEAF_ONLY_LABELS: CoreLabel[] = ["attribute"];

// ラベルの分類
export type LabelLayer = "core" | "alias" | "free";

export function classifyLabel(label: string): LabelLayer {
  if ((CORE_LABELS as string[]).includes(label)) return "core";
  if (label in ALIAS_MAP) return "alias";
  return "free";
}

// エイリアスをコアラベルに正規化する
export function normalizeLabel(label: string): string {
  if ((CORE_LABELS as string[]).includes(label)) return label;
  return ALIAS_MAP[label] ?? label;
}

// 見出しブロック上の procedure ラベルの PROV 挙動
// H1 → セクションマーカー（Activity 生成しない）
// H2+ → 個別の実験ステップ（Activity 生成する）
//   H2 = トップレベル Activity、H3 = サブ Activity、H4+ = さらに深いサブ Activity
export function getHeadingLabelRole(
  level: number,
  label: string,
): "section-marker" | "activity" | null {
  const normalized = normalizeLabel(label);
  if (normalized !== "procedure") return null;
  return level === 1 ? "section-marker" : "activity";
}
