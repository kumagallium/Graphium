// データ表の表本体（見えている行だけを描く）
//
// ブロック内の表示と拡大モーダルの両方で使う。行の高さを固定にして、スクロール位置から
// 描くべき行を計算で出す（仮想スクロール）。並べ替えは表示だけで、データは変えない。

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Calculator } from "lucide-react";
import { t } from "../../i18n";
import type { SortState } from "../../features/table-meta/sort-table";
import type { DataTableData } from "./data";
import type { LinkedColumn } from "./linked";
import {
  HEADER_HEIGHT,
  INDEX_COLUMN_WIDTH,
  ROW_HEIGHT,
  VISIBLE_ROWS,
  buildColumnModels,
  orderRows,
  tableWidth,
  viewportHeightFor,
  visibleRowRange,
} from "./model";

export function DataGrid({
  data,
  visibleRows = VISIBLE_ROWS,
  linked = [],
}: {
  data: DataTableData;
  /** 一度に見せる行数。これを超えると表の中でスクロールする */
  visibleRows?: number;
  /** 末尾に足した計算列（calc の書き戻し）。見出しにバッジを出す */
  linked?: LinkedColumn[];
}) {
  const { headers, rows } = data;
  const linkedStart = headers.length - linked.length;
  const columns = useMemo(() => buildColumnModels(headers, rows), [headers, rows]);
  const [sort, setSort] = useState<SortState>(null);
  const order = useMemo(() => orderRows(rows, sort), [rows, sort]);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const height = viewportHeightFor(rows.length, visibleRows);
  const bodyHeight = height - HEADER_HEIGHT;
  const { start, end } = visibleRowRange(scrollTop, bodyHeight, rows.length);
  const width = tableWidth(columns);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const toggleSort = (col: number) => {
    setSort((cur) => {
      if (!cur || cur.col !== col) return { col, dir: "asc" };
      if (cur.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{ ...styles.scroller, height }}
      role="table"
      aria-rowcount={rows.length + 1}
      aria-colcount={headers.length + 1}
      // 表の中はブロックの編集対象ではない（テキスト選択はできる）
      contentEditable={false}
    >
      <div style={{ ...styles.header, width }} role="row">
        <div
          style={{ ...styles.headerCell, ...styles.indexCell, width: INDEX_COLUMN_WIDTH }}
          role="columnheader"
        >
          {t("dataTable.rowNumber")}
        </div>
        {headers.map((h, col) => {
          const active = sort?.col === col;
          const linkedColumn = col >= linkedStart ? linked[col - linkedStart] : undefined;
          return (
            <button
              key={col}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
              onClick={() => toggleSort(col)}
              title={
                linkedColumn
                  ? t("dataTable.linkedColumn", { calc: linkedColumn.calcName || t("calc.label") })
                  : t("dataTable.sortHint")
              }
              data-linked-column={linkedColumn ? "true" : undefined}
              style={{
                ...styles.headerCell,
                ...styles.headerButton,
                width: columns[col].width,
                justifyContent: columns[col].numeric ? "flex-end" : "flex-start",
                color: active ? "var(--color-foreground)" : "var(--color-text-secondary)",
              }}
            >
              {linkedColumn && <Calculator size={11} strokeWidth={2} style={{ flexShrink: 0 }} />}
              <span style={styles.ellipsis}>{h}</span>
              {active &&
                (sort!.dir === "asc" ? (
                  <ArrowUp size={11} style={{ flexShrink: 0 }} />
                ) : (
                  <ArrowDown size={11} style={{ flexShrink: 0 }} />
                ))}
            </button>
          );
        })}
      </div>
      <div style={{ position: "relative", height: rows.length * ROW_HEIGHT, width }}>
        {order.slice(start, end).map((rowIndex, i) => {
          const row = rows[rowIndex];
          const top = (start + i) * ROW_HEIGHT;
          return (
            <div key={rowIndex} role="row" aria-rowindex={rowIndex + 2} style={{ ...styles.row, top }}>
              <div
                style={{ ...styles.cell, ...styles.indexCell, width: INDEX_COLUMN_WIDTH }}
                role="cell"
              >
                {rowIndex + 1}
              </div>
              {columns.map((c, col) => (
                <div
                  key={col}
                  role="cell"
                  style={{
                    ...styles.cell,
                    width: c.width,
                    textAlign: c.numeric ? "right" : "left",
                    fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
                  }}
                >
                  {row[col] ?? ""}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  scroller: {
    overflow: "auto",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 8,
    background: "var(--color-surface)",
    fontSize: 13,
    lineHeight: `${ROW_HEIGHT}px`,
    userSelect: "text",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    height: HEADER_HEIGHT,
    background: "var(--color-muted)",
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  headerCell: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: HEADER_HEIGHT,
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 500,
    boxSizing: "border-box",
    flexShrink: 0,
    borderRight: "1px solid var(--color-border-subtle)",
    overflow: "hidden",
  },
  headerButton: {
    background: "transparent",
    border: "none",
    borderRight: "1px solid var(--color-border-subtle)",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
  },
  row: {
    position: "absolute",
    left: 0,
    display: "flex",
    height: ROW_HEIGHT,
    borderBottom: "1px solid var(--color-border-subtle)",
    boxSizing: "border-box",
  },
  cell: {
    height: ROW_HEIGHT,
    padding: "0 10px",
    boxSizing: "border-box",
    flexShrink: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    borderRight: "1px solid var(--color-border-subtle)",
    color: "var(--color-foreground)",
  },
  indexCell: {
    color: "var(--color-text-tertiary)",
    fontSize: 11,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    justifyContent: "flex-end",
  },
  ellipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
