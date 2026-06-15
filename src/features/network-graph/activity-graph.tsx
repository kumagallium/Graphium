// ──────────────────────────────────────────────
// Activity グラフ（ノードエディタ的なリンク試作）
//
// 目的: activity（手順見出し）間の operation リンクを、
//   余白ラベル → パネル → モーダル選択ではなく、
//   ノードエディタのようにポート（ノード下の丸）からドラッグして引く UX 検証。
//
// 各ノードは下にソースポート・上にターゲットポートを持ち、
// 下の丸を掴んで別ノードへドラッグ → ドロップで関係種を選んで接続する。
// activity↔activity の関係は informed_by（前手順）が主・reproduction_of（再現）が従。
// （描画は @xyflow/react。既存の読み取り専用グラフは cytoscape のままで別物）
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LINK_TYPE_META, type ProvLinkType } from "../block-link/link-types";

// ── テーマカラー（design.md / view.tsx 準拠）──
const NODE_COLOR = "#4B7A52"; // ブランドグリーン
const NODE_BORDER = "#3d6844";
const PORT_COLOR = "#5b8fb9"; // ポート（丸）の青

/** activity↔activity で選べる関係種（ドロップ時のピッカー候補） */
const ACTIVITY_RELATIONS: { type: ProvLinkType; label: string; hint: string }[] = [
  { type: "informed_by", label: "前の手順", hint: "wasInformedBy（順序）" },
  { type: "reproduction_of", label: "再現・追試", hint: "wasDerivedFrom（実験↔実験）" },
];

export type ActivityNode = {
  /** blockId */
  id: string;
  /** 連番プレフィックス除去済みの activity 名 */
  name: string;
  phase?: "plan" | "result";
};

export type ActivityEdge = {
  id: string;
  source: string; // sourceBlockId
  target: string; // targetBlockId
  type: ProvLinkType;
};

export type ActivityGraphProps = {
  activities: ActivityNode[];
  edges: ActivityEdge[];
  /** ポートからのドラッグ接続 → 関係種選択が確定したとき */
  onCreateEdge?: (source: string, target: string, type: ProvLinkType) => void;
  /** エッジクリックで削除 */
  onRemoveEdge?: (edgeId: string) => void;
};

// ── カスタムノード（上下にポートを持つ手順ボックス）──
type ActivityNodeData = { name: string; phase?: "plan" | "result" };
type ActivityFlowNode = Node<ActivityNodeData, "activity">;

const PORT_STYLE = {
  width: 12,
  height: 12,
  background: PORT_COLOR,
  border: "2px solid #ffffff",
};

function ActivityNodeView({ data }: NodeProps<ActivityFlowNode>) {
  return (
    <div
      style={{
        background: NODE_COLOR,
        border: `2px solid ${NODE_BORDER}`,
        borderRadius: 10,
        color: "#ffffff",
        fontSize: 13,
        fontWeight: 600,
        padding: "10px 16px",
        minWidth: 92,
        textAlign: "center",
      }}
    >
      {/* 上: 受け口（前の手順から来る線を受ける） */}
      <Handle type="target" position={Position.Top} style={PORT_STYLE} />
      {data.name}
      {/* 下: 出し口（ここを掴んでドラッグ） */}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} />
    </div>
  );
}

const nodeTypes = { activity: ActivityNodeView };

/** ドロップ時に表示する関係種ピッカーの状態 */
type PendingLink = { source: string; target: string; x: number; y: number } | null;

export function ActivityGraph({
  activities,
  edges,
  onCreateEdge,
  onRemoveEdge,
}: ActivityGraphProps) {
  // ノードはドラッグで動かせるようローカル state。位置は縦一列（手順の流れ）に初期配置。
  const [nodes, setNodes, onNodesChange] = useNodesState<ActivityFlowNode>(
    activities.map((a, i) => ({
      id: a.id,
      type: "activity",
      position: { x: 120, y: i * 110 },
      data: { name: a.name, phase: a.phase },
    })),
  );

  // activities が差し替わったら配置し直す
  useEffect(() => {
    setNodes(
      activities.map((a, i) => ({
        id: a.id,
        type: "activity",
        position: { x: 120, y: i * 110 },
        data: { name: a.name, phase: a.phase },
      })),
    );
  }, [activities, setNodes]);

  // エッジは親が所有（props）。色・矢印・ラベルを LINK_TYPE_META から付与。
  const flowEdges: Edge[] = edges.map((e) => {
    const meta = LINK_TYPE_META[e.type];
    const color = meta?.color ?? PORT_COLOR;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: meta?.provDM ?? e.type,
      style: { stroke: color, strokeWidth: 2 },
      labelStyle: { fill: color, fontSize: 9 },
      labelBgStyle: { fill: "#fafdf7" },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });

  // 関係ピッカーの配置にカーソル位置を使う
  const pointer = useRef({ x: 0, y: 0 });
  const [pending, setPending] = useState<PendingLink>(null);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setPending({
      source: c.source,
      target: c.target,
      x: pointer.current.x,
      y: pointer.current.y,
    });
  }, []);

  const confirmRelation = useCallback(
    (type: ProvLinkType) => {
      if (pending) onCreateEdge?.(pending.source, pending.target, type);
      setPending(null);
    },
    [pending, onCreateEdge],
  );

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgeClick={(_, edge) => onRemoveEdge?.(edge.id)}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#fafdf7", borderRadius: 8 }}
      >
        <Background color="#dde7df" gap={20} />
      </ReactFlow>

      {/* 操作ヒント */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: 12,
          color: "#6b7f6e",
          pointerEvents: "none",
        }}
      >
        ノード下の青い丸を掴んで、別の手順の上の丸へドラッグしてつなぎます
      </div>

      {/* ドロップ時の関係種ピッカー */}
      {pending && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setPending(null)}
          />
          <div
            style={{
              position: "fixed",
              left: pending.x,
              top: pending.y,
              transform: "translate(-50%, 10px)",
              zIndex: 41,
              background: "#ffffff",
              border: "1px solid #d9e2dc",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              padding: 6,
              minWidth: 180,
            }}
          >
            <div style={{ fontSize: 11, color: "#8a978d", padding: "2px 8px 6px" }}>
              関係を選ぶ
            </div>
            {ACTIVITY_RELATIONS.map((r) => (
              <button
                key={r.type}
                onClick={() => confirmRelation(r.type)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 6,
                  background: "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f6f1")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: LINK_TYPE_META[r.type].color,
                    fontWeight: 600,
                  }}
                >
                  {r.label}
                </span>
                <span style={{ fontSize: 10, color: "#9aa7a0" }}>{r.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
