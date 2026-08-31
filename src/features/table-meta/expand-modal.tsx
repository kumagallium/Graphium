// テーブルの拡大表示モーダル
//
// 大きな表（装置ログの取り込みなど）は本文の幅では読みづらい。ここでは表を
// 画面いっぱいに出し、列見出しクリックで並べ替えて眺められるようにする。
// - 中身は開いた時点のスナップショット（読み取り専用）。編集はしない
// - 並べ替えは**見え方だけ**で、元のテーブル（ノートのデータ）には一切触れない
// - セルはただの文字列のまま。数値が多い列だけ数値として比べる

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { parseNumeric } from "../../blocks/chart/chart-data";
import { t, useLocaleSubscription } from "../../i18n";

export type TableExpandData = {
  /** 表示名（キャプション or 自動名）。無名の表は空文字 */
  name: string;
  header: string[];
  rows: string[][];
};

type SortState = { col: number; dir: "asc" | "desc" } | null;

/**
 * 列を数値として並べ替えるべきか。非空セルの過半が数値として読めれば数値列とみなす。
 * （チャートの列判定と同じ「推定」の考え方。型を宣言させない）
 */
export function isNumericColumn(rows: string[][], col: number): boolean {
  let filled = 0;
  let numeric = 0;
  for (const row of rows) {
    const v = (row[col] ?? "").trim();
    if (v === "") continue;
    filled++;
    if (parseNumeric(v) !== null) numeric++;
  }
  return filled > 0 && numeric * 2 > filled;
}

/**
 * 行を並べ替えて返す（元配列は変えない）。
 * 数値列: 読めない値・空セルは常に末尾。文字列列: locale 比較、空セルは末尾。
 */
export function sortRows(rows: string[][], sort: SortState): string[][] {
  if (!sort) return rows;
  const { col, dir } = sort;
  const sign = dir === "asc" ? 1 : -1;
  const numeric = isNumericColumn(rows, col);
  // 同値のときは元の並びを保つ（安定ソート + 元 index）
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const va = (a.row[col] ?? "").trim();
      const vb = (b.row[col] ?? "").trim();
      if (va === "" && vb === "") return a.i - b.i;
      if (va === "") return 1;
      if (vb === "") return -1;
      if (numeric) {
        const na = parseNumeric(va);
        const nb = parseNumeric(vb);
        if (na === null && nb === null) return a.i - b.i;
        if (na === null) return 1;
        if (nb === null) return -1;
        return na === nb ? a.i - b.i : (na - nb) * sign;
      }
      const c = va.localeCompare(vb, undefined, { numeric: true });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}

export function TableExpandModal({
  data,
  onClose,
}: {
  /** null なら閉じている */
  data: TableExpandData | null;
  onClose: () => void;
}) {
  useLocaleSubscription();
  const [sort, setSort] = useState<SortState>(null);

  // 別の表を開いたら並べ替えはリセット（前の表の列番号を引きずらない）
  useEffect(() => {
    setSort(null);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  const sorted = useMemo(() => (data ? sortRows(data.rows, sort) : []), [data, sort]);

  if (!data) return null;

  const cycleSort = (col: number) => {
    setSort((cur) => {
      if (!cur || cur.col !== col) return { col, dir: "asc" };
      if (cur.dir === "asc") return { col, dir: "desc" };
      return null; // 3 回目で元の並びに戻す
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      data-modal-portal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[min(1400px,94vw)] max-h-[90dvh] flex flex-col overflow-hidden">
        {/* ヘッダー: 表の名前と寸法。並べ替えが見え方だけであることをここで断る */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {data.name || t("tableMeta.expandUntitled")}
          </h2>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {t("tableMeta.expandCount", {
              rows: String(data.rows.length),
              cols: String(data.header.length),
            })}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground hidden sm:block">
            {t("tableMeta.expandSortHint")}
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {/* 表本体。縦横ともここでスクロールし、ヘッダ行は貼り付ける */}
        <div className="overflow-auto">
          <table className="border-collapse text-[13px] w-full">
            <thead>
              <tr>
                {data.header.map((h, col) => {
                  const active = sort?.col === col;
                  return (
                    <th
                      key={col}
                      onClick={() => cycleSort(col)}
                      aria-sort={
                        active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"
                      }
                      className="sticky top-0 z-10 bg-muted text-left font-medium text-foreground px-3 py-2 border-b border-r border-border last:border-r-0 cursor-pointer select-none whitespace-nowrap hover:bg-accent"
                    >
                      <span className="inline-flex items-center gap-1">
                        {h || " "}
                        {active &&
                          (sort!.dir === "asc" ? (
                            <ArrowUp size={12} strokeWidth={2} />
                          ) : (
                            <ArrowDown size={12} strokeWidth={2} />
                          ))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={i} className="even:bg-muted/30">
                  {data.header.map((_, col) => (
                    <td
                      key={col}
                      className="px-3 py-1.5 border-b border-r border-border last:border-r-0 whitespace-nowrap text-foreground"
                    >
                      {row[col] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}
