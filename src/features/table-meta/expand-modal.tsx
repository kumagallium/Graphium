// テーブルの拡大表示モーダル
//
// 大きな表（装置ログの取り込みなど）は本文の幅では読みづらい。ここでは表を
// 画面いっぱいに出し、列見出しクリックで並べ替えられるようにする。
// - 中身は開いた時点のスナップショット
// - onSort を渡されたとき（ノート上の実テーブル）: 並べ替えは**表そのもの**に
//   反映される（列ハンドルメニューの並べ替えと同じ操作の別入口）。ホストが
//   sortTableBlock を実行して新しいスナップショットを渡し直す。戻すのは Undo
// - onSort が無いとき（データ素材プレビュー等、実表が無い場面）: ここだけの
//   見え方として並べ替える
// - セルはただの文字列のまま。数値が多い列だけ数値として比べる
//
// 表本体（SortableTable）はデータ素材のプレビューでも使う。表示と並べ替えの
// 実装を 1 か所に集め、モーダルはその外枠にすぎない。

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { t, useLocaleSubscription } from "../../i18n";
import { sortRows, type SortDir, type SortState } from "./sort-table";

// 比較ロジックは sort-table.ts に 1 本化（実テーブルの並べ替えと共有）
export { isNumericColumn, sortRows } from "./sort-table";

export type TableExpandData = {
  /** 表示名（キャプション or 自動名）。無名の表は空文字 */
  name: string;
  header: string[];
  rows: string[][];
};

/**
 * 並べ替えつきの読み取り専用テーブル。ヘッダ行は貼り付き、スクロールは
 * 親コンテナに任せる（親が overflow: auto を持つこと）。
 *
 * - onSort あり（制御モード）: 見出しクリックで onSort(col, dir) を呼ぶだけ。
 *   行は渡された順で描き、activeSort は表示にだけ使う（昇順 ⇄ 降順のトグル）
 * - onSort なし（ローカルモード）: ここだけの見え方として
 *   昇順 → 降順 → 元の並び を巡回する
 */
export function SortableTable({
  header,
  rows,
  onSort,
  activeSort,
}: {
  header: string[];
  rows: string[][];
  onSort?: (col: number, dir: SortDir) => void;
  activeSort?: SortState;
}) {
  const [localSort, setLocalSort] = useState<SortState>(null);

  // 中身が差し替わったらローカルの並べ替えはリセット（前のデータの列番号を引きずらない）
  useEffect(() => {
    setLocalSort(null);
  }, [rows]);

  const sort = onSort ? (activeSort ?? null) : localSort;
  const sorted = useMemo(
    () => (onSort ? rows : sortRows(rows, localSort)),
    [onSort, rows, localSort]
  );

  const cycleSort = (col: number) => {
    if (onSort) {
      // 実表の並べ替えに「元の並びに戻す」は無い（戻すのは Undo の役目）
      const dir: SortDir = sort?.col === col && sort.dir === "asc" ? "desc" : "asc";
      onSort(col, dir);
      return;
    }
    setLocalSort((cur) => {
      if (!cur || cur.col !== col) return { col, dir: "asc" };
      if (cur.dir === "asc") return { col, dir: "desc" };
      return null; // 3 回目で元の並びに戻す
    });
  };

  return (
    <table className="border-collapse text-[13px] w-full">
      <thead>
        <tr>
          {header.map((h, col) => {
            const active = sort?.col === col;
            return (
              <th
                key={col}
                onClick={() => cycleSort(col)}
                aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                className="sticky top-0 z-10 bg-muted text-left font-medium text-foreground px-3 py-2 border-b border-r border-border last:border-r-0 cursor-pointer select-none whitespace-nowrap hover:bg-accent"
              >
                <span className="inline-flex items-center gap-1">
                  {h || " "}
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
            {header.map((_, col) => (
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
  );
}

export function TableExpandModal({
  data,
  onClose,
  onSort,
  activeSort,
}: {
  /** null なら閉じている */
  data: TableExpandData | null;
  onClose: () => void;
  /**
   * 見出しクリックで実テーブルを並べ替えるハンドラ。ホストが sortTableBlock を
   * 実行し、並べ替え後のスナップショットで data を更新する（ビューは実表の鏡）。
   */
  onSort?: (col: number, dir: SortDir) => void;
  /** onSort 使用時の、いま適用中の並べ替え（矢印表示にだけ使う） */
  activeSort?: SortState;
}) {
  useLocaleSubscription();

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  if (!data) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      data-modal-portal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[min(1400px,94vw)] max-h-[90dvh] flex flex-col overflow-hidden">
        {/* ヘッダー: 表の名前と寸法。並べ替えがどこに効くかをここで断る */}
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
            {onSort ? t("tableMeta.expandSortApplyHint") : t("tableMeta.expandSortHint")}
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
          <SortableTable
            header={data.header}
            rows={data.rows}
            onSort={onSort}
            activeSort={activeSort}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
