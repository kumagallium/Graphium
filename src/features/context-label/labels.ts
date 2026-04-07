// ──────────────────────────────────────────────
// コンテキストラベル定義
// thought-provenance-spec.md § 0-A に準拠
// ──────────────────────────────────────────────

// Layer 1: コアラベル（PROV-DM直結、5種）
export type CoreLabel =
  | "[手順]"
  | "[材料]"
  | "[ツール]"
  | "[属性]"
  | "[結果]";

export const CORE_LABELS: CoreLabel[] = [
  "[手順]",
  "[材料]",
  "[ツール]",
  "[属性]",
  "[結果]",
];

// PROV-DMロールのマッピング
export const CORE_LABEL_PROV: Record<CoreLabel, string> = {
  "[手順]": "prov:Activity",
  "[材料]": "prov:used",       // Entity subtype: material
  "[ツール]": "prov:used",     // Entity subtype: tool
  "[属性]": "prov:Entity",     // 親ノードの属性（prov:Entity として出力）
  "[結果]": "prov:wasGeneratedBy",
};

// Entity サブタイプ（MatPROV 互換: material / tool）
export type EntitySubtype = "material" | "tool";
export const LABEL_TO_ENTITY_SUBTYPE: Partial<Record<CoreLabel, EntitySubtype>> = {
  "[材料]": "material",
  "[ツール]": "tool",
};

// Layer 2: エイリアス（ユーザーが書く → コアラベルに正規化）
export const ALIAS_MAP: Record<string, CoreLabel> = {
  "[操作]": "[手順]",
  "[産物]": "[結果]",
  "[output]": "[結果]",
  "[Reagents]": "[材料]",
  // 後方互換: [使用したもの] → [材料] に正規化
  "[使用したもの]": "[材料]",
  "[使用するもの]": "[材料]",
  // [条件] は [属性] のエイリアスとして後方互換
  "[条件]": "[属性]",
  "[パラメータ]": "[属性]",
  "[仕様]": "[属性]",
  // 材料エイリアス
  "[試薬]": "[材料]",
  "[原料]": "[材料]",
  // ツールエイリアス
  "[装置]": "[ツール]",
  "[器具]": "[ツール]",
  "[道具]": "[ツール]",
  "[機器]": "[ツール]",
  // 英語短縮
  "[step]": "[手順]",
  "[mat]": "[材料]",
  "[result]": "[結果]",
  "[attr]": "[属性]",
  "[tool]": "[ツール]",
  // 英語フルネーム
  "[Procedure]": "[手順]",
  "[procedure]": "[手順]",
  "[Materials]": "[材料]",
  "[materials]": "[材料]",
  "[Material]": "[材料]",
  "[material]": "[材料]",
  "[Tool]": "[ツール]",
  "[Tools]": "[ツール]",
  "[tools]": "[ツール]",
  "[Equipment]": "[ツール]",
  "[equipment]": "[ツール]",
  "[Attributes]": "[属性]",
  "[attributes]": "[属性]",
  "[Results]": "[結果]",
  "[results]": "[結果]",
};

// 構造ラベル（リンク生成に使う特殊ラベル）
export const STRUCTURAL_LABELS = ["[前手順]"] as const;
export type StructuralLabel = typeof STRUCTURAL_LABELS[number];

// Layer 3: フリーラベル例（PROVに変換しない）
export const FREE_LABEL_EXAMPLES: string[] = [
  "[目的]",
  "[考察]",
  "[疑問]",
  "[証跡]",
  "[背景]",
  "[参照]",
  "[感想]",
];

// [属性] は常に末端ノード（子にラベル付きブロックを持てない）
export const LEAF_ONLY_LABELS: CoreLabel[] = ["[属性]"];

// ラベルの分類
export type LabelLayer = "core" | "alias" | "free";

export function classifyLabel(label: string): LabelLayer {
  if (CORE_LABELS.includes(label as CoreLabel)) return "core";
  if (label in ALIAS_MAP) return "alias";
  return "free";
}

// エイリアスをコアラベルに正規化する
export function normalizeLabel(label: string): string {
  return ALIAS_MAP[label] ?? label;
}

// 見出しブロック上の [手順] ラベルのPROV挙動
// H1 → セクションマーカー（Activity生成しない）
// H2+ → 個別の実験ステップ（Activity生成する）
//   H2 = トップレベル Activity、H3 = サブ Activity、H4+ = さらに深いサブ Activity
export function getHeadingLabelRole(
  level: number,
  label: string
): "section-marker" | "activity" | null {
  if (label !== "[手順]") return null;
  return level === 1 ? "section-marker" : "activity";
}
