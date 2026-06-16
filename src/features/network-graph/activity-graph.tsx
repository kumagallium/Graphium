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
//   配置は静的 PROV グラフ（view.tsx）と同じ ELK layered。activity の文書順は
//   隠しシーケンス辺で保ち、output はその間のランクに収まる。
//   （描画は @xyflow/react。既存の読み取り専用グラフは cytoscape のまま別物）
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

// ── テーマカラー（context-label のラベル配色準拠）──
const ACTIVITY_COLOR = "#5b8fb9"; // procedure（青）
const ACTIVITY_BORDER = "#4a7da6";
const OUTPUT_COLOR = "#c26356"; // output / result（赤系）
const OUTPUT_BORDER = "#a8513f"; // design.md グラフ可視化 [結果] ボーダー
const PORT_COLOR = "#5b8fb9";
const GENERATED_COLOR = "#c26356"; // wasGeneratedBy
const USED_COLOR = "#4B7A52"; // used

// ELK 用のノードサイズ概算（静的 PROV グラフの密度に寄せて小型）
const SIZE = {
  activity: { w: 84, h: 28 },
  outputEntity: { w: 116, h: 24 },
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
  width: 9,
  height: 9,
  background: PORT_COLOR,
  border: "1.5px solid #ffffff",
};

// design.md グラフ可視化トークン準拠:
//   Activity [手順] = 楕円（ピル）/ 青、Entity [結果] = 丸四角 / 赤。白文字。
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

function OutputNodeView({ data }: NodeProps<OutputFlowNode>) {
  return (
    <div
      style={{
        background: OUTPUT_COLOR,
        border: `1.5px solid ${OUTPUT_BORDER}`,
        borderRadius: 6,
        color: "#ffffff",
        fontSize: 10,
        fontWeight: 600,
        padding: "3px 9px",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
      title={data.label}
    >
      {/* 上: owner からの generated を受ける（自動なので手動接続不可） */}
      <Handle type="target" position={Position.Top} style={PORT_STYLE} isConnectable={false} />
      {data.label}
      {/* 下: ここから別の手順へ used を伸ばせる（fan-out） */}
      <Handle type="source" position={Position.Bottom} style={PORT_STYLE} />
    </div>
  );
}

const nodeTypes = { activity: ActivityNodeView, outputEntity: OutputNodeView };

/**
 * ELK layered で配置する（静的 PROV グラフ view.tsx と同じエンジン・同じパラメータ）。
 * - generated（owner→output）/ used（output→consumer）を辺として与える
 * - activity 同士は文書順を保つため隠しシーケンス辺を与える（描画はしない）
 */
async function layout(
  activities: ActivityNode[],
  outputs: OutputEntity[],
  uses: UseEdge[],
): Promise<FlowNode[]> {
  const children = [
    ...activities.map((a) => ({ id: a.id, width: SIZE.activity.w, height: SIZE.activity.h })),
    ...outputs.map((o) => ({ id: o.id, width: SIZE.outputEntity.w, height: SIZE.outputEntity.h })),
  ];
  const edges: { id: string; sources: string[]; targets: string[] }[] = [
    ...outputs.map((o) => ({ id: `el-gen-${o.id}`, sources: [o.owner], targets: [o.id] })),
    ...uses.map((u) => ({ id: `el-use-${u.id}`, sources: [u.outputId], targets: [u.consumer] })),
  ];
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
  const mk = (
    id: string,
    type: "activity" | "outputEntity",
    data: ActivityNodeData | OutputNodeData,
  ): FlowNode => ({ id, type, position: pos.get(id) ?? { x: 0, y: 0 }, data }) as FlowNode;

  return [
    ...activities.map((a) => mk(a.id, "activity", { name: a.name })),
    ...outputs.map((o) => mk(o.id, "outputEntity", { label: o.label })),
  ];
}

function ActivityGraphInner({
  activities,
  outputs,
  uses,
  onLinkActivities,
  onLinkOutput,
  onRemoveUse,
}: ActivityGraphProps) {
  const activityIds = useMemo(() => new Set(activities.map((a) => a.id)), [activities]);
  const outputIds = useMemo(() => new Set(outputs.map((o) => o.id)), [outputs]);

  // ELK 自動配置（非同期）。グラフが変わるたびに再レイアウトし、完了後に fit する。
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  useEffect(() => {
    let cancelled = false;
    void layout(activities, outputs, uses).then((laid) => {
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
  }, [activities, outputs, uses, setNodes, fitView]);

  // generated: owner → output / used: output → consumer
  // 静的 PROV グラフに合わせ、種別は色で表現（テキストラベルなし）・width 2・小さめ三角矢印
  const edges: Edge[] = [
    ...outputs.map((o) => ({
      id: `gen-${o.id}`,
      source: o.owner,
      target: o.id,
      style: { stroke: GENERATED_COLOR, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: GENERATED_COLOR, width: 16, height: 16 },
    })),
    ...uses.map((u) => ({
      id: u.id,
      source: u.outputId,
      target: u.consumer,
      style: { stroke: USED_COLOR, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: USED_COLOR, width: 16, height: 16 },
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
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#fafdf7", borderRadius: 8 }}
      />

      {/* 空状態のときだけ控えめに使い方を示す（つなぎが 1 本でもあれば隠す） */}
      {uses.length === 0 && (
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
