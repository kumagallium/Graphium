// ──────────────────────────────────────────────
// コンテキストラベル定義（内部キー方式）
// thought-provenance-spec.md § 0-A / design-registry.md L-002 / docs/internal/provenance-layer-design.md に準拠
//
// Phase 2 (2026-04-24): 日本語表示文字列から内部キーへ移行。
//   [手順] → "procedure"、[材料] → "material" ...
// 表示は i18n 層（getDisplayLabel）で解決する。
//
// Phase A (2026-04-28): 3 層構造（Section / Phase / Inline）対応。
//   - 旧 "result"（Output Entity）→ "output" にリネーム
//   - Phase 用の新ラベル "plan" / "result" を追加
//   - LABEL_SCOPE で各ラベルの適用範囲（section/phase/inline）を定義
// ──────────────────────────────────────────────

// Layer 1: コアラベル
//   Section 層: procedure（見出しブロック）
//   Phase 層: plan / result（見出しブロック、procedure 配下）
//   Inline 層: material / tool / attribute / output（テキスト範囲ハイライト）
export type CoreLabel =
  | "procedure"
  | "plan"
  | "result"
  | "material"
  | "tool"
  | "attribute"
  | "output";

export const CORE_LABELS: CoreLabel[] = [
  "procedure",
  "plan",
  "result",
  "material",
  "tool",
  "attribute",
  "output",
];

// ラベルの適用範囲
//   section: 見出しブロックに付与され、Activity の境界を作る
//   phase:   見出しブロックに付与され、procedure 配下で Plan / Execution 文脈を切り替える
//   inline:  テキスト範囲（mark）に付与され、referent（Entity / Attribute）を同定する
export type LabelScope = "section" | "phase" | "inline";

export const LABEL_SCOPE: Record<CoreLabel, LabelScope> = {
  procedure: "section",
  plan: "phase",
  result: "phase",
  material: "inline",
  tool: "inline",
  attribute: "inline",
  output: "inline",
};

// PROV-DM ロールのマッピング
export const CORE_LABEL_PROV: Record<CoreLabel, string> = {
  procedure: "prov:Activity",
  plan: "prov:Plan",
  result: "prov:Activity",       // Phase=result は Activity 実行記録の文脈（独立ノードは生成しない）
  material: "prov:used",          // Entity subtype: material
  tool: "prov:used",              // Entity subtype: tool
  attribute: "prov:Entity",       // 親ノードの属性（prov:Entity として出力）。
                                   // ただし親が Activity の [パラメータ] 表で行が複数
                                   // ある場合（段階 stage）は prov:Activity（子）に投影する
                                   // — generator.ts の attribute → 親ノード節を参照。
  output: "prov:wasGeneratedBy",  // Activity から生成される Entity
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
//
// NOTE: 旧 "result"（Output Entity 意味）は v3 → v4 マイグレーションで "output" に変換される。
// 旧ブラケット形式 "[結果]" / "[Output]" 等は **Output Entity** として "output" に正規化する。
export const ALIAS_MAP: Record<string, CoreLabel> = {
  // 旧ブラケット日本語（v2 以前のノート・エクスポート）→ Output Entity 系
  "[手順]": "procedure",
  "[材料]": "material",
  "[ツール]": "tool",
  "[属性]": "attribute",
  "[結果]": "output",      // 旧 "[結果]" は Output Entity を指していた
  // 旧エイリアス（ブラケット日本語系）
  "[操作]": "procedure",
  "[産物]": "output",
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
  // Phase ラベル（新規、ブラケット日本語）
  "[計画]": "plan",
  "[結果セクション]": "result",   // セクション意味の result、衝突回避のため別表記
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
  // Output Entity 系（旧 result キーから移行）
  "[result]": "output",
  "[Result]": "output",
  "[Results]": "output",
  "[results]": "output",
  "[output]": "output",
  "[Output]": "output",
  // Phase ラベル（新規、ブラケット英語）
  "[Plan]": "plan",
  "[plan]": "plan",
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
  output: "output",
  // NOTE: 裸文字列 "result" / "results" は Phase の result（CoreLabel）と一致するため
  // ALIAS_MAP に載せない（normalizeLabel が CoreLabel チェックでそのまま返す）。
  // 旧データ中の Output Entity 意味の "result" は document-migration v3→v4 で "output" に変換される。
  plan: "plan",
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

// ラベルの適用範囲を取得（CoreLabel のみ。フリーラベル等は undefined）
export function getLabelScope(label: string): LabelScope | undefined {
  const normalized = normalizeLabel(label);
  if ((CORE_LABELS as string[]).includes(normalized)) {
    return LABEL_SCOPE[normalized as CoreLabel];
  }
  return undefined;
}

// 見出しブロック上の procedure ラベルの PROV 挙動
//   H1 = トップレベル Activity（ノート本文の最上位手順）
//   H2 = サブ Activity、H3+ = さらに深いサブ Activity
//
// Phase B (2026-04-29): h1 を section-marker から Activity に変更。
//   ノートタイトルは page metadata にあり、本文 h1 は手順そのものとして使われる。
//   3 層モデルでは「h1 #step → h2 #plan/#result」が自然な階層なので h1 も Activity 化。
//   旧 "section-marker" return value は廃止。
export function getHeadingLabelRole(
  level: number,
  label: string,
): "activity" | null {
  const normalized = normalizeLabel(label);
  if (normalized !== "procedure") return null;
  return "activity";
}
