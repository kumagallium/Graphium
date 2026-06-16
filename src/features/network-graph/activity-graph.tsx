// ──────────────────────────────────────────────
// 手順フローグラフ（ノードエディタ的なリンク）
//
// 方針（2026-06-16 改訂 4）:
//   このビューは「手順の流れ」だけを操作する場にする。
//   実 PROV では手順間に必ず output entity が挟まるが、その紐づけは PROV ビューに任せ、
//   ここでは手順ノード同士を直接つなぐ手順依存（A → B）だけを描く・編集する。
//   ドラッグは informed_by を書き、生成側が PROV 側で output 経由に展開する。
//
//   配置・エッジスタイルは静的 PROV グラフ（view.tsx）と同じ ELK layered に揃える。
//   （描画は @xyflow/react。既存の読み取り専用 PROV グラフは Cytoscape のまま別物）
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
import ELK from "elkjs/lib/elk.bundled.js";
import { t } from "../../i18n";

// 静的 PROV グラフ（view.tsx）と同じレイアウトエンジン・同じパラメータで揃える
const elk = new ELK();

// ── テーマカラー（design.md グラフ可視化トークン準拠）──
const ACTIVITY_COLOR = "#5b8fb9"; // [手順]（青）
const ACTIVITY_BORDER = "#4a7da6";
const PORT_COLOR = "#5b8fb9";
const STEP_EDGE_COLOR = "#5b8fb9"; // wasInformedBy（手順依存）

// ELK 用のノードサイズ概算（静的 PROV グラフの密度に寄せて小型）
const NODE_W = 84;
const NODE_H = 28;

export type ActivityNode = {
  id: string; // blockId
  name: string; // 連番プレフィックス除去済みの activity 名
  phase?: "plan" | "result";
};

/** 手順間の依存（A が産み B が使う＝ B wasInformedBy A）。from=A / to=B で下向きに流す。 */
export type StepEdge = {
  id: string;
  from: string; // 生成側 activity（blockId）
  to: string; // 使用側 activity（blockId）
};

export type ActivityGraphProps = {
  activities: ActivityNode[];
  steps: StepEdge[];
  /** 手順 A（産）→ 手順 B（使）のドラッグ接続 */
  onConnectSteps?: (producer: string, consumer: string) => void;
  /** 手順エッジ削除 */
  onRemoveStep?: (stepId: string) => void;
};

// ── カスタムノード（手順 = 楕円ピル / 青）──
type ActivityNodeData = { name: string };
type ActivityFlowNode = Node<ActivityNodeData, "activity">;

const PORT_STYLE = {
  width: 9,
  height: 9,
  background: PORT_COLOR,
  border: "1.5px solid #ffffff",
};

function ActivityNodeView({ data }: NodeProps<ActivityFlowNode>) {
  return (
    <div
      style={{
        background: ACTIVITY_COLOR,
        border: `1.5px solid ${ACTIVITY_BORDER}`,
        borderRadius: 999,
        color: "#ffffff",
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 12px",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      <Handle type="target" position={Position.Top} style={PORT_STYLE} />
      {data.name}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} />
    </div>
  );
}

const nodeTypes = { activity: ActivityNodeView };

/**
 * ELK layered で配置する（静的 PROV グラフ view.tsx と同じエンジン・同じパラメータ）。
 * - 手順エッジ（from→to）を辺として与える
 * - 孤立した手順も文書順に並ぶよう、隠しシーケンス辺を与える（描画はしない）
 */
async function layout(activities: ActivityNode[], steps: StepEdge[]): Promise<ActivityFlowNode[]> {
  const children = activities.map((a) => ({ id: a.id, width: NODE_W, height: NODE_H }));
  const edges: { id: string; sources: string[]; targets: string[] }[] = steps.map((s) => ({
    id: `el-${s.id}`,
    sources: [s.from],
    targets: [s.to],
  }));
  for (let i = 0; i < activities.length - 1; i++) {
    edges.push({ id: `el-seq-${i}`, sources: [activities[i].id], targets: [activities[i + 1].id] });
  }

  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.layered.spacing.edgeNodeBetweenLayers": "30",
    },
    children,
    edges,
  });

  const pos = new Map((res.children ?? []).map((c: any) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return activities.map((a) => ({
    id: a.id,
    type: "activity" as const,
    position: pos.get(a.id) ?? { x: 0, y: 0 },
    data: { name: a.name },
  }));
}

function ActivityGraphInner({
  activities,
  steps,
  onConnectSteps,
  onRemoveStep,
}: ActivityGraphProps) {
  const activityIds = useMemo(() => new Set(activities.map((a) => a.id)), [activities]);

  // ELK 自動配置（非同期）。グラフが変わるたびに再レイアウトし、完了後に fit する。
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<ActivityFlowNode>([]);
  useEffect(() => {
    let cancelled = false;
    void layout(activities, steps).then((laid) => {
      if (cancelled) return;
      setNodes(laid);
      requestAnimationFrame(() => {
        try {
          fitView({ padding: 0.2, duration: 200 });
        } catch {
          /* fitView 前にアンマウントされた場合は無視 */
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activities, steps, setNodes, fitView]);

  // 手順依存エッジ（informed_by 色）。種別は 1 種類なので色も 1 色。
  const edges: Edge[] = steps.map((s) => ({
    id: s.id,
    source: s.from,
    target: s.to,
    style: { stroke: STEP_EDGE_COLOR, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: STEP_EDGE_COLOR, width: 13, height: 13 },
  }));

  // 接続の妥当性: 手順同士のみ・自己ループ不可・既存の重複不可
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (!activityIds.has(c.source) || !activityIds.has(c.target)) return false;
      return !steps.some((s) => s.from === c.source && s.to === c.target);
    },
    [activityIds, steps],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (!activityIds.has(c.source) || !activityIds.has(c.target)) return;
      onConnectSteps?.(c.source, c.target);
    },
    [activityIds, onConnectSteps],
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
        onEdgeClick={(_, edge) => onRemoveStep?.(edge.id)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#fafdf7", borderRadius: 8 }}
      />

      {/* 空状態のときだけ控えめに使い方を示す（つなぎが 1 本でもあれば隠す） */}
      {steps.length === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 12,
            color: "#8fa394", // text-tertiary（design.md）
            pointerEvents: "none",
          }}
        >
          {t("activityGraph.dragHint")}
        </div>
      )}
    </div>
  );
}

// useReactFlow（fitView）を使うため Provider でラップする
export function ActivityGraph(props: ActivityGraphProps) {
  return (
    <ReactFlowProvider>
      <ActivityGraphInner {...props} />
    </ReactFlowProvider>
  );
}
