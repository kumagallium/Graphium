// 選択中ノードの裏にある step の中身（全テーブル）を編集するパネル。
//
// パネルは「ステップの中身ぜんぶ」— パラメータ / インプット / ツール /
// アウトプットの 4 セクション + 本文 span 由来の一覧。step を選んでも、
// その中の Entity を選んでも同じパネルで、Entity 選択は該当行のハイライト +
// そこへのスクロールになるだけ。グラフからの追加はすべてここ（行を追加 /
// 列を追加）に一本化されている（step カードの追加ボタンは持たない）。
//
// 1 セクション = 1 カード。ノート側で 1 つのラベル付き表が 1 ブロックなのと
// 同じ区切りで、見出しにはグラフのノードと同じ種類色の帯 + ノートの表と
// 同じラベルチップを置く。表がまだ無いセクションは破線カード。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t, getDisplayLabel } from "../../i18n";
import { splitAttrLabel, type ActivityIoKind, type FlowEntity, type FlowStep } from "./activity-graph-adapter";
import { KIND_PALETTE } from "./flow-palette";
import type { TableData } from "./table-row-edit";

export type FlowSelection =
  | { kind: "step"; step: FlowStep }
  | { kind: "entity"; entity: FlowEntity }
  | null;

export type SectionKind = "attribute" | ActivityIoKind;

/** 本文 span 由来（表になっていないもの） */
export type ProseItem = {
  entityId: string;
  /** グラフのノード id（Entity のみ。表へ移すときに使う） */
  nodeId?: string;
  kind: SectionKind;
  label: string;
};

/** 選択の裏にある step の中身（getPanelFor が組み立てる） */
export type StepPanelData = {
  stepId: string;
  stepName: string;
  tables: Record<SectionKind, TableData | null>;
  /** テーブル行 Entity を選択中: その行をハイライト */
  highlight?: { blockId: string; rowName: string };
  prose: ProseItem[];
  /** 本文 span 由来の項目を選択中: その entityId */
  proseHighlight?: string;
};

export type FlowStepPanelProps = {
  selection: FlowSelection;
  data: StepPanelData | null;
  // ── テーブル編集（既存の表） ──
  onSetCell?: (blockId: string, rowIndex: number, colIndex: number, value: string) => void;
  onRenameColumn?: (blockId: string, colIndex: number, name: string) => void;
  onAddColumn?: (blockId: string, name: string) => void;
  onRemoveColumn?: (blockId: string, colIndex: number) => void;
  onAddRow?: (blockId: string, name: string) => void;
  // ── 表がまだ無いセクション ──
  /** 入出力・ツール: 表ごと作って 1 行目に name を書く（ラベルも付く） */
  onAddEntityRow?: (stepBlockId: string, kind: ActivityIoKind, name: string) => void;
  /** パラメータ: 既定のキー列 1 つで表を作る（できたらキーを編集状態にする） */
  onCreateParamTable?: (stepBlockId: string) => void;
  // ── 本文 span 由来の編集 ──
  onRenameEntity?: (entityId: string, text: string) => void;
  onRemoveEntity?: (entityId: string) => void;
  /** 本文 span 由来の Entity を所属 step の表へ移す（nodeId 指定） */
  onMoveEntityToTable?: (entityNodeId: string) => void;
};

const SECTION_ORDER: SectionKind[] = ["attribute", "material", "tool", "output"];

// パラメータのグレーグリーンはノート側の [パラメータ] チップと同じ
const SECTION_COLOR: Record<SectionKind, string> = {
  attribute: "#8fa394",
  material: KIND_PALETTE.material.main,
  tool: KIND_PALETTE.tool.main,
  output: KIND_PALETTE.output.main,
};

const th: CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 700,
  textAlign: "left",
  whiteSpace: "nowrap",
  background: "var(--color-surface)",
  borderBottom: "1px solid var(--color-border)",
  borderRight: "1px solid var(--color-border-subtle)",
};

const td: CSSProperties = {
  padding: "3px 8px",
  fontSize: 12,
  // 空セルでも行が潰れないように高さを持たせる（クリック対象が線になるのを防ぐ）
  height: 26,
  lineHeight: "20px",
  borderBottom: "1px solid var(--color-border-subtle)",
  borderRight: "1px solid var(--color-border-subtle)",
  cursor: "text",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "1px 4px",
  fontSize: 12,
  border: "1px solid var(--color-primary)",
  borderRadius: 3,
  outline: "none",
};

const addBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "2px 7px 2px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-primary)",
  background: "transparent",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
};

/** ノート側の表ラベルチップ（#646）と同じ見た目のセクション見出しチップ */
function SectionChip({ kind }: { kind: SectionKind }) {
  const color = SECTION_COLOR[kind];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 6px",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        borderRadius: 999,
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}38`,
        flexShrink: 0,
      }}
    >
      {getDisplayLabel(kind)}
    </span>
  );
}

function KindDot({ kind }: { kind: ActivityIoKind }) {
  const color = SECTION_COLOR[kind];
  return (
    <span
      style={{
        flexShrink: 0,
        width: 7,
        height: 7,
        borderRadius: kind === "tool" ? 1 : "50%",
        transform: kind === "tool" ? "rotate(45deg)" : undefined,
        background: color,
      }}
    />
  );
}

export function FlowStepPanel({
  selection,
  data,
  onSetCell,
  onRenameColumn,
  onAddColumn,
  onRemoveColumn,
  onAddRow,
  onAddEntityRow,
  onCreateParamTable,
  onRenameEntity,
  onRemoveEntity,
  onMoveEntityToTable,
}: FlowStepPanelProps) {
  // 編集対象: `h:<blockId>:<col>`（ヘッダ） / `c:<blockId>:<row>:<col>`（セル）
  //           / `inline:<entityId>`（本文 span）
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  // 追加入力中: 既存表への行・列、または空セクションの最初の行
  const [adding, setAdding] = useState<
    | { what: "column" | "row"; blockId: string; draft: string }
    | { what: "newRow"; kind: ActivityIoKind; draft: string }
    | null
  >(null);
  // パラメータ表を作った直後、キー列を編集状態にする予約
  const [focusParamKey, setFocusParamKey] = useState(false);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const sectionRefs = useRef<Partial<Record<SectionKind | "prose", HTMLDivElement | null>>>({});

  const stepId = data?.stepId ?? null;
  useEffect(() => {
    setEdit(null);
    setAdding(null);
    setFocusParamKey(false);
  }, [stepId]);

  // 「＋列（表を作成）」の後、できたパラメータ表のキーをそのまま編集状態にする
  const paramTable = data?.tables.attribute ?? null;
  useEffect(() => {
    if (!focusParamKey || !paramTable) return;
    setEdit({ key: `h:${paramTable.blockId}:0`, draft: paramTable.headers[0] ?? "" });
    setFocusParamKey(false);
  }, [focusParamKey, paramTable]);

  // Entity 選択が変わったら、その行のあるセクションを視界に入れる
  const highlightBlockId = data?.highlight?.blockId ?? null;
  const highlightRowName = data?.highlight?.rowName ?? null;
  const proseHighlight = data?.proseHighlight ?? null;
  useEffect(() => {
    if (!data) return;
    let key: SectionKind | "prose" | null = null;
    if (proseHighlight) key = "prose";
    else if (highlightBlockId) {
      key = SECTION_ORDER.find((k) => data.tables[k]?.blockId === highlightBlockId) ?? null;
    }
    if (!key) return;
    sectionRefs.current[key]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightBlockId, highlightRowName, proseHighlight]);

  if (!selection) {
    return (
      <div style={emptyStyle}>
        <span>{t("flowTable.noSelection")}</span>
      </div>
    );
  }

  if (!data) {
    // 所属 step が特定できない（孤立した Entity など）ときの逃げ道
    const title = selection.kind === "step" ? selection.step.name : selection.entity.label;
    return (
      <div style={emptyStyle}>
        <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>{title}</span>
        <span>{t("flowTable.noTableYet")}</span>
      </div>
    );
  }

  const commitEdit = () => {
    if (edit) {
      const v = edit.draft.trim();
      const parts = edit.key.split(":");
      if (parts[0] === "h" && v) onRenameColumn?.(parts[1], Number(parts[2]), v);
      else if (parts[0] === "c") onSetCell?.(parts[1], Number(parts[2]), Number(parts[3]), edit.draft);
      else if (parts[0] === "inline" && v) onRenameEntity?.(edit.key.slice("inline:".length), v);
    }
    setEdit(null);
  };

  const commitAdd = () => {
    if (adding) {
      const v = adding.draft.trim();
      if (v) {
        if (adding.what === "newRow") onAddEntityRow?.(data.stepId, adding.kind, v);
        else if (adding.what === "column") onAddColumn?.(adding.blockId, v);
        else onAddRow?.(adding.blockId, v);
      }
    }
    setAdding(null);
  };

  const field = (value: string, onChange: (v: string) => void, onCommit: () => void) => (
    <input
      value={value}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(e.target.value)}
      {...compositionHandlers}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isImeKey(e)) onCommit();
        else if (e.key === "Escape") {
          e.stopPropagation();
          setEdit(null);
          setAdding(null);
        }
      }}
      onBlur={() => {
        setEdit(null);
        setAdding(null);
      }}
      style={inputStyle}
    />
  );

  const editing = (key: string) => edit?.key === key;

  const grid = (table: TableData, highlightRow: number | undefined, kind: SectionKind) => (
    <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
      <thead>
        <tr>
          {table.headers.map((h, col) => {
            const key = `h:${table.blockId}:${col}`;
            return (
              <th key={col} style={th}>
                {editing(key) ? (
                  field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit)
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span
                      onClick={() => onRenameColumn && setEdit({ key, draft: h })}
                      style={{ cursor: onRenameColumn ? "text" : "default" }}
                    >
                      {h || "—"}
                    </span>
                    {col > 0 && onRemoveColumn && (
                      <button
                        onClick={() => onRemoveColumn(table.blockId, col)}
                        title={t("flowTable.removeColumn")}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--color-destructive)",
                          cursor: "pointer",
                          padding: 0,
                          lineHeight: 1,
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </span>
                )}
              </th>
            );
          })}
          {onAddColumn && (
            <th style={{ ...th, borderRight: "none" }}>
              {adding?.what === "column" && adding.blockId === table.blockId ? (
                field(adding.draft, (v) => setAdding({ what: "column", blockId: table.blockId, draft: v }), commitAdd)
              ) : (
                <button
                  onClick={() => setAdding({ what: "column", blockId: table.blockId, draft: "" })}
                  style={addBtnStyle}
                >
                  <Plus size={11} /> {t("flowTable.addColumn")}
                </button>
              )}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} style={highlightRow === r ? { background: "var(--color-accent)" } : undefined}>
            {table.headers.map((_, col) => {
              const key = `c:${table.blockId}:${r}:${col}`;
              return (
                <td
                  key={col}
                  style={td}
                  onClick={() => onSetCell && !editing(key) && setEdit({ key, draft: row[col] ?? "" })}
                >
                  {editing(key) ? field(edit!.draft, (v) => setEdit({ key, draft: v }), commitEdit) : (row[col] ?? "")}
                </td>
              );
            })}
            {onAddColumn && <td style={{ ...td, borderRight: "none" }} />}
          </tr>
        ))}
      </tbody>
      {/* パラメータ表は「1 行 = 値」なので行は増やさない（項目はぜんぶ列） */}
      {kind !== "attribute" && onAddRow && (
        <tfoot>
          <tr>
            <td colSpan={table.headers.length + (onAddColumn ? 1 : 0)} style={{ border: "none", padding: 0 }}>
              {adding?.what === "row" && adding.blockId === table.blockId ? (
                <div style={{ padding: "3px 6px", maxWidth: 220 }}>
                  {field(adding.draft, (v) => setAdding({ what: "row", blockId: table.blockId, draft: v }), commitAdd)}
                </div>
              ) : (
                <button
                  onClick={() => setAdding({ what: "row", blockId: table.blockId, draft: "" })}
                  style={{ ...addBtnStyle, margin: "2px 4px 4px" }}
                >
                  <Plus size={11} /> {t("flowTable.addRow")}
                </button>
              )}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );

  const section = (kind: SectionKind) => {
    const color = SECTION_COLOR[kind];
    const table = data.tables[kind];
    const highlightRow =
      table && highlightBlockId === table.blockId && highlightRowName != null
        ? table.rows.findIndex((r) => r[0] === highlightRowName)
        : -1;
    const canStart =
      kind === "attribute" ? !!onCreateParamTable : !!onAddEntityRow;
    return (
      <div
        key={kind}
        ref={(el) => {
          sectionRefs.current[kind] = el;
        }}
        style={{
          borderRadius: 6,
          // 空でも種類色は保つ（破線が「まだ無い」を言う）。帯は全色 15% —
          // 一律 8% だと赤系だけ目立ち、緑・アンバーが灰色に沈む
          border: table ? `1px solid ${color}66` : `1px dashed ${color}88`,
          background: "var(--color-card)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 6px",
            background: `${color}26`,
          }}
        >
          <SectionChip kind={kind} />
          {/* 空セクションは見出し行に追加を畳み込む。押した瞬間に表ごと生まれる */}
          {!table &&
            canStart &&
            (adding?.what === "newRow" && adding.kind === kind ? (
              <div style={{ flex: 1, maxWidth: 200 }}>
                {field(adding.draft, (v) => setAdding({ what: "newRow", kind, draft: v }), commitAdd)}
              </div>
            ) : (
              <button
                onClick={() => {
                  if (kind === "attribute") {
                    onCreateParamTable?.(data.stepId);
                    setFocusParamKey(true);
                  } else {
                    setAdding({ what: "newRow", kind, draft: "" });
                  }
                }}
                style={addBtnStyle}
              >
                <Plus size={11} /> {kind === "attribute" ? t("flowTable.addColumn") : t("flowTable.addRow")}
              </button>
            ))}
        </div>
        {table && grid(table, highlightRow >= 0 ? highlightRow : undefined, kind)}
      </div>
    );
  };

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>{data.stepName}</span>
        <span style={{ color: "var(--color-text-tertiary)" }}>{t("flowTable.tableHint")}</span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 8,
          // カードを浮かせる薄い地。ここが白だと 1 枚の長い表に見えてしまう
          background: "var(--color-surface)",
        }}
      >
        {SECTION_ORDER.map(section)}

        {/* 本文 span 由来（表になっていないもの）。表ではないのでカードにしない */}
        {data.prose.length > 0 && (
          <div
            ref={(el) => {
              sectionRefs.current.prose = el;
            }}
            style={{ padding: "2px 2px 4px" }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)", paddingBottom: 2 }}>
              {t("flowTable.inlineSection")}
            </div>
            {data.prose.map((item) => {
              const k = `inline:${item.entityId}`;
              const { key, value } = item.kind === "attribute" ? splitAttrLabel(item.label) : { key: null, value: item.label };
              const highlighted = proseHighlight === item.entityId;
              return (
                <div
                  key={item.entityId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 4px",
                    borderRadius: 4,
                    background: highlighted ? "var(--color-accent)" : "transparent",
                  }}
                >
                  {editing(k) ? (
                    field(edit!.draft, (v) => setEdit({ key: k, draft: v }), commitEdit)
                  ) : (
                    <>
                      {item.kind === "attribute" ? (
                        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", width: 72, flexShrink: 0 }}>
                          {key ?? "—"}
                        </span>
                      ) : (
                        <KindDot kind={item.kind} />
                      )}
                      <span
                        style={{ flex: 1, minWidth: 0, fontSize: 12, cursor: onRenameEntity ? "text" : "default" }}
                        onClick={() => onRenameEntity && setEdit({ key: k, draft: item.label })}
                      >
                        {value}
                      </span>
                      {item.nodeId && onMoveEntityToTable && (
                        <button
                          onClick={() => onMoveEntityToTable(item.nodeId!)}
                          style={{ ...addBtnStyle, padding: "1px 5px 1px 3px", fontSize: 10 }}
                        >
                          <Plus size={10} /> {t("flowTable.addToTable")}
                        </button>
                      )}
                      {onRemoveEntity && (
                        <button
                          onClick={() => onRemoveEntity(item.entityId)}
                          title={t("activityGraph.removeChip")}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "var(--color-destructive)",
                            cursor: "pointer",
                            padding: 2,
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  background: "var(--color-card)",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 10px",
  fontSize: 12,
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  flexShrink: 0,
};

const emptyStyle: CSSProperties = {
  ...wrapStyle,
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  fontSize: 12,
  color: "var(--color-text-tertiary)",
  textAlign: "center",
  padding: 12,
};
