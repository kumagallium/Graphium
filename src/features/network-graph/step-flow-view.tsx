// ──────────────────────────────────────────────
// 手順フロービュー（React Flow 版ノードエディタ）
//
// 表示・探索系のグラフ（PROV フルビュー / ノート関係 / 全体 / アセット）は
// cytoscape（canvas）のままにし、「編集するグラフ」であるこのビューだけ
// React Flow を使う。ノードが DOM（React コンポーネント）になるので、
// カード UI・カード上の操作・Storybook での単体開発がそのまま効く。
//
// 役割は旧 activity-graph.tsx と同じ:
// - 手順ノードと手順依存（wasInformedBy）だけを描く
// - すべての操作はコールバックで親（ActivityGraphEditor）へ委ね、
//   ドキュメントを知らない（グラフは blocks+links の投影、を保つ）
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2 } from "lucide-react";
import { t } from "../../i18n";
import type { ActivityNode, StepEdge } from "./activity-graph-adapter";
import { layoutStepFlow } from "./elk-flow-layout";
import { StepNodeCard, type StepFlowNode } from "./step-node-card";

const ACTIVITY_BLUE = "#5b8fb9";
const DANGER = "#c26356";

/** onConnectSteps の戻り値。error が "cycle_detected" なら循環で拒否されたことを表示する */
export type ConnectResult = { error: string | null };

/** カードから追加できる要素の種類（本文への写像はエディタ側 STYLE_KEY を参照） */
export type EntityKind = "material" | "tool" | "output" | "attribute";

export type StepFlowViewProps = {
  activities: ActivityNode[];
  steps: StepEdge[];
  /** 手順 A（産）→ 手順 B（使）のドラッグ接続。拒否理由を返すと画面に表示する */
  onConnectSteps?: (producer: string, consumer: string) => ConnectResult | void;
  /** 手順エッジ削除（deletable なものだけ呼ばれる） */
  onRemoveStep?: (stepId: string) => void;
  /** ツールバーの「+ 手順」。省略時はボタンを出さない */
  onAddActivity?: () => void;
  /** ノードカードでのリネーム確定 */
  onRenameActivity?: (blockId: string, title: string) => void;
  /** ノードカードからの削除（step の中身ごと消える） */
  onDeleteActivity?: (blockId: string) => void;
  /** ノードカードの「本文へ」（エディタの該当 step へスクロール） */
  onJumpToBlock?: (blockId: string) => void;
  /** 削除確認に出す「中身のブロック数」。省略時は 0 扱い（確認なしで削除） */
  getStepContentCount?: (blockId: string) => number;
  /** カードからの入出力・パラメータ追加（本文に span 付き行を合成） */
  onAddEntity?: (blockId: string, kind: EntityKind, text: string) => void;
  /** チップのリネーム（本文 span のテキスト置換。entityId は維持） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** チップの削除（専用行なら行削除、文中なら mark 解除） */
  onRemoveEntity?: (entityId: string) => void;
};

const nodeTypes = { step: StepNodeCard };

type StepFlowEdge = Edge<{ deletable: boolean }>;

function StepFlowCanvas({
  activities,
  steps,
  onConnectSteps,
  onRemoveStep,
  onAddActivity,
  onRenameActivity,
  onDeleteActivity,
  onJumpToBlock,
  getStepContentCount,
  onAddEntity,
  onRenameEntity,
  onRemoveEntity,
}: StepFlowViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StepFlowEdge>([]);
  const [needsLayout, setNeedsLayout] = useState(false);
  // エッジ削除メニュー（クリックで開く。即削除しないことで誤操作を防ぐ）
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  // 循環でドラッグ接続を拒否したときの警告。0 = 非表示
  const [cycleWarnAt, setCycleWarnAt] = useState(0);
  const nodesInitialized = useNodesInitialized();
  const { fitView, getNodes } = useReactFlow();

  useEffect(() => {
    if (!cycleWarnAt) return;
    const id = setTimeout(() => setCycleWarnAt(0), 3000);
    return () => clearTimeout(id);
  }, [cycleWarnAt]);

  // ── activities / steps → React Flow の nodes / edges 同期 ──
  useEffect(() => {
    setEdgeMenu(null);
    setNodes((prev: StepFlowNode[]) => {
      const prevPos = new Map(prev.map((n: StepFlowNode) => [n.id, n.position]));
      return activities.map((a) => ({
        id: a.id,
        type: "step" as const,
        position: prevPos.get(a.id) ?? { x: 0, y: 0 },
        data: {
          activity: a,
          onRename: onRenameActivity,
          onDelete: onDeleteActivity,
          onJump: onJumpToBlock,
          getContentCount: getStepContentCount,
          onAddEntity,
          onRenameEntity,
          onRemoveEntity,
        },
        draggable: false,
      }));
    });
    setEdges(
      steps.map((s) => ({
        id: s.id,
        source: s.from,
        target: s.to,
        style: { stroke: ACTIVITY_BLUE, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: ACTIVITY_BLUE, width: 18, height: 18 },
        data: { deletable: s.deletable ?? false },
      })),
    );
    setNeedsLayout(true);
  }, [
    activities,
    steps,
    onRenameActivity,
    onDeleteActivity,
    onJumpToBlock,
    getStepContentCount,
    onAddEntity,
    onRenameEntity,
    onRemoveEntity,
    setNodes,
    setEdges,
  ]);

  // ── ノードの実測サイズが揃ったら ELK でレイアウト ──
  useEffect(() => {
    if (!nodesInitialized || !needsLayout) return;
    let cancelled = false;
    const current = getNodes();
    const sized = current.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? 200,
      height: n.measured?.height ?? 56,
    }));
    void layoutStepFlow(
      sized,
      steps.map((s) => ({ id: s.id, source: s.from, target: s.to })),
    ).then((positions) => {
      if (cancelled) return;
      setNodes((nds: StepFlowNode[]) =>
        nds.map((n: StepFlowNode) => ({ ...n, position: positions.get(n.id) ?? n.position })),
      );
      setNeedsLayout(false);
      requestAnimationFrame(() => {
        void fitView({ padding: 0.15, duration: 200, maxZoom: 1 });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [nodesInitialized, needsLayout, steps, getNodes, setNodes, fitView]);

  // ── 接続（source=産む側の下ポート → target=使う側の上ポート） ──
  const handleConnect = useCallback(
    (conn: { source: string | null; target: string | null }) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const res = onConnectSteps?.(conn.source, conn.target);
      // store が循環（DAG 違反）で拒否したときは理由をその場に出す
      if (res && res.error === "cycle_detected") setCycleWarnAt(Date.now());
    },
    [onConnectSteps],
  );

  const isValidConnection: IsValidConnection<StepFlowEdge> = useCallback(
    (conn) =>
      !!conn.source &&
      !!conn.target &&
      conn.source !== conn.target &&
      !edges.some((e) => e.source === conn.source && e.target === conn.target),
    [edges],
  );

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onEdgeClick={(e: React.MouseEvent, edge: StepFlowEdge) => {
          if (!edge.data?.deletable || !onRemoveStep) return;
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (!rect) return;
          setEdgeMenu({ edgeId: edge.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        onPaneClick={() => setEdgeMenu(null)}
        onMove={() => setEdgeMenu(null)}
        nodesDraggable={false}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={4}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        style={{ background: "#fafdf7", borderRadius: 8 }}
      >
        <Background color="#d5e0d7" gap={22} size={1.5} />

        {onAddActivity && (
          <Panel position="top-right">
            <button
              onClick={onAddActivity}
              title={t("activityGraph.addStep")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                color: ACTIVITY_BLUE,
                background: "#ffffff",
                border: "1px solid #d5e0d7",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(30, 20, 10, 0.08)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f5ef")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
            >
              <Plus size={13} /> {t("activityGraph.addStep")}
            </button>
          </Panel>
        )}

        {cycleWarnAt !== 0 && (
          <Panel position="top-center">
            <div
              style={{
                background: "#fef2f2",
                color: DANGER,
                border: `1px solid ${DANGER}`,
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {t("step.cycleBlocked")}
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* エッジ削除メニュー */}
      {edgeMenu && (
        <div
          style={{
            position: "absolute",
            left: edgeMenu.x,
            top: edgeMenu.y,
            transform: "translate(-50%, -50%)",
            zIndex: 30,
            background: "#ffffff",
            border: "1px solid #d5e0d7",
            borderRadius: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            padding: 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onRemoveStep?.(edgeMenu.edgeId);
              setEdgeMenu(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 600,
              color: DANGER,
              background: "transparent",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Trash2 size={14} /> {t("activityGraph.deleteStep")}
          </button>
        </div>
      )}

      {/* 空状態: まだ手順が無いノートの入口 */}
      {activities.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            pointerEvents: "none",
            textAlign: "center",
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4a6350" }}>
            {t("activityGraph.emptyTitle")}
          </div>
          <div style={{ fontSize: 12, color: "#8fa394" }}>{t("activityGraph.emptyHint")}</div>
        </div>
      )}

      {/* 使い方ヒント（つなぎが 1 本でもあれば隠す） */}
      {activities.length > 0 && steps.length === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 12,
            color: "#8fa394",
            pointerEvents: "none",
          }}
        >
          {t("activityGraph.dragHint")}
        </div>
      )}
    </div>
  );
}

export function StepFlowView(props: StepFlowViewProps) {
  return (
    <ReactFlowProvider>
      <StepFlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
