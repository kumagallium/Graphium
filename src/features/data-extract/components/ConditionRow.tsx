// 条件の 1 行: [列] [演算子] [値] [×]
//
// 制御された部品。列の種類で演算子の候補を変え、種類の少ない列では値の候補を出す。

import { useId } from "react";
import { t, useLocaleSubscription } from "../../../i18n";
import type { ColumnKind, ColumnProfile, ExtractCondition, ExtractOperator } from "../types";

/** 列の種類ごとの演算子の候補。大小比較は数値の列だけ（文字の列では意味が定まらない） */
const OPERATORS: Record<ColumnKind, ExtractOperator[]> = {
  number: ["eq", "ne", "gt", "ge", "lt", "le", "notEmpty"],
  text: ["eq", "ne", "contains", "notEmpty"],
};

const FIELD =
  "text-[11px] px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary";

export function ConditionRow({
  columns,
  condition,
  onChange,
  onRemove,
}: {
  columns: ColumnProfile[];
  condition: ExtractCondition;
  onChange: (next: ExtractCondition) => void;
  onRemove: () => void;
}) {
  useLocaleSubscription();
  const listId = useId();
  const profile = columns.find((c) => c.name === condition.column);
  const kind: ColumnKind = profile?.kind ?? "text";
  const operators = OPERATORS[kind];
  const showCandidates =
    (condition.op === "eq" || condition.op === "ne") && (profile?.distinct?.length ?? 0) > 0;

  const changeColumn = (name: string) => {
    const nextKind = columns.find((c) => c.name === name)?.kind ?? "text";
    // 列を替えて今の演算子が使えなくなったとき（数値 → 文字で ≥ など）は「=」に戻す
    const op = OPERATORS[nextKind].includes(condition.op) ? condition.op : "eq";
    onChange({ ...condition, column: name, op });
  };
  const changeOp = (op: ExtractOperator) => {
    // 「空でない」は値を取らないので、前の入力を持ち越さない
    onChange(op === "notEmpty" ? { column: condition.column, op } : { ...condition, op });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={condition.column}
        aria-label={t("dataExtract.column")}
        onChange={(e) => changeColumn(e.target.value)}
        className={`${FIELD} max-w-[160px]`}
      >
        {condition.column === "" && <option value="">{t("dataExtract.column")}</option>}
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={condition.op}
        aria-label={t("dataExtract.condition")}
        onChange={(e) => changeOp(e.target.value as ExtractOperator)}
        className={FIELD}
      >
        {operators.map((op) => (
          <option key={op} value={op}>
            {t(`dataExtract.op.${op}`)}
          </option>
        ))}
      </select>
      {condition.op !== "notEmpty" && (
        <>
          <input
            type="text"
            value={condition.value ?? ""}
            list={showCandidates ? listId : undefined}
            placeholder={t("dataExtract.value")}
            aria-label={t("dataExtract.value")}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className={`${FIELD} w-40`}
          />
          {showCandidates && (
            <datalist id={listId}>
              {profile!.distinct!.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("dataExtract.removeCondition")}
        className="w-6 h-6 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
