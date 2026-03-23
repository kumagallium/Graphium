// ──────────────────────────────────────────────
// ブロック間リンクのタイプ定義
// thought-provenance-spec.md § 0-B に準拠
// ──────────────────────────────────────────────

export type LinkType =
  | "derived_from"      // wasDerivedFrom: データ→考察
  | "used"              // used: 手順→試料
  | "generated"         // wasGeneratedBy: 手順→データ
  | "related_to"        // カスタム: 考察↔文献
  | "reproduction_of"   // wasDerivedFrom: 実験A→実験B
  | "informed_by";      // wasInformedBy: 手順2→手順1（前手順: @）

export type CreatedBy = "human" | "ai" | "system";

export type BlockLink = {
  id: string;
  /** リンク元ブロックID */
  sourceBlockId: string;
  /** リンク先ブロックID */
  targetBlockId: string;
  /** リンクタイプ */
  type: LinkType;
  /** 誰が作成したか */
  createdBy: CreatedBy;
  /** リンク先がページの場合のページID（ページ間リンク用） */
  targetPageId?: string;
};

// リンクタイプの表示名とPROV-DM対応
export const LINK_TYPE_CONFIG: Record<LinkType, {
  label: string;
  provDM: string;
  color: string;
}> = {
  derived_from: { label: "派生元", provDM: "wasDerivedFrom", color: "#8b7ab5" },
  used: { label: "使用", provDM: "used", color: "#4B7A52" },
  generated: { label: "生成", provDM: "wasGeneratedBy", color: "#c26356" },
  related_to: { label: "関連", provDM: "(custom)", color: "#6b7f6e" },
  reproduction_of: { label: "再現", provDM: "wasDerivedFrom", color: "#c08b3e" },
  informed_by: { label: "前手順", provDM: "wasInformedBy", color: "#5b8fb9" },
};

// createdBy の表示名
export const CREATED_BY_LABELS: Record<CreatedBy, string> = {
  human: "手動",
  ai: "AI",
  system: "自動",
};
