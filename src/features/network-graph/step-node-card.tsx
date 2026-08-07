// 手順フロービューのノードカード。
//
// カードが持つのはタイトル・操作（リネーム / 本文へ / 削除）・入出力の追加
// 導線と、パラメータの件数だけ。パラメータの中身は flow-attribute-table に
// 集約する（ノードに表を詰めるとグラフが読めなくなる）。
// 色は design.md のラベル配色（activity 青 / 材料 緑 / 道具 アンバー /
// output テラコッタ）に従う。書き込みは data のコールバック経由。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t, getDisplayLabelName } from "../../i18n";
import type { ActivityIoKind, ActivityNode } from "./activity-graph-adapter";
import type { EntityKind } from "./step-flow-view";

export type StepNodeData = {
  /** F 案では FlowStep（id/name/params）を渡す。旧 ActivityNode も型互換
   *  （inputs/outputs はもう表示しない — Entity は独立ノードになった） */
  activity: Pick<ActivityNode, "id" | "name" | "params"> &
    Partial<Pick<ActivityNode, "inputs" | "outputs">>;
  onRename?: (blockId: string, title: string) => void;
  onDelete?: (blockId: string) => void;
  onJump?: (blockId: string) => void;
  /** 削除確認に出す「中身のブロック数」。押した瞬間に評価する（stale 回避） */
  getContentCount?: (blockId: string) => number;
  onAddEntity?: (blockId: string, kind: EntityKind, text: string) => void;
};

export type StepFlowNode = Node<StepNodeData, "step">;

const IO_COLORS: Record<ActivityIoKind, string> = {
  material: "#4B7A52", // 材料（ブランドグリーン）
  tool: "#c08b3e", // 道具（アンバー）
  output: "#c26356", // output（テラコッタ）
};

const PARAM_COLOR = "var(--color-text-tertiary)";
const ACTIVITY_BLUE = "#5b8fb9";
// 帯（薄い青）の上に載る文字色。ラベル色の暗い変種で、Entity ノードの text と同じ役割
const ACTIVITY_TEXT = "#3f6c92";

const iconBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "var(--color-text-tertiary)",
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

const ADD_KINDS: { kind: ActivityIoKind; labelKey: string }[] = [
  { kind: "material", labelKey: "material" },
  { kind: "tool", labelKey: "tool" },
  { kind: "output", labelKey: "output" },
];

export function StepNodeCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const {
    activity,
    onRename,
    onDelete,
    onJump,
    getContentCount,
    onAddEntity,
  } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.name);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // 追加フロー: 種類メニュー → 種類確定で input
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [adding, setAdding] = useState<{ kind: ActivityIoKind; draft: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 選択が外れたら編集・削除確認・追加フローをリセットする
  useEffect(() => {
    if (!selected) {
      setEditing(false);
      setConfirmCount(null);
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

  const commitAdd = () => {
    if (adding) {
      const v = adding.draft.trim();
      if (v) onAddEntity?.(id, adding.kind, v);
    }
    setAdding(null);
  };

  const hasBody = activity.params.length > 0;
  const showAddControl = selected && !!onAddEntity;

  return (
    <div
      style={{
        minWidth: 180,
        maxWidth: 240,
        borderRadius: 8,
        background: "var(--color-card)",
        border: `1.5px solid ${ACTIVITY_BLUE}`,
        // 選択は枠を太くせずリングで示す。太さを変えるとノードの実寸が変わり、
        // React Flow が測り直してレイアウトが動く
        boxShadow: selected ? `0 0 0 3px ${ACTIVITY_BLUE}33, var(--shadow-2)` : "var(--shadow-1)",
        overflow: "hidden",
        fontFamily: "inherit",
      }}
    >
      {/* タイトル帯（Entity ノードと同じ作り: 種類の色 + 点 + 名前） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px 5px 10px",
          background: "var(--color-label-activity-bg)",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            flexShrink: 0,
            borderRadius: "50%",
            background: ACTIVITY_BLUE,
          }}
        />
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
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-foreground)",
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
              fontSize: 12,
              fontWeight: 700,
              color: ACTIVITY_TEXT,
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
                style={{ ...iconBtnStyle, color: ACTIVITY_TEXT }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Pencil size={12} />
              </button>
            )}
            {onJump && (
              <button
                onClick={() => onJump(id)}
                title={t("activityGraph.jumpToText")}
                style={{ ...iconBtnStyle, color: ACTIVITY_TEXT }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.7)")}
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
                style={{ ...iconBtnStyle, color: "var(--color-destructive)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-error-bg)")}
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
              color: "var(--color-destructive)",
              background: "var(--color-error-bg)",
              border: "1px solid var(--color-destructive)",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Trash2 size={11} /> {t("activityGraph.deleteNodeConfirm", { n: String(confirmCount) })}
          </button>
        </div>
      )}

      {/* パラメータはテーブルパネルで編集する。ここは件数と追加導線だけ */}
      {(activity.params.length > 0 || showAddControl) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 6px" }}>
          {activity.params.length > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: PARAM_COLOR }}>
              <SlidersHorizontal size={10} />
              {activity.params.length}
            </span>
          )}
          {showAddControl &&
            (adding ? (
              <span className="nodrag" style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                <KindDot kind={adding.kind} />
                <input
                  value={adding.draft}
                  autoFocus
                  placeholder={getDisplayLabelName(adding.kind)}
                  onChange={(e) => setAdding((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
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
            ) : addMenuOpen ? (
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
                      color: "var(--color-accent-foreground)",
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 9,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <KindDot kind={kind} />
                    {getDisplayLabelName(labelKey)}
                  </button>
                ))}
              </span>
            ) : (
              <button
                className="nodrag"
                onClick={() => setAddMenuOpen(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "1px 6px 1px 2px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--color-text-tertiary)",
                  background: "transparent",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                }}
              >
                <Plus size={11} /> {t("activityGraph.addChip")}
              </button>
            ))}
        </div>
      )}

      {/* 上=入力（受け側・白抜き）、下=出力（掴んで接続・青塗り） */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 9,
          height: 9,
          background: "var(--color-card)",
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
