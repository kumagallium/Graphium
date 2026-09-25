// ローカルビュー（起点ノートの近傍を「深さ × 時間」で見る）。
//
// docs/internal/note-chain-plan.md §2.4・§3 PR3。
// データは local-view-model.ts の buildLocalView（純関数）に一本化し、
// このファイルは実データを React Flow で描く（工程フローと同じ部品・同じ
// ズーム/パン操作）レイアウトだけを担当する。
//
// ノードカードは step-flow-view.tsx と同じ StepNodeCard / GroupFlowNode を
// そのまま再利用する。手順フローと違い、ここではドラッグ・接続・ELK は
// 使わない（時間軸に沿った固定レイアウト。ノードは model が変わるたびに
// 丸ごと作り直す）。

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Undo2 } from "lucide-react";
import { useT } from "../../i18n";
import { buildLocalView } from "./local-view-model";
import type { LocalViewModel, LocalViewNode, LocalViewStep } from "./local-view-model";
import type { GraphiumIndex } from "../navigation/index-file";
import { NoteOriginPicker } from "./note-origin-picker";
import {
  getLatestProcessIndex,
  requestLatestProcessIndexRefresh,
  subscribeLatestProcessIndex,
} from "./process-index";
import { StepNodeCard } from "./step-node-card";
import { GroupFlowNode } from "./group-flow-node";
import type { FlowNoteRef, FlowStep } from "./activity-graph-adapter";

// ── 寸法（React Flow の座標。ピクセル） ──

const NODE_W = 180;
const NODE_H = 64;
const ROW_GAP = 16;
const LANE_PAD_TOP = 40; // 帯のラベル分
const LANE_PAD = 16;
const LANE_GAP = 40;
/** 同じレーンに並ぶノード 1 つあたりの最小横幅 */
const MIN_SLOT = NODE_W + 40;
const STEP_W = NODE_W;
const STEP_GAP = 32;
const AXIS_H = 28;

const FOREST = "var(--forest)";
const MUTED = "var(--color-muted-foreground)";

// ── 時間軸 ──

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}

type TimeScale = { min: number; max: number };

function buildTimeScale(nodes: LocalViewNode[]): TimeScale | null {
  const times = nodes.map((n) => new Date(n.t).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return { min: Math.min(...times), max: Math.max(...times) };
}

/** 時刻を横位置（左端）へ写す。幅 0（全ノード同時刻）なら左寄せ */
function xOfTime(iso: string, scale: TimeScale | null, laneW: number): number {
  if (!scale) return LANE_PAD;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || scale.max === scale.min) return LANE_PAD;
  const ratio = (t - scale.min) / (scale.max - scale.min);
  return LANE_PAD + ratio * (laneW - 2 * LANE_PAD - NODE_W);
}

function buildTicks(scale: TimeScale | null, laneW: number): { x: number; label: string }[] {
  if (!scale) return [];
  const COUNT = 5;
  if (scale.max === scale.min) {
    return [{ x: LANE_PAD + NODE_W / 2, label: dateLabel(new Date(scale.min).toISOString()) }];
  }
  const ticks: { x: number; label: string }[] = [];
  for (let i = 0; i < COUNT; i++) {
    const ratio = i / (COUNT - 1);
    const t = scale.min + ratio * (scale.max - scale.min);
    const iso = new Date(t).toISOString();
    ticks.push({
      x: LANE_PAD + ratio * (laneW - 2 * LANE_PAD - NODE_W) + NODE_W / 2,
      label: dateLabel(iso),
    });
  }
  // 同じ日に収まる範囲（数分差など）だと 5 つとも同じ日付になる。同じラベルは 1 つに畳む
  return ticks.filter((tick, i) => i === 0 || tick.label !== ticks[i - 1].label);
}

// ── 行数から帯の高さを出す ──

function laneRows(nodes: { row: number }[]): number {
  return nodes.length === 0 ? 1 : Math.max(...nodes.map((n) => n.row)) + 1;
}

function bandHeight(rows: number): number {
  return LANE_PAD_TOP + rows * NODE_H + (rows - 1) * ROW_GAP + LANE_PAD;
}

// ── ノード id ──

function noteNodeId(noteId: string): string {
  return `note:${noteId}`;
}

function stepNodeId(ownerNoteId: string, stepId: string): string {
  return `step:${ownerNoteId}:${stepId}`;
}

// ── エッジの見た目 ──
//
// 全エッジは同じカスタム型 "timeline"（TimelineEdgeComponent）で描く。
// ハンドルの位置（StepNodeCard の上/下ハンドル）には依存せず、data.kind で
// 横向き（handoff・step: 右辺中央→左辺中央）/ 縦向き（partOf: 下辺中央→上辺中央）
// を出し分ける（ノードの絶対座標から毎回計算し直すので、レーンをまたいでも
// 輪を描かない）。

export type TimelineEdgeKind = "handoff" | "step" | "partOf";
type TimelineEdgeData = { kind: TimelineEdgeKind; broken?: boolean };
type TimelineFlowEdge = Edge<TimelineEdgeData, "timeline">;

function partOfEdge(source: string, target: string): Edge {
  return {
    id: `partOf-${source}->${target}`,
    source,
    target,
    type: "timeline",
    data: { kind: "partOf" },
    style: { stroke: MUTED, strokeWidth: 1, strokeDasharray: "4 3" },
    selectable: false,
  };
}

function handoffEdge(source: string, target: string, broken: boolean): Edge {
  return {
    id: `handoff-${source}->${target}`,
    source,
    target,
    type: "timeline",
    data: { kind: "handoff", broken },
    style: { stroke: FOREST, strokeWidth: 1.5, ...(broken ? { strokeDasharray: "4 3" } : {}) },
    markerEnd: { type: MarkerType.ArrowClosed, color: FOREST, width: 16, height: 16 },
    selectable: false,
  };
}

function stepEdge(source: string, target: string): Edge {
  return {
    id: `step-${source}->${target}`,
    source,
    target,
    type: "timeline",
    data: { kind: "step" },
    style: { stroke: FOREST, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: FOREST, width: 16, height: 16 },
    selectable: false,
  };
}

/**
 * 全エッジ共通のカスタムエッジ。ハンドルの座標（下→上に回り込む輪の原因）
 * ではなく、両端ノードの絶対座標（useInternalNode）から直接
 * 「横向き: 右辺中央→左辺中央」「縦向き: 下辺中央→上辺中央」を計算する。
 */
function TimelineEdgeComponent({ id, source, target, style, markerEnd, data }: EdgeProps<TimelineFlowEdge>) {
  const t = useT();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  // partOf（親→同じ層、起点→子、工程→その手順）だけ縦向き。
  // handoff・step（同じレーン内の受け渡し・手順間）は横向き
  const horizontal = data?.kind !== "partOf";

  const sx = sourceNode.internals.positionAbsolute.x;
  const sy = sourceNode.internals.positionAbsolute.y;
  const sw = sourceNode.measured.width ?? NODE_W;
  const sh = sourceNode.measured.height ?? NODE_H;
  const tx = targetNode.internals.positionAbsolute.x;
  const ty = targetNode.internals.positionAbsolute.y;
  const tw = targetNode.measured.width ?? NODE_W;
  const th = targetNode.measured.height ?? NODE_H;

  const sourceX = horizontal ? sx + sw : sx + sw / 2;
  const sourceY = horizontal ? sy + sh / 2 : sy + sh;
  const targetX = horizontal ? tx : tx + tw / 2;
  const targetY = horizontal ? ty + th / 2 : ty;

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: horizontal ? Position.Right : Position.Bottom,
    targetX,
    targetY,
    targetPosition: horizontal ? Position.Left : Position.Top,
  });

  const edge = <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
  // broken な受け渡し線だけ、旧 SVG 版と同じホバー説明を出す
  if (data?.kind === "handoff" && data.broken) {
    return (
      <g>
        <title>{t("planFlow.brokenRef")}</title>
        {edge}
      </g>
    );
  }
  return edge;
}

const edgeTypes = { timeline: TimelineEdgeComponent };

// ── 帯ごとのラベル（相対表示。localView.lane.* の出し分けは元の SVG 版と同じ規則）──

type LaneLabels = { parent: string; siblings: string; children: string; childSteps: string };

// ── ノード生成 ──

function noteFlowStep(node: LocalViewNode): FlowStep {
  return {
    id: noteNodeId(node.noteId),
    name: node.title,
    params: [],
    noteRef: { noteId: node.noteId, tableBlockId: "", rowIndex: -1, state: node.state },
  };
}

function noteNode(
  node: LocalViewNode,
  parentId: string,
  x: number,
  y: number,
  onOpenNote: (noteId: string) => void,
): Node {
  return {
    id: noteNodeId(node.noteId),
    type: "step",
    parentId,
    position: { x, y },
    data: {
      activity: noteFlowStep(node),
      onOpenNoteRef: (ref: FlowNoteRef) => {
        if (ref.noteId) onOpenNote(ref.noteId);
      },
      showParams: false,
      connectNoteRefs: false,
    },
    selected: node.isOrigin,
    draggable: false,
    selectable: false,
    connectable: false,
  };
}

function stepNode(step: LocalViewStep, ownerNoteId: string, parentId: string, x: number, y: number): Node {
  return {
    id: stepNodeId(ownerNoteId, step.id),
    type: "step",
    parentId,
    position: { x, y },
    data: {
      activity: { id: stepNodeId(ownerNoteId, step.id), name: step.name, params: [] },
      showParams: false,
      connectNoteRefs: false,
    },
    draggable: false,
    selectable: false,
    connectable: false,
  };
}

function bandNode(id: string, y: number, width: number, height: number, label: string, index: number): Node {
  return {
    id,
    type: "band",
    position: { x: 0, y },
    style: { width, height },
    data: { label, index },
    selectable: false,
    draggable: false,
    connectable: false,
    zIndex: -1,
  };
}

// ── レイアウト本体（model → React Flow の nodes/edges）──

function buildTimelineFlow(
  model: LocalViewModel,
  labels: LaneLabels,
  onOpenNote: (noteId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const childNotes = model.children.kind === "notes" ? model.children.notes : [];
  const stepsByNote = model.children.kind === "notes" ? model.children.stepsByNote : {};

  const timeScale = buildTimeScale([...model.siblings, ...childNotes]);
  const n = Math.max(model.siblings.length, childNotes.length, 1);
  // 時間 → x のスケール（ratio の分母）。帯・時間軸の実際の幅（containerW、
  // 下で算出）とは別物にする — 後で右端の overflow に合わせて帯を広げても、
  // 一度決めた時間軸のスケール自体はずらさない（目盛りとノードの対応がぶれない）
  const laneW = Math.max(960, n * MIN_SLOT);
  const xOfNote = (node: LocalViewNode) => xOfTime(node.t, timeScale, laneW);
  const originNode = model.siblings.find((s) => s.isOrigin) ?? null;

  // 帯は「幅が決まるまで」スペックだけ集めておき、containerW が決まった後に
  // Node へ変換する（各工程の手順は起点ノートの x + col 分右へ伸びるので、
  // 右端が laneW を超えることがある。960 起点の初期値のままだと右端が
  // 帯からはみ出る）
  const bandSpecs: { id: string; y: number; height: number; label: string; index: number }[] = [];
  const items: Node[] = [];
  const edges: Edge[] = [];
  let y = 0;
  // 色相の index は帯の出現順ではなく役割で固定する（親=0/同じ層=1/子=2/
  // 各工程の手順=3）。親が無いときも同じ層は 1 のまま（0 にはならない）
  const BAND_INDEX = { parent: 0, siblings: 1, children: 2, childSteps: 3 } as const;

  // 親レーン
  if (model.parent) {
    const bandId = "band:parent";
    const height = bandHeight(1);
    bandSpecs.push({ id: bandId, y, height, label: labels.parent, index: BAND_INDEX.parent });
    items.push(noteNode(model.parent, bandId, LANE_PAD, LANE_PAD_TOP, onOpenNote));
    y += height + LANE_GAP;
  }

  // 同じ層
  const siblingsBandId = "band:siblings";
  {
    const height = bandHeight(laneRows(model.siblings));
    bandSpecs.push({ id: siblingsBandId, y, height, label: labels.siblings, index: BAND_INDEX.siblings });
    for (const node of model.siblings) {
      const x = xOfNote(node);
      const ny = LANE_PAD_TOP + node.row * (NODE_H + ROW_GAP);
      items.push(noteNode(node, siblingsBandId, x, ny, onOpenNote));
    }
    y += height + LANE_GAP;
  }

  // 子
  const childrenBandId = "band:children";
  const originX = originNode ? xOfNote(originNode) : LANE_PAD;
  {
    const rows = model.children.kind === "notes" ? laneRows(childNotes) : laneRows(model.children.steps);
    const height = bandHeight(rows);
    bandSpecs.push({ id: childrenBandId, y, height, label: labels.children, index: BAND_INDEX.children });
    if (model.children.kind === "notes") {
      for (const note of childNotes) {
        const x = xOfNote(note);
        const ny = LANE_PAD_TOP + note.row * (NODE_H + ROW_GAP);
        items.push(noteNode(note, childrenBandId, x, ny, onOpenNote));
      }
    } else {
      for (const step of model.children.steps) {
        const x = originX + step.col * (STEP_W + STEP_GAP);
        const ny = LANE_PAD_TOP + step.row * (NODE_H + ROW_GAP);
        items.push(stepNode(step, model.origin.noteId, childrenBandId, x, ny));
      }
    }
    y += height + LANE_GAP;
  }

  // 各工程の手順（3 段目。起点が計画ノートのときだけ）
  const childStepGroups: {
    note: LocalViewNode;
    steps: LocalViewStep[];
    edges: { from: string; to: string }[];
    rowOffset: number;
  }[] = [];
  if (model.children.kind === "notes") {
    let rowOffset = 0;
    for (const note of childNotes) {
      const data = stepsByNote[note.noteId];
      if (!data || data.steps.length === 0) continue;
      childStepGroups.push({ note, steps: data.steps, edges: data.edges, rowOffset });
      rowOffset += Math.max(...data.steps.map((s) => s.row)) + 1;
    }
  }
  const hasChildSteps = childStepGroups.length > 0;
  let childStepsBandId: string | null = null;
  if (hasChildSteps) {
    const totalRows = childStepGroups.reduce(
      (acc, g) => acc + Math.max(...g.steps.map((s) => s.row)) + 1,
      0,
    );
    childStepsBandId = "band:childSteps";
    const height = bandHeight(totalRows);
    bandSpecs.push({ id: childStepsBandId, y, height, label: labels.childSteps, index: BAND_INDEX.childSteps });
    for (const group of childStepGroups) {
      const baseX = xOfNote(group.note);
      for (const step of group.steps) {
        const x = baseX + step.col * (STEP_W + STEP_GAP);
        const ny = LANE_PAD_TOP + (group.rowOffset + step.row) * (NODE_H + ROW_GAP);
        items.push(stepNode(step, group.note.noteId, childStepsBandId, x, ny));
      }
    }
    y += height + LANE_GAP;
  }

  // 帯・時間軸の実際の幅。全ノード（手順の col 分の右への伸びも含む）の
  // 右端 + LANE_PAD を下回らないようにする（時間軸のスケール laneW はそのまま）
  const maxRight = items.reduce((max, item) => Math.max(max, item.position.x + NODE_W), 0);
  const containerW = Math.max(laneW, maxRight + LANE_PAD);
  const bands: Node[] = bandSpecs.map((spec) =>
    bandNode(spec.id, spec.y, containerW, spec.height, spec.label, spec.index),
  );

  // 時間軸
  const ticks = buildTicks(timeScale, laneW);
  const axisNode: Node = {
    id: "axis",
    type: "axis",
    position: { x: 0, y },
    style: { width: containerW, height: AXIS_H },
    data: { ticks },
    selectable: false,
    draggable: false,
    connectable: false,
  };

  // ── エッジ ──

  if (model.parent) {
    for (const s of model.siblings) {
      edges.push(partOfEdge(noteNodeId(model.parent.noteId), noteNodeId(s.noteId)));
    }
  }

  if (originNode) {
    if (model.children.kind === "notes") {
      for (const note of childNotes) {
        edges.push(partOfEdge(noteNodeId(originNode.noteId), noteNodeId(note.noteId)));
      }
    } else {
      for (const step of model.children.steps.filter((s) => s.col === 0)) {
        edges.push(partOfEdge(noteNodeId(originNode.noteId), stepNodeId(model.origin.noteId, step.id)));
      }
    }
  }

  for (const group of childStepGroups) {
    const first = group.steps[0];
    if (!first) continue;
    edges.push(partOfEdge(noteNodeId(group.note.noteId), stepNodeId(group.note.noteId, first.id)));
  }

  for (const h of model.handoffs) {
    edges.push(handoffEdge(noteNodeId(h.from), noteNodeId(h.to), h.broken));
  }

  if (model.children.kind === "steps") {
    for (const e of model.children.edges) {
      edges.push(stepEdge(stepNodeId(model.origin.noteId, e.from), stepNodeId(model.origin.noteId, e.to)));
    }
  }

  for (const group of childStepGroups) {
    for (const e of group.edges) {
      edges.push(stepEdge(stepNodeId(group.note.noteId, e.from), stepNodeId(group.note.noteId, e.to)));
    }
  }

  return { nodes: [...bands, ...items, axisNode], edges };
}

// ── 時間軸ノード（帯の下に 1 本。目盛りを絶対配置で並べるだけの表示専用）──

type TimeAxisData = { ticks: { x: number; label: string }[] };
type TimeAxisFlowNode = Node<TimeAxisData, "axis">;

function TimeAxisNode({ data }: NodeProps<TimeAxisFlowNode>) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 1,
          background: MUTED,
        }}
      />
      {data.ticks.map((tick, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: tick.x,
            top: 6,
            transform: "translateX(-50%)",
            fontSize: 11,
            color: MUTED,
            whiteSpace: "nowrap",
          }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

const nodeTypes = { step: StepNodeCard, band: GroupFlowNode, axis: TimeAxisNode };

// ── React Flow キャンバス ──

function TimelineFlow({
  model,
  onOpenNote,
}: {
  model: LocalViewModel;
  onOpenNote: (noteId: string) => void;
}) {
  const t = useT();
  const { fitView } = useReactFlow();
  const rafRef = useRef<number | null>(null);

  // 呼び出し元（note-app.tsx）は onOpenNote を毎レンダー新しい関数で渡してくる。
  // 参照を ref に retain し、buildTimelineFlow/useMemo の依存には入れない
  // ノードを作り直す条件を「model が変わったとき」だけに保ち、無関係な
  // 再レンダーで fitView が巻き戻らないようにするため
  const onOpenNoteRef = useRef(onOpenNote);
  onOpenNoteRef.current = onOpenNote;
  const openNote = useRef((noteId: string) => onOpenNoteRef.current(noteId)).current;

  const labels: LaneLabels = useMemo(
    () => ({
      parent: t("localView.lane.parent"),
      siblings:
        !model.parent && model.children.kind === "notes"
          ? t("localView.lane.parent")
          : t("localView.lane.siblings"),
      children: model.children.kind === "notes" ? t("localView.lane.siblings") : t("localView.lane.children"),
      childSteps: t("localView.lane.childSteps"),
    }),
    [t, model.parent, model.children.kind],
  );

  const { nodes, edges } = useMemo(
    () => buildTimelineFlow(model, labels, openNote),
    [model, labels, openNote],
  );

  // model が変わるたびにノードを作り直しているので、実測サイズが揃うのを
  // 待ってから改めて全体を収める。ELK もドラッグも無い画面なので、
  // 二度 rAF を挟むだけの簡単な再試行で足りる
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        void fitView({ padding: 0.1, maxZoom: 1 });
      });
    });
    rafRef.current = raf1;
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_e, node) => {
        if (node.id.startsWith("note:")) openNote(node.id.slice("note:".length));
      }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
      minZoom={0.2}
      style={{ background: "var(--color-background)" }}
    >
      <Background color="var(--color-border)" gap={22} size={1.5} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

// ── 本体（描画のみ。データは props で受け取る） ──

export type LocalGraphViewProps = {
  model: LocalViewModel | null;
  depth: number;
  onDepthChange: (depth: number) => void;
  onOpenNote: (noteId: string) => void;
  /** 起点の選び直し（ヘッダーの検索付きセレクト）。Container から NoteOriginPicker を渡す */
  originPicker?: ReactNode;
  /** ノートから来たときだけ渡す。ヘッダー右端に t("localView.backToNote") */
  onBackToNote?: () => void;
};

export function LocalGraphView({
  model,
  depth,
  onDepthChange,
  onOpenNote,
  originPicker,
  onBackToNote,
}: LocalGraphViewProps) {
  const t = useT();

  // ヘッダー（起点セレクト・深さ・ノートに戻る）は起点未選択・データ無しでも常に出す
  const header = (
    <div className="px-4 pt-3 pb-2 border-b border-border shrink-0 space-y-2">
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span className="text-muted-foreground">{t("localView.origin")}</span>
        {originPicker}
        {/* 深さは「計画に属さないノート」を起点にしたときだけ効く（参照を何ホップ辿って
            同じ層に並べるか）。計画や計画の工程ノートが起点なら同じ層は計画で決まるので、
            効かない場面では出さない（押しても何も起きない操作を見せない） */}
        {model && !model.parent && model.children.kind === "steps" && (
          <>
            <span className="ml-2 text-muted-foreground" title={t("localView.depthHint")}>
              {t("localView.depth")}
            </span>
            <DepthSegment depth={depth} onChange={onDepthChange} />
          </>
        )}
        {model && model.plans.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {t("localView.otherPlans", { names: model.plans.slice(1).map((p) => p.title).join(", ") })}
          </span>
        )}
        {onBackToNote && (
          <button
            type="button"
            onClick={onBackToNote}
            className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border bg-card text-xs text-foreground"
          >
            <Undo2 size={12} strokeWidth={2} />
            {t("localView.backToNote")}
          </button>
        )}
      </div>
    </div>
  );

  if (!model) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {header}
        <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground text-center">
          {t("localView.originPlaceholder")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {header}
      <div className="flex-1 min-h-0">
        <ReactFlowProvider>
          <TimelineFlow model={model} onOpenNote={onOpenNote} />
        </ReactFlowProvider>
      </div>
      {model.truncated && (
        <p className="px-4 py-1 text-xs text-muted-foreground shrink-0 border-t border-border">
          {t("planFlow.truncated")}
        </p>
      )}
    </div>
  );
}

function DepthSegment({ depth, onChange }: { depth: number; onChange: (d: number) => void }) {
  return (
    <span className="inline-flex rounded-md border border-border overflow-hidden text-xs">
      {[1, 2, 3].map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={"px-2 py-0.5 " + (d === depth ? "bg-secondary text-foreground" : "text-muted-foreground")}
        >
          {d}
        </button>
      ))}
    </span>
  );
}

// ── データ配線（buildLocalView + ProcessIndex 購読） ──

export type LocalGraphViewContainerProps = {
  /** null = 起点未選択（案内文 + ピッカーだけ出す） */
  originNoteId: string | null;
  index: GraphiumIndex | null;
  onChangeOrigin: (noteId: string) => void;
  onOpenNote: (noteId: string) => void;
  /** ノートから来たときだけ渡す */
  onBackToNote?: () => void;
};

export function LocalGraphViewContainer({
  originNoteId,
  index,
  onChangeOrigin,
  onOpenNote,
  onBackToNote,
}: LocalGraphViewContainerProps) {
  const [depth, setDepth] = useState(1);
  const processIndex = useSyncExternalStore(
    subscribeLatestProcessIndex,
    getLatestProcessIndex,
    getLatestProcessIndex,
  );

  useEffect(() => {
    requestLatestProcessIndexRefresh();
  }, []);

  // 起点が変わったら深さを既定値に戻す
  useEffect(() => {
    setDepth(1);
  }, [originNoteId]);

  const model = useMemo(
    () => (originNoteId ? buildLocalView({ originNoteId, index, processIndex, depth }) : null),
    [originNoteId, index, processIndex, depth],
  );

  return (
    <LocalGraphView
      model={model}
      depth={depth}
      onDepthChange={setDepth}
      onOpenNote={onOpenNote}
      originPicker={<NoteOriginPicker index={index} value={originNoteId} onChange={onChangeOrigin} />}
      onBackToNote={onBackToNote}
    />
  );
}
