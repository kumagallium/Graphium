// 選択中ノードの属性テーブル（フロービューの下 / 全画面では右）。
//
// ノードの中に表を詰めるとグラフが読みにくくなるため、ノードは名前だけにして
// 属性の閲覧・編集はここに集約する。編集の書き込み先はノードの出自で分かれる:
// - インライン span 由来: 行テキストの書き換え / span の削除（entity-edit 経由）
// - 構造化テーブルの行由来: ノート側テーブルのセル（table-row-edit 経由）
// - step のパラメータ: Activity 直結のインライン attribute

import { useEffect, useState, type CSSProperties } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import { splitAttrLabel, type FlowEntity, type FlowStep } from "./activity-graph-adapter";

export type FlowSelection =
  | { kind: "step"; step: FlowStep }
  | { kind: "entity"; entity: FlowEntity }
  | null;

export type FlowAttributeTableProps = {
  selection: FlowSelection;
  /** entityId 指定のリネーム（Entity 名・属性行の共通機構） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** entityId 指定の削除 */
  onRemoveEntity?: (entityId: string) => void;
  /** Entity への従属属性の追加 */
  onAddAttrToEntity?: (parentEntityId: string, text: string) => void;
  /** step へのパラメータ追加 */
  onAddStepParam?: (stepBlockId: string, text: string) => void;
  /** テーブル行 Entity: セルの書き換え */
  onSetTableCell?: (blockId: string, rowName: string, columnKey: string, value: string) => void;
};

const cellStyle: CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  borderBottom: "1px solid var(--color-border-subtle, #dce5dd)",
  verticalAlign: "middle",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "2px 6px",
  fontSize: 12,
  border: "1px solid var(--color-primary, #4B7A52)",
  borderRadius: 4,
  outline: "none",
};

const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  padding: 0,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "var(--color-text-tertiary, #8fa394)",
  cursor: "pointer",
};

export function FlowAttributeTable({
  selection,
  onRenameEntity,
  onRemoveEntity,
  onAddAttrToEntity,
  onAddStepParam,
  onSetTableCell,
}: FlowAttributeTableProps) {
  // 編集中の行キー（`inline:<entityId>` / `cell:<columnKey>`）とドラフト
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  const selectionId =
    selection?.kind === "step"
      ? selection.step.id
      : selection?.kind === "entity"
        ? selection.entity.id
        : null;

  // 選択が変わったら編集状態を捨てる（別ノードに書き込まないため）
  useEffect(() => {
    setEdit(null);
    setAdding(null);
  }, [selectionId]);

  if (!selection) {
    return (
      <div style={emptyStyle}>
        <span>{t("flowTable.noSelection")}</span>
      </div>
    );
  }

  const attrs = selection.kind === "step" ? selection.step.params : selection.entity.attrs;
  const title = selection.kind === "step" ? selection.step.name : selection.entity.label;
  const tableRef = selection.kind === "entity" ? selection.entity.tableRef : undefined;
  const parentEntityId = selection.kind === "entity" ? selection.entity.entityId : undefined;
  const canAdd =
    selection.kind === "step"
      ? !!onAddStepParam
      : !!parentEntityId && !!onAddAttrToEntity;

  const commitEdit = () => {
    if (edit) {
      const v = edit.draft.trim();
      if (v) {
        if (edit.key.startsWith("inline:")) {
          onRenameEntity?.(edit.key.slice("inline:".length), v);
        } else if (edit.key.startsWith("cell:") && tableRef) {
          onSetTableCell?.(tableRef.blockId, tableRef.rowName, edit.key.slice("cell:".length), v);
        }
      }
    }
    setEdit(null);
  };

  const commitAdd = () => {
    if (adding !== null) {
      const v = adding.trim();
      if (v) {
        if (selection.kind === "step") onAddStepParam?.(selection.step.id, v);
        else if (parentEntityId) onAddAttrToEntity?.(parentEntityId, v);
      }
    }
    setAdding(null);
  };

  const editField = (value: string, onChange: (v: string) => void, onCommit: () => void, onCancel: () => void) => (
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
          onCancel();
        }
      }}
      onBlur={onCancel}
      style={inputStyle}
    />
  );

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, color: "var(--color-foreground)" }}>{title}</span>
        <span style={{ color: "var(--color-text-tertiary, #8fa394)" }}>
          {t("flowTable.attrCount", { n: String(attrs.length) })}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {attrs.map((a, i) => {
              const { key, value } = splitAttrLabel(a.label);
              const inlineEditable = !!a.entityId && !!onRenameEntity;
              const cellEditable = !a.entityId && !!tableRef && key !== null && !!onSetTableCell;
              const editKey = a.entityId ? `inline:${a.entityId}` : key ? `cell:${key}` : null;
              const editing = editKey !== null && edit?.key === editKey;
              const startEdit = () =>
                editKey &&
                setEdit({ key: editKey, draft: a.entityId ? a.label : value });
              return (
                <tr key={a.entityId ?? `row-${i}`}>
                  <td style={{ ...cellStyle, width: "38%", color: "var(--color-text-tertiary, #8fa394)" }}>
                    {key ?? "—"}
                  </td>
                  <td style={cellStyle}>
                    {editing
                      ? editField(
                          edit!.draft,
                          (v) => setEdit((prev) => (prev ? { ...prev, draft: v } : prev)),
                          commitEdit,
                          () => setEdit(null),
                        )
                      : value}
                  </td>
                  <td style={{ ...cellStyle, width: 52, textAlign: "right", whiteSpace: "nowrap" }}>
                    {!editing && (inlineEditable || cellEditable) && (
                      <button onClick={startEdit} title={t("activityGraph.editChip")} style={iconBtn}>
                        <Pencil size={12} />
                      </button>
                    )}
                    {!editing && a.entityId && onRemoveEntity && (
                      <button
                        onClick={() => onRemoveEntity(a.entityId!)}
                        title={t("activityGraph.removeChip")}
                        style={{ ...iconBtn, color: "#c26356" }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {adding !== null && (
              <tr>
                <td colSpan={3} style={cellStyle}>
                  {editField(adding, setAdding, commitAdd, () => setAdding(null))}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {attrs.length === 0 && adding === null && (
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-text-tertiary, #8fa394)" }}>
            {t("flowTable.noAttrs")}
          </div>
        )}
      </div>

      {canAdd && adding === null && (
        <button
          onClick={() => setAdding("")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            alignSelf: "flex-start",
            margin: "4px 6px 6px",
            padding: "3px 8px 3px 4px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-primary, #4B7A52)",
            background: "transparent",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          <Plus size={12} /> {t("activityGraph.addAttr")}
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
  background: "var(--color-card, #ffffff)",
  borderRadius: 8,
  border: "1px solid var(--color-border, #d5e0d7)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 10px",
  fontSize: 12,
  borderBottom: "1px solid var(--color-border, #d5e0d7)",
  background: "var(--color-surface, #f5f8f5)",
};

const emptyStyle: CSSProperties = {
  ...wrapStyle,
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  color: "var(--color-text-tertiary, #8fa394)",
  textAlign: "center",
  padding: 12,
};
