// ──────────────────────────────────────────────
// ブロック間リンクのタイプ定義
// thought-provenance-spec.md § 0-B に準拠
// ──────────────────────────────────────────────

// リンクの二層構造
export type LinkLayer = "prov" | "knowledge";

// PROV 層: DAG 制約あり
export type ProvLinkType =
  | "derived_from"      // wasDerivedFrom: データ→考察
  | "used"              // used: 手順→試料
  | "generated"         // wasGeneratedBy: 手順→データ
  | "reproduction_of"   // wasDerivedFrom: 実験A→実験B
  | "informed_by";      // wasInformedBy: 手順2→手順1（前手順: @）

// 知識層: 循環 OK、タイプは1種類のみ（「リンクはリンク」原則）
export type KnowledgeLinkType = "reference";

export type LinkType = ProvLinkType | KnowledgeLinkType;

// PROV リンクかどうかの判定
export const PROV_LINK_TYPES: Set<string> = new Set([
  "derived_from", "used", "generated", "reproduction_of", "informed_by",
]);

export function isProvLink(type: string): boolean {
  return PROV_LINK_TYPES.has(type);
}

export type CreatedBy = "human" | "ai" | "system";

export type BlockLink = {
  id: string;
  /** リンク元ブロックID */
  sourceBlockId: string;
  /** リンク先ブロックID */
  targetBlockId: string;
  /** リンクタイプ */
  type: LinkType;
  /** PROV 層 or 知識層 */
  layer: LinkLayer;
  /** 誰が作成したか */
  createdBy: CreatedBy;
  /** リンク先がページの場合のページID（ページ間リンク用） */
  targetPageId?: string;
  /** リンク先ノートの Google Drive ファイル ID（ノート間参照用） */
  targetNoteId?: string;
};

// リンクタイプの表示名とPROV-DM対応
export const LINK_TYPE_CONFIG: Record<LinkType, {
  label: string;
  provDM: string;
  color: string;
  layer: LinkLayer;
}> = {
  derived_from: { label: "派生元", provDM: "wasDerivedFrom", color: "#8b7ab5", layer: "prov" },
  used: { label: "使用", provDM: "used", color: "#4B7A52", layer: "prov" },
  generated: { label: "生成", provDM: "wasGeneratedBy", color: "#c26356", layer: "prov" },
  reproduction_of: { label: "再現", provDM: "wasDerivedFrom", color: "#c08b3e", layer: "prov" },
  informed_by: { label: "前手順", provDM: "wasInformedBy", color: "#5b8fb9", layer: "prov" },
  reference: { label: "参照", provDM: "(knowledge)", color: "#6b7f6e", layer: "knowledge" },
};

// createdBy の表示名
export const CREATED_BY_LABELS: Record<CreatedBy, string> = {
  human: "手動",
  ai: "AI",
  system: "自動",
};
