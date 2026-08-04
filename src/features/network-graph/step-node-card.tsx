// 手順フロービューのノードカード。
//
// PROV ビュー（cytoscape の楕円）とは意図的に見た目を変える: こちらは
// 「編集するための UI」なので、ノードエディタの定石に寄せた角丸カードに
// タイトル + 入出力チップ + パラメータ行を載せ、操作（リネーム / 本文へ /
// 削除 / チップの追加・編集・削除）はカード上に直接置く。色は design.md の
// ラベル配色に従う（activity 青 / 材料 緑 / 道具 アンバー / output テラコッタ）。
//
// チップの編集・削除は entityId を持つもの（インライン span 由来）だけ。
// テーブル行・メディア・plan 由来の Entity は表示のみ（本文 span の書き換えでは
// 編集できないため）。書き込み自体は data のコールバック経由でエディタ側が行う。

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t, getDisplayLabelName } from "../../i18n";
import type { ActivityIoKind, ActivityNode } from "./activity-graph-adapter";
import type { EntityKind } from "./step-flow-view";

export type StepNodeData = {
  activity: ActivityNode;
  onRename?: (blockId: string, title: string) => void;
  onDelete?: (blockId: string) => void;
  onJump?: (blockId: string) => void;
  /** 削除確認に出す「中身のブロック数」。押した瞬間に評価する（stale 回避） */
  getContentCount?: (blockId: string) => number;
  onAddEntity?: (blockId: string, kind: EntityKind, text: string) => void;
  onRenameEntity?: (entityId: string, text: string) => void;
  onRemoveEntity?: (entityId: string) => void;
};

export type StepFlowNode = Node<StepNodeData, "step">;

const IO_COLORS: Record<ActivityIoKind, string> = {
  material: "#4B7A52", // 材料（ブランドグリーン）
  tool: "#c08b3e", // 道具（アンバー）
  output: "#c26356", // output（テラコッタ）
};

const PARAM_COLOR = "#8fa394";
const ACTIVITY_BLUE = "#5b8fb9";

const iconBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#6b7f6e",
  cursor: "pointer",
};

const miniBtnStyle: CSSProperties = {
  ...iconBtnStyle,
  width: 18,
  height: 18,
};

const chipInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "1px 5px",
  fontSize: 11,
  border: `1px solid ${ACTIVITY_BLUE}`,
  borderRadius: 5,
  outline: "none",
};

function KindDot({ kind }: { kind: ActivityIoKind }) {
  return (
    <span
      style={{
        flexShrink: 0,
        width: 7,
        height: 7,
        borderRadius: kind === "tool" ? 1 : "50%",
        transform: kind === "tool" ? "rotate(45deg)" : undefined,
        background: IO_COLORS[kind],
      }}
    />
  );
}

/** チップ 1 行。編集可能（entityId + handlers あり）なら選択時に ✎ × を出す */
function ChipRow({
  icon,
  label,
  entityId,
  selected,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  entityId?: string;
  selected: boolean;
  editing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit?: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onRemove?: () => void;
}) {
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const editable = !!entityId && (!!onStartEdit || !!onRemove);

  if (editing) {
    return (
      <span className="nodrag" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {icon}
        <input
          value={draft}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => onDraftChange(e.target.value)}
          {...compositionHandlers}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeKey(e)) onCommitEdit();
            else if (e.key === "Escape") {
              e.stopPropagation();
              onCancelEdit();
            }
          }}
          onBlur={onCancelEdit}
          style={chipInputStyle}
        />
      </span>
    );
  }

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        fontSize: 11,
        lineHeight: "16px",
        color: "#2d4a32",
      }}
    >
      {icon}
      <span
        title={label}
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {label}
      </span>
      {selected && editable && (
        <span className="nodrag" style={{ display: "inline-flex", gap: 0, flexShrink: 0 }}>
          {onStartEdit && (
            <button
              onClick={onStartEdit}
              title={t("activityGraph.editChip")}
              style={miniBtnStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Pencil size={10} />
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              title={t("activityGraph.removeChip")}
              style={{ ...miniBtnStyle, color: "#c26356" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <X size={11} />
            </button>
          )}
        </span>
      )}
    </span>
  );
}

const ADD_KINDS: { kind: EntityKind; labelKey: string }[] = [
  { kind: "material", labelKey: "material" },
  { kind: "tool", labelKey: "tool" },
  { kind: "output", labelKey: "output" },
  { kind: "attribute", labelKey: "attribute" },
];

export function StepNodeCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const {
    activity,
    onRename,
    onDelete,
    onJump,
    getContentCount,
    onAddEntity,
    onRenameEntity,
    onRemoveEntity,
  } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.name);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // チップ編集: 対象 entityId とドラフト
  const [chipEdit, setChipEdit] = useState<{ entityId: string; draft: string } | null>(null);
  // 追加フロー: 種類メニュー → 種類確定で input
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [adding, setAdding] = useState<{ kind: EntityKind; draft: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 選択が外れたら編集・削除確認・追加フローをリセットする
  useEffect(() => {
    if (!selected) {
      setEditing(false);
      setConfirmCount(null);
      setChipEdit(null);
      setAddMenuOpen(false);
      setAdding(null);
    }
  }, [selected]);

  const startEditing = () => {
    if (!onRename) return;
    setDraft(activity.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    const v = draft.trim();
    // 開いて閉じただけでタイトル（連番プレフィックス等）を壊さない
    if (v && v !== activity.name) onRename?.(id, v);
    setEditing(false);
  };

  const commitChipEdit = () => {
    if (chipEdit) {
      const v = chipEdit.draft.trim();
      if (v) onRenameEntity?.(chipEdit.entityId, v);
    }
    setChipEdit(null);
  };

  const commitAdd = () => {
    if (adding) {
      const v = adding.draft.trim();
      if (v) onAddEntity?.(id, adding.kind, v);
    }
    setAdding(null);
  };

  const chipRowProps = (label: string, entityId?: string) => ({
    label,
    entityId,
    selected,
    editing: !!entityId && chipEdit?.entityId === entityId,
    draft: chipEdit?.draft ?? "",
    onDraftChange: (v: string) => setChipEdit((prev) => (prev ? { ...prev, draft: v } : prev)),
    onStartEdit:
      entityId && onRenameEntity ? () => setChipEdit({ entityId, draft: label }) : undefined,
    onCommitEdit: commitChipEdit,
    onCancelEdit: () => setChipEdit(null),
    onRemove: entityId && onRemoveEntity ? () => onRemoveEntity(entityId) : undefined,
  });

  const hasBody =
    activity.inputs.length > 0 || activity.outputs.length > 0 || activity.params.length > 0;
  const showAddControl = selected && !!onAddEntity;

  return (
    <div
      style={{
        minWidth: 180,
        maxWidth: 240,
        borderRadius: 8,
        background: "#ffffff",
        border: selected ? `1.5px solid ${ACTIVITY_BLUE}` : "1px solid #d5e0d7",
        borderLeft: `3px solid ${ACTIVITY_BLUE}`,
        boxShadow: selected
          ? "0 2px 8px rgba(30, 20, 10, 0.14)"
          : "0 1px 3px rgba(30, 20, 10, 0.08)",
        fontFamily: "inherit",
      }}
    >
      {/* タイトル行 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: hasBody || showAddControl ? "7px 8px 5px 10px" : "7px 8px 7px 10px",
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag"
            value={draft}
            autoFocus
            aria-label={t("activityGraph.stepName")}
            onChange={(e) => setDraft(e.target.value)}
            {...compositionHandlers}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeKey(e)) {
                commitRename();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            onBlur={() => setEditing(false)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "1px 5px",
              fontSize: 13,
              fontWeight: 700,
              color: "#1a2e1d",
              border: `1px solid ${ACTIVITY_BLUE}`,
              borderRadius: 5,
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={startEditing}
            title={activity.name}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: 700,
              color: "#1a2e1d",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activity.name}
          </span>
        )}

        {/* 操作: 選択時のみ出す（非選択時はカードをすっきり保つ） */}
        {selected && !editing && (
          <span className="nodrag" style={{ display: "inline-flex", gap: 1, flexShrink: 0 }}>
            {onRename && (
              <button
                onClick={startEditing}
                title={t("activityGraph.stepName")}
                style={iconBtnStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Pencil size={12} />
              </button>
            )}
            {onJump && (
              <button
                onClick={() => onJump(id)}
                title={t("activityGraph.jumpToText")}
                style={iconBtnStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <FileText size={12} />
              </button>
            )}
            {onDelete && confirmCount === null && (
              <button
                onClick={() => {
                  const n = getContentCount?.(id) ?? 0;
                  if (n > 0) setConfirmCount(n);
                  else onDelete(id);
                }}
                title={t("activityGraph.deleteNode")}
                style={{ ...iconBtnStyle, color: "#c26356" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Trash2 size={12} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* 削除確認（中身がある step は 1 クリックで消さない） */}
      {selected && confirmCount !== null && (
        <div className="nodrag" style={{ padding: "0 8px 6px 10px" }}>
          <button
            onClick={() => onDelete?.(id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              width: "100%",
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: "#c26356",
              background: "#fef2f2",
              border: "1px solid #c26356",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Trash2 size={11} /> {t("activityGraph.deleteNodeConfirm", { n: String(confirmCount) })}
          </button>
        </div>
      )}

      {/* 入出力チップ + パラメータ行 */}
      {(hasBody || showAddControl) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            padding: "0 10px 7px 10px",
          }}
        >
          {activity.inputs.map((io, i) => (
            <ChipRow
              key={io.entityId ?? `in-${i}`}
              icon={<KindDot kind={io.kind} />}
              {...chipRowProps(io.label, io.entityId)}
            />
          ))}
          {activity.outputs.map((io, i) => (
            <ChipRow
              key={io.entityId ?? `out-${i}`}
              icon={<KindDot kind={io.kind} />}
              {...chipRowProps(io.label, io.entityId)}
            />
          ))}
          {activity.params.map((p, i) => (
            <ChipRow
              key={p.entityId ?? `param-${i}`}
              icon={<SlidersHorizontal size={10} style={{ flexShrink: 0, color: PARAM_COLOR }} />}
              {...chipRowProps(p.label, p.entityId)}
            />
          ))}

          {/* 追加フロー: + 追加 → 種類 → input */}
          {showAddControl && adding && (
            <span className="nodrag" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {adding.kind === "attribute" ? (
                <SlidersHorizontal size={10} style={{ flexShrink: 0, color: PARAM_COLOR }} />
              ) : (
                <KindDot kind={adding.kind} />
              )}
              <input
                value={adding.draft}
                autoFocus
                placeholder={getDisplayLabelName(adding.kind)}
                onChange={(e) =>
                  setAdding((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                }
                {...compositionHandlers}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isImeKey(e)) commitAdd();
                  else if (e.key === "Escape") {
                    e.stopPropagation();
                    setAdding(null);
                  }
                }}
                onBlur={() => setAdding(null)}
                style={chipInputStyle}
              />
            </span>
          )}
          {showAddControl && !adding && addMenuOpen && (
            <span className="nodrag" style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {ADD_KINDS.map(({ kind, labelKey }) => (
                <button
                  key={kind}
                  onClick={() => {
                    setAddMenuOpen(false);
                    setAdding({ kind, draft: "" });
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 7px",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#2d4a32",
                    background: "#f0f5ef",
                    border: "1px solid #d5e0d7",
                    borderRadius: 9,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {kind === "attribute" ? (
                    <SlidersHorizontal size={9} style={{ color: PARAM_COLOR }} />
                  ) : (
                    <KindDot kind={kind} />
                  )}
                  {getDisplayLabelName(labelKey)}
                </button>
              ))}
            </span>
          )}
          {showAddControl && !adding && !addMenuOpen && (
            <button
              className="nodrag"
              onClick={() => setAddMenuOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                alignSelf: "flex-start",
                padding: "1px 6px 1px 2px",
                fontSize: 10,
                fontWeight: 600,
                color: "#8fa394",
                background: "transparent",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Plus size={11} /> {t("activityGraph.addChip")}
            </button>
          )}
        </div>
      )}

      {/* 上=入力（受け側・白抜き）、下=出力（掴んで接続・青塗り） */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 9,
          height: 9,
          background: "#ffffff",
          border: `2px solid ${ACTIVITY_BLUE}`,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 11,
          height: 11,
          background: ACTIVITY_BLUE,
          border: `2px solid ${ACTIVITY_BLUE}`,
        }}
      />
    </div>
  );
}
