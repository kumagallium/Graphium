// フロービュー（F 案）の Entity ノード。
//
// material / tool / output の Entity が独立ノードとして表示され、
// パラメータ（従属 attribute / テーブル列）はノード内の属性行に載る。
// 編集は entityId を持つもの（インライン span 由来）のみ:
// - 名前のリネーム / 削除 → 本文 span の書き換え（entity-edit 経由、editor 側）
// - 属性行のリネーム / 削除 → 従属 attribute span の書き換え（同上）
// - 「+ 属性」 → 明示 binding 付き attribute 行を本文に合成
// テーブル行・メディア・key-value 由来は表示のみ。

import { useEffect, useState, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Film, Image as ImageIcon, Music, Pencil, Plus, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import type { ActivityIoKind, FlowEntity } from "./activity-graph-adapter";

export type EntityFlowNodeData = {
  entity: FlowEntity;
  /** entityId 指定のリネーム（Entity 名にも属性行にも使う — 同じ span 書き換え機構） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** entityId 指定の削除（同上） */
  onRemoveEntity?: (entityId: string) => void;
  /** この Entity に従属する属性を追加 */
  onAddAttr?: (parentEntityId: string, text: string) => void;
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
  const { entity, onRenameEntity, onRemoveEntity, onAddAttr } = data;
  const c = KIND_COLORS[entity.kind];
  const editable = !!entity.entityId;
  // 名前 / 属性行の編集: 対象 entityId とドラフト（Entity 名も属性も同じ機構）
  const [edit, setEdit] = useState<{ entityId: string; draft: string } | null>(null);
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
      if (v) onRenameEntity?.(edit.entityId, v);
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

  const MediaIcon = entity.mediaType ? (MEDIA_ICONS[entity.mediaType] ?? FileText) : null;
  const editingName = !!entity.entityId && edit?.entityId === entity.entityId;

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

  return (
    <div
      style={{
        minWidth: 130,
        maxWidth: 210,
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
            onDoubleClick={() =>
              editable && onRenameEntity && setEdit({ entityId: entity.entityId!, draft: entity.label })
            }
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
        {selected && editable && !editingName && (
          <span className="nodrag" style={{ display: "inline-flex", gap: 0, flexShrink: 0 }}>
            {onRenameEntity && (
              <button
                onClick={() => setEdit({ entityId: entity.entityId!, draft: entity.label })}
                title={t("activityGraph.editChip")}
                style={{ ...miniBtnStyle, color: c.text }}
              >
                <Pencil size={11} />
              </button>
            )}
            {onRemoveEntity && (
              <button
                onClick={() => onRemoveEntity(entity.entityId!)}
                title={t("activityGraph.removeChip")}
                style={{ ...miniBtnStyle, color: "#c26356" }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* 属性行 */}
      {(entity.attrs.length > 0 || (selected && editable && onAddAttr)) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 8px 6px" }}>
          {entity.attrs.map((a, i) => {
            const attrEditable = !!a.entityId;
            const editingThis = attrEditable && edit?.entityId === a.entityId;
            return (
              <div key={a.entityId ?? `attr-${i}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {editingThis ? (
                  editField(
                    edit!.draft,
                    (v) => setEdit((prev) => (prev ? { ...prev, draft: v } : prev)),
                    commitEdit,
                    () => setEdit(null),
                  )
                ) : (
                  <span
                    title={a.label}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 11,
                      lineHeight: "16px",
                      color: "#4a6350",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.label}
                  </span>
                )}
                {selected && attrEditable && !editingThis && (
                  <span className="nodrag" style={{ display: "inline-flex", gap: 0, flexShrink: 0 }}>
                    {onRenameEntity && (
                      <button
                        onClick={() => setEdit({ entityId: a.entityId!, draft: a.label })}
                        title={t("activityGraph.editChip")}
                        style={miniBtnStyle}
                      >
                        <Pencil size={10} />
                      </button>
                    )}
                    {onRemoveEntity && (
                      <button
                        onClick={() => onRemoveEntity(a.entityId!)}
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
          })}

          {/* + 属性（インライン Entity のみ — 明示 binding の親が必要） */}
          {selected && editable && onAddAttr && (
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
