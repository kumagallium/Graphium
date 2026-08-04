// 手順フロービューのノードカード。
//
// PROV ビュー（cytoscape の楕円）とは意図的に見た目を変える: こちらは
// 「編集するための UI」なので、ノードエディタの定石に寄せた角丸カードに
// タイトル + 入出力チップ + パラメータ行を載せ、操作（リネーム / 本文へ /
// 削除）はカード上に直接置く。色は design.md のラベル配色に従う
// （activity 青 / 材料 緑 / 道具 アンバー / output テラコッタ）。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import type { ActivityIoKind, ActivityNode } from "./activity-graph-adapter";

export type StepNodeData = {
  activity: ActivityNode;
  onRename?: (blockId: string, title: string) => void;
  onDelete?: (blockId: string) => void;
  onJump?: (blockId: string) => void;
  /** 削除確認に出す「中身のブロック数」。押した瞬間に評価する（stale 回避） */
  getContentCount?: (blockId: string) => number;
};

export type StepFlowNode = Node<StepNodeData, "step">;

const IO_COLORS: Record<ActivityIoKind, string> = {
  material: "#4B7A52", // 材料（ブランドグリーン）
  tool: "#c08b3e", // 道具（アンバー）
  output: "#c26356", // output（テラコッタ）
};

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

function IoChip({ kind, label }: { kind: ActivityIoKind; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        fontSize: 11,
        lineHeight: "16px",
        color: "#2d4a32",
      }}
    >
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
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </span>
  );
}

export function StepNodeCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const { activity, onRename, onDelete, onJump, getContentCount } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.name);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 選択が外れたら編集・削除確認をリセットする
  useEffect(() => {
    if (!selected) {
      setEditing(false);
      setConfirmCount(null);
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

  const hasBody = activity.inputs.length > 0 || activity.outputs.length > 0 || activity.params.length > 0;

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
          padding: hasBody ? "7px 8px 5px 10px" : "7px 8px 7px 10px",
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
      {hasBody && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            padding: "0 10px 7px 10px",
          }}
        >
          {activity.inputs.map((io, i) => (
            <IoChip key={`in-${i}`} kind={io.kind} label={io.label} />
          ))}
          {activity.outputs.map((io, i) => (
            <IoChip key={`out-${i}`} kind={io.kind} label={io.label} />
          ))}
          {activity.params.length > 0 && (
            <span
              title={activity.params.join(" · ")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                lineHeight: "16px",
                color: "#8fa394",
              }}
            >
              <SlidersHorizontal size={10} style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activity.params.join(" · ")}
              </span>
            </span>
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
