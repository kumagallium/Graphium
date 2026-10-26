// 系譜（来歴の図）で、段ごとの図（FlowGraphData）を組み立てる純関数。
// 計画ノートは工程グラフ、手順のあるノートはステップタブと同じ図をそのまま使い、
// 派生したノート（stack の子）を noteRef ノードとして足す。手で並べた配置は
// 工程グラフ・ステップタブと同じ layoutScope で共有する。
// 知識・資料・仮想ルート・手順も工程も無いノートは、子を箱ごとの帯に並べた図にする。

import type { GraphiumDocument } from "../../lib/document-types";
import { isPlanNote } from "../note-context/reserved-folders";
import type { GraphiumIndex } from "../navigation/index-file";
import type { FlowEdge, FlowEntity, FlowGraphData, FlowGroup, FlowNoteRef, FlowStep } from "./activity-graph-adapter";
import { addCrossNoteOriginsToFlowGraph } from "./cross-note-flow";
import { planFlowScope, procedureFlowScope, provFlowScope } from "./graph-layout";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";
import { buildPlanFlowGraph, collectOperationRows, normalizeOperationName, resolvePlannedRow } from "./plan-flow";
import { createCrossNoteOutputResolver, type ProcessIndex } from "./process-index";

/** 計画の段の「手順を表示」オンの図（buildProcedureFlow）。layoutScope は procedure:<planId> */
export type ProcedureFlow = { graph: FlowGraphData; layoutScope: string; operationIds: string[] };

export type LevelFlow =
  /** 計画ノートの段。graph = 工程グラフ（手順を表示オフ）、steps = 全工程の手順をつなげた図（オン）。工程ノートが無ければ steps は null */
  | { kind: "plan"; graph: FlowGraphData; layoutScope: string; steps: ProcedureFlow | null }
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

function noteRefStep(
  item: Item,
  rowIndex: number,
  group?: FlowStep["group"],
  extra?: Pick<FlowNoteRef, "action" | "via">,
): FlowStep {
  return {
    id: `note:${item.id}`,
    name: item.title,
    params: [],
    noteRef: { noteId: item.id, tableBlockId: "lineage", rowIndex, ...extra },
    ...(group ? { group } : {}),
  };
}

type ActionContext = {
  stack: LineageStackModel;
  index: GraphiumIndex | null;
  processIndex: ProcessIndex | null;
};

/**
 * 系譜のノードのボタン。下に何かあるノート（箱・省いた子・手順・計画フォルダ）は「下に展開」、
 * stack に無い（上限で省いて名前だけ持っている）ノートも展開（経路として作らせる）、
 * どれでもない葉は「ノートを開く」
 */
function noteActionOf(ctx: ActionContext, noteId: string): "open" | "expand" {
  const node = ctx.stack.nodes[noteId];
  if (!node) return "expand";
  if (node.groups.length > 0 || node.truncated) return "expand";
  const proc = ctx.processIndex?.processes.find((p) => p.noteId === noteId);
  if (proc?.graph.steps.some((s) => !s.externalOrigin)) return "expand";
  const entry = ctx.index?.notes.find((n) => n.noteId === noteId);
  if (isPlanNote(entry?.noteContexts)) return "expand";
  return "open";
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
  const actionCtx: ActionContext = { stack, index, processIndex };
  const derivedExtra = (id: string, via?: string) => ({ action: noteActionOf(actionCtx, id), ...(via ? { via } : {}) });
  const isPlainNote = node.kind !== "knowledge" && node.kind !== "asset" && node.kind !== "root";
  const doc = isPlainNote ? docs.get(nodeId) : undefined;

  // 1. 計画ノート（工程タブと同じ条件）: 工程グラフと同一
  if (doc && index) {
    const entry = index.notes.find((n) => n.noteId === nodeId);
    const rows = isPlanNote(entry?.noteContexts) ? collectOperationRows(doc, index) : [];
    if (rows.length > 0) {
      const base = buildPlanFlowGraph({ rows, index, processIndex }).graph;
      // 未作成・ゴミ箱・アーカイブ・開けないノートの行には「作る / 開く」ボタンを出さない
      // 計画の工程は「ノートを開く」（工程の中身は手順を表示で見る）
      const baseSteps = base.steps.map((s) => {
        const r = s.noteRef;
        if (!r) return s;
        const unopenable =
          !r.noteId || r.state === "trashed" || r.state === "archived" || (!stack.nodes[r.noteId] && !docs.has(r.noteId));
        return { ...s, noteRef: { ...r, action: "open" as const, ...(unopenable ? { readOnly: true } : {}) } };
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
          extra.push(noteRefStep(item, order++, { id: DERIVED_BAND_ID, label: "", index: 999 }, derivedExtra(item.id)));
        }
      }
      const bandLabel = omitted > 0 ? labels.bandMore(labels.derivedBand, omitted) : labels.derivedBand;
      for (const s of extra) s.group = { id: DERIVED_BAND_ID, label: bandLabel, index: 999 };

      // 工程の派生ノートはここには足さない（手順を表示オンの図で工程の帯の中に出る）。
      // オフの図は工程グラフと配置（plan:<id>）を共有するので、工程グラフに無いノードは増やさない
      const graph = extra.length > 0 ? { ...base, steps: [...baseSteps, ...extra] } : { ...base, steps: baseSteps };
      return { kind: "plan", graph, layoutScope: planFlowScope(nodeId), steps: null };
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
          steps.push(noteRefStep(item, ci, undefined, derivedExtra(item.id)));
          edges.push({ id: `lineage-derived:${from}->${item.id}`, kind: "derived", source: from, target: sid });
        } else {
          steps.push(noteRefStep(item, ci, { id: `lineage-box:${b.key}`, label: b.label, index: b.order }, derivedExtra(item.id)));
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
        steps.push(noteRefStep(item, ci, { id: `lineage-box:${b.key}`, label: b.label, index: b.order }, derivedExtra(item.id)));
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

/** 計画の段の図 flow が、noteId を工程（派生ノートではない）として持っているか */
export function planHasOperation(flow: LevelFlow, noteId: string): boolean {
  if (flow.kind !== "plan") return false;
  return flow.graph.steps.some(
    (st) => st.noteRef?.noteId === noteId && st.group?.id !== DERIVED_BAND_ID && !st.noteRef?.via,
  );
}

/**
 * 計画の段に「手順を表示」の図を足す。計画ノートでなければそのまま。
 * 工程ノート（noteId のある行）が 1 つも無ければ steps は null（工程グラフだけ）
 */
export function withPlanSteps(flow: LevelFlow, input: Omit<BuildProcedureFlowInput, "planId">, planId: string): LevelFlow {
  if (flow.kind !== "plan") return flow;
  const proc = buildProcedureFlow({ ...input, planId });
  return { ...flow, steps: proc.operationIds.length > 0 ? proc : null };
}

/** 系譜で描く段。pathIndex は経路（validPath）の中の位置 */
export type DisplayLevel = { id: string; pathIndex: number; flow: LevelFlow };

/**
 * 経路から、描く段を決める。計画の段の直後の工程の段は描かない（計画の段に含まれる）。
 * getLevelFlow の nextId は経路の次のノード（工程なら計画の段が focusOperationId にする）
 */
export function displayLevels(
  path: string[],
  getLevelFlow: (nodeId: string, nextId?: string) => LevelFlow,
): DisplayLevel[] {
  const out: DisplayLevel[] = [];
  path.forEach((id, i) => {
    const last = out[out.length - 1];
    // 直前の段（経路で隣）が計画で、このノートがその計画の工程なら飛ばす
    if (last && last.pathIndex === i - 1 && planHasOperation(last.flow, id)) return;
    out.push({ id, pathIndex: i, flow: getLevelFlow(id, path[i + 1]) });
  });
  return out;
}

export type BuildProcedureFlowInput = {
  planId: string;
  docs: Map<string, GraphiumDocument>;
  index: GraphiumIndex | null;
  processIndex: ProcessIndex | null;
  /** 派生ノート（子）の取得に使う */
  stack: LineageStackModel;
  /** 押した／今の工程（帯に印） */
  focusOperationId: string | null;
  /** 現在地のノート（工程ならその帯に「現在地」） */
  currentId: string | null;
  labels: { derivedBand: string; noSteps: string; here: string };
};

const PROCEDURE_SEP = "::";
const pid = (noteId: string, id: string) => `${noteId}${PROCEDURE_SEP}${id}`;

/**
 * 計画ノートの全工程の手順の図を、工程ごとの帯につなげた図を作る（系譜の「手順の全体」）。
 * 帯の中は工程ノートの手順・材料・出力。工程をまたぐ実際の受け渡し（used）と、
 * 受け渡しの無い組だけの予定の線（planned）を足す。
 */
export function buildProcedureFlow(input: BuildProcedureFlowInput): ProcedureFlow {
  const { planId, docs, index, processIndex, stack, focusOperationId, currentId, labels } = input;
  const actionCtx: ActionContext = { stack, index, processIndex };
  const layoutScope = procedureFlowScope(planId);
  const planDoc = docs.get(planId);
  const allRows = planDoc ? collectOperationRows(planDoc, index) : [];
  // 工程 = noteId のある行（表の順）。同じノートが複数行にあれば最初の行だけ
  const rows: typeof allRows = [];
  const seenOps = new Set<string>();
  for (const r of allRows) {
    if (!r.noteId || seenOps.has(r.noteId)) continue;
    seenOps.add(r.noteId);
    rows.push(r);
  }
  const operationIds = rows.map((r) => r.noteId!);

  const steps: FlowStep[] = [];
  const entities: FlowEntity[] = [];
  const edges: FlowEdge[] = [];
  const edgeIds = new Set<string>();
  const pushEdge = (e: FlowEdge) => {
    if (edgeIds.has(e.id)) return;
    edgeIds.add(e.id);
    edges.push(e);
  };

  // 工程ごとの帯の内訳（受け渡し・予定の線の端点探しに使う）
  type Part = {
    noteId: string;
    group: FlowGroup;
    entry: ProcessIndex["processes"][number] | undefined;
    /** 帯に入れた元の step（元の id） */
    steps: FlowStep[];
    entities: FlowEntity[];
    /** 元の id → 接頭辞付き id の edges（元の辺） */
    edges: FlowEdge[];
    /** 手順が 0 のときの noteRef ノード id */
    placeholderId: string | null;
  };
  const parts = new Map<string, Part>();

  rows.forEach((row, i) => {
    const noteId = row.noteId!;
    const name = row.name.startsWith("@") ? row.name.slice(1) : row.name;
    const isHere = noteId === currentId;
    const isFocus = noteId === focusOperationId;
    const group: FlowGroup = {
      id: noteId,
      label: isHere ? `${name} · ${labels.here}` : name,
      index: i,
      ...(isHere ? { highlight: "here" as const } : isFocus ? { highlight: "focus" as const } : {}),
      // 帯のラベルの右の「ノートを開く」（工程は帯なので、工程ノートを開く口はここ）
      openRef: { noteId, tableBlockId: "lineage", rowIndex: i, action: "open" },
    };
    const entry = processIndex?.processes.find((p) => p.noteId === noteId);
    const ownSteps = entry ? entry.graph.steps.filter((st) => !st.externalOrigin && !st.noteRef) : [];
    const part: Part = { noteId, group, entry, steps: ownSteps, entities: [], edges: [], placeholderId: null };
    parts.set(noteId, part);

    if (!entry || ownSteps.length === 0) {
      // 手順の無い工程は、工程ノート自身の noteRef ノード 1 つ（下に展開できる）
      const placeholderId = pid(noteId, `note:${noteId}`);
      part.placeholderId = placeholderId;
      steps.push({
        id: placeholderId,
        name,
        params: [{ label: labels.noSteps }],
        noteRef: { noteId, tableBlockId: "lineage", rowIndex: i, action: "open" },
        group,
      });
      return;
    }

    const stepIds = new Set(ownSteps.map((st) => st.id));
    for (const st of ownSteps) steps.push({ ...st, id: pid(noteId, st.id), group });
    const ownEntities = entry!.graph.entities;
    const entityIds = new Set(ownEntities.map((e) => e.id));
    for (const e of ownEntities) {
      const copy = { ...e, id: pid(noteId, e.id), group };
      part.entities.push(e);
      entities.push(copy);
    }
    for (const e of entry!.graph.edges) {
      const ok = (id: string) => stepIds.has(id) || entityIds.has(id);
      if (!ok(e.source) || !ok(e.target)) continue;
      part.edges.push(e);
      pushEdge({ ...e, id: pid(noteId, e.id), source: pid(noteId, e.source), target: pid(noteId, e.target) });
    }
  });

  const opSet = new Set(operationIds);
  // 実際の受け渡しがあった組（"producer->consumer"）
  const handedOver = new Set<string>();
  const resolve = createCrossNoteOutputResolver(processIndex);

  for (const consumer of parts.values()) {
    if (!consumer.entry) continue;
    for (const link of consumer.entry.crossNoteLinks ?? []) {
      if (link.type !== "informed_by" || !link.targetNoteId || !link.targetEntityId) continue;
      const producer = parts.get(link.targetNoteId);
      if (!producer || producer.noteId === consumer.noteId || !opSet.has(link.targetNoteId)) continue;
      const resolved = resolve({
        noteId: link.targetNoteId,
        sourceModifiedAt: link.targetSourceModifiedAt,
        stepId: link.targetBlockId,
        entityIdentity: link.targetEntityId,
        identityStable: link.targetEntityStable,
        outputIndex: link.targetEntityIndex,
        outputCount: link.targetEntityCount,
      });
      if (!resolved) continue;
      const out = producer.entities.find(
        (e) => (e.rowIdentity ?? e.entityId ?? e.id) === resolved.entityIdentity,
      );
      if (!out) continue;
      const localEntity = link.sourceEntityId
        ? consumer.entities.find((e) => e.entityId === link.sourceEntityId || e.rowIdentity === link.sourceEntityId)
        : undefined;
      let targetOriginal: string | undefined = localEntity?.id;
      if (!targetOriginal && consumer.steps.some((st) => st.id === link.sourceBlockId)) targetOriginal = link.sourceBlockId;
      if (!targetOriginal) continue;
      const source = pid(producer.noteId, out.id);
      const target = pid(consumer.noteId, targetOriginal);
      pushEdge({ id: `procedure-used:${source}->${target}`, kind: "used", source, target });
      handedOver.add(`${producer.noteId}->${consumer.noteId}`);
    }
  }

  // 帯の最初／最後の手順（無ければ noteRef ノード）
  const lastNodeOf = (part: Part): string | null => {
    if (part.placeholderId) return part.placeholderId;
    const ids = part.steps.map((st) => st.id);
    const outgoing = new Set(part.edges.filter((e) => e.kind === "orderOnly" || e.kind === "used").map((e) => e.source));
    const last = ids.filter((id) => !outgoing.has(id));
    const pick = last.length > 0 ? last[last.length - 1] : ids[ids.length - 1];
    return pick ? pid(part.noteId, pick) : null;
  };
  const firstNodeOf = (part: Part): string | null => {
    if (part.placeholderId) return part.placeholderId;
    const ids = part.steps.map((st) => st.id);
    const incoming = new Set(part.edges.filter((e) => e.kind === "orderOnly").map((e) => e.target));
    const first = ids.filter((id) => !incoming.has(id));
    const pick = first.length > 0 ? first[0] : ids[0];
    return pick ? pid(part.noteId, pick) : null;
  };

  // 予定の線（入力元列）。実際の受け渡しが 1 本も無い組だけ
  for (const row of rows) {
    const consumer = parts.get(row.noteId!);
    if (!consumer) continue;
    for (const name of row.plannedFrom) {
      const prodRow = resolvePlannedRow(allRows, name);
      if (!prodRow?.noteId || prodRow.noteId === row.noteId) continue;
      const producer = parts.get(prodRow.noteId);
      if (!producer || handedOver.has(`${producer.noteId}->${consumer.noteId}`)) continue;
      const source = lastNodeOf(producer);
      const target = firstNodeOf(consumer);
      if (!source || !target) continue;
      const userLabel = row.inputLabels?.[normalizeOperationName(prodRow.name)];
      pushEdge({
        id: `procedure-planned:${producer.noteId}->${consumer.noteId}`,
        kind: "planned",
        source,
        target,
        ...(userLabel ? { userLabel } : {}),
      });
    }
  }

  // 派生ノート: 各工程の子を、その工程の帯に noteRef ノードで足す
  let left = LEVEL_FLOW_NODE_LIMIT;
  const known = new Set(steps.map((st) => st.id));
  for (const part of parts.values()) {
    const opNode = stack.nodes[part.noteId];
    if (!opNode) continue;
    const childIds: Item[] = [];
    for (const g of opNode.groups) {
      for (const id of g.children) childIds.push({ id, title: stack.nodes[id]?.title ?? docs.get(id)?.title ?? id });
      for (const h of g.hidden ?? []) childIds.push({ id: h.id, title: h.title });
    }
    const ownStepIds = new Set(part.steps.map((st) => st.id));
    let ci = 0;
    for (const item of childIds) {
      if (left <= 0) break;
      if (opSet.has(item.id)) continue;
      const nodeId = pid(part.noteId, `note:${item.id}`);
      if (known.has(nodeId)) continue;
      known.add(nodeId);
      left--;
      steps.push({
        ...noteRefStep(item, ci++, part.group, { action: noteActionOf(actionCtx, item.id), via: part.noteId }),
        id: nodeId,
      });
      const from = docs.get(item.id)?.derivedFromBlockId;
      if (from && ownStepIds.has(from)) {
        pushEdge({
          id: `lineage-derived:${pid(part.noteId, from)}->${item.id}`,
          kind: "derived",
          source: pid(part.noteId, from),
          target: nodeId,
        });
      }
    }
  }

  return { graph: { steps, entities, edges }, layoutScope, operationIds };
}
