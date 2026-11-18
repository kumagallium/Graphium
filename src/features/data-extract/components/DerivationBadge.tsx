// 由来のバッジ: 「絞り込み: oven-curves.csv」
//
// データ表の上に並ぶ既存のバッジ（blocks/data-table/view.tsx の styles.badge）と同じ寸法・書式。
// 絞り込みの中身と行数はツールチップ（data-tooltip）で見せる。

import { Filter } from "lucide-react";
import type { CSSProperties } from "react";
import { t, useLocaleSubscription } from "../../../i18n";
import { describeSpec } from "../describe";
import type { TableDerivation } from "../types";

// data-table/view.tsx の styles.badge と同じ値。あちらは非公開なので複製している
const badge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  height: 18,
  padding: "0 6px",
  borderRadius: 9,
  border: "1px solid var(--color-border-subtle)",
  background: "transparent",
  color: "var(--color-text-tertiary)",
  fontSize: 10,
  lineHeight: "16px",
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  maxWidth: "50%",
  minWidth: 0,
};

export function DerivationBadge({ derivation }: { derivation: TableDerivation }) {
  useLocaleSubscription();
  const tooltip = t("dataExtract.badgeTooltip", {
    spec: describeSpec(
      { columns: derivation.columns, conditions: derivation.conditions },
      t
    ),
    rows: derivation.resultRows.toLocaleString(),
    total: derivation.sourceRows.toLocaleString(),
  });
  return (
    <span style={badge} data-tooltip={tooltip}>
      <Filter size={10} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t("dataExtract.badge", { fileName: derivation.fromFileName })}
      </span>
    </span>
  );
}
