// データ表ブロック
//
// 取り込んだ区切りテキスト（装置の .txt / .dat / .csv）を、ノート本文の表に展開せず
// 素材への参照として持つ。表は「見せるもの」で、実体は素材のまま。
//
// なぜ本文の表と別に持つか:
// - 本文の表は 1 セルが 1 ノードで、編集のたびに文書全体を直列化する（保存・PROV・
//   索引・計算列）。行数にそのまま比例して重くなり、2,000 行で編集が止まる
// - 測定データは「セルを書き換える」ものではなく「読む・図にする」もの。本文の表の
//   編集機能は要らない代わりに、行数に強いことが要る
//
// 設計メモ:
// - props は source（TableSource の JSON。取り込み設定と出所。tableMeta.source と
//   同じ形）と caption だけ。行は持たない
// - 描くのは見えている行だけ（仮想スクロール）。行の高さを固定にして位置を計算で出す
// - 並べ替えは表示だけ（拡大ビューと同じ）。データは変えない
// - 素材が無い・読めないときはエラーにせず、出所を示す枠だけ残す（参照切れ）
// - 取り込み設定の見直しはホストのダイアログに任せる（callbacks.ts）

import { createReactBlockSpec } from "@blocknote/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { TriangleAlert, ArrowDown, ArrowUp, Database } from "lucide-react";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t, useLocaleSubscription } from "../../i18n";
import type { TableSource } from "../../lib/document-types";
import type { SortState } from "../../features/table-meta/sort-table";
import { defaultCaption } from "../../features/data-import/to-table-block";
import {
  hasDataTableReimportCallback,
  requestDataTableReimport,
  subscribeDataTableReimport,
} from "./callbacks";
import { loadDataTable, peekDataTable, type DataTableData } from "./data";
import {
  HEADER_HEIGHT,
  INDEX_COLUMN_WIDTH,
  ROW_HEIGHT,
  buildColumnModels,
  orderRows,
  parseDataTableSource,
  tableWidth,
  viewportHeightFor,
  visibleRowRange,
} from "./model";

export const DataTableBlock = createReactBlockSpec(
  {
    type: "dataTable" as const,
    propSchema: {
      /** 出所と読み方（TableSource の JSON）。行の実体はここが指す素材にある */
      source: { default: "" },
      /** 表の名前。学術文書の慣例どおり表の上に出す */
      caption: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => <DataTableBlockView {...(props as any)} />,
  },
);

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: DataTableData }
  | { kind: "missing" };

function DataTableBlockView({ block, editor }: { block: any; editor: any }) {
  useLocaleSubscription();
  const editable = (editor as any).isEditable !== false;
  const source = useMemo(() => parseDataTableSource(block.props.source), [block.props.source]);

  const [state, setState] = useState<LoadState>(() => {
    const data = source ? peekDataTable(source) : null;
    return data ? { kind: "ready", data } : source?.fileId ? { kind: "loading" } : { kind: "missing" };
  });

  useEffect(() => {
    if (!source?.fileId) {
      setState({ kind: "missing" });
      return;
    }
    const cached = peekDataTable(source);
    if (cached) {
      setState({ kind: "ready", data: cached });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    loadDataTable(source)
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const caption = String(block.props.caption ?? "");
  const commitCaption = useCallback(
    (next: string) => {
      if (next === caption) return;
      editor.updateBlock(block, { props: { caption: next } });
    },
    [editor, block, caption],
  );

  const reimport = useCallback(() => {
    if (!source) return;
    requestDataTableReimport(editor, block.id, source);
  }, [editor, block.id, source]);
  // ホストの登録はブロックの初回描画より後に入るので、登録の変化を購読して描き直す
  const hostAcceptsReimport = useSyncExternalStore(
    subscribeDataTableReimport,
    () => hasDataTableReimportCallback(editor),
  );

  return (
    <div style={styles.root} data-data-table-block>
      <CaptionLine caption={caption} editable={editable} onCommit={commitCaption} />
      {state.kind === "ready" ? (
        <DataGrid data={state.data} />
      ) : (
        <Placeholder state={state.kind} source={source} />
      )}
      <FooterLine
        source={source}
        data={state.kind === "ready" ? state.data : null}
        canReimport={editable && !!source?.fileId && hostAcceptsReimport}
        onReimport={reimport}
      />
    </div>
  );
}

function CaptionLine({
  caption,
  editable,
  onCommit,
}: {
  caption: string;
  editable: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(caption);
  useEffect(() => setDraft(caption), [caption]);
  if (!editable) {
    return caption.trim() === "" ? null : <div style={styles.caption}>{caption}</div>;
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder={t("dataTable.captionPlaceholder")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(caption);
          (e.currentTarget as HTMLInputElement).blur();
        }
        // BlockNote にキー操作を取られない（ブロック削除・移動が走る）
        e.stopPropagation();
      }}
      style={styles.captionInput}
      aria-label={t("dataTable.captionPlaceholder")}
    />
  );
}

/** 見えている行だけを描く表。見出しは上に固定 */
function DataGrid({ data }: { data: DataTableData }) {
  const { headers, rows } = data;
  const columns = useMemo(() => buildColumnModels(headers, rows), [headers, rows]);
  const [sort, setSort] = useState<SortState>(null);
  const order = useMemo(() => orderRows(rows, sort), [rows, sort]);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const height = viewportHeightFor(rows.length);
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
        <div style={{ ...styles.headerCell, ...styles.indexCell, width: INDEX_COLUMN_WIDTH }} role="columnheader">
          {t("dataTable.rowNumber")}
        </div>
        {headers.map((h, col) => {
          const active = sort?.col === col;
          return (
            <button
              key={col}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
              onClick={() => toggleSort(col)}
              title={t("dataTable.sortHint")}
              style={{
                ...styles.headerCell,
                ...styles.headerButton,
                width: columns[col].width,
                justifyContent: columns[col].numeric ? "flex-end" : "flex-start",
                color: active ? "var(--color-foreground)" : "var(--color-text-secondary)",
              }}
            >
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
            <div
              key={rowIndex}
              role="row"
              aria-rowindex={rowIndex + 2}
              style={{ ...styles.row, top }}
            >
              <div style={{ ...styles.cell, ...styles.indexCell, width: INDEX_COLUMN_WIDTH }} role="cell">
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

function Placeholder({ state, source }: { state: "loading" | "missing"; source: TableSource | null }) {
  return (
    <div style={styles.placeholder}>
      {state === "loading" ? (
        <>
          <Database size={14} style={{ flexShrink: 0 }} />
          <span>{t("dataTable.loading")}</span>
        </>
      ) : (
        <>
          <TriangleAlert size={14} style={{ flexShrink: 0 }} />
          <span>
            {t("dataTable.missing", { fileName: source?.fileName ?? "" })}
            <span style={styles.placeholderHint}>{t("dataTable.missingHint")}</span>
          </span>
        </>
      )}
    </div>
  );
}

function FooterLine({
  source,
  data,
  canReimport,
  onReimport,
}: {
  source: TableSource | null;
  data: DataTableData | null;
  canReimport: boolean;
  onReimport: () => void;
}) {
  if (!source) return null;
  return (
    <div style={styles.footer}>
      {data && (
        <span>
          {t("dataTable.rowsCols", {
            rows: data.rows.length.toLocaleString(),
            cols: String(data.headers.length),
          })}
        </span>
      )}
      <button
        type="button"
        onClick={canReimport ? onReimport : undefined}
        disabled={!canReimport}
        title={canReimport ? t("dataImport.sourceClickHint") : undefined}
        style={{ ...styles.sourceBadge, cursor: canReimport ? "pointer" : "default" }}
      >
        <Database size={11} style={{ flexShrink: 0 }} />
        <span style={styles.ellipsis}>{t("dataImport.sourceBadge", { fileName: source.fileName })}</span>
      </button>
    </div>
  );
}

// キャプションの既定表示名（取り込み時に caption が空のまま入ったときの保険）
export function dataTableDisplayName(caption: string, source: TableSource | null): string {
  const trimmed = caption.trim();
  if (trimmed) return trimmed;
  return source ? defaultCaption(source.fileName) : "";
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    margin: "4px 0",
  },
  caption: {
    fontSize: 13,
    color: "var(--color-foreground)",
    padding: "0 2px",
  },
  captionInput: {
    fontSize: 13,
    color: "var(--color-foreground)",
    background: "transparent",
    border: "none",
    outline: "none",
    padding: "0 2px",
    width: "100%",
  },
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
  placeholder: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px dashed var(--color-border-subtle)",
    background: "var(--color-muted)",
    color: "var(--color-text-secondary)",
    fontSize: 12,
  },
  placeholderHint: {
    display: "block",
    marginTop: 2,
    color: "var(--color-text-tertiary)",
    fontSize: 11,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 11,
    color: "var(--color-text-tertiary)",
    padding: "0 2px",
    minWidth: 0,
  },
  sourceBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    maxWidth: "60%",
    padding: "1px 8px",
    borderRadius: 999,
    border: "1px solid var(--color-border-subtle)",
    background: "transparent",
    color: "var(--color-text-tertiary)",
    fontSize: 10,
    font: "inherit",
    lineHeight: "16px",
  },
};
