// ──────────────────────────────────────────────
// Activity グラフ（ノードエディタ的なリンク試作）
//
// 方針（2026-06 改訂 3）:
//   実データでは activity 同士は直接つながらず、必ず output entity を挟む
//   （A →generated→ Entity →used→ B）。1 つの output は複数手順から used されうる。
//
//   モデル:「output は activity が所有」「used は何本でも張れる（fan-out）」。
//   操作:
//     - 手順 A の出力ポート → 手順 B の入力ポートへドラッグ
//         · A に output があれば【再利用】、無ければ【自動補完】して used を張る
//     - output ノード → 手順 B へドラッグ = used を足す（fan-out）
//   関係種ピッカーは不要。output は見える・名前を付けられるノードになる。
//
//   配置は dagre による自動レイアウト（縦スパイン）。activity の文書順は
//   隠しシーケンス辺で保ち、output はその間のランクに収まる。
//   （描画は @xyflow/react。既存の読み取り専用グラフは cytoscape のまま別物）
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo } from "react";
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
import dagre from "@dagrejs/dagre";

// ── テーマカラー（context-label のラベル配色準拠）──
const ACTIVITY_COLOR = "#5b8fb9"; // procedure（青）
const ACTIVITY_BORDER = "#4a7da6";
const OUTPUT_COLOR = "#c26356"; // output / result（赤系）
const OUTPUT_BORDER = "#a44d42";
const PORT_COLOR = "#5b8fb9";
const GENERATED_COLOR = "#c26356"; // wasGeneratedBy
const USED_COLOR = "#4B7A52"; // used

// dagre 用のノードサイズ概算
const SIZE = {
  activity: { w: 120, h: 46 },
  outputEntity: { w: 150, h: 30 },
} as const;

export type ActivityNode = {
  id: string; // blockId
  name: string; // 連番プレフィックス除去済みの activity 名
  phase?: "plan" | "result";
};

/** activity が所有する output entity */
export type OutputEntity = {
  id: string;
  owner: string; // 生成元 activity（blockId）
  label: string;
};

/** output → activity の used 関係（fan-out で複数張れる） */
export type UseEdge = {
  id: string;
  outputId: string;
  consumer: string; // 使用側 activity（blockId）
};

export type ActivityGraphProps = {
  activities: ActivityNode[];
  outputs: OutputEntity[];
  uses: UseEdge[];
  /** 手順 A → 手順 B のドラッグ（A の output を再利用 or 補完して used を張る） */
  onLinkActivities?: (from: string, to: string) => void;
  /** output → 手順 B のドラッグ（fan-out: used を足す） */
  onLinkOutput?: (outputId: string, to: string) => void;
  /** used エッジ削除 */
  onRemoveUse?: (useId: string) => void;
};

// ── カスタムノード ──
type ActivityNodeData = { name: string };
type OutputNodeData = { label: string };
type ActivityFlowNode = Node<ActivityNodeData, "activity">;
// 注意: React Flow のノード型名に予約語（input/default/output/group）を使うと
// 組み込みの .react-flow__node-<type> デフォルト枠が被るため "outputEntity" にする
type OutputFlowNode = Node<OutputNodeData, "outputEntity">;
type FlowNode = ActivityFlowNode | OutputFlowNode;

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
      <Handle type="target" position={Position.Top} style={PORT_STYLE} />
      {data.name}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} />
    </div>
  );
}

function OutputNodeView({ data }: NodeProps<OutputFlowNode>) {
  return (
    <div
      style={{
        background: OUTPUT_COLOR,
        border: `2px solid ${OUTPUT_BORDER}`,
        borderRadius: 999,
        color: "#ffffff",
        fontSize: 11,
        fontWeight: 600,
        padding: "5px 12px",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
      title="output entity（下のポートから別の手順へ used を増やせる / 自動補完）"
    >
      {/* 上: owner からの generated を受ける（自動なので手動接続不可） */}
      <Handle type="target" position={Position.Top} style={PORT_STYLE} isConnectable={false} />
      ⬡ {data.label}
      {/* 下: ここから別の手順へ used を伸ばせる（fan-out） */}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} />
    </div>
  );
}

const nodeTypes = { activity: ActivityNodeView, outputEntity: OutputNodeView };

/**
 * dagre で縦スパインに自動配置する。
 * - generated（owner→output）/ used（output→consumer）を辺として与える
 * - activity 同士は文書順を保つため隠しシーケンス辺を高 weight で与える（描画はしない）
 */
function layout(
  activities: ActivityNode[],
  outputs: OutputEntity[],
  uses: UseEdge[],
): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 78 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const a of activities) g.setNode(a.id, { ...SIZE.activity });
  for (const o of outputs) g.setNode(o.id, { ...SIZE.outputEntity });

  for (const o of outputs) g.setEdge(o.owner, o.id);
  for (const u of uses) g.setEdge(u.outputId, u.consumer);
  // 文書順維持（隠し辺・描画しない）
  for (let i = 0; i < activities.length - 1; i++) {
    g.setEdge(activities[i].id, activities[i + 1].id, { weight: 20, minlen: 1 });
  }

  dagre.layout(g);

  const toNode = (
    id: string,
    type: "activity" | "outputEntity",
    data: ActivityNodeData | OutputNodeData,
  ): FlowNode => {
    const n = g.node(id);
    const s = SIZE[type];
    const pos = n ? { x: n.x - s.w / 2, y: n.y - s.h / 2 } : { x: 0, y: 0 };
    return { id, type, position: pos, data } as FlowNode;
  };

  return [
    ...activities.map((a) => toNode(a.id, "activity", { name: a.name })),
    ...outputs.map((o) => toNode(o.id, "outputEntity", { label: o.label })),
  ];
}

export function ActivityGraph({
  activities,
  outputs,
  uses,
  onLinkActivities,
  onLinkOutput,
  onRemoveUse,
}: ActivityGraphProps) {
  const activityIds = useMemo(() => new Set(activities.map((a) => a.id)), [activities]);
  const outputIds = useMemo(() => new Set(outputs.map((o) => o.id)), [outputs]);

  // dagre 自動配置。グラフが変わるたびに再レイアウト。
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    layout(activities, outputs, uses),
  );
  useEffect(() => {
    setNodes(layout(activities, outputs, uses));
  }, [activities, outputs, uses, setNodes]);

  // generated: owner → output / used: output → consumer
  const edges: Edge[] = [
    ...outputs.map((o) => ({
      id: `gen-${o.id}`,
      source: o.owner,
      target: o.id,
      label: "wasGeneratedBy",
      style: { stroke: GENERATED_COLOR, strokeWidth: 2 },
      labelStyle: { fill: GENERATED_COLOR, fontSize: 9 },
      labelBgStyle: { fill: "#fafdf7" },
      markerEnd: { type: MarkerType.ArrowClosed, color: GENERATED_COLOR },
    })),
    ...uses.map((u) => ({
      id: u.id,
      source: u.outputId,
      target: u.consumer,
      label: "used",
      style: { stroke: USED_COLOR, strokeWidth: 2 },
      labelStyle: { fill: USED_COLOR, fontSize: 9 },
      labelBgStyle: { fill: "#fafdf7" },
      markerEnd: { type: MarkerType.ArrowClosed, color: USED_COLOR },
    })),
  ];

  // 接続の妥当性: 接続先は必ず activity。output の owner 自身へは戻さない。
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (!activityIds.has(c.target)) return false;
      if (outputIds.has(c.source)) {
        const owner = outputs.find((o) => o.id === c.source)?.owner;
        return owner !== c.target;
      }
      return activityIds.has(c.source);
    },
    [activityIds, outputIds, outputs],
  );

  // ドラッグ確定: 起点が activity なら手順リンク、output なら fan-out
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !activityIds.has(c.target)) return;
      if (activityIds.has(c.source)) onLinkActivities?.(c.source, c.target);
      else if (outputIds.has(c.source)) onLinkOutput?.(c.source, c.target);
    },
    [activityIds, outputIds, onLinkActivities, onLinkOutput],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onEdgeClick={(_, edge) => {
          if (edge.id.startsWith("gen-")) return; // generated は output 由来なので消さない
          onRemoveUse?.(edge.id);
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
          maxWidth: 380,
          lineHeight: 1.5,
        }}
      >
        手順下の青い丸 → 別の手順の上の丸へドラッグ。output が無ければ自動補完、
        既にあれば再利用。output 下の丸から別の手順へ伸ばすと used を足せます（fan-out）
      </div>
    </div>
  );
}
