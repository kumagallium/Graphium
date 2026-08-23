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
  /** 参照元ノートにある具体的な output の identity */
  targetEntityId?: string;
  /** 選択時点での、参照元 step 内 output 順（0 始まり） */
  targetEntityIndex?: number;
  /** 選択時点での、参照元 step 内 output 件数 */
  targetEntityCount?: number;
  /** false の場合、identity は表の行位置由来で安定しない */
  targetEntityStable?: boolean;
  /** 参照元を投影した時点の更新日時。不安定な表行 identity の再利用防止に使う */
  targetSourceModifiedAt?: string;
  /** 現在ノート側に作った material span の entityId */
  sourceEntityId?: string;
  /** 投影未読・リンク切れでも表示するためのスナップショット */
  targetEntityLabel?: string;
  targetNoteTitle?: string;
  targetStepTitle?: string;
};

import { t } from "../../i18n";

// リンクタイプの色と PROV-DM 対応（言語非依存）
export const LINK_TYPE_META: Record<LinkType, {
  provDM: string;
  color: string;
  layer: LinkLayer;
}> = {
  derived_from: { provDM: "wasDerivedFrom", color: "#8b7ab5", layer: "prov" },
  used: { provDM: "used", color: "#4B7A52", layer: "prov" },
  generated: { provDM: "wasGeneratedBy", color: "#c26356", layer: "prov" },
  reproduction_of: { provDM: "wasDerivedFrom", color: "#c08b3e", layer: "prov" },
  informed_by: { provDM: "wasInformedBy", color: "#5b8fb9", layer: "prov" },
  reference: { provDM: "(knowledge)", color: "#6b7f6e", layer: "knowledge" },
};

// リンクタイプの表示名（i18n 対応）
export function getLinkTypeLabel(type: LinkType): string {
  return t(`linkType.${type}`);
}

// createdBy の表示名（i18n 対応）
export function getCreatedByLabel(createdBy: CreatedBy): string {
  return t(`createdBy.${createdBy}`);
}

// 後方互換: LINK_TYPE_CONFIG を参照している既存コード向け
export const LINK_TYPE_CONFIG: Record<LinkType, {
  label: string;
  provDM: string;
  color: string;
  layer: LinkLayer;
}> = new Proxy(
  {} as any,
  {
    get: (_, key: string) => {
      const meta = LINK_TYPE_META[key as LinkType];
      if (!meta) return undefined;
      return { label: getLinkTypeLabel(key as LinkType), ...meta };
    },
  },
);

// 後方互換: CREATED_BY_LABELS
export const CREATED_BY_LABELS: Record<CreatedBy, string> = new Proxy(
  {} as Record<CreatedBy, string>,
  { get: (_, key: string) => getCreatedByLabel(key as CreatedBy) },
);
