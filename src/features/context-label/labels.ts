// ──────────────────────────────────────────────
// コンテキストラベル定義
// thought-provenance-spec.md § 0-A に準拠
// ──────────────────────────────────────────────

// Layer 1: コアラベル（PROV-DM直結）
export type CoreLabel =
  | "[手順]"
  | "[使用したもの]"
  | "[属性]"
  | "[試料]"
  | "[結果]";

export const CORE_LABELS: CoreLabel[] = [
  "[手順]",
  "[使用したもの]",
  "[属性]",
  "[試料]",
  "[結果]",
];

// PROV-DMロールのマッピング
export const CORE_LABEL_PROV: Record<CoreLabel, string> = {
  "[手順]": "prov:Activity",
  "[使用したもの]": "prov:used",
  "[属性]": "prov:Entity",     // 親ノードの属性（prov:Entity として出力）
  "[試料]": "prov:Activity×N",
  "[結果]": "prov:wasGeneratedBy",
};

// Layer 2: エイリアス（ユーザーが書く → コアラベルに正規化）
export const ALIAS_MAP: Record<string, CoreLabel> = {
  "[材料]": "[使用したもの]",
  "[操作]": "[手順]",
  "[産物]": "[結果]",
  "[output]": "[結果]",
  "[サンプル]": "[試料]",
  "[Reagents]": "[使用したもの]",
  // [条件] は [属性] のエイリアスとして後方互換
  "[条件]": "[属性]",
  "[パラメータ]": "[属性]",
  "[仕様]": "[属性]",
  // 汎用化: 試料の別名
  "[パターン]": "[試料]",
  "[ケース]": "[試料]",
  "[条件群]": "[試料]",
  // 英語短縮
  "[step]": "[手順]",
  "[mat]": "[使用したもの]",
  "[result]": "[結果]",
  "[attr]": "[属性]",
  "[sample]": "[試料]",
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
