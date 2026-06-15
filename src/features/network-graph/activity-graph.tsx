// ──────────────────────────────────────────────
// Activity グラフ（ノードエディタ的なリンク試作）
//
// 方針（2026-06 改訂）:
//   実データでは activity 同士は直接つながらず、必ず output entity を挟む
//   （A →generated→ Entity →used→ B）。informed_by を張っても生成側で
//   entity 経由に展開され、無ければ仮 entity が挿入される。
//
//   そこでグラフ上の操作も「activity の出力ポート → 別 activity の入力ポート」
//   へドラッグしたら、間に output entity を【自動補完】して
//   generated / used の 2 本を張る、という 1 ジェスチャに固定する。
//   関係種ピッカーは不要。entity は見える・名前を付けられるノードになる。
//
//   （描画は @xyflow/react。既存の読み取り専用グラフは cytoscape のまま別物）
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef } from "react";
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

// ── テーマカラー（context-label のラベル配色準拠）──
const ACTIVITY_COLOR = "#5b8fb9"; // procedure（青）
const ACTIVITY_BORDER = "#4a7da6";
const ENTITY_COLOR = "#c26356"; // output / result（赤系）
const ENTITY_BORDER = "#a44d42";
const PORT_COLOR = "#5b8fb9";
const GENERATED_COLOR = "#c26356"; // wasGeneratedBy
const USED_COLOR = "#4B7A52"; // used

export type ActivityNode = {
  /** blockId */
  id: string;
  /** 連番プレフィックス除去済みの activity 名 */
  name: string;
  phase?: "plan" | "result";
};

/**
 * activity 間の 1 操作。実体は A →generated→ [output entity] →used→ B。
 * outputLabel は補完された output entity のラベル（名前を付けられる）。
 */
export type Operation = {
  id: string;
  from: string; // 生成側 activity（blockId）
  to: string; // 使用側 activity（blockId）
  outputLabel: string;
};

export type ActivityGraphProps = {
  activities: ActivityNode[];
  operations: Operation[];
  /** activity → activity のドラッグ接続（間に output entity を補完する） */
  onCreateOperation?: (from: string, to: string) => void;
  /** エッジ or entity クリックで操作ごと削除 */
  onRemoveOperation?: (id: string) => void;
};

// ── カスタムノード ──
type ActivityNodeData = { name: string };
type EntityNodeData = { label: string };
type ActivityFlowNode = Node<ActivityNodeData, "activity">;
type EntityFlowNode = Node<EntityNodeData, "entity">;
type FlowNode = ActivityFlowNode | EntityFlowNode;

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
        background: ACTIVITY_COLOR,
        border: `2px solid ${ACTIVITY_BORDER}`,
        borderRadius: 10,
        color: "#ffffff",
        fontSize: 13,
        fontWeight: 600,
        padding: "10px 16px",
        minWidth: 92,
        textAlign: "center",
      }}
    >
      {/* 上: 入力ポート（前工程の output を受ける） */}
      <Handle type="target" position={Position.Top} style={PORT_STYLE} />
      {data.name}
      {/* 下: 出力ポート（ここを掴んでドラッグ） */}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} />
    </div>
  );
}

function EntityNodeView({ data }: NodeProps<EntityFlowNode>) {
  return (
    <div
      style={{
        background: ENTITY_COLOR,
        border: `2px solid ${ENTITY_BORDER}`,
        borderRadius: 999,
        color: "#ffffff",
        fontSize: 11,
        fontWeight: 600,
        padding: "5px 12px",
        textAlign: "center",
        opacity: 0.95,
      }}
      title="自動補完された output entity（クリックで削除）"
    >
      {/* entity は自動補完されるので手動接続は不可（isConnectable=false） */}
      <Handle type="target" position={Position.Top} style={PORT_STYLE} isConnectable={false} />
      ⬡ {data.label}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { activity: ActivityNodeView, entity: EntityNodeView };

export function ActivityGraph({
  activities,
  operations,
  onCreateOperation,
  onRemoveOperation,
}: ActivityGraphProps) {
  const activityIds = useMemo(() => new Set(activities.map((a) => a.id)), [activities]);
  const posY = useMemo(() => {
    const m = new Map<string, number>();
    activities.forEach((a, i) => m.set(a.id, i * 170));
    return m;
  }, [activities]);

  // activity ノード（縦一列＝工程の流れ）はドラッグで動かせるよう state 管理
  const [actNodes, setActNodes, onActNodesChange] = useNodesState<FlowNode>(
    activities.map((a) => ({
      id: a.id,
      type: "activity",
      position: { x: 140, y: posY.get(a.id) ?? 0 },
      data: { name: a.name },
    })),
  );

  useEffect(() => {
    setActNodes(
      activities.map((a) => ({
        id: a.id,
        type: "activity",
        position: { x: 140, y: posY.get(a.id) ?? 0 },
        data: { name: a.name },
      })),
    );
  }, [activities, posY, setActNodes]);

  // 各 operation を「entity ノード + generated/used エッジ 2 本」に展開
  const entityNodes: EntityFlowNode[] = operations.map((op) => {
    const yFrom = posY.get(op.from) ?? 0;
    const yTo = posY.get(op.to) ?? 0;
    return {
      id: `ent-${op.id}`,
      type: "entity",
      position: { x: 340, y: (yFrom + yTo) / 2 + 20 },
      data: { label: op.outputLabel },
    };
  });

  const nodes = [...actNodes, ...entityNodes];

  const edges: Edge[] = operations.flatMap((op) => {
    const entId = `ent-${op.id}`;
    return [
      {
        id: `${op.id}-gen`,
        source: op.from,
        target: entId,
        label: "wasGeneratedBy",
        style: { stroke: GENERATED_COLOR, strokeWidth: 2 },
        labelStyle: { fill: GENERATED_COLOR, fontSize: 9 },
        labelBgStyle: { fill: "#fafdf7" },
        markerEnd: { type: MarkerType.ArrowClosed, color: GENERATED_COLOR },
      },
      {
        id: `${op.id}-use`,
        source: entId,
        target: op.to,
        label: "used",
        style: { stroke: USED_COLOR, strokeWidth: 2 },
        labelStyle: { fill: USED_COLOR, fontSize: 9 },
        labelBgStyle: { fill: "#fafdf7" },
        markerEnd: { type: MarkerType.ArrowClosed, color: USED_COLOR },
      },
    ];
  });

  // ドラッグ接続: activity → activity のみ受け付け、operation を作る
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (!activityIds.has(c.source) || !activityIds.has(c.target)) return;
      onCreateOperation?.(c.source, c.target);
    },
    [activityIds, onCreateOperation],
  );

  // entity / エッジクリックで対応する operation を削除
  const opIdFromEdge = (edgeId: string) => edgeId.replace(/-(gen|use)$/, "");

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onActNodesChange}
        onConnect={onConnect}
        onEdgeClick={(_, edge) => onRemoveOperation?.(opIdFromEdge(edge.id))}
        onNodeClick={(_, node) => {
          if (node.type === "entity") onRemoveOperation?.(node.id.replace(/^ent-/, ""));
        }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#fafdf7", borderRadius: 8 }}
      >
        <Background color="#dde7df" gap={20} />
      </ReactFlow>

      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: 12,
          color: "#6b7f6e",
          pointerEvents: "none",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        手順ノード下の青い丸 → 別の手順の上の丸へドラッグすると、
        間に output entity（⬡ 赤）が自動で挟まり generated / used が張られます
      </div>
    </div>
  );
}
