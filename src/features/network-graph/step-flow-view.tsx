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
import { computeStepDistinguishers, type FlowGraphData, type FlowNoteRef, type FlowStep } from "./activity-graph-adapter";
import { layoutStepFlow, type ElkLayoutNode } from "./elk-flow-layout";
import { StepNodeCard } from "./step-node-card";
import { EntityFlowNode } from "./entity-flow-node";
import { GroupFlowNode } from "./group-flow-node";
import { FlowStepPanel, type FlowSelection, type SectionKind, type StepPanelData } from "./flow-attribute-table";
import { KIND_PALETTE } from "./flow-palette";
import { useGraphDataKey, useGraphRenderKey, useGraphStructureKey } from "./graph-identity";
import { GraphSelectionHint } from "./GraphSelectionHint";
import { plannedSourceId } from "./planned-edge-source";
import { nextLayoutRequest } from "./step-flow-layout-gate";
import { seedUnplacedFlowNodes, useGraphLayout } from "./use-graph-layout";
import { ResizeHandle } from "../../components/ResizeHandle";
import { useResizableWidth } from "../../hooks/use-resizable-width";
import { useResizableHeight } from "../../hooks/use-resizable-height";

const ACTIVITY_BLUE = KIND_PALETTE.activity.main;
const MATERIAL_GREEN = KIND_PALETTE.material.main;
const OUTPUT_TERRACOTTA = KIND_PALETTE.output.main;
const DANGER = "var(--color-destructive)";
/** 工程フローの broken エッジ（cross-note 参照が解決できない）用の薄い色 */
const BROKEN_COLOR = "var(--color-text-tertiary)";
/** 計画ノートの工程フロー専用: 予定の線（灰色の点線） */
const PLANNED_COLOR = "var(--color-muted-foreground)";
/** 実績が予定どおりだった線（緑の実線） */
const PLAN_AS_PLANNED_COLOR = "var(--forest)";
/** 実績はあるが予定に無かった線（琥珀の実線） */
const PLAN_UNPLANNED_COLOR = "var(--amber)";

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

/**
 * onConnectSteps の戻り値。error があれば画面上部にバナーで表示する。
 * "cycle_detected" は固定文言（t("step.cycleBlocked")）、それ以外の文字列は
 * そのまま表示する（plan-flow-editor.tsx の循環メッセージ等、呼び出し側が
 * 文脈に応じた文言を組み立てられるようにするため）
 */
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
  /** 「+ 手順を追加」の文言差し替え（計画ノートの工程フローでは「+ 工程を追加」）。省略時は既定文言 */
  addActivityLabel?: string;
  /** step カードのリネーム確定 */
  onRenameActivity?: (blockId: string, title: string) => void;
  /** step カードからの削除（step の中身ごと消える） */
  onDeleteActivity?: (blockId: string) => void;
  /** step カードの「本文へ」 */
  onJumpToBlock?: (blockId: string) => void;
  /** 別ノート由来の step / input から参照元ノートを開く */
  onOpenExternalNote?: (noteId: string) => void;
  /**
   * 工程ノード（FlowStep.noteRef 付き）の「ノートを開く / 作る」ボタン。noteId が
   * あれば開く、無ければ（未作成行）作る、の判断は呼び出し側が行う。
   */
  onOpenNoteRef?: (ref: FlowNoteRef, step: FlowStep) => void;
  /** step が 1 つも無いときの案内文。省略時は activityGraph.emptyHint */
  emptyHint?: string;
  /** 同じく空状態の見出し。省略時は activityGraph.emptyTitle */
  emptyTitle?: string;
  /**
   * 工程ノード（noteRef）同士の接続を許す（計画ノートの工程フローで予定の線を引く）。
   * true のとき noteRef ノードのハンドルが掴めるようになり、step → step の接続は
   * onConnectSteps に渡る。entity → noteRef の接続は許さない
   */
  connectNoteRefs?: boolean;
  /** planned エッジの削除（線を選んで「予定を外す」） */
  onRemovePlannedEdge?: (producer: string, consumer: string) => void;
  /**
   * 接続できないフロー（計画ノートの工程フロー）で、線が 1 本も無いときに下中央へ
   * 薄く出す案内。「線はどこで引くか」を伝える。dragHint と同じ場所・同じ条件
   */
  staticHint?: string;
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
  /** 属性パネルに描くセクション。既定は 4 種すべて（計画ノートの工程パネルは attribute だけ） */
  panelSections?: SectionKind[];
  onSetCell?: (blockId: string, rowIndex: number, colIndex: number, value: string) => void;
  /** 画像セルから画像だけを外す（テキスト・行 ID は残す） */
  onRemoveCellImage?: (blockId: string, rowIndex: number, colIndex: number) => void;
  onRenameColumn?: (blockId: string, colIndex: number, name: string) => void;
  onAddColumn?: (blockId: string, name: string) => void;
  onRemoveColumn?: (blockId: string, colIndex: number) => void;
  onAddRow?: (blockId: string, name: string) => void;
  /** 空セクションの「表を追加」: 空の表をラベル付きで作る */
  onCreateSectionTable?: (stepBlockId: string, kind: "attribute" | EntityKind, name: string) => void;
  onMoveEntityToTable?: (entityNodeId: string) => void;
  onMoveParamToTable?: (stepBlockId: string, entityId: string, key: string, value: string) => void;
};

const nodeTypes = { step: StepNodeCard, entity: EntityFlowNode, band: GroupFlowNode };

/** プレビューで先頭に寄せるときの上余白 */
const PREVIEW_TOP_PADDING = 24;

// 実測待ちで ELK を流せなかったときに、次フレームで様子を見る上限。
// dimensions change が来ない経路（非表示でマウント → 表示など）でも自力で
// 追いつけるようにするためのもので、無限に回さないための上限でもある
const LAYOUT_RETRY_FRAMES = 60;
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
  planned: {
    style: { stroke: PLANNED_COLOR, strokeWidth: 1.5, strokeDasharray: "5 4" },
    markerEnd: { type: MarkerType.ArrowClosed, color: PLANNED_COLOR, width: 16, height: 16 },
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

/**
 * 接続の端点として使える step か。別ノート由来（externalOrigin）は常に不可
 * （このノートの本文に書き込む対象ではない）。工程ノート（noteRef）は、
 * connectNoteRefs が有効な工程フロー（予定の線を引く画面）でだけ許す
 */
function isEditableStep(graph: FlowGraphData, id: string, connectNoteRefs = false): boolean {
  return graph.steps.some(
    (step) =>
      step.id === id &&
      !step.externalOrigin &&
      // 工程ノードは connectNoteRefs のときだけ。同名の行（duplicateName）は予定が行名で
      // 保存されるため、引いても 1 番目の同名行に付け替わってしまう。端点にしない
      (!step.noteRef || (connectNoteRefs && step.noteRef.state !== "duplicateName")),
  );
}

/** 帯ノードの id（"group:" + 表の blockId） */
function groupNodeId(groupId: string): string {
  return `group:${groupId}`;
}

/** グラフに登場する帯ノード id の集合（step.group から重複なく集める） */
function groupNodeIdsOf(graph: Pick<FlowGraphData, "steps">): string[] {
  const ids = new Set<string>();
  for (const s of graph.steps) if (s.group) ids.add(groupNodeId(s.group.id));
  return [...ids];
}

function StepFlowCanvas({
  graph,
  onConnectSteps,
  onRemoveOrderEdge,
  onConnectEntityToStep,
  onCreateStepFromEntity,
  onAddActivity,
  addActivityLabel,
  onRenameActivity,
  onDeleteActivity,
  onJumpToBlock,
  onOpenExternalNote,
  onOpenNoteRef,
  emptyHint,
  emptyTitle,
  connectNoteRefs = false,
  onRemovePlannedEdge,
  staticHint,
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
  panelSections,
  onSetCell,
  onRemoveCellImage,
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
  //
  // この旗は「まだ ELK を適用できていない要求」を表す。下ろしていいのは
  // 適用できたとき・ドラッグで人の意思が勝ったとき・手動配置を採用したときだけ。
  // 「形が変わっていない」だけで下ろすと、実測待ちの要求が消えて二度と並ばない
  const needsLayoutRef = useRef(false);
  // 実測待ちで見送った回数と、予約中の再試行フレーム
  const layoutRetryRef = useRef(0);
  const layoutRetryRafRef = useRef<number | null>(null);
  // orderOnly / planned エッジの削除メニュー（クリックで開く。即削除しないことで誤操作を防ぐ）
  const [edgeMenu, setEdgeMenu] = useState<{
    source: string;
    target: string;
    x: number;
    y: number;
    kind: "orderOnly" | "planned";
  } | null>(null);
  // ドラッグ接続を拒否したときの警告。message は onConnectSteps の error をそのまま
  // 出す（"cycle_detected" だけは固定文言に差し替える）。null = 非表示
  const [connectWarn, setConnectWarn] = useState<{ at: number; message: string } | null>(null);
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
  // 帯（表ごとのグループ）があるか。あると手動配置（保存済み座標・ドラッグ）は使わない
  // — 帯の子は相対座標、帯の無いノードは絶対座標なので混ざると壊れる
  const hasGroups = graph.steps.some((s) => !!s.group);
  // ノードを作り直すかは中身で決める。graph は PROV の再生成のたびに新しい
  // オブジェクトになるので、参照を依存にすると入力のたびに ELK が流れてノードが動く
  const graphKey = useGraphDataKey(graph);
  // 並べ直すのは「形が変わったとき」だけ。名前や件数が変わっただけで ELK を
  // 流すと、入力のたびにノードが動いて読めなくなる
  const structureKey = useGraphStructureKey(
    [...graph.steps.map((x) => x.id), ...graph.entities.map((x) => x.id), ...groupNodeIdsOf(graph)],
    graph.edges,
  );
  // ドラッグ中と読み込み中の連続変化は、作り直しを待たせて 1 回にする
  // （ドラッグ中に作り直すと position が prevPos 由来に戻り、途中の位置が失われる）
  const { renderKey, beginDrag, endDrag } = useGraphRenderKey(graphKey, structureKey);
  const lastStructureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!connectWarn) return;
    const id = setTimeout(() => setConnectWarn(null), 3000);
    return () => clearTimeout(id);
  }, [connectWarn]);

  // onConnectSteps の error をバナー文言へ変換。"cycle_detected" だけ固定文言、
  // それ以外（plan-flow-editor.tsx の循環メッセージ等）はそのまま表示する
  const showConnectError = useCallback((error: string) => {
    setConnectWarn({ at: Date.now(), message: error === "cycle_detected" ? t("step.cycleBlocked") : error });
  }, []);

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
      // 実測サイズも引き継ぐ。ノードを新しいオブジェクトに作り直すと React Flow は
      // measured の無いノードを「未計測」として visibility: hidden にし、再計測 →
      // dimensions change → ELK → fitView が一周するまで見えない。コールバックの
      // 参照が変わっただけの再構築でその一周を毎回やると、ノードが消えたままになる
      const prevMeasured = new Map(prev.map((n) => [n.id, n.measured]));
      // 帯ノードの直前の style（width/height）。measured と同じ理由で引き継ぐ
      const prevStyle = new Map(prev.map((n) => [n.id, n.style]));
      // 保存済みの座標。スコープが無い文脈（プレビュー等）では常に null。
      // 帯があるときは使わない（相対座標と絶対座標が混ざるのを避ける）
      const saved = hasGroups ? null : savedPositionsRef.current;
      const nodesAreDraggable = !!layoutScope && !hasGroups;
      // 同名ステップ（条件違いの並列ラン）を見分けるためのパラメータ
      const distinguishers = computeStepDistinguishers(graph.steps);
      const showParams = showParamsRef.current;

      // 帯ノード（重複なし、表の出現順）。先頭に置く（背面表示は zIndex で担保）
      const groupsById = new Map<string, { id: string; label: string; index: number }>();
      for (const s of graph.steps) {
        if (s.group && !groupsById.has(s.group.id)) groupsById.set(s.group.id, s.group);
      }
      const groups = [...groupsById.values()].sort((a, b) => a.index - b.index);
      const groupNodes: Node[] = groups.map((g) => {
        const gid = groupNodeId(g.id);
        const prevGroupStyle = prevStyle.get(gid) as { width?: number; height?: number } | undefined;
        return {
          id: gid,
          type: "band" as const,
          position: prevPos.get(gid) ?? { x: 0, y: 0 },
          ...(prevMeasured.get(gid) ? { measured: prevMeasured.get(gid) } : {}),
          style: {
            width: prevGroupStyle?.width ?? 240,
            height: prevGroupStyle?.height ?? 120,
          },
          data: { label: g.label, index: g.index },
          selectable: false,
          draggable: false,
          connectable: false,
          zIndex: -1,
        };
      });

      const stepNodes: Node[] = graph.steps.map((s) => ({
        id: s.id,
        type: "step" as const,
        position: saved?.[s.id] ?? prevPos.get(s.id) ?? { x: 0, y: 0 },
        ...(prevMeasured.get(s.id) ? { measured: prevMeasured.get(s.id) } : {}),
        data: {
          activity: s,
          onRename: s.externalOrigin || s.noteRef ? undefined : onRenameActivity,
          onDelete: s.externalOrigin || s.noteRef ? undefined : onDeleteActivity,
          onJump: s.externalOrigin || s.noteRef ? undefined : onJumpToBlock,
          onOpenExternalNote,
          onOpenNoteRef,
          getContentCount: s.externalOrigin || s.noteRef ? undefined : getStepContentCount,
          distinguishers: distinguishers.get(s.id),
          showParams,
          connectNoteRefs,
        },
        draggable: nodesAreDraggable,
        selected: s.id === selectedIdRef.current,
        ...(s.group ? { parentId: groupNodeId(s.group.id), extent: "parent" as const } : {}),
      }));
      const entityNodes: Node[] = graph.entities.map((e) => ({
        id: e.id,
        type: "entity" as const,
        position: saved?.[e.id] ?? prevPos.get(e.id) ?? { x: 0, y: 0 },
        ...(prevMeasured.get(e.id) ? { measured: prevMeasured.get(e.id) } : {}),
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
      return [...groupNodes, ...stepNodes, ...entityNodes];
    });
    setEdges(
      graph.edges.map((e) => {
        // derived は linkType で色分けが変わるため、他の kind と違い静的な
        // EDGE_STYLES を引かず、その場で色・ラベルを組み立てる
        const derived = e.kind === "derived" ? derivedEdgeVisual(e.linkType) : null;
        // 工程フロー（plan-flow.ts）専用: used エッジは予定（入力元列）との突き合わせで
        // 「計画どおり」「計画外」の色分けが乗ることがある（plan 未設定なら従来どおり）
        const planVisual =
          e.kind === "used" && e.plan === "asPlanned"
            ? { color: PLAN_AS_PLANNED_COLOR, label: t("planFlow.asPlanned") }
            : e.kind === "used" && e.plan === "unplanned"
              ? { color: PLAN_UNPLANNED_COLOR, label: t("planFlow.unplanned") }
              : null;
        // 工程フロー（plan-flow.ts）の cross-note 参照が解決できなかった used エッジ。
        // 種別ごとの色分けより優先して、点線 + 薄い色 + ラベルで「切れている」ことを示す
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.broken
            ? {
                style: { stroke: BROKEN_COLOR, strokeWidth: 1.5, strokeDasharray: "4 3", opacity: 0.7 },
                markerEnd: { type: MarkerType.ArrowClosed, color: BROKEN_COLOR, width: 16, height: 16 },
              }
            : planVisual
              ? {
                  style: { stroke: planVisual.color, strokeWidth: 2 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: planVisual.color, width: 16, height: 16 },
                }
              : derived
                ? {
                    style: { stroke: derived.color, strokeWidth: 1.5 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: derived.color, width: 16, height: 16 },
                  }
                : EDGE_STYLES[e.kind]),
          ...(e.broken
            ? {
                label: t("planFlow.brokenRef"),
                labelStyle: { fontSize: 9, fill: BROKEN_COLOR, fontWeight: 700 },
                labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.9 },
              }
            : planVisual
              ? {
                  label: planVisual.label,
                  labelStyle: { fontSize: 9, fill: planVisual.color, fontWeight: 700 },
                  labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.9 },
                }
              : e.kind === "planned"
                ? {
                    label: t("planFlow.planned"),
                    labelStyle: { fontSize: 9, fill: PLANNED_COLOR, fontWeight: 700 },
                    labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.9 },
                  }
                : e.kind === "orderOnly"
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
          // planned（予定の線）は表の 1 セルを書き戻すだけで消せるので、削除口が
          // 渡されていれば常に deletable。orderOnly は裏の informed_by の有無で editor が決める
          data: { kind: e.kind, deletable: e.kind === "planned" ? !!onRemovePlannedEdge : (e.deletable ?? false) },
        };
      }),
    );
    // 保存済みの配置が 1 つでもあるなら ELK は流さない（手で整えた並びを保つ）。
    // 保存に無い新しいノードだけ、既存の並びの下に仮置きして気づけるようにする。
    // 帯があるときは保存済み座標を使わない（相対座標と絶対座標が混ざるのを避ける）
    const savedNow = hasGroups ? null : savedPositionsRef.current;
    const placedCount = savedNow
      ? [...graph.steps, ...graph.entities].filter((n) => savedNow[n.id]).length
      : 0;
    usingSavedLayoutRef.current = hasGroups ? false : placedCount > 0;
    // 形が前回と同じなら、位置は prevPos で引き継がれている。新しく並べ直す
    // 理由は無いが、実測待ちで積んだままの要求は消さずに持ち越す
    // （この effect はコールバックの参照が変わっただけでも走る）
    const structureChanged = lastStructureRef.current !== structureKey;
    lastStructureRef.current = structureKey;
    if (structureChanged) layoutRetryRef.current = 0;
    needsLayoutRef.current = nextLayoutRequest({
      pending: needsLayoutRef.current,
      usingSavedLayout: usingSavedLayoutRef.current && !!savedNow,
      structureChanged,
    });
    if (usingSavedLayoutRef.current && savedNow) {
      setNodes((nds: Node[]) => seedUnplacedFlowNodes(nds, savedNow));
    } else if (needsLayoutRef.current) {
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
    onOpenNoteRef,
    getStepContentCount,
    onRenameEntity,
    onRemoveEntity,
    onRenameTableRow,
    onRemoveTableRow,
    showParams,
    connectNoteRefs,
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
  // tryLayout は自分自身を次フレームに予約する。useCallback の中から直接
  // 自分を参照すると依存が循環するので、ref 経由で最新の実体を呼ぶ
  const tryLayoutRef = useRef<() => void>(() => {});
  const tryLayout = useCallback(() => {
    if (!needsLayoutRef.current || layoutRunningRef.current) return;
    const current = getNodes();
    // store が最新の graph をまだ反映していない間は消費しない。
    // ここで走らせると「古い一覧は全部測定済み」で ELK が確定してしまい、
    // 直後にマウントされる新ノードが (0,0) に置き去りになる（実バグ）
    const g = graphRef.current;
    const expected = new Set<string>([
      ...g.steps.map((s) => s.id),
      ...g.entities.map((e) => e.id),
      ...groupNodeIdsOf(g),
    ]);
    if (
      current.length === 0 ||
      current.length !== expected.size ||
      // 実測幅 0（非表示のコンテナ等）は「まだ測れていない」と同じ扱い
      !current.every((n) => expected.has(n.id) && n.measured?.width)
    ) {
      // 実測が揃うのを dimensions change だけに頼らない。ノードが隠れている・
      // React Flow が変化を出さない経路でも、上限つきで次フレームに試し直す
      if (layoutRetryRef.current < LAYOUT_RETRY_FRAMES && layoutRetryRafRef.current === null) {
        layoutRetryRef.current += 1;
        layoutRetryRafRef.current = requestAnimationFrame(() => {
          layoutRetryRafRef.current = null;
          tryLayoutRef.current();
        });
      }
      return;
    }
    layoutRunningRef.current = true;
    // 帯ノードは parentId 無し・width/height を渡さない（ELK が子から決める）。
    // 帯の子は parentId を渡し、compound layout の対象にする
    const sized: ElkLayoutNode[] = current.map((n) =>
      n.type === "band"
        ? { id: n.id }
        : {
            id: n.id,
            width: n.measured?.width ?? 180,
            height: n.measured?.height ?? 48,
            ...(n.parentId ? { parentId: n.parentId } : {}),
          },
    );
    // ELK は非同期。完了までに graph の中身（ノード id の集合）が変わっていたら、
    // その結果は古い id の座標でしかなく、今のノードには当たらない。適用も
    // 「要求を消す」こともせず、finally で並べ直しに回す。
    // 実例: 計画ノートの工程フローは、表のメタ情報（noteLinks）が復元される前は
    // "row:<表>:<行>"、復元後は "note:<id>" の id になる。その切り替わりの最中に
    // 古い ELK が完了すると、座標は当たらないのに needsLayout だけ下りて、以後
    // 誰も並べ直さず、ノードが (0,0) や非表示のまま固定された
    const idsOf = (ids: string[]) => [...ids].sort().join("\n");
    const startedIds = idsOf(sized.map((n) => n.id));
    void layoutStepFlow(
      sized,
      g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    ).then((positions) => {
      // ドラッグが始まっていたら、この結果はもう古い
      if (layoutAbandonedRef.current) {
        needsLayoutRef.current = false;
        return;
      }
      const latest = graphRef.current;
      const latestIds = idsOf([
        ...latest.steps.map((n) => n.id),
        ...latest.entities.map((n) => n.id),
        ...groupNodeIdsOf(latest),
      ]);
      if (latestIds !== startedIds) {
        // 古い結果。要求は残したまま（finally が最新の graph で並べ直す）
        needsLayoutRef.current = true;
        return;
      }
      // 適用できたときだけ要求を消す。ELK が失敗した場合（下の catch）は
      // 要求を残し、次の変化・整列ボタンで再試行できるようにする。
      // 以前はレイアウト開始前に消していたため、一度失敗すると誰も再実行せず
      // ノードが (0,0) や旧位置に置き去りのまま「グラフが消えた」状態に固定された
      needsLayoutRef.current = false;
      setNodes((nds: Node[]) =>
        nds.map((n: Node) => {
          const pos = positions.get(n.id);
          if (!pos) return n;
          if (n.type === "band") {
            // 帯: 位置に加えて ELK が子から決めた width/height も反映する
            return {
              ...n,
              position: { x: pos.x, y: pos.y },
              style: { ...(n.style ?? {}), width: pos.width, height: pos.height },
            };
          }
          // 帯の子は相対座標（ELK の出力どおり。React Flow の parentId 付きノードも
          // 相対座標なのでそのまま使える）
          return { ...n, position: { x: pos.x, y: pos.y } };
        }),
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
  tryLayoutRef.current = tryLayout;

  // 予約したままアンマウントされても後始末する
  useEffect(
    () => () => {
      if (layoutRetryRafRef.current !== null) cancelAnimationFrame(layoutRetryRafRef.current);
    },
    [],
  );

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
        // 実測が新しく届いた = 前進した。見送り回数の持ち分を戻す
        layoutRetryRef.current = 0;
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
      const targetStep = g.steps.find((s) => s.id === conn.target);
      if (!targetStep || targetStep.externalOrigin) return;
      if (targetStep.noteRef) {
        // 予定の線: connectNoteRefs が有効な工程フローでだけ引ける。
        // アウトプットのポートから引いたときは、その出力を出した工程からの線として
        // 扱う（実行の線はアウトプット起点で描かれるので、掴める所を揃える）。
        // 予定はノート（工程）の粒度なので、どの出力だったかは持たない
        if (!connectNoteRefs) return;
        const source = plannedSourceId(g.edges, conn.source, sourceEntity);
        if (!source || source === conn.target) return;
        if (!isEditableStep(g, source, true)) return;
        const res = onConnectSteps?.(source, conn.target);
        if (res && res.error) showConnectError(res.error);
        return;
      }
      if (sourceEntity) {
        // Entity → step: その Entity を対象手順の入力にする（本文に同名 span 合成）
        onConnectEntityToStep?.(sourceEntity.id, conn.target);
        return;
      }
      if (isEditableStep(g, conn.source)) {
        // step → step: 順序のみの依存（informed_by）
        const res = onConnectSteps?.(conn.source, conn.target);
        if (res && res.error) showConnectError(res.error);
      }
    },
    [onConnectSteps, onConnectEntityToStep, connectNoteRefs, showConnectError],
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
      const targetStep = g.steps.find((s) => s.id === conn.target);
      if (!targetStep || targetStep.externalOrigin) return false;
      const sourceEntity = g.entities.find((e) => e.id === conn.source);
      const sourceIsEntity = !!sourceEntity;
      // 既に同じ線があるかは「読み替えたあとの始点」で見る。アウトプット起点のまま
      // 数えると、同じ工程どうしの予定を 2 本目として通してしまう
      let effectiveSource = conn.source;
      if (targetStep.noteRef) {
        // 予定の線。アウトプット起点は生成元の工程に読み替えて判定する（handleConnect と同じ規則）
        if (!connectNoteRefs) return false;
        const source = plannedSourceId(g.edges, conn.source, sourceEntity);
        if (!source || source === conn.target) return false;
        if (!isEditableStep(g, source, true)) return false;
        effectiveSource = source;
      } else if (!sourceIsEntity && !isEditableStep(g, conn.source)) {
        return false;
      }
      return !edges.some((e) => e.source === effectiveSource && e.target === conn.target);
    },
    [edges, connectNoteRefs],
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
      sections={panelSections}
      onSetCell={onSetCell}
      onRemoveCellImage={onRemoveCellImage}
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
      onOpenExternalNote={onOpenExternalNote}
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
      <GraphSelectionHint
        show={showSelectionHint}
        // エッジ 0 のときは下中央に接続ヒントが出るので、重ならないよう 1 行分上げる
        bottom={variant !== "preview" && graph.steps.length > 0 && graph.edges.length === 0 ? 32 : 10}
      />
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
          const canRemoveOrder = edge.data?.kind === "orderOnly" && !!edge.data?.deletable && !!onRemoveOrderEdge;
          const canRemovePlanned = edge.data?.kind === "planned" && !!edge.data?.deletable && !!onRemovePlannedEdge;
          if (!canRemoveOrder && !canRemovePlanned) return;
          const rect = wrapperRef.current?.getBoundingClientRect();
          if (!rect) return;
          setEdgeMenu({
            source: edge.source,
            target: edge.target,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            kind: canRemovePlanned ? "planned" : "orderOnly",
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
        // 選択グループの矩形を掴んで動かしたとき（onNodeDragStop は発火しない）
        onSelectionDragStart={() => {
          layoutAbandonedRef.current = true;
          needsLayoutRef.current = false;
          beginDrag();
        }}
        onSelectionDragStop={() => {
          // 帯があるときは保存しない（子は帯からの相対座標。保存は絶対座標前提）
          if (!layoutScope || hasGroups) {
            endDrag();
            return;
          }
          const positions: Record<string, { x: number; y: number }> = {};
          for (const n of getNodes()) positions[n.id] = { x: n.position.x, y: n.position.y };
          usingSavedLayoutRef.current = true;
          saveLayoutRef.current(positions, true);
          endDrag();
        }}
        onNodeDragStop={(_e, _node, dragged) => {
          if (!layoutScope || hasGroups) {
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
        nodesDraggable={!!layoutScope && !hasGroups}
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
                // 形が変わっていなくても、押されたら並べ直す
                lastStructureRef.current = null;
                needsLayoutRef.current = true;
                layoutRetryRef.current = 0;
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
                layoutRetryRef.current = 0;
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
                title={addActivityLabel ?? t("activityGraph.addStep")}
                style={toolbarBtnStyle(ACTIVITY_BLUE)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-card)")}
              >
                <Plus size={13} /> {addActivityLabel ?? t("activityGraph.addStep")}
              </button>
            )}
          </div>
        </Panel>

        {connectWarn && (
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
              {connectWarn.message}
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* orderOnly / planned エッジ削除メニュー */}
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
              if (edgeMenu.kind === "planned") {
                onRemovePlannedEdge?.(edgeMenu.source, edgeMenu.target);
              } else {
                onRemoveOrderEdge?.(edgeMenu.source, edgeMenu.target);
              }
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
            <Trash2 size={14} />{" "}
            {edgeMenu.kind === "planned" ? t("planFlow.removePlanned") : t("activityGraph.deleteStep")}
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
            {emptyTitle ?? t("activityGraph.emptyTitle")}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {emptyHint ?? t("activityGraph.emptyHint")}
          </div>
        </div>
      )}

      {/* 使い方ヒント（エッジが 1 本でもあれば隠す）。接続できるフローはつなぎ方、
          接続できないフロー（工程フロー）は staticHint（線をどこで引くか） */}
      {variant !== "preview" && (onConnectSteps || onConnectEntityToStep || staticHint) && graph.steps.length > 0 && graph.edges.length === 0 && (
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
          {onConnectSteps || onConnectEntityToStep ? t("activityGraph.dragHint") : staticHint}
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
