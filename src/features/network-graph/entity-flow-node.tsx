// フロービュー（F 案）の Entity ノード。
//
// material / tool / output の Entity が独立ノードとして表示され、
// パラメータ（従属 attribute / テーブル列）は「key | value」の 2 列表で
// ノード内に載る。編集は出自で分かれる:
// - インライン span 由来（entityId あり）: 名前・属性行のリネーム / 削除 /
//   「+ パラメータ」→ 本文 span の書き換え・合成（entity-edit 経由）
// - 構造化テーブルの行由来（tableRef あり）: 名前 = 1 列目セル、属性 =
//   該当列セルの書き換え。行削除も可能（table-row-edit 経由）
// - どちらでもない（メディア / key-value 由来など）: 表示のみ

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Film, Image as ImageIcon, Music, Pencil, Plus, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import { splitAttrLabel, type ActivityIoKind, type FlowEntity } from "./activity-graph-adapter";

export type EntityFlowNodeData = {
  entity: FlowEntity;
  /** entityId 指定のリネーム（Entity 名にも属性行にも使う — 同じ span 書き換え機構） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** entityId 指定の削除（同上） */
  onRemoveEntity?: (entityId: string) => void;
  /** この Entity に従属する属性を追加（インライン Entity のみ） */
  onAddAttr?: (parentEntityId: string, text: string) => void;
  /** テーブル行の名前（1 列目）を書き換える */
  onRenameTableRow?: (blockId: string, rowName: string, newName: string) => void;
  /** テーブル行の属性セル（columnKey 列）を書き換える */
  onSetTableCell?: (blockId: string, rowName: string, columnKey: string, value: string) => void;
  /** テーブル行を削除する */
  onRemoveTableRow?: (blockId: string, rowName: string) => void;
};

export type EntityFlowNodeType = Node<EntityFlowNodeData, "entity">;

const KIND_COLORS: Record<ActivityIoKind, { main: string; bg: string; text: string }> = {
  material: { main: "#4B7A52", bg: "#f0f5ef", text: "#2d4a32" },
  tool: { main: "#c08b3e", bg: "#faf3e8", text: "#7a5a22" },
  output: { main: "#c26356", bg: "#fdf3f1", text: "#a8513f" },
};

const MEDIA_ICONS: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
  file: FileText,
};

const miniBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#6b7f6e",
  cursor: "pointer",
};

const attrInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "1px 6px",
  fontSize: 11,
  border: "1px solid #d5e0d7",
  borderRadius: 4,
  outline: "none",
  color: "#1a2e1d",
};

export function EntityFlowNode({ data, selected }: NodeProps<EntityFlowNodeType>) {
  const {
    entity,
    onRenameEntity,
    onRemoveEntity,
    onAddAttr,
    onRenameTableRow,
    onSetTableCell,
    onRemoveTableRow,
  } = data;
  const c = KIND_COLORS[entity.kind];
  const inlineEditable = !!entity.entityId;
  const tableEditable = !!entity.tableRef;
  // 編集中の対象（合成キー）とドラフト:
  //   "name" | `inline:<entityId>` | `cell:<columnKey>`
  const [edit, setEdit] = useState<{ key: string; draft: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // 属性追加中のドラフト
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  useEffect(() => {
    if (!selected) {
      setEdit(null);
      setAdding(null);
    }
  }, [selected]);

  const commitEdit = () => {
    if (edit) {
      const v = edit.draft.trim();
      if (v) {
        if (edit.key === "name") {
          if (inlineEditable) onRenameEntity?.(entity.entityId!, v);
          else if (tableEditable)
            onRenameTableRow?.(entity.tableRef!.blockId, entity.tableRef!.rowName, v);
        } else if (edit.key.startsWith("inline:")) {
          onRenameEntity?.(edit.key.slice("inline:".length), v);
        } else if (edit.key.startsWith("cell:")) {
          onSetTableCell?.(
            entity.tableRef!.blockId,
            entity.tableRef!.rowName,
            edit.key.slice("cell:".length),
            v,
          );
        }
      }
    }
    setEdit(null);
  };

  const commitAdd = () => {
    if (adding !== null && entity.entityId) {
      const v = adding.trim();
      if (v) onAddAttr?.(entity.entityId, v);
    }
    setAdding(null);
  };

  const removeSelf = () => {
    if (inlineEditable) onRemoveEntity?.(entity.entityId!);
    else if (tableEditable) onRemoveTableRow?.(entity.tableRef!.blockId, entity.tableRef!.rowName);
  };

  const canRenameSelf = (inlineEditable && !!onRenameEntity) || (tableEditable && !!onRenameTableRow);
  const canRemoveSelf = (inlineEditable && !!onRemoveEntity) || (tableEditable && !!onRemoveTableRow);

  const MediaIcon = entity.mediaType ? (MEDIA_ICONS[entity.mediaType] ?? FileText) : null;
  const editingName = edit?.key === "name";

  const editField = (
    value: string,
    onChange: (v: string) => void,
    onCommit: () => void,
    onCancel: () => void,
  ) => (
    <input
      className="nodrag"
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
      style={attrInputStyle}
    />
  );

  /** 属性 1 行。kv 分解して 2 列（key はグレー・右寄せ）で描く */
  const attrRow = (
    rowKey: string,
    label: string,
    editKey: string | null, // null = 表示のみ
    onStartEdit: (() => void) | null,
    onRemove: (() => void) | null,
    editDraftValueOnly: boolean, // cell 編集は value のみ input に出す
  ): ReactNode => {
    const { key, value } = splitAttrLabel(label);
    const editingThis = editKey !== null && edit?.key === editKey;
    return (
      <div key={rowKey} style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {key !== null && (
          <span
            style={{
              fontSize: 10,
              color: "#8fa394",
              width: 52,
              flexShrink: 0,
              textAlign: "right",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={key}
          >
            {key}
          </span>
        )}
        {editingThis ? (
          editField(
            edit!.draft,
            (v) => setEdit((prev) => (prev ? { ...prev, draft: v } : prev)),
            commitEdit,
            () => setEdit(null),
          )
        ) : (
          <span
            title={label}
            onDoubleClick={onStartEdit ?? undefined}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              lineHeight: "16px",
              color: "#1a2e1d",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {editDraftValueOnly || key !== null ? value : label}
          </span>
        )}
        {selected && !editingThis && (onStartEdit || onRemove) && (
          <span className="nodrag" style={{ display: "inline-flex", gap: 0, flexShrink: 0 }}>
            {onStartEdit && (
              <button onClick={onStartEdit} title={t("activityGraph.editChip")} style={miniBtnStyle}>
                <Pencil size={10} />
              </button>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                title={t("activityGraph.removeChip")}
                style={{ ...miniBtnStyle, color: "#c26356" }}
              >
                <Trash2 size={10} />
              </button>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        minWidth: 140,
        maxWidth: 220,
        borderRadius: 8,
        background: "#ffffff",
        border: selected ? `2px solid ${c.main}` : `1.5px solid ${c.main}`,
        boxShadow: selected ? "0 2px 8px rgba(30,20,10,0.14)" : "0 1px 3px rgba(30,20,10,0.08)",
        overflow: "hidden",
      }}
    >
      {/* ヘッダ（名前 + 選択時の操作） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px 5px 10px",
          background: c.bg,
          fontSize: 12,
          fontWeight: 700,
          color: c.text,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: entity.kind === "tool" ? 1 : "50%",
            transform: entity.kind === "tool" ? "rotate(45deg)" : undefined,
            background: c.main,
            flexShrink: 0,
          }}
        />
        {MediaIcon && <MediaIcon size={11} style={{ flexShrink: 0, color: c.main }} />}
        {editingName ? (
          editField(
            edit!.draft,
            (v) => setEdit((prev) => (prev ? { ...prev, draft: v } : prev)),
            commitEdit,
            () => setEdit(null),
          )
        ) : (
          <span
            title={entity.label}
            onDoubleClick={() => canRenameSelf && setEdit({ key: "name", draft: entity.label })}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entity.label}
          </span>
        )}
        {selected && !editingName && (canRenameSelf || canRemoveSelf) && (
          <span className="nodrag" style={{ display: "inline-flex", gap: 0, flexShrink: 0 }}>
            {canRenameSelf && (
              <button
                onClick={() => setEdit({ key: "name", draft: entity.label })}
                title={t("activityGraph.editChip")}
                style={{ ...miniBtnStyle, color: c.text }}
              >
                <Pencil size={11} />
              </button>
            )}
            {canRemoveSelf && (
              <button
                onClick={removeSelf}
                title={t("activityGraph.removeChip")}
                style={{ ...miniBtnStyle, color: "#c26356" }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* 属性表（key | value の 2 列） */}
      {(entity.attrs.length > 0 || (selected && inlineEditable && onAddAttr)) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px 6px" }}>
          {entity.attrs.map((a, i) => {
            if (a.entityId) {
              // インライン従属 attribute: 行全体テキストの編集・span 削除
              const editKey = `inline:${a.entityId}`;
              return attrRow(
                a.entityId,
                a.label,
                editKey,
                onRenameEntity ? () => setEdit({ key: editKey, draft: a.label }) : null,
                onRemoveEntity ? () => onRemoveEntity(a.entityId!) : null,
                false,
              );
            }
            const { key } = splitAttrLabel(a.label);
            if (tableEditable && key !== null) {
              // テーブル列: value セルだけ書き換え（列自体の削除はテーブル UI で）
              const editKey = `cell:${key}`;
              return attrRow(
                `cell-${i}`,
                a.label,
                editKey,
                onSetTableCell
                  ? () => setEdit({ key: editKey, draft: splitAttrLabel(a.label).value })
                  : null,
                null,
                true,
              );
            }
            return attrRow(`ro-${i}`, a.label, null, null, null, false);
          })}

          {/* + パラメータ（インライン Entity のみ — 明示 binding の親が必要） */}
          {selected && inlineEditable && onAddAttr && (
            adding !== null ? (
              <div className="nodrag" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {editField(adding, setAdding, commitAdd, () => setAdding(null))}
              </div>
            ) : (
              <button
                className="nodrag"
                onClick={() => setAdding("")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  alignSelf: "flex-start",
                  padding: "1px 5px 1px 2px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#8fa394",
                  background: "transparent",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                <Plus size={10} /> {t("activityGraph.addAttr")}
              </button>
            )
          )}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Top}
        style={{ width: 8, height: 8, background: "#ffffff", border: `2px solid ${c.main}` }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: 10, height: 10, background: c.main, border: `2px solid ${c.main}` }}
      />
    </div>
  );
}
