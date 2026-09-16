// ──────────────────────────────────────────────
// ローカルビューのデータ（純関数）。
//
// 起点ノートから見た相対 3 レーン「親 / 同じ層 / 子」を組み立てる。
// docs/internal/note-chain-plan.md §2.4。
//
// - 親: 直近の計画ノート（findPlanNotesOf の先頭。sourceModifiedAt 最新）
// - 同じ層: 親があればその計画の工程ノート（起点を含む）。無ければ起点と
//   cross-note 参照で depth ホップ以内につながるノート
// - 子: 起点が計画ノートでもあるならその工程ノート、そうでなければ起点の
//   ProcessIndex 上の step（used/generates/orderOnly をトポロジカル整列）
//
// 横軸（t = createdAt ?? modifiedAt）で同日が重なる場合は row をずらす。
// ──────────────────────────────────────────────

import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { ProcessIndex } from "./process-index";
import { resolveCrossNoteOutput } from "./process-index";
import type { CrossNoteOutputRef } from "./process-index";
import type { FlowGraphData } from "./activity-graph-adapter";
import type { BlockLink } from "../../lib/block-link-types";
import { isPlanNote } from "../note-context/reserved-folders";
import {
  collectOperationNoteIds,
  collectCrossNoteReferencesTo,
  findPlanNotesOf,
} from "./plan-flow";

// ── 型 ──

export type LocalViewNode = {
  noteId: string;
  title: string;
  t: string;
  row: number;
  isOrigin: boolean;
  state?: "trashed" | "archived";
};

export type LocalViewStep = {
  id: string;
  name: string;
  col: number;
  row: number;
};

export type LocalViewModel = {
  origin: { noteId: string; title: string };
  /** 先頭が親レーン（modifiedAt 最新）。残りはヘッダに列挙 */
  plans: { noteId: string; title: string }[];
  parent: LocalViewNode | null;
  /** 同じ層。起点を含む */
  siblings: LocalViewNode[];
  children:
    | {
        kind: "notes";
        notes: LocalViewNode[];
        /** 各工程ノートの手順（3 段目のレーン）。step が無い・未投影のノートは空配列 */
        stepsByNote: Record<
          string,
          { steps: LocalViewStep[]; edges: { from: string; to: string }[] }
        >;
      }
    | { kind: "steps"; steps: LocalViewStep[]; edges: { from: string; to: string }[] };
  /** siblings 間。from/to は noteId */
  handoffs: { from: string; to: string; broken: boolean }[];
  truncated: boolean;
};

const DEFAULT_DEPTH = 1;

// ── ノート → LocalViewNode ──

function noteEntryOf(index: GraphiumIndex, noteId: string): NoteIndexEntry | undefined {
  return index.notes.find((n) => n.noteId === noteId);
}

function stateOf(entry: NoteIndexEntry): "trashed" | "archived" | undefined {
  if (entry.deletedAt) return "trashed";
  if (entry.archivedAt) return "archived";
  return undefined;
}

function toLocalViewNode(
  index: GraphiumIndex,
  noteId: string,
  isOrigin: boolean,
): LocalViewNode | null {
  const entry = noteEntryOf(index, noteId);
  if (!entry) return null;
  return {
    noteId,
    title: entry.title,
    t: entry.createdAt || entry.modifiedAt,
    row: 0,
    isOrigin,
    state: stateOf(entry),
  };
}

/**
 * t 昇順に並べ、同じ日付（YYYY-MM-DD）が連続する間は row を 1 ずつ増やす。
 * 日付が変われば row は 0 に戻る。
 */
function assignRows(nodes: LocalViewNode[]): LocalViewNode[] {
  const sorted = [...nodes].sort((a, b) => a.t.localeCompare(b.t));
  let prevDay: string | null = null;
  let row = 0;
  return sorted.map((node) => {
    const day = node.t.slice(0, 10);
    if (day === prevDay) {
      row += 1;
    } else {
      row = 0;
      prevDay = day;
    }
    return { ...node, row };
  });
}

// ── 計画が無いときの cross-note 参照による近傍探索 ──

function neighborsOf(processIndex: ProcessIndex | null, noteId: string): string[] {
  const result = new Set<string>();
  const entry = processIndex?.processes.find((p) => p.noteId === noteId);
  for (const link of entry?.crossNoteLinks ?? []) {
    if (link.type !== "informed_by") continue;
    if (link.targetNoteId) result.add(link.targetNoteId);
  }
  for (const ref of collectCrossNoteReferencesTo(processIndex, noteId)) {
    result.add(ref.fromNoteId);
  }
  return [...result];
}

/** 起点から depth ホップ以内につながるノート id（起点自身を含む）と、打ち切りの有無 */
function collectConnectedNotes(
  originNoteId: string,
  processIndex: ProcessIndex | null,
  depth: number,
): { ids: string[]; truncated: boolean } {
  const visited = new Set<string>([originNoteId]);
  let frontier = [originNoteId];

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighborsOf(processIndex, id)) {
        if (visited.has(n)) continue;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  let truncated = false;
  for (const id of frontier) {
    if (neighborsOf(processIndex, id).some((n) => !visited.has(n))) {
      truncated = true;
      break;
    }
  }

  return { ids: [...visited], truncated };
}

// ── handoffs（siblings 間の cross-note 参照） ──

function buildHandoffs(
  index: GraphiumIndex,
  processIndex: ProcessIndex | null,
  siblingIds: Set<string>,
): { from: string; to: string; broken: boolean }[] {
  // 同じ from/to は 1 本にまとめる（dedupe キーに broken を含めない）。
  // 同じ from/to の参照が複数あり、うち 1 つでも解決できなければ、その組は
  // handoff として broken 扱いにする（「1 本でも broken なら true」）。
  const brokenByKey = new Map<string, boolean>();

  for (const fromId of siblingIds) {
    const entry = processIndex?.processes.find((p) => p.noteId === fromId);
    for (const link of entry?.crossNoteLinks ?? []) {
      if (link.type !== "informed_by") continue;
      const targetNoteId = link.targetNoteId;
      if (!targetNoteId || targetNoteId === fromId) continue;
      if (!siblingIds.has(targetNoteId)) continue;

      const key = `${fromId}->${targetNoteId}`;
      const broken = isHandoffBroken(processIndex, link, targetNoteId);
      brokenByKey.set(key, (brokenByKey.get(key) ?? false) || broken);
    }
  }

  return [...brokenByKey.entries()].map(([key, broken]) => {
    const [from, to] = key.split("->");
    return { from, to, broken };
  });
}

function isHandoffBroken(
  processIndex: ProcessIndex | null,
  link: BlockLink,
  targetNoteId: string,
): boolean {
  if (!link.targetBlockId || !link.targetEntityId) return true;
  const ref: CrossNoteOutputRef = {
    noteId: targetNoteId,
    stepId: link.targetBlockId,
    entityIdentity: link.targetEntityId,
    sourceModifiedAt: link.targetSourceModifiedAt,
    identityStable: link.targetEntityStable,
    outputIndex: link.targetEntityIndex,
    outputCount: link.targetEntityCount,
  };
  return resolveCrossNoteOutput(processIndex, ref) === null;
}

// ── 子: ステップの整列（used/generates/orderOnly をトポロジカル整列） ──

function collectStepEdges(graph: FlowGraphData): { from: string; to: string }[] {
  const stepIds = new Set(graph.steps.map((s) => s.id));
  const edgeKeys = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  function addEdge(from: string, to: string): void {
    if (from === to) return;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to });
  }

  // orderOnly は step→step 直結
  for (const e of graph.edges) {
    if (e.kind === "orderOnly" && stepIds.has(e.source) && stepIds.has(e.target)) {
      addEdge(e.source, e.target);
    }
  }

  // used/generates は entity を畳んで step→step にする
  // （wasGeneratedBy(O, A) かつ used(B, O) のとき A → B）
  const generatedBy = new Map<string, string>(); // entityId -> 生成した stepId
  for (const e of graph.edges) {
    if (e.kind === "generates" && stepIds.has(e.source)) {
      generatedBy.set(e.target, e.source);
    }
  }
  for (const e of graph.edges) {
    if (e.kind === "used" && stepIds.has(e.target)) {
      const producer = generatedBy.get(e.source);
      if (producer) addEdge(producer, e.target);
    }
  }

  return edges;
}

/** 最長パス法で col（層）を求める（Kahn 法。循環が混じっても処理済み集合で止める） */
function layerSteps(
  graph: FlowGraphData,
  edges: { from: string; to: string }[],
): LocalViewStep[] {
  const stepIds = graph.steps.map((s) => s.id);
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of stepIds) {
    adj.set(id, []);
    indegree.set(id, 0);
  }
  for (const { from, to } of edges) {
    if (!adj.has(from) || !indegree.has(to)) continue;
    adj.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const colOf = new Map<string, number>();
  const processed = new Set<string>();
  const queue: string[] = [];
  for (const id of stepIds) {
    if ((indegree.get(id) ?? 0) === 0) {
      colOf.set(id, 0);
      queue.push(id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    if (processed.has(id)) continue;
    processed.add(id);
    const col = colOf.get(id) ?? 0;
    for (const next of adj.get(id) ?? []) {
      const nextCol = Math.max(colOf.get(next) ?? 0, col + 1);
      colOf.set(next, nextCol);
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) <= 0 && !processed.has(next)) queue.push(next);
    }
  }
  // 循環などで層が決まらなかったノードは col 0 に落とす（暴走防止。表示上は重なるだけ）
  for (const id of stepIds) {
    if (!colOf.has(id)) colOf.set(id, 0);
  }

  // 同じ col 内は元の並び順で row を振る
  const rowCounter = new Map<number, number>();
  const result: LocalViewStep[] = [];
  for (const step of graph.steps) {
    const col = colOf.get(step.id) ?? 0;
    const row = rowCounter.get(col) ?? 0;
    rowCounter.set(col, row + 1);
    result.push({ id: step.id, name: step.name, col, row });
  }
  return result;
}

/** 指定ノートの ProcessIndex graph を step 整列した結果（steps/edges）を返す */
function computeStepsForNote(
  processIndex: ProcessIndex | null,
  noteId: string,
): { steps: LocalViewStep[]; edges: { from: string; to: string }[] } {
  const process = processIndex?.processes.find((p) => p.noteId === noteId);
  const graph = process?.graph ?? { steps: [], entities: [], edges: [] };
  const stepEdges = collectStepEdges(graph);
  const steps = layerSteps(graph, stepEdges);
  return { steps, edges: stepEdges };
}

// ── 本体 ──

/**
 * depth は親（計画）が無いときだけ効く。同じ層を cross-note 参照で何ホップ
 * 集めるか（既定 1）。親があるときは無視。子側は常に 1 段。
 */
export function buildLocalView(input: {
  originNoteId: string;
  index: GraphiumIndex | null;
  processIndex: ProcessIndex | null;
  depth?: number;
}): LocalViewModel | null {
  const { originNoteId, index, processIndex } = input;
  const depth = input.depth ?? DEFAULT_DEPTH;
  if (!index) return null;

  const originEntry = noteEntryOf(index, originNoteId);
  if (!originEntry) return null;

  const planEntries = findPlanNotesOf(index, originNoteId);
  const plans = planEntries.map((p) => ({ noteId: p.noteId, title: p.title }));
  const parentEntry = planEntries[0];
  const parent = parentEntry ? toLocalViewNode(index, parentEntry.noteId, false) : null;

  // 同じ層
  let siblingIds: string[];
  let truncated = false;
  if (parent) {
    const ids = new Set(collectOperationNoteIds(index, parent.noteId));
    ids.add(originNoteId); // 防御的に起点を必ず含める
    siblingIds = [...ids];
  } else {
    const connected = collectConnectedNotes(originNoteId, processIndex, depth);
    siblingIds = connected.ids;
    truncated = connected.truncated;
  }
  const siblings = assignRows(
    siblingIds
      .map((id) => toLocalViewNode(index, id, id === originNoteId))
      .filter((n): n is LocalViewNode => n !== null),
  );

  // 子
  const originIsPlan = isPlanNote(originEntry.noteContexts);
  let children: LocalViewModel["children"];
  if (originIsPlan) {
    const childIds = collectOperationNoteIds(index, originNoteId);
    const notes = assignRows(
      childIds
        .map((id) => toLocalViewNode(index, id, false))
        .filter((n): n is LocalViewNode => n !== null),
    );
    // 各工程ノートの手順を 3 段目のレーンとして併せ持つ（計画起点でも作業手順が見えるように）
    const stepsByNote: Record<
      string,
      { steps: LocalViewStep[]; edges: { from: string; to: string }[] }
    > = {};
    for (const note of notes) {
      stepsByNote[note.noteId] = computeStepsForNote(processIndex, note.noteId);
    }
    children = { kind: "notes", notes, stepsByNote };
  } else {
    children = { kind: "steps", ...computeStepsForNote(processIndex, originNoteId) };
  }

  const handoffs = buildHandoffs(index, processIndex, new Set(siblings.map((s) => s.noteId)));

  return {
    origin: { noteId: originNoteId, title: originEntry.title },
    plans,
    parent,
    siblings,
    children,
    handoffs,
    truncated,
  };
}
