// 系譜（来歴の図）で、段ごとの図（FlowGraphData）を組み立てる純関数。
// 計画ノートは工程グラフ、手順のあるノートはステップタブと同じ図をそのまま使い、
// 派生したノート（stack の子）を noteRef ノードとして足す。手で並べた配置は
// 工程グラフ・ステップタブと同じ layoutScope で共有する。
// 知識・資料・仮想ルート・手順も工程も無いノートは、子を箱ごとの帯に並べた図にする。

import type { GraphiumDocument } from "../../lib/document-types";
import { isPlanNote } from "../note-context/reserved-folders";
import type { GraphiumIndex } from "../navigation/index-file";
import type { FlowEdge, FlowGraphData, FlowStep } from "./activity-graph-adapter";
import { addCrossNoteOriginsToFlowGraph } from "./cross-note-flow";
import { planFlowScope, provFlowScope } from "./graph-layout";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";
import { buildPlanFlowGraph, collectOperationRows } from "./plan-flow";
import type { ProcessIndex } from "./process-index";

export type LevelFlow =
  | { kind: "plan"; graph: FlowGraphData; layoutScope: string }
  | { kind: "note"; graph: FlowGraphData; layoutScope: string }
  /** 子を箱ごとの帯に並べただけの図。知識・資料・仮想ルートでは layoutScope が null（配置を保存しない） */
  | { kind: "children"; graph: FlowGraphData; layoutScope: string | null }
  /** 子が無く、図にするものが無い段 */
  | { kind: "none" };

export type BuildLevelFlowInput = {
  /** 段のノード（StackNode.id） */
  nodeId: string;
  stack: LineageStackModel;
  docs: Map<string, GraphiumDocument>;
  index: GraphiumIndex | null;
  processIndex: ProcessIndex | null;
  labels: {
    derivedBand: string;
    wholeNote: string;
    /** 1 段の上限で省いた分を帯のラベルに足す（例: 「生地（他 3 件）」） */
    bandMore: (label: string, count: number) => string;
  };
};

const DERIVED_BAND_ID = "lineage-derived";
/** 1 段に図として並べる子の上限（超えた分は帯のラベルに件数で出す） */
export const LEVEL_FLOW_NODE_LIMIT = 60;

type Item = { id: string; title: string };
type Band = { key: string; label: string; order: number; items: Item[]; omitted: number };

function noteRefStep(item: Item, rowIndex: number, group?: FlowStep["group"]): FlowStep {
  return {
    id: `note:${item.id}`,
    name: item.title,
    params: [],
    noteRef: { noteId: item.id, tableBlockId: "lineage", rowIndex },
    ...(group ? { group } : {}),
  };
}

/** 段の箱ごとに、子（作った札 + 上限で省いた札）を 60 件の予算で拾う */
function collectBands(node: StackNode, titleOf: (id: string) => string, bandMore: BuildLevelFlowInput["labels"]["bandMore"]): Band[] {
  let left = LEVEL_FLOW_NODE_LIMIT;
  const seen = new Set<string>();
  const bands: Band[] = [];
  node.groups.forEach((g, gi) => {
    const all: Item[] = [];
    for (const id of g.children) {
      if (seen.has(id)) continue;
      seen.add(id);
      all.push({ id, title: titleOf(id) });
    }
    for (const h of g.hidden ?? []) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      all.push({ id: h.id, title: h.title });
    }
    const items = all.slice(0, Math.max(0, left));
    left -= items.length;
    // 省いた分 = 予算で切った分 + モデル側で名前も持たなかった分（more のうち hidden に無い分）
    const omitted = all.length - items.length + Math.max(0, (g.more ?? 0) - (g.hidden?.length ?? 0));
    if (items.length === 0 && omitted === 0) return;
    bands.push({ key: g.key, label: omitted > 0 ? bandMore(g.label, omitted) : g.label, order: 100 + gi, items, omitted });
  });
  return bands;
}

export function buildLevelFlow(input: BuildLevelFlowInput): LevelFlow {
  const { nodeId, stack, docs, index, processIndex, labels } = input;
  const node = stack.nodes[nodeId];
  if (!node) return { kind: "none" };

  const titleOf = (id: string) => stack.nodes[id]?.title ?? docs.get(id)?.title ?? id;
  const bands = collectBands(node, titleOf, labels.bandMore);
  const isPlainNote = node.kind !== "knowledge" && node.kind !== "asset" && node.kind !== "root";
  const doc = isPlainNote ? docs.get(nodeId) : undefined;

  // 1. 計画ノート（工程タブと同じ条件）: 工程グラフと同一
  if (doc && index) {
    const entry = index.notes.find((n) => n.noteId === nodeId);
    const rows = isPlanNote(entry?.noteContexts) ? collectOperationRows(doc, index) : [];
    if (rows.length > 0) {
      const base = buildPlanFlowGraph({ rows, index, processIndex }).graph;
      // 未作成・ゴミ箱・アーカイブ・開けないノートの行には「作る / 開く」ボタンを出さない
      const baseSteps = base.steps.map((s) => {
        const r = s.noteRef;
        if (!r) return s;
        const unopenable =
          !r.noteId || r.state === "trashed" || r.state === "archived" || (!stack.nodes[r.noteId] && !docs.has(r.noteId));
        return unopenable ? { ...s, noteRef: { ...r, readOnly: true } } : s;
      });
      const rowNoteIds = new Set(rows.map((r) => r.noteId).filter((id): id is string => !!id));
      const known = new Set(baseSteps.map((s) => s.id));
      const extra: FlowStep[] = [];
      let omitted = 0;
      let order = 0;
      for (const b of bands) {
        omitted += b.omitted;
        for (const item of b.items) {
          if (rowNoteIds.has(item.id) || known.has(`note:${item.id}`)) continue;
          known.add(`note:${item.id}`);
          extra.push(noteRefStep(item, order++, { id: DERIVED_BAND_ID, label: "", index: 999 }));
        }
      }
      const bandLabel = omitted > 0 ? labels.bandMore(labels.derivedBand, omitted) : labels.derivedBand;
      for (const s of extra) s.group = { id: DERIVED_BAND_ID, label: bandLabel, index: 999 };
      const graph = extra.length > 0 ? { ...base, steps: [...baseSteps, ...extra] } : { ...base, steps: baseSteps };
      return { kind: "plan", graph, layoutScope: planFlowScope(nodeId) };
    }
  }

  // 2. 手順のあるノート: ステップタブと同じ図 + 派生ノート
  const entry = isPlainNote ? processIndex?.processes.find((p) => p.noteId === nodeId) : undefined;
  if (entry && entry.graph.steps.some((s) => !s.externalOrigin)) {
    const base = addCrossNoteOriginsToFlowGraph(entry.graph, entry.crossNoteLinks ?? [], processIndex);
    const stepIds = new Set(base.steps.filter((s) => !s.externalOrigin).map((s) => s.id));
    const steps: FlowStep[] = [...base.steps];
    const edges: FlowEdge[] = [...base.edges];
    const known = new Set(steps.map((s) => s.id));
    for (const b of bands) {
      b.items.forEach((item, ci) => {
        const sid = `note:${item.id}`;
        if (known.has(sid)) return;
        known.add(sid);
        const from = docs.get(item.id)?.derivedFromBlockId;
        if (from && stepIds.has(from)) {
          steps.push(noteRefStep(item, ci));
          edges.push({ id: `lineage-derived:${from}->${item.id}`, kind: "derived", source: from, target: sid });
        } else {
          steps.push(noteRefStep(item, ci, { id: `lineage-box:${b.key}`, label: b.label, index: b.order }));
        }
      });
    }
    return { kind: "note", graph: { ...base, steps, edges }, layoutScope: provFlowScope(nodeId) };
  }

  // 3. 手順も工程も無い（知識・資料・出典を含む）が子がある: 箱ごとの帯
  if (bands.length > 0) {
    const steps: FlowStep[] = [];
    const known = new Set<string>();
    for (const b of bands) {
      b.items.forEach((item, ci) => {
        const sid = `note:${item.id}`;
        if (known.has(sid)) return;
        known.add(sid);
        steps.push(noteRefStep(item, ci, { id: `lineage-box:${b.key}`, label: b.label, index: b.order }));
      });
    }
    const edges: FlowEdge[] = [];
    const seen = new Set<string>();
    for (const l of node.links) {
      const s = `note:${l.from}`;
      const t = `note:${l.to}`;
      const id = `lineage-used:${l.from}->${l.to}`;
      if (!known.has(s) || !known.has(t) || seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, kind: "used", source: s, target: t });
    }
    return {
      kind: "children",
      graph: { steps, entities: [], edges },
      layoutScope: isPlainNote ? provFlowScope(nodeId) : null,
    };
  }

  return { kind: "none" };
}
