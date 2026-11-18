// 取り込み画面の「絞り込む」の段
//
// 設定（行の範囲・区切り）の下、プレビューの上に置く。畳んだ状態が既定で、
// 開くと列の選択・条件・結果の要約が出る。制御された部品で、状態と計算は
// 取り込み画面（DataImportModal）が持つ。
//
// 畳んだ 1 行は、条件や列の選択が入っていればその文と行数を、入っていなければ
// 控えめな説明を右に出す。ノートには条件を選ぶ部品を出さないので、
// 条件を直せる場所はこの段だけ。

import { ChevronDown, ChevronRight } from "lucide-react";
import { t, useLocaleSubscription } from "../../../i18n";
import type { ColumnProfile, ExtractCondition } from "../types";
import { ColumnChooser } from "./ColumnChooser";
import { ConditionRow } from "./ConditionRow";

// 取り込み画面の設定の「調整」ボタンなどと同じ書式
const ACTION =
  "px-2.5 py-1 text-[11px] rounded border border-border text-muted-foreground hover:bg-muted transition-colors";

/** 全体を読んでいる間の表示。大きなファイルで段を開いた直後に出る */
export function ExtractLoading() {
  useLocaleSubscription();
  return (
    <p role="status" className="text-[11px] text-muted-foreground">
      {t("dataExtract.loading")}
    </p>
  );
}

export function ExtractSection({
  open,
  onToggle,
  collapsedSummary,
  loading,
  columns,
  selectedColumns,
  onColumnsChange,
  conditions,
  onConditionsChange,
}: {
  open: boolean;
  onToggle: () => void;
  /**
   * 畳んだときに説明の代わりに出す文（条件の文と行数）。null なら控えめな説明を出す。
   * 文の組み立ては呼び出し側（結果の行数を持っている）に任せる
   */
  collapsedSummary: string | null;
  /** 全体を読んでいる最中か。true の間は列・条件・要約の代わりに「読んでいます」を出す */
  loading: boolean;
  columns: ColumnProfile[];
  /** 選んだ列（表の列の順）。「すべて」のときも全列の名前を渡す */
  selectedColumns: string[];
  onColumnsChange: (selected: string[]) => void;
  conditions: ExtractCondition[];
  onConditionsChange: (next: ExtractCondition[]) => void;
}) {
  useLocaleSubscription();
  const Chevron = open ? ChevronDown : ChevronRight;
  const addCondition = () =>
    onConditionsChange([...conditions, { column: columns[0]?.name ?? "", op: "eq", value: "" }]);

  return (
    <div className="px-4 py-2 border-b border-border shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-left"
      >
        <Chevron size={12} strokeWidth={2} className="shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground shrink-0">
          {t("dataExtract.sectionTitle")}
        </span>
        {/* 開いているときは中身がすべて見えているので、右の説明は出さない */}
        {!open && (
          <span
            className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground"
            data-tooltip={collapsedSummary ?? undefined}
          >
            {collapsedSummary ?? t("dataExtract.sectionHint")}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {loading ? (
            <ExtractLoading />
          ) : (
            <>
              <ColumnChooser
                columns={columns}
                selected={selectedColumns}
                onChange={onColumnsChange}
              />
              <div>
                {/* 見出しの右隣に置く。条件の行が増えても押せるよう、行の外に出してある */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[11px] font-medium text-foreground mr-1">
                    {t("dataExtract.condition")}
                  </span>
                  <button type="button" className={ACTION} onClick={addCondition}>
                    {t("dataExtract.addCondition")}
                  </button>
                </div>
                {/* スクロールするのは条件の行だけ */}
                <div className="flex flex-col gap-1.5 max-h-16 overflow-y-auto">
                  {conditions.map((c, i) => (
                    <ConditionRow
                      key={i}
                      columns={columns}
                      condition={c}
                      onChange={(next) =>
                        onConditionsChange(conditions.map((x, j) => (j === i ? next : x)))
                      }
                      onRemove={() => onConditionsChange(conditions.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
