// ──────────────────────────────────────────────
// 手順フロービュー（React Flow 版ノードエディタ、F 案）
//
// step カードに加えて material / tool / output の Entity が独立ノードに
// なり、パラメータは各ノード内の属性行に載る（Storybook Proposal F で合意）。
// 表示・探索系のグラフ（PROV フルビュー / ノート関係 / 全体 / アセット）は
// cytoscape（canvas）のまま。
//
// エッジ 3 種:
//   used      entity → step   緑実線（次の手順が材料・道具として使う）
//   generates step → entity   テラコッタ実線（この手順が生成した）
//   orderOnly step → step     青点線（物質を特定しない informed_by）
//
// 接続ドラッグの意味論:
//   entity(下ポート) → step   その Entity を対象手順の入力にする（本文に同名 span 合成）
//   step(下ポート) → step     順序のみの依存（informed_by リンク）
//   → entity への接続は不可（生成関係はドキュメント側で書く）
//
// すべての操作はコールバックで親（ActivityGraphEditor）へ委ね、
// ドキュメントを知らない（グラフは blocks+links の投影、を保つ）。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2 } from "lucide-react";
import { t } from "../../i18n";
import type { FlowGraphData } from "./activity-graph-adapter";
import { layoutStepFlow } from "./elk-flow-layout";
import { StepNodeCard } from "./step-node-card";
import { EntityFlowNode } from "./entity-flow-node";
import { FlowAttributeTable, type FlowSelection } from "./flow-attribute-table";

const ACTIVITY_BLUE = "#5b8fb9";
const MATERIAL_GREEN = "#4B7A52";
const OUTPUT_TERRACOTTA = "#c26356";
const DANGER = "#c26356";

/** onConnectSteps の戻り値。error が "cycle_detected" なら循環で拒否されたことを表示する */
export type ConnectResult = { error: string | null };

/** カードから追加できる要素の種類（本文への写像はエディタ側 STYLE_KEY を参照） */
export type EntityKind = "material" | "tool" | "output" | "attribute";

export type StepFlowViewProps = {
  graph: FlowGraphData;
  /** step → step の順序のみ依存（informed_by）。拒否理由を返すと画面に表示する */
  onConnectSteps?: (producer: string, consumer: string) => ConnectResult | void;
  /** orderOnly エッジの削除（deletable なものだけ呼ばれる） */
  onRemoveOrderEdge?: (producer: string, consumer: string) => void;
  /** entity → step 接続: その Entity を対象手順の入力にする（entityNodeId は provDoc の @id） */
  onConnectEntityToStep?: (entityNodeId: string, stepBlockId: string) => void;
  /** entity の下ポートを空白へドロップ: その Entity を受け取る新しい手順を作る */
  onCreateStepFromEntity?: (entityNodeId: string) => void;
  /** ツールバーの「+ 手順」。省略時はボタンを出さない */
  onAddActivity?: () => void;
  /** step カードのリネーム確定 */
  onRenameActivity?: (blockId: string, title: string) => void;
  /** step カードからの削除（step の中身ごと消える） */
  onDeleteActivity?: (blockId: string) => void;
  /** step カードの「本文へ」 */
  onJumpToBlock?: (blockId: string) => void;
  /** 削除確認に出す「中身のブロック数」 */
  getStepContentCount?: (blockId: string) => number;
  /** step カードからの入出力・パラメータ追加（本文に span 付き行を合成） */
  onAddEntity?: (blockId: string, kind: EntityKind, text: string) => void;
  /** entityId 指定のリネーム（Entity 名・属性行・step パラメータ行の共通機構） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** entityId 指定の削除（同上） */
  onRemoveEntity?: (entityId: string) => void;
  /** Entity ノードへの従属属性の追加 */
  onAddAttrToEntity?: (parentEntityId: string, text: string) => void;
  /** テーブル行 Entity: 行の名前（1 列目）の書き換え */
  onRenameTableRow?: (blockId: string, rowName: string, newName: string) => void;
  /** テーブル行 Entity: 属性セルの書き換え */
  onSetTableCell?: (blockId: string, rowName: string, columnKey: string, value: string) => void;
  /** テーブル行 Entity: 行の削除 */
  onRemoveTableRow?: (blockId: string, rowName: string) => void;
  /** 属性テーブルの置き場所。below = グラフの下（右パネル）、side = 右横（全画面） */
  tableLayout?: "below" | "side";
};

const nodeTypes = { step: StepNodeCard, entity: EntityFlowNode };

type FlowRfEdge = Edge<{ kind: string; deletable: boolean }>;

const EDGE_STYLES: Record<string, Partial<Edge>> = {
  used: {
    style: { stroke: MATERIAL_GREEN, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: MATERIAL_GREEN, width: 16, height: 16 },
  },
  generates: {
    style: { stroke: OUTPUT_TERRACOTTA, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: OUTPUT_TERRACOTTA, width: 16, height: 16 },
  },
  orderOnly: {
    style: { stroke: ACTIVITY_BLUE, strokeWidth: 1.5, strokeDasharray: "6 4" },
    markerEnd: { type: MarkerType.ArrowClosed, color: ACTIVITY_BLUE, width: 16, height: 16 },
  },
};

function StepFlowCanvas({
  graph,
  onConnectSteps,
  onRemoveOrderEdge,
  onConnectEntityToStep,
  onCreateStepFromEntity,
  onAddActivity,
  onRenameActivity,
  onDeleteActivity,
  onJumpToBlock,
  getStepContentCount,
  onAddEntity,
  onRenameEntity,
  onRemoveEntity,
  onAddAttrToEntity,
  onRenameTableRow,
  onSetTableCell,
  onRemoveTableRow,
  tableLayout = "below",
}: StepFlowViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowRfEdge>([]);
  // グラフが変わったら次に全ノードの実測サイズが揃った時点で ELK を流す。
  // useNodesInitialized は「後からノードを流し込む」経路で true にならない
  // ことがある（実測）ため、dimensions change 駆動 + 即時チェックの二段構えにする。
  const needsLayoutRef = useRef(false);
  // orderOnly エッジの削除メニュー（クリックで開く。即削除しないことで誤操作を防ぐ）
  const [edgeMenu, setEdgeMenu] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  // 循環でドラッグ接続を拒否したときの警告。0 = 非表示
  const [cycleWarnAt, setCycleWarnAt] = useState(0);
  // 属性テーブルに出す選択中ノード。グラフ再生成でノードが作り直されても
  // 選択は保つ（属性を足した直後にテーブルが空へ戻らないように）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const { fitView, getNodes } = useReactFlow();
  // 接続判定用に最新の graph を ref でも持つ（cy 初期化不要の React Flow でも
  // コールバック安定化のため）
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    if (!cycleWarnAt) return;
    const id = setTimeout(() => setCycleWarnAt(0), 3000);
    return () => clearTimeout(id);
  }, [cycleWarnAt]);

  // ── FlowGraphData → React Flow の nodes / edges 同期 ──
  useEffect(() => {
    setEdgeMenu(null);
    setNodes((prev: Node[]) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      const stepNodes: Node[] = graph.steps.map((s) => ({
        id: s.id,
        type: "step" as const,
        position: prevPos.get(s.id) ?? { x: 0, y: 0 },
        data: {
          activity: s,
          onRename: onRenameActivity,
          onDelete: onDeleteActivity,
          onJump: onJumpToBlock,
          getContentCount: getStepContentCount,
          onAddEntity,
          onRenameEntity,
          onRemoveEntity,
        },
        draggable: false,
        selected: s.id === selectedIdRef.current,
      }));
      const entityNodes: Node[] = graph.entities.map((e) => ({
        id: e.id,
        type: "entity" as const,
        position: prevPos.get(e.id) ?? { x: 0, y: 0 },
        data: {
          entity: e,
          onRenameEntity,
          onRemoveEntity,
          onRenameTableRow,
          onRemoveTableRow,
        },
        draggable: false,
        selected: e.id === selectedIdRef.current,
      }));
      return [...stepNodes, ...entityNodes];
    });
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...EDGE_STYLES[e.kind],
        ...(e.kind === "orderOnly"
          ? {
              label: t("activityGraph.orderOnly"),
              labelStyle: { fontSize: 9, fill: ACTIVITY_BLUE, fontWeight: 700 },
              labelBgStyle: { fill: "#fafdf7", fillOpacity: 0.9 },
            }
          : {}),
        data: { kind: e.kind, deletable: e.deletable ?? false },
      })),
    );
    needsLayoutRef.current = true;
    // 既存ノードの position 更新だけで dimensions change が来ないケースに備えて、
    // 次フレームで「全ノード実測済みなら即レイアウト」も試す
    requestAnimationFrame(() => tryLayout());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    graph,
    onRenameActivity,
    onDeleteActivity,
    onJumpToBlock,
    getStepContentCount,
    onAddEntity,
    onRenameEntity,
    onRemoveEntity,
    onAddAttrToEntity,
    onRenameTableRow,
    onSetTableCell,
    onRemoveTableRow,
    setNodes,
    setEdges,
  ]);

  // ── 全ノードの実測サイズが揃った時点で ELK レイアウト ──
  const tryLayout = useCallback(() => {
    if (!needsLayoutRef.current) return;
    const current = getNodes();
    if (current.length === 0 || !current.every((n) => n.measured?.width)) return;
    needsLayoutRef.current = false;
    const sized = current.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? 180,
      height: n.measured?.height ?? 48,
    }));
    void layoutStepFlow(
      sized,
      graphRef.current.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    ).then((positions) => {
      setNodes((nds: Node[]) =>
        nds.map((n: Node) => ({ ...n, position: positions.get(n.id) ?? n.position })),
      );
      requestAnimationFrame(() => {
        void fitView({ padding: 0.15, duration: 200, maxZoom: 1 });
      });
    });
  }, [getNodes, setNodes, fitView]);

  // ノードが measure された（dimensions change が流れた）タイミングでレイアウトを試す
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);
      if (needsLayoutRef.current && changes.some((c) => c.type === "dimensions")) {
        requestAnimationFrame(() => tryLayout());
      }
    },
    [onNodesChange, tryLayout],
  );

  // ── 接続（意味論はソース種別で分岐） ──
  const handleConnect = useCallback(
    (conn: { source: string | null; target: string | null }) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const g = graphRef.current;
      const sourceEntity = g.entities.find((e) => e.id === conn.source);
      const targetIsStep = g.steps.some((s) => s.id === conn.target);
      if (!targetIsStep) return;
      if (sourceEntity) {
        // Entity → step: その Entity を対象手順の入力にする（本文に同名 span 合成）
        onConnectEntityToStep?.(sourceEntity.id, conn.target);
        return;
      }
      if (g.steps.some((s) => s.id === conn.source)) {
        // step → step: 順序のみの依存（informed_by）
        const res = onConnectSteps?.(conn.source, conn.target);
        if (res && res.error === "cycle_detected") setCycleWarnAt(Date.now());
      }
    },
    [onConnectSteps, onConnectEntityToStep],
  );

  // Entity の下ポートを空白へドロップ → その Entity を入力に持つ新しい手順を作る。
  // n8n 的な「線を引き出して次を生やす」操作で、+ 手順を追加より発見しやすい。
  const handleConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; fromNode?: { id: string } | null }) => {
      if (connectionState.isValid) return; // 既存ノードへの接続は onConnect が処理済み
      const fromId = connectionState.fromNode?.id;
      if (!fromId) return;
      if (!graphRef.current.entities.some((e) => e.id === fromId)) return;
      onCreateStepFromEntity?.(fromId);
    },
    [onCreateStepFromEntity],
  );

  const isValidConnection: IsValidConnection<FlowRfEdge> = useCallback(
    (conn) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return false;
      const g = graphRef.current;
      // 受け側は step のみ（entity への接続 = 生成関係はドキュメント側で書く）
      if (!g.steps.some((s) => s.id === conn.target)) return false;
      return !edges.some((e) => e.source === conn.source && e.target === conn.target);
    },
    [edges],
  );

  // 選択中ノードを属性テーブルへ渡す（step / entity のどちらか）
  const selection: FlowSelection = selectedId
    ? (() => {
        const step = graph.steps.find((s) => s.id === selectedId);
        if (step) return { kind: "step" as const, step };
        const entity = graph.entities.find((e) => e.id === selectedId);
        return entity ? { kind: "entity" as const, entity } : null;
      })()
    : null;

  const attributeTable = (
    <FlowAttributeTable
      selection={selection}
      onRenameEntity={onRenameEntity}
      onRemoveEntity={onRemoveEntity}
      onAddAttrToEntity={onAddAttrToEntity}
      onAddStepParam={
        onAddEntity ? (stepBlockId, text) => onAddEntity(stepBlockId, "attribute", text) : undefined
      }
      onSetTableCell={onSetTableCell}
    />
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: tableLayout === "side" ? "row" : "column",
        gap: 8,
        width: "100%",
        height: "100%",
        minHeight: 0,
      }}
    >
    <div ref={wrapperRef} style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={onCreateStepFromEntity ? (handleConnectEnd as any) : undefined}
        isValidConnection={isValidConnection}
        onEdgeClick={(e: React.MouseEvent, edge: FlowRfEdge) => {
          if (edge.data?.kind !== "orderOnly" || !edge.data?.deletable || !onRemoveOrderEdge) return;
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (!rect) return;
          setEdgeMenu({
            source: edge.source,
            target: edge.target,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
        }}
        onSelectionChange={({ nodes: sel }) => {
          // 再生成の谷間で一瞬 [] が来ることがある。まだグラフに残っている
          // 選択は維持し、ユーザーが本当に外したときだけ null にする
          const next = sel[0]?.id ?? null;
          if (next) {
            setSelectedId(next);
            return;
          }
          const prev = selectedIdRef.current;
          const stillThere =
            prev &&
            (graphRef.current.steps.some((x) => x.id === prev) ||
              graphRef.current.entities.some((x) => x.id === prev));
          if (!stillThere) setSelectedId(null);
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

      {/* orderOnly エッジ削除メニュー */}
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
              onRemoveOrderEdge?.(edgeMenu.source, edgeMenu.target);
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
      {graph.steps.length === 0 && (
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

      {/* 使い方ヒント（エッジが 1 本でもあれば隠す） */}
      {graph.steps.length > 0 && graph.edges.length === 0 && (
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

      {/* 属性テーブル（下 or 右）。ノードは名前だけに保ち、中身はここで編集する */}
      <div
        style={
          tableLayout === "side"
            ? { width: 300, flexShrink: 0, minHeight: 0 }
            : { height: 176, flexShrink: 0 }
        }
      >
        {attributeTable}
      </div>
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
