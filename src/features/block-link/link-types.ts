// ──────────────────────────────────────────────
// ブロック間リンクのタイプ定義（表示メタ・i18n 依存関数）
// thought-provenance-spec.md § 0-B に準拠
// データ型本体は src/lib/block-link-types.ts に移設済み（lib は features に依存できないため）。
// ──────────────────────────────────────────────

export type {
  LinkLayer,
  ProvLinkType,
  KnowledgeLinkType,
  LinkType,
  CreatedBy,
  BlockLink,
} from "../../lib/block-link-types";
export { PROV_LINK_TYPES, isProvLink } from "../../lib/block-link-types";

import type { LinkType, LinkLayer, CreatedBy } from "../../lib/block-link-types";
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
