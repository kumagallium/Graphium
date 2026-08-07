// 選択中ノードの裏にあるノート側テーブルを、そのままグリッドとして編集するパネル。
//
// 「グラフから足したものがノートに文字として散らばる」のを避けるため、
// 入出力もパラメータもノート側では表（インデックステーブルと同じ標準 table +
// ラベル）に入る。このパネルはその表の編集 UI で、ヘッダ（キー）もセル（値）も
// ここで作れる。表の実体はノートにあるので、ノート側で直接編集しても同じ。
//
// 表の裏付けが無い属性（本文のインライン span 由来の旧データ）は、下に
// 「本文に書かれたもの」として別枠で並べ、テキストの編集・解除だけできる。

import { useEffect, useState, type CSSProperties } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import { splitAttrLabel, type FlowEntity, type FlowStep } from "./activity-graph-adapter";
import type { TableData } from "./table-row-edit";

export type FlowSelection =
  | { kind: "step"; step: FlowStep }
  | { kind: "entity"; entity: FlowEntity }
  | null;

export type FlowAttributeTableProps = {
  selection: FlowSelection;
  /** 選択の裏にあるノート側テーブル（step ならパラメータ表、entity ならその行の表） */
  table: TableData | null;
  /** グリッド内でハイライトする行（entity 選択時のその行） */
  highlightRow?: number;
  // ── テーブル編集 ──
  onSetCell?: (blockId: string, rowIndex: number, colIndex: number, value: string) => void;
  onRenameColumn?: (blockId: string, colIndex: number, name: string) => void;
  onAddColumn?: (blockId: string, name: string) => void;
  onRemoveColumn?: (blockId: string, colIndex: number) => void;
  onAddRow?: (blockId: string, name: string) => void;
  /** 表がまだ無い step にパラメータ表を作る（最初のキー列は既定名で入る） */
  onCreateParamTable?: (stepBlockId: string) => void;
  /** まだ表に入っていない Entity（本文 span 由来）を所属 step の表へ移す */
  onMoveEntityToTable?: (entityNodeId: string) => void;
  // ── 本文 span 由来（旧データ）の編集 ──
  onRenameEntity?: (entityId: string, text: string) => void;
  onRemoveEntity?: (entityId: string) => void;
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

export function FlowAttributeTable({
  selection,
  table,
  highlightRow,
  onSetCell,
  onRenameColumn,
  onAddColumn,
  onRemoveColumn,
  onAddRow,
  onCreateParamTable,
  onMoveEntityToTable,
  onRenameEntity,
  onRemoveEntity,
}: FlowAttributeTableProps) {
  // 編集対象: `h:<col>`（ヘッダ） / `c:<row>:<col>`（セル） / `inline:<entityId>`
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  // 追加中: 列 or 行
  const [adding, setAdding] = useState<{ what: "column" | "row"; draft: string } | null>(null);
  // 「表を作成」直後、できた表のキー列を編集状態にするための予約
  const [focusFirstKey, setFocusFirstKey] = useState(false);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const selectionId =
    selection?.kind === "step"
      ? selection.step.id
      : selection?.kind === "entity"
        ? selection.entity.id
        : null;

  useEffect(() => {
    setEdit(null);
    setAdding(null);
    setFocusFirstKey(false);
  }, [selectionId]);

  // 表ができたら、そのキー列をそのまま編集状態にする。「ボタンを押す →
  // 表が出る → キーを打つ」を 1 つの流れにするため（entity 側は名前が
  // 既にあるので、ボタンだけで完結する）。
  useEffect(() => {
    if (!focusFirstKey || !table) return;
    setEdit({ key: "h:0", draft: table.headers[0] ?? "" });
    setFocusFirstKey(false);
  }, [focusFirstKey, table]);

  if (!selection) {
    return (
      <div style={emptyStyle}>
        <span>{t("flowTable.noSelection")}</span>
      </div>
    );
  }

  const title = selection.kind === "step" ? selection.step.name : selection.entity.label;
  // 本文 span 由来（表の裏付けが無い）属性だけを別枠で扱う
  const inlineAttrs = (selection.kind === "step" ? selection.step.params : selection.entity.attrs).filter(
    (a) => !!a.entityId,
  );
  const blockId = table?.blockId ?? null;

  const commitEdit = () => {
    if (edit && blockId) {
      const v = edit.draft.trim();
      const [kind, a, b] = edit.key.split(":");
      if (kind === "h" && v) onRenameColumn?.(blockId, Number(a), v);
      else if (kind === "c") onSetCell?.(blockId, Number(a), Number(b), edit.draft);
    }
    if (edit?.key.startsWith("inline:")) {
      const v = edit.draft.trim();
      if (v) onRenameEntity?.(edit.key.slice("inline:".length), v);
    }
    setEdit(null);
  };

  const commitAdd = () => {
    if (adding) {
      const v = adding.draft.trim();
      if (v && blockId) {
        if (adding.what === "column") onAddColumn?.(blockId, v);
        else onAddRow?.(blockId, v);
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

  // 表がまだ無いときの「表を作成」。step も entity も 1 クリックで表ができる。
  // step はパラメータ表を作ってキー列を編集状態にし、entity は所属 step の
  // 表を作ってこの行を入れる（種類は Entity 自身が持つ）。
  const canCreateTable =
    selection.kind === "step" ? !!onCreateParamTable : !!onMoveEntityToTable;
  const startCreateTable = () => {
    if (selection.kind === "step") {
      onCreateParamTable?.(selection.step.id);
      setFocusFirstKey(true);
    } else {
      onMoveEntityToTable?.(selection.entity.id);
    }
  };

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>{title}</span>
        {table && (
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {t("flowTable.tableHint")}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {table ? (
          <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
            <thead>
              <tr>
                {table.headers.map((h, col) => (
                  <th key={col} style={th}>
                    {editing(`h:${col}`) ? (
                      field(edit!.draft, (v) => setEdit({ key: `h:${col}`, draft: v }), commitEdit)
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span
                          onClick={() => onRenameColumn && setEdit({ key: `h:${col}`, draft: h })}
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
                ))}
                {onAddColumn && (
                  <th style={{ ...th, borderRight: "none" }}>
                    {adding?.what === "column" ? (
                      field(adding.draft, (v) => setAdding({ what: "column", draft: v }), commitAdd)
                    ) : (
                      <button onClick={() => setAdding({ what: "column", draft: "" })} style={addBtnStyle}>
                        <Plus size={11} /> {t("flowTable.addColumn")}
                      </button>
                    )}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr
                  key={r}
                  style={
                    highlightRow === r
                      ? { background: "var(--color-accent)" }
                      : undefined
                  }
                >
                  {table.headers.map((_, col) => (
                    <td
                      key={col}
                      style={td}
                      onClick={() =>
                        onSetCell && !editing(`c:${r}:${col}`) &&
                        setEdit({ key: `c:${r}:${col}`, draft: row[col] ?? "" })
                      }
                    >
                      {editing(`c:${r}:${col}`)
                        ? field(edit!.draft, (v) => setEdit({ key: `c:${r}:${col}`, draft: v }), commitEdit)
                        : (row[col] ?? "")}
                    </td>
                  ))}
                  {onAddColumn && <td style={{ ...td, borderRight: "none" }} />}
                </tr>
              ))}
              {adding?.what === "row" && (
                <tr>
                  <td style={td} colSpan={table.headers.length + (onAddColumn ? 1 : 0)}>
                    {field(adding.draft, (v) => setAdding({ what: "row", draft: v }), commitAdd)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-text-tertiary)" }}>
            <div>{t("flowTable.noTableYet")}</div>
            {canCreateTable && (
              <button onClick={startCreateTable} style={{ ...addBtnStyle, marginTop: 4, marginLeft: -4 }}>
                <Plus size={12} /> {t("flowTable.createTable")}
              </button>
            )}
          </div>
        )}

        {/* 本文 span 由来（表になっていない旧データ） */}
        {inlineAttrs.length > 0 && (
          <div style={{ padding: "6px 8px 2px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)", paddingBottom: 2 }}>
              {t("flowTable.inlineSection")}
            </div>
            {inlineAttrs.map((a) => {
              const { key, value } = splitAttrLabel(a.label);
              const k = `inline:${a.entityId}`;
              return (
                <div key={a.entityId} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                  {editing(k) ? (
                    field(edit!.draft, (v) => setEdit({ key: k, draft: v }), commitEdit)
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", width: 72, flexShrink: 0 }}>
                        {key ?? "—"}
                      </span>
                      <span
                        style={{ flex: 1, minWidth: 0, fontSize: 12, cursor: onRenameEntity ? "text" : "default" }}
                        onClick={() => onRenameEntity && setEdit({ key: k, draft: a.label })}
                      >
                        {value}
                      </span>
                      {onRemoveEntity && (
                        <button
                          onClick={() => onRemoveEntity(a.entityId!)}
                          title={t("activityGraph.removeChip")}
                          style={{ border: "none", background: "transparent", color: "var(--color-destructive)", cursor: "pointer", padding: 2 }}
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

      {/* この Entity がまだ表の行になっていないとき（表だけ先にある場合） */}
      {table && selection.kind === "entity" && !selection.entity.tableRef && onMoveEntityToTable && (
        <button
          onClick={() => onMoveEntityToTable(selection.entity.id)}
          style={{ ...addBtnStyle, margin: "4px 6px 0" }}
        >
          <Plus size={12} /> {t("flowTable.addToTable")}
        </button>
      )}

      {/* 行の追加は「1 行 = 1 Entity」の表のときだけ（パラメータ表は 1 行しか使わない） */}
      {table && onAddRow && selection.kind === "entity" && selection.entity.tableRef && adding === null && (
        <button onClick={() => setAdding({ what: "row", draft: "" })} style={{ ...addBtnStyle, margin: "4px 6px 6px" }}>
          <Plus size={12} /> {t("flowTable.addRow")}
        </button>
      )}
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
};

const emptyStyle: CSSProperties = {
  ...wrapStyle,
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  color: "var(--color-text-tertiary)",
  textAlign: "center",
  padding: 12,
};
