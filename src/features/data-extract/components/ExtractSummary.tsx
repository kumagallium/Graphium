// 結果の要約の 1 行: 「233,000 行のうち 1,204 行 × 4 列」
//
// 0 行のときと、元と同じ内容のときは、確定してよいか迷う理由を控えめな注記で添える
// （警告ではないので、注意の帯の背景色は使わない）。

import { t, useLocaleSubscription } from "../../../i18n";

export function ExtractSummary({
  sourceRows,
  resultRows,
  columnCount,
  sameAsSource,
}: {
  sourceRows: number;
  resultRows: number;
  columnCount: number;
  /** 条件が 1 つも無く全列（＝元と同じ内容）か */
  sameAsSource: boolean;
}) {
  useLocaleSubscription();
  const note =
    resultRows === 0
      ? t("dataExtract.zeroRows")
      : sameAsSource
        ? t("dataExtract.sameAsSource")
        : null;
  return (
    <div>
      <span className="text-xs text-foreground">
        {t("dataExtract.summary", {
          total: sourceRows.toLocaleString(),
          rows: resultRows.toLocaleString(),
          cols: String(columnCount),
        })}
      </span>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
