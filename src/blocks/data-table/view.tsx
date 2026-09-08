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
// - 描くのは見えている行だけ（grid.tsx。行の高さを固定にして位置を計算で出す）
// - 並べ替えは表示だけ（拡大ビューと同じ）。データは変えない
// - 素材が無い・読めないときはエラーにせず、出所を示す枠だけ残す（参照切れ）
// - 取り込み設定の見直しはホストのダイアログに任せる（callbacks.ts）
// - 計算ブロック・チャートは表示名（caption）で参照する（読み取りのみ。書き戻しは
//   本文の表だけ）。列の配布は calc/table-scope が peekDataTable で読む

import { createReactBlockSpec } from "@blocknote/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Database, Download, Maximize2, TriangleAlert } from "lucide-react";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t, useLocaleSubscription } from "../../i18n";
import type { TableSource } from "../../lib/document-types";
import {
  hasDataTableExportCallback,
  hasDataTableReimportCallback,
  requestDataTableExport,
  requestDataTableReimport,
  subscribeDataTableReimport,
} from "./callbacks";
import { loadDataTable, peekDataTable, type DataTableData } from "./data";
import { DataTableExpandModal } from "./expand-modal";
import { DataGrid } from "./grid";
import { dataTableDisplayName, parseDataTableSource } from "./source";
import { linkedColumnsFor, mergeLinkedColumns } from "./linked";
// calc の書き戻し宣言（計算列）を読む。Provider が無い場所（Storybook 等）でも動く optional 版
import { useTableMetaStoreOptional } from "../../features/table-meta/store";

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

  const [expanded, setExpanded] = useState(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  // 計算列込みで素材に書き出す。結果（素材名）を数秒だけキャプション行に出す
  const [exportedName, setExportedName] = useState<string | null>(null);
  const hostAcceptsExport = useSyncExternalStore(
    subscribeDataTableReimport,
    () => hasDataTableExportCallback(editor),
  );

  // calc が ⇥ でこのデータ表へ宣言した列を、素材の列の右に足して見せる（セルには書かない）
  const tableStore = useTableMetaStoreOptional();
  const calcWritebacks = tableStore?.calcWritebacks;
  const linked = useMemo(() => linkedColumnsFor(block.id, calcWritebacks), [block.id, calcWritebacks]);
  const merged = useMemo(
    () => (state.kind === "ready" ? mergeLinkedColumns(state.data, linked) : null),
    [state, linked],
  );

  return (
    <div style={styles.root} data-data-table-block>
      {/* 本文の表と同じく、名前・出所・行数・拡大は表の上の 1 行にまとめる */}
      <CaptionRow
        caption={caption}
        editable={editable}
        onCommit={commitCaption}
        source={source}
        data={merged ? merged.data : null}
        canReimport={editable && !!source?.fileId && hostAcceptsReimport}
        onReimport={reimport}
        onExpand={merged ? () => setExpanded(true) : undefined}
        onExport={
          merged && source && hostAcceptsExport
            ? () => {
                const p = requestDataTableExport(editor, {
                  blockId: block.id,
                  source,
                  caption: dataTableDisplayName(caption, source),
                  headers: merged.data.headers,
                  rows: merged.data.rows,
                });
                if (!p) return;
                void p.then((name) => {
                  if (!name) return;
                  setExportedName(name);
                  setTimeout(() => setExportedName(null), 4000);
                });
              }
            : undefined
        }
        exportedName={exportedName}
      />
      {merged ? (
        <DataGrid data={merged.data} linked={merged.linked} />
      ) : (
        <Placeholder state={state.kind === "ready" ? "loading" : state.kind} source={source} />
      )}
      {expanded && merged && (
        <DataTableExpandModal
          caption={dataTableDisplayName(caption, source)}
          data={merged.data}
          linked={merged.linked}
          onClose={closeExpanded}
        />
      )}
    </div>
  );
}

/** 表の上の 1 行: 名前（編集可）+ 出所バッジ + 行数 + 拡大。本文の表のキャプション層と同じ並び */
function CaptionRow({
  caption,
  editable,
  onCommit,
  source,
  data,
  canReimport,
  onReimport,
  onExpand,
  onExport,
  exportedName,
}: {
  caption: string;
  editable: boolean;
  onCommit: (next: string) => void;
  source: TableSource | null;
  data: DataTableData | null;
  canReimport: boolean;
  onReimport: () => void;
  onExpand?: () => void;
  onExport?: () => void;
  exportedName?: string | null;
}) {
  const [draft, setDraft] = useState(caption);
  useEffect(() => setDraft(caption), [caption]);
  const name = editable ? (
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
      // 名前の長さに合わせて幅を取る（バッジを右に押し出さない）
      style={{ ...styles.captionInput, width: `${Math.max(6, draft.length + 1)}ch` }}
      aria-label={t("dataTable.captionPlaceholder")}
    />
  ) : caption.trim() === "" ? null : (
    <span style={styles.caption}>{caption}</span>
  );
  return (
    <div style={styles.captionRow}>
      {name}
      {source && (
        <button
          type="button"
          onClick={canReimport ? onReimport : undefined}
          disabled={!canReimport}
          title={canReimport ? t("dataImport.sourceClickHint") : undefined}
          style={{ ...styles.badge, cursor: canReimport ? "pointer" : "default" }}
        >
          <Database size={10} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span style={styles.ellipsis}>{t("dataImport.sourceBadge", { fileName: source.fileName })}</span>
        </button>
      )}
      {data && (
        <span style={styles.badge}>
          {t("dataTable.rowsCols", {
            rows: data.rows.length.toLocaleString(),
            cols: String(data.headers.length),
          })}
        </span>
      )}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          title={t("tableMeta.expand")}
          aria-label={t("tableMeta.expand")}
          style={{ ...styles.badge, ...styles.iconBadge }}
        >
          <Maximize2 size={10} strokeWidth={2} />
        </button>
      )}
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          title={t("dataTable.exportAsset")}
          aria-label={t("dataTable.exportAsset")}
          style={{ ...styles.badge, ...styles.iconBadge }}
        >
          <Download size={10} strokeWidth={2} />
        </button>
      )}
      {exportedName && (
        <span style={styles.exported}>{t("dataTable.exported", { name: exportedName })}</span>
      )}
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

const styles: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    margin: "4px 0",
  },
  captionRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minHeight: 22,
    padding: "0 2px",
    minWidth: 0,
  },
  caption: {
    fontSize: 13,
    color: "var(--color-foreground)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  captionInput: {
    fontSize: 13,
    color: "var(--color-foreground)",
    background: "transparent",
    border: "none",
    outline: "none",
    padding: 0,
    minWidth: 48,
    maxWidth: "60%",
  },
  // 本文の表のキャプション層のバッジ（features/table-meta/caption-layer）と同じ寸法
  badge: {
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
  },
  iconBadge: {
    padding: "0 5px",
    cursor: "pointer",
  },
  exported: {
    fontSize: 10,
    color: "var(--color-text-tertiary)",
    whiteSpace: "nowrap",
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
};
