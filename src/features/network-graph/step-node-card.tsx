// 手順フロービューのノードカード。
//
// カードが持つのはタイトル・操作（リネーム / 本文へ / 削除）と、
// パラメータの件数だけ。中身の閲覧・編集も追加も flow-attribute-table
// （ステップの全テーブルを積んだパネル）に集約する。
// 色は design.md のラベル配色（activity 青 / 材料 緑 / 道具 アンバー /
// output テラコッタ）に従う。書き込みは data のコールバック経由。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { FileText, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import type { ActivityNode } from "./activity-graph-adapter";
import { KIND_PALETTE, selectionRing } from "./flow-palette";

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
  /**
   * 同名の兄弟ステップと値が食い違うパラメータ（computeStepDistinguishers）。
   * 見出しは操作名だけなので、条件違いの並列ノートはこれが唯一の見分け。
   * 兄弟がいない、または全員同じ値のときは空 = 何も出さない。
   */
  distinguishers?: string[];
};

export type StepFlowNode = Node<StepNodeData, "step">;


const PARAM_COLOR = "var(--color-text-tertiary)";
const ACTIVITY_BLUE = KIND_PALETTE.activity.main;
const ACTIVITY_TEXT = KIND_PALETTE.activity.text;

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

export function StepNodeCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const {
    activity,
    onRename,
    onDelete,
    onJump,
    getContentCount,
  } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.name);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const { getViewport, setViewport } = useReactFlow();

  // 選択が外れたら編集・削除確認・追加フローをリセットする
  useEffect(() => {
    if (!selected) {
      setEditing(false);
      setConfirmCount(null);
    }
  }, [selected]);

  // 開いた中身がキャンバスの外にはみ出したら、その分だけ寄せる。
  // 種類の選択肢は下へ伸びるので、端の手順だと切れて見えなくなる
  useEffect(() => {
    if (!selected) return;
    const id = requestAnimationFrame(() => {
      const el = cardRef.current;
      const pane = el?.closest(".react-flow");
      if (!el || !pane) return;
      const overflow = el.getBoundingClientRect().bottom - (pane.getBoundingClientRect().bottom - 8);
      if (overflow <= 0) return;
      const vp = getViewport();
      setViewport({ ...vp, y: vp.y - overflow }, { duration: 150 });
    });
    return () => cancelAnimationFrame(id);
  }, [selected, confirmCount, getViewport, setViewport]);

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

  const hasBody = activity.params.length > 0;
  const distinguishers = data.distinguishers ?? [];

  return (
    <div
      ref={cardRef}
      style={{
        minWidth: 180,
        maxWidth: 240,
        borderRadius: 8,
        background: "var(--color-card)",
        border: `1.5px solid ${ACTIVITY_BLUE}`,
        // 選択は枠を太くせずリングで示す。太さを変えるとノードの実寸が変わり、
        // React Flow が測り直してレイアウトが動く
        boxShadow: selected ? selectionRing(ACTIVITY_BLUE) : "var(--shadow-1)",
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
          background: KIND_PALETTE.activity.bg,
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

      {/* 同名ノードの見分け。値が割れているパラメータだけを薄く添える
          （全員同じ rpm: 300 は区別に効かないので出さない） */}
      {distinguishers.length > 0 && (
        <div
          style={{
            padding: "3px 10px 0",
            fontSize: 10,
            lineHeight: 1.35,
            color: PARAM_COLOR,
            overflowWrap: "anywhere",
          }}
        >
          {distinguishers.join(" · ")}
        </div>
      )}

      {/* パラメータの中身も追加もパネル側。ここは「ある」ことだけ示す */}
      {hasBody && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "4px 10px 6px",
            fontSize: 10,
            color: PARAM_COLOR,
          }}
        >
          <SlidersHorizontal size={10} />
          {activity.params.length}
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
