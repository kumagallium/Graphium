// 条件を人が読む 1 行にする
//
// 来歴の表示とバッジのツールチップで使う。演算子の表示名は i18n のキーで持つので、
// t は呼び出し側から渡す（部品も来歴表示も同じ文言を引ける）。

import { isActiveCondition } from "./apply";
import type { ExtractCondition, ExtractSpec } from "./types";

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
