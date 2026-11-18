// 条件を人が読む 1 行にする
//
// 来歴の表示とバッジのツールチップで使う。演算子の表示名は i18n のキーで持つので、
// t は呼び出し側から渡す（部品も来歴表示も同じ文言を引ける）。

import { isActiveCondition } from "./apply";
import type { ExtractCondition, ExtractSpec, TableDerivation } from "./types";

type T = (key: string, params?: Record<string, string>) => string;

/** 例: `prop_y = Seebeck coefficient` / `temperature ≥ 300` / `comment を含む "ok"` / `value が空でない` */
export function describeCondition(c: ExtractCondition, t: T): string {
  const value = (c.value ?? "").trim();
  if (c.op === "notEmpty") return t("dataExtract.describe.notEmpty", { column: c.column });
  if (c.op === "contains") return t("dataExtract.describe.contains", { column: c.column, value });
  return `${c.column} ${t(`dataExtract.op.${c.op}`)} ${value}`;
}

/** 取り出しの指定を 1 行にする。書きかけの条件は結果に効かないので出さない */
export function describeSpec(spec: ExtractSpec, t: T): string {
  const parts: string[] = [];
  if (spec.columns.length > 0) {
    parts.push(t("dataExtract.describe.columns", { columns: spec.columns.join(", ") }));
  }
  const conds = spec.conditions.filter(isActiveCondition).map((c) => describeCondition(c, t));
  if (conds.length > 0) parts.push(conds.join(t("dataExtract.describe.and")));
  return parts.length > 0 ? parts.join(" / ") : t("dataExtract.describe.all");
}

/**
 * 表の上の「条件の 1 行」。行数を先に、条件の文を後に出す:
 * 「120 行のうち 30 行: temp_c ≥ 200 かつ dough = baguette」。長くて省略されるのは条件の側で、行数は必ず見える
 *
 * 列だけ選んで条件が無いときは、列名を並べず個数で言う（長くなって 1 行に収まらないため）:
 * 「120 行のうち 120 行: 3 列を選択」。何も絞っていない来歴は「全列・全行」
 */
export function describeDerivation(derivation: TableDerivation, t: T): string {
  const parts: string[] = [];
  const conds = derivation.conditions.filter(isActiveCondition).map((c) => describeCondition(c, t));
  if (conds.length > 0) parts.push(conds.join(t("dataExtract.describe.and")));
  // 全列のまま（元の列の数と同じ）なら、列のことは書かない。古い来歴（sourceColumns なし）は従来どおり
  const allColumns =
    derivation.sourceColumns !== undefined && derivation.columns.length === derivation.sourceColumns;
  if (derivation.columns.length > 0 && !allColumns) {
    parts.push(t("dataExtract.describe.columnCount", { count: String(derivation.columns.length) }));
  }
  const spec = parts.length > 0 ? parts.join(" / ") : t("dataExtract.describe.all");
  return t("dataExtract.describe.withRows", {
    spec,
    rows: derivation.resultRows.toLocaleString(),
    total: derivation.sourceRows.toLocaleString(),
  });
}
