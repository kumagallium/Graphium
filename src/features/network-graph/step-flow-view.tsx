// ──────────────────────────────────────────────
// 手順フロービュー（React Flow 版ノードエディタ、F 案）
//
// step カードに加えて material / tool / output の Entity が独立ノードに
// なる（Storybook Proposal F で合意）。ノードが載せるのは名前と件数だけで、
// 属性とパラメータは下のテーブルパネル（= ノート側の表そのもの）で編集する。
// 表示・探索系のグラフ（ノート関係 / 全体 / アセット）は cytoscape のまま。
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
import { LayoutGrid, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { t } from "../../i18n";
import { LINK_TYPE_META, getLinkTypeLabel } from "../block-link/link-types";
import { computeStepDistinguishers, type FlowGraphData } from "./activity-graph-adapter";
import { layoutStepFlow } from "./elk-flow-layout";
import { StepNodeCard } from "./step-node-card";
import { EntityFlowNode } from "./entity-flow-node";
import { FlowStepPanel, type FlowSelection, type StepPanelData } from "./flow-attribute-table";
import { KIND_PALETTE } from "./flow-palette";
import { useGraphDataKey, useGraphRenderKey } from "./graph-identity";
import { GraphSelectionHint } from "./GraphSelectionHint";
import { seedUnplacedFlowNodes, useGraphLayout } from "./use-graph-layout";
import { ResizeHandle } from "../../components/ResizeHandle";
import { useResizableWidth } from "../../hooks/use-resizable-width";
import { useResizableHeight } from "../../hooks/use-resizable-height";

const ACTIVITY_BLUE = KIND_PALETTE.activity.main;
const MATERIAL_GREEN = KIND_PALETTE.material.main;
const OUTPUT_TERRACOTTA = KIND_PALETTE.output.main;
const DANGER = "var(--color-destructive)";

/**
 * derived エッジ（prov:wasDerivedFrom）の色とラベルを、元のブロック間リンク種別で
 * 出し分ける。generator.ts の wasDerivedFrom は 3 由来を区別なく生成するため
 * （derived_from / reproduction_of / used・generated の Activity 未解決フォールバック）、
 * FlowEdge.linkType（無指定=derived_from）を見て block-link 側の
 * LINK_TYPE_META と同じ色分けに揃える。
 */
function derivedEdgeVisual(linkType?: string): { color: string; label: string } {
  switch (linkType) {
    case "reproduction_of":
      return { color: LINK_TYPE_META.reproduction_of.color, label: getLinkTypeLabel("reproduction_of") };
    case "used":
      return { color: LINK_TYPE_META.used.color, label: getLinkTypeLabel("used") };
    case "generated":
      return { color: LINK_TYPE_META.generated.color, label: getLinkTypeLabel("generated") };
    default:
      return { color: LINK_TYPE_META.derived_from.color, label: t("activityGraph.derivedFrom") };
  }
}

/** onConnectSteps の戻り値。error が "cycle_detected" なら循環で拒否されたことを表示する */
export type ConnectResult = { error: string | null };

/**
 * カードから追加できる要素の種類（本文への写像はエディタ側 STYLE_KEY を参照）。
 * パラメータは含まない — step のパラメータはテーブルパネルの列として足す。
 */
export type EntityKind = "material" | "tool" | "output";

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
  /** 別ノート由来の step / input から参照元ノートを開く */
  onOpenExternalNote?: (noteId: string) => void;
  /** 削除確認に出す「中身のブロック数」 */
  getStepContentCount?: (blockId: string) => number;
  /** 共有行の「表に追加」: その step の kind 表に行を書く（表が無ければ作る） */
  onAddEntity?: (blockId: string, kind: EntityKind, text: string) => void;
  /** entityId 指定のリネーム（Entity 名・属性行・step パラメータ行の共通機構） */
  onRenameEntity?: (entityId: string, text: string) => void;
  /** entityId 指定の削除（同上） */
  onRemoveEntity?: (entityId: string) => void;
  /** テーブル行 Entity: 行の名前（1 列目）の書き換え */
  onRenameTableRow?: (blockId: string, rowName: string, newName: string) => void;
  /** テーブル行 Entity: 行の削除 */
  onRemoveTableRow?: (blockId: string, rowName: string) => void;
  /** 属性テーブルの置き場所。below = グラフの下（右パネル）、side = 右横（全画面） */
  tableLayout?: "below" | "side";
  /**
   * 手動配置を保存するスコープ（provFlowScope(noteId)）。
   * 指定するとノードをドラッグで動かせるようになり、並びが保存・復元される。
   * 未指定なら従来どおり自動レイアウト専用（ドラッグ不可）。
   */
  layoutScope?: string | null;
  /**
   * 使われ方。"preview" はプロセス一覧の右ペインのように、構造だけを見せて
   * 編集させない場所で使う: 属性テーブルを畳み、初期表示で縮小しすぎない
   * （収まりきらない長い手順は読める大きさのままスクロールで追う）。
   */
  variant?: "editor" | "preview";
  /** 選択の裏にある step の中身（全テーブル + 本文 span 由来）を読む */
  getPanelFor?: (selection: FlowSelection) => StepPanelData | null;
  onSetCell?: (blockId: string, rowIndex: number, colIndex: number, value: string) => void;
  onRenameColumn?: (blockId: string, colIndex: number, name: string) => void;
  onAddColumn?: (blockId: string, name: string) => void;
  onRemoveColumn?: (blockId: string, colIndex: number) => void;
  onAddRow?: (blockId: string, name: string) => void;
  /** 空セクションの「表を追加」: 空の表をラベル付きで作る */
  onCreateSectionTable?: (stepBlockId: string, kind: "attribute" | EntityKind, name: string) => void;
  onMoveEntityToTable?: (entityNodeId: string) => void;
  onMoveParamToTable?: (stepBlockId: string, entityId: string, key: string, value: string) => void;
};

const nodeTypes = { step: StepNodeCard, entity: EntityFlowNode };

/** プレビューで先頭に寄せるときの上余白 */
const PREVIEW_TOP_PADDING = 24;
/** パラメータ展開の記憶キー（端末ごと・ノート横断） */
const SHOW_PARAMS_KEY = "graphium:stepFlowShowParams";

const toolbarBtnStyle = (color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  color,
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  cursor: "pointer",
  boxShadow: "0 1px 3px rgba(30, 20, 10, 0.08)",
});

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
  external: {
    style: { stroke: OUTPUT_TERRACOTTA, strokeWidth: 1.5, strokeDasharray: "5 4" },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: OUTPUT_TERRACOTTA,
      width: 16,
      height: 16,
    },
  },
  // derived は linkType で色が分かれるため EDGE_STYLES では定義せず、
  // setEdges 内で derivedEdgeVisual() から動的に組み立てる
};

function isEditableStep(graph: FlowGraphData, id: string): boolean {
  return graph.steps.some((step) => step.id === id && !step.externalOrigin);
}

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
  onOpenExternalNote,
  getStepContentCount,
  onAddEntity,
  onRenameEntity,
  onRemoveEntity,
  onRenameTableRow,
  onRemoveTableRow,
  tableLayout = "below",
  layoutScope = null,
  variant = "editor",
  getPanelFor,
  onSetCell,
  onRenameColumn,
  onAddColumn,
  onRemoveColumn,
  onAddRow,
  onCreateSectionTable,
  onMoveEntityToTable,
  onMoveParamToTable,
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
  // 前回のノード id 一覧。選択中のノードが消えたとき、入れ替わりで現れた
  // ノードへ選択を引き継ぐために使う（表に移す・行のリネームで id が変わる）
  // パラメータの展開はビューの読み方（形を見る / 条件を読む）の切り替えなので、
  // ノートではなく端末の設定として覚える。ref も持つのは、ノード再構築の
  // useEffect が showParams を依存に取らずに最新値を読めるようにするため
  const [showParams, setShowParams] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(SHOW_PARAMS_KEY) === "1";
  });
  const showParamsRef = useRef(showParams);
  showParamsRef.current = showParams;
  // カードの中身が変わったときは、React Flow が測り直した後にもう一度並べ直す。
  // 直後の 1 回は古い実測値で走ってしまい、そのままだと配置がずれたまま残る
  const relayoutAfterResizeRef = useRef(false);

  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const { fitView, getNodes, getViewport, setViewport } = useReactFlow();

  // ── 手動配置の保存（ノート周辺グラフと同じ仕組み・同じ保存先）──
  //
  // 保存済みの座標があるノードはその位置に戻し、ELK は流さない。1 つノードが
  // 増えただけで手で整えた並びが崩れないようにするため（Cytoscape 側と同じ方針）。
  const {
    ready: layoutReady,
    positions: savedPositions,
    save: saveLayout,
    reset: resetLayout,
    hasSaved: hasSavedLayout,
    resetSeq: layoutResetSeq,
    showSelectionHint,
  } = useGraphLayout(layoutScope);
  // ノード再構築 effect の依存には入れない（保存のたびに参照が変わり、
  // ドラッグ → 保存 → 再構築のループになる）
  const savedPositionsRef = useRef(savedPositions);
  savedPositionsRef.current = savedPositions;
  const saveLayoutRef = useRef(saveLayout);
  saveLayoutRef.current = saveLayout;
  // 手動配置を使っている間は ELK を走らせない。resetLayout でこの旗が下りる
  const usingSavedLayoutRef = useRef(false);
  // ユーザーがノードを掴んだ。走っている（非同期の）ELK の結果は捨てる —
  // ELK は Promise で返ってくるので、ドラッグ中に解決すると位置を上書きして
  // 「動かしたのに元の場所へ戻る」になる。掴んだ時点で人の意思の方が新しい
  const layoutAbandonedRef = useRef(false);
  // プレビューは全体を収めるより読めることを優先する
  const fitMinZoom = variant === "preview" ? 0.55 : 0.2;
  // 接続判定用に最新の graph を ref でも持つ（cy 初期化不要の React Flow でも
  // コールバック安定化のため）
  const graphRef = useRef(graph);
  graphRef.current = graph;
  // ノードを作り直すかは中身で決める。graph は PROV の再生成のたびに新しい
  // オブジェクトになるので、参照を依存にすると入力のたびに ELK が流れてノードが動く
  const graphKey = useGraphDataKey(graph);
  // ドラッグ中はノードの作り直しを待たせる。作り直すと position が prevPos 由来に
  // 戻り、ドラッグ途中の位置が失われる（＝動かしたのに戻る）
  const { renderKey, beginDrag, endDrag } = useGraphRenderKey(graphKey);

  useEffect(() => {
    if (!cycleWarnAt) return;
    const id = setTimeout(() => setCycleWarnAt(0), 3000);
    return () => clearTimeout(id);
  }, [cycleWarnAt]);

  // ── FlowGraphData → React Flow の nodes / edges 同期 ──
  useEffect(() => {
    // 保存済みの配置を読み終えるまで組まない。先に ELK で組むと、復元のたびに
    // ノードが並べ直されて見える
    if (!layoutReady) return;
    setEdgeMenu(null);
    // 選択中ノードが消えた場合、同じ更新で新しく現れたノードが 1 つだけなら
    // それが「同じもの」の付け替え（表に移した・行名を変えた）なので選択を移す
    const currentIds = new Set<string>([
      ...graph.steps.map((s) => s.id),
      ...graph.entities.map((e) => e.id),
    ]);
    const prevIds = prevNodeIdsRef.current;
    const sel = selectedIdRef.current;
    if (sel && prevIds.size > 0 && !currentIds.has(sel)) {
      const appeared = [...currentIds].filter((id) => !prevIds.has(id));
      const next = appeared.length === 1 ? appeared[0] : null;
      selectedIdRef.current = next;
      setSelectedId(next);
    }
    prevNodeIdsRef.current = currentIds;
    setNodes((prev: Node[]) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      // 保存済みの座標。スコープが無い文脈（プレビュー等）では常に null
      const saved = savedPositionsRef.current;
      const nodesAreDraggable = !!layoutScope;
      // 同名ステップ（条件違いの並列ラン）を見分けるためのパラメータ
      const distinguishers = computeStepDistinguishers(graph.steps);
      const showParams = showParamsRef.current;
      const stepNodes: Node[] = graph.steps.map((s) => ({
        id: s.id,
        type: "step" as const,
        position: saved?.[s.id] ?? prevPos.get(s.id) ?? { x: 0, y: 0 },
        data: {
          activity: s,
          onRename: s.externalOrigin ? undefined : onRenameActivity,
          onDelete: s.externalOrigin ? undefined : onDeleteActivity,
          onJump: s.externalOrigin ? undefined : onJumpToBlock,
          onOpenExternalNote,
          getContentCount: s.externalOrigin ? undefined : getStepContentCount,
          distinguishers: distinguishers.get(s.id),
          showParams,
        },
        draggable: nodesAreDraggable,
        selected: s.id === selectedIdRef.current,
      }));
      const entityNodes: Node[] = graph.entities.map((e) => ({
        id: e.id,
        type: "entity" as const,
        position: saved?.[e.id] ?? prevPos.get(e.id) ?? { x: 0, y: 0 },
        data: {
          entity: e,
          onRenameEntity,
          onRemoveEntity,
          onRenameTableRow,
          onRemoveTableRow,
          onOpenExternalNote,
          showParams,
        },
        draggable: nodesAreDraggable,
        selected: e.id === selectedIdRef.current,
      }));
      return [...stepNodes, ...entityNodes];
    });
    setEdges(
      graph.edges.map((e) => {
        // derived は linkType で色分けが変わるため、他の kind と違い静的な
        // EDGE_STYLES を引かず、その場で色・ラベルを組み立てる
        const derived = e.kind === "derived" ? derivedEdgeVisual(e.linkType) : null;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(derived
            ? {
                style: { stroke: derived.color, strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: derived.color, width: 16, height: 16 },
              }
            : EDGE_STYLES[e.kind]),
          ...(e.kind === "orderOnly"
            ? {
                label: t("activityGraph.orderOnly"),
                labelStyle: { fontSize: 9, fill: ACTIVITY_BLUE, fontWeight: 700 },
                labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.9 },
              }
            : e.kind === "external"
              ? {
                  label: t("activityGraph.externalProcess"),
                  labelStyle: { fontSize: 9, fill: OUTPUT_TERRACOTTA, fontWeight: 700 },
                  labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.9 },
                }
              : derived
                ? {
                    label: derived.label,
                    labelStyle: { fontSize: 9, fill: derived.color, fontWeight: 700 },
                    labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.9 },
                  }
                : {}),
          data: { kind: e.kind, deletable: e.deletable ?? false },
        };
      }),
    );
    // 保存済みの配置が 1 つでもあるなら ELK は流さない（手で整えた並びを保つ）。
    // 保存に無い新しいノードだけ、既存の並びの下に仮置きして気づけるようにする
    const savedNow = savedPositionsRef.current;
    const placedCount = savedNow
      ? [...graph.steps, ...graph.entities].filter((n) => savedNow[n.id]).length
      : 0;
    usingSavedLayoutRef.current = placedCount > 0;
    if (usingSavedLayoutRef.current && savedNow) {
      needsLayoutRef.current = false;
      setNodes((nds: Node[]) => seedUnplacedFlowNodes(nds, savedNow));
    } else {
      needsLayoutRef.current = true;
      // 既存ノードの position 更新だけで dimensions change が来ないケースに備えて、
      // 次フレームで「全ノード実測済みなら即レイアウト」も試す
      requestAnimationFrame(() => tryLayout());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    renderKey,
    onRenameActivity,
    onDeleteActivity,
    onJumpToBlock,
    onOpenExternalNote,
    getStepContentCount,
    onRenameEntity,
    onRemoveEntity,
    onRenameTableRow,
    onRemoveTableRow,
    showParams,
    setNodes,
    setEdges,
    // 保存済み配置の読み込み完了とリセットで組み直す。savedPositions / saveLayout
    // 自体は ref 経由で読む（依存に入れるとドラッグ → 保存 → 再構築のループになる）
    layoutReady,
    layoutResetSeq,
    layoutScope,
  ]);

  // ── 全ノードの実測サイズが揃った時点で ELK レイアウト ──
  // 実行中フラグ。ELK は非同期なので、完了前に graph が変わったときは
  // 完了後にもう一周して「最後の要求が必ず勝つ」ようにする
  const layoutRunningRef = useRef(false);
  const tryLayout = useCallback(() => {
    if (!needsLayoutRef.current || layoutRunningRef.current) return;
    const current = getNodes();
    // store が最新の graph をまだ反映していない間は消費しない。
    // ここで走らせると「古い一覧は全部測定済み」で ELK が確定してしまい、
    // 直後にマウントされる新ノードが (0,0) に置き去りになる（実バグ）
    const g = graphRef.current;
    const expected = new Set<string>([...g.steps.map((s) => s.id), ...g.entities.map((e) => e.id)]);
    if (
      current.length === 0 ||
      current.length !== expected.size ||
      !current.every((n) => expected.has(n.id) && n.measured?.width)
    )
      return;
    layoutRunningRef.current = true;
    const sized = current.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? 180,
      height: n.measured?.height ?? 48,
    }));
    void layoutStepFlow(
      sized,
      g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    ).then((positions) => {
      // ドラッグが始まっていたら、この結果はもう古い
      if (layoutAbandonedRef.current) {
        needsLayoutRef.current = false;
        return;
      }
      // 適用できたときだけ要求を消す。ELK が失敗した場合（下の catch）は
      // 要求を残し、次の変化・整列ボタンで再試行できるようにする。
      // 以前はレイアウト開始前に消していたため、一度失敗すると誰も再実行せず
      // ノードが (0,0) や旧位置に置き去りのまま「グラフが消えた」状態に固定された
      needsLayoutRef.current = false;
      setNodes((nds: Node[]) =>
        nds.map((n: Node) => ({ ...n, position: positions.get(n.id) ?? n.position })),
      );
      requestAnimationFrame(() => {
        // duration を残すと、アニメーションが後から viewport を動かして
        // 下の先頭寄せを上書きする（実機で再現）。プレビューは即座に決める
        void fitView({
          padding: 0.15,
          duration: variant === "preview" ? 0 : 200,
          maxZoom: 1,
          minZoom: fitMinZoom,
        }).then(
          () => {
            // 手順は上から下へ読むもの。収まりきらないときに中央合わせだと
            // 最初の工程が画面外へ出てしまうので、プレビューでは先頭に寄せる
            if (variant !== "preview") return;
            const top = Math.min(...getNodes().map((n) => n.position.y));
            if (!Number.isFinite(top)) return;
            const { x, zoom } = getViewport();
            setViewport({ x, y: -top * zoom + PREVIEW_TOP_PADDING, zoom });
          },
        );
      });
    }).catch((err) => {
      // ELK の失敗を握り潰さない。needsLayout は残っているので再試行可能
      console.warn("手順フローのレイアウトに失敗:", err);
    }).finally(() => {
      layoutRunningRef.current = false;
      // 実行中に graph が変わって新しい要求が積まれていたら、そのまま続けて並べ直す
      if (needsLayoutRef.current) requestAnimationFrame(() => tryLayout());
    });
  }, [getNodes, setNodes, fitView, getViewport, setViewport, variant]);

  // ノードが measure された（dimensions change が流れた）タイミングでレイアウトを試す
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);
      if (!changes.some((c) => c.type === "dimensions")) return;
      // 手動で整えた並びを使っている間は、カードの実寸が変わっても並べ直さない
      // （勝手に ELK が走ると手で整えた配置が消える。戻したいときは「整列」を押す）
      if (usingSavedLayoutRef.current) {
        relayoutAfterResizeRef.current = false;
        return;
      }
      if (relayoutAfterResizeRef.current) {
        relayoutAfterResizeRef.current = false;
        needsLayoutRef.current = true;
      }
      if (needsLayoutRef.current) {
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
      if (!targetIsStep || !isEditableStep(g, conn.target)) return;
      if (sourceEntity) {
        // Entity → step: その Entity を対象手順の入力にする（本文に同名 span 合成）
        onConnectEntityToStep?.(sourceEntity.id, conn.target);
        return;
      }
      if (isEditableStep(g, conn.source)) {
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
      if (!isEditableStep(g, conn.target)) return false;
      if (g.steps.some((step) => step.id === conn.source && step.externalOrigin)) return false;
      return !edges.some((e) => e.source === conn.source && e.target === conn.target);
    },
    [edges],
  );

  // 選択中ノードを属性テーブルへ渡す（step / entity のどちらか）
  const selection: FlowSelection = selectedId
    ? (() => {
        const step = graph.steps.find((s) => s.id === selectedId);
        if (step && !step.externalOrigin) return { kind: "step" as const, step };
        const entity = graph.entities.find((e) => e.id === selectedId);
        return entity ? { kind: "entity" as const, entity } : null;
      })()
    : null;

  // 仕切りのドラッグ。下配置は高さ、全画面（右横）は幅。位置は記憶し、
  // ダブルクリックで既定（高さ 45% / 幅 300px）に戻る
  const panelHeight = useResizableHeight({
    storageKey: "graphium-flowpanel-height",
    min: 140,
    max: 900,
    containerReserve: 180, // グラフ側に最低限残す高さ
  });
  const panelWidth = useResizableWidth({
    storageKey: "graphium-flowpanel-width",
    min: 240,
    max: 640,
    containerReserve: 420, // グラフ側に最低限残す幅
  });

  const attributeTable = (
    <FlowStepPanel
      selection={selection}
      data={getPanelFor?.(selection) ?? null}
      onSetCell={onSetCell}
      onRenameColumn={onRenameColumn}
      onAddColumn={onAddColumn}
      onRemoveColumn={onRemoveColumn}
      onAddRow={onAddRow}
      onCreateSectionTable={onCreateSectionTable}
      onMoveEntityToTable={onMoveEntityToTable}
      onMoveParamToTable={onMoveParamToTable}
      onAddSharedRow={onAddEntity}
      onRenameEntity={onRenameEntity}
      onRemoveEntity={onRemoveEntity}
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
      <GraphSelectionHint show={showSelectionHint} />
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
        // ドラッグが終わったら、その時点の全ノード座標を保存する。複数選択して
        // まとめて動かした場合も、動いた分がまとめて 1 回の保存になる
        // DragStart ではなく Drag（実際に動いた）で判定する。DragStart は
        // 選択目的の単なるクリックでも発火するので、それで自動レイアウトを
        // 捨てると手順を足しても並べ直されなくなる
        onNodeDrag={() => {
          layoutAbandonedRef.current = true;
          needsLayoutRef.current = false;
          beginDrag();
        }}
        onNodeDragStop={(_e, _node, dragged) => {
          if (!layoutScope) {
            endDrag();
            return;
          }
          const positions: Record<string, { x: number; y: number }> = {};
          for (const n of getNodes()) positions[n.id] = { x: n.position.x, y: n.position.y };
          usingSavedLayoutRef.current = true;
          // 掴んだノード以外も動いていれば、範囲選択を使えた人
          saveLayoutRef.current(positions, (dragged?.length ?? 1) > 1);
          // 保存の後で、待たせていた作り直しを許可する（順序が逆だと
          // 保存されていない座標で組み直してしまう）
          endDrag();
        }}
        nodesDraggable={!!layoutScope}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={4}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: fitMinZoom }}
        style={{ background: "var(--color-background)", borderRadius: 8 }}
      >
        <Background color="var(--color-border)" gap={22} size={1.5} />

        <Panel position="top-right">
          <div style={{ display: "flex", gap: 6 }}>
            {/* レイアウトの手動やり直し。自動レイアウトが原則だが、崩れたときの逃げ道 */}
            <button
              onClick={() => {
                // 手で整えた並びがあれば手放して、自動配置に戻す
                if (hasSavedLayout) resetLayout();
                usingSavedLayoutRef.current = false;
                layoutAbandonedRef.current = false;
                needsLayoutRef.current = true;
                requestAnimationFrame(() => tryLayout());
              }}
              title={hasSavedLayout ? t("graph.layout.resetHint") : t("activityGraph.relayout")}
              style={toolbarBtnStyle("var(--color-text-tertiary)")}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-card)")}
            >
              <LayoutGrid size={13} /> {t("activityGraph.relayout")}
            </button>
            {/* パラメータの展開。カードの実寸が変わるので、切り替えたら並べ直す */}
            <button
              onClick={() => {
                const next = !showParamsRef.current;
                showParamsRef.current = next;
                setShowParams(next);
                try {
                  localStorage.setItem(SHOW_PARAMS_KEY, next ? "1" : "0");
                } catch {
                  // プライベートモード等で書けなくても表示は切り替える
                }
                needsLayoutRef.current = true;
                relayoutAfterResizeRef.current = true;
              }}
              title={t("activityGraph.toggleParams")}
              aria-pressed={showParams}
              style={{
                ...toolbarBtnStyle(showParams ? ACTIVITY_BLUE : "var(--color-text-tertiary)"),
                background: showParams ? "var(--color-surface-hover)" : "var(--color-card)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = showParams
                  ? "var(--color-surface-hover)"
                  : "var(--color-card)")
              }
            >
              <SlidersHorizontal size={13} /> {t("activityGraph.toggleParams")}
            </button>
            {onAddActivity && (
              <button
                onClick={onAddActivity}
                title={t("activityGraph.addStep")}
                style={toolbarBtnStyle(ACTIVITY_BLUE)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-card)")}
              >
                <Plus size={13} /> {t("activityGraph.addStep")}
              </button>
            )}
          </div>
        </Panel>

        {cycleWarnAt !== 0 && (
          <Panel position="top-center">
            <div
              style={{
                background: "var(--color-error-bg)",
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
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
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
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-error-bg)")}
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
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-foreground)" }}>
            {t("activityGraph.emptyTitle")}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{t("activityGraph.emptyHint")}</div>
        </div>
      )}

      {/* 使い方ヒント（エッジが 1 本でもあれば隠す） */}
      {variant !== "preview" && graph.steps.length > 0 && graph.edges.length === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            pointerEvents: "none",
          }}
        >
          {t("activityGraph.dragHint")}
        </div>
      )}
    </div>

      {/* 属性テーブル（下 or 右）。ノードは名前だけに保ち、中身はここで編集する。
          仕切りはドラッグで動かせる（位置は記憶・ダブルクリックで既定）。
          下配置は未選択時にヒント 1 行へ畳み、グラフに全高を渡す */}
      {variant === "preview" ? null : tableLayout === "side" ? (
        <div
          style={{
            position: "relative",
            width: panelWidth.widthStyle ?? 300,
            flexShrink: 0,
            minHeight: 0,
          }}
        >
          <ResizeHandle
            handleProps={panelWidth.handleProps}
            isResizing={panelWidth.isResizing}
            label={t("flowTable.resizeHandle")}
            edge="left"
          />
          {attributeTable}
        </div>
      ) : selection ? (
        <div
          style={{
            position: "relative",
            height: panelHeight.heightStyle ?? "45%",
            minHeight: 140,
            flexShrink: 0,
          }}
        >
          <ResizeHandle
            handleProps={panelHeight.handleProps}
            isResizing={panelHeight.isResizing}
            label={t("flowTable.resizeHandle")}
            edge="top"
          />
          {attributeTable}
        </div>
      ) : (
        <div
          style={{
            flexShrink: 0,
            padding: "7px 10px",
            fontSize: 12,
            textAlign: "center",
            color: "var(--color-text-tertiary)",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
          }}
        >
          {t("flowTable.noSelection")}
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
