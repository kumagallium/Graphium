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
  derived_from: { label: "派生元", provDM: "wasDerivedFrom", color: "#8b5cf6" },
  used: { label: "使用", provDM: "used", color: "#10b981" },
  generated: { label: "生成", provDM: "wasGeneratedBy", color: "#ef4444" },
  related_to: { label: "関連", provDM: "(custom)", color: "#6b7280" },
  reproduction_of: { label: "再現", provDM: "wasDerivedFrom", color: "#f59e0b" },
  informed_by: { label: "前手順", provDM: "wasInformedBy", color: "#3b82f6" },
};

// createdBy の表示名
export const CREATED_BY_LABELS: Record<CreatedBy, string> = {
  human: "手動",
  ai: "AI",
  system: "自動",
};
