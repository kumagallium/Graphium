// 手順の流れ（StepFlow）を Mermaid の flowchart として描く。
//
// Graphium の StepFlow と同じ投影（generateProvDocument → provDocToFlowGraph）を使い、
// 出てきた FlowGraphData を文字列にするだけ。独自に手順の関係を推論しない。
// process-index.ts は storage registry を引くため import せず、同じ呼び方だけを写す。

import type { GraphiumDocument } from "../lib/document-types";
import { syncLocale } from "../i18n";
import { generateProvDocument } from "../features/prov-generator/generator";
import { pageToGeneratorInput } from "../features/prov-generator/page-input";
import { provDocToFlowGraph, type FlowGraphData } from "../features/network-graph/activity-graph-adapter";
import { collectSteps } from "./note-text";
import { allEntries } from "./search";

/** 描く手順の上限。超えた分は注記ノードに畳む */
export const MAX_FLOW_STEPS = 60;

export type StepFlowMermaidOptions = {
  maxSteps?: number;
  /** 他ノートの名前の引き方（既定は索引）。テストで差し替える */
  noteTitleOf?: (noteId: string) => string | undefined;
};

/** ラベルを Mermaid の "…" に入れられる形にする（タグは入れない） */
export function escapeMermaidLabel(raw: string): string {
  return raw
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\r?\n/g, "<br/>");
}

function quoted(lines: string[]): string {
  return `"${lines.map(escapeMermaidLabel).join("<br/>")}"`;
}

/** ノートの 1 ページ目から手順の流れを投影する。失敗したら空の図 */
function projectFlow(doc: GraphiumDocument): FlowGraphData {
  const page = doc.pages?.[0];
  if (!page) return { steps: [], entities: [], edges: [] };
  // t() が返す文言（ラベル無しの名前など）を毎回同じにする
  syncLocale("ja");
  try {
    return provDocToFlowGraph(generateProvDocument(pageToGeneratorInput(page)));
  } catch {
    return { steps: [], entities: [], edges: [] };
  }
}

export function renderStepFlowMermaid(doc: GraphiumDocument, options: StepFlowMermaidOptions = {}): string {
  const maxSteps = options.maxSteps ?? MAX_FLOW_STEPS;
  const flow = projectFlow(doc);
  if (flow.steps.length === 0) {
    return `このノートには手順ブロックがありません: ${doc.title ?? ""}`.trim();
  }

  const noteTitleOf =
    options.noteTitleOf ?? ((id: string) => allEntries().find((e) => e.noteId === id)?.title);

  // ノード id は n1, n2, … を通し番号で振る
  let seq = 0;
  const idOf = new Map<string, string>();
  const assign = (key: string): string => {
    const existing = idOf.get(key);
    if (existing) return existing;
    const id = `n${++seq}`;
    idOf.set(key, id);
    return id;
  };

  const keptSteps = flow.steps.slice(0, maxSteps);
  const omitted = flow.steps.length - keptSteps.length;
  const keptStepIds = new Set(keptSteps.map((s) => s.id));

  const nodeLines: string[] = [];
  const edgeLines: string[] = [];

  for (const step of keptSteps) {
    const params = step.params.slice(0, 3).map((p) => p.label);
    nodeLines.push(`  ${assign(`step:${step.id}`)}[${quoted([step.name, ...params])}]`);
  }

  // 残した手順につながる Entity だけを描く（落とした手順の材料は出さない）
  const entityById = new Map(flow.entities.map((e) => [e.id, e]));
  const usedEntityIds = new Set<string>();
  for (const e of flow.edges) {
    if (e.kind === "used" && keptStepIds.has(e.target)) usedEntityIds.add(e.source);
    if (e.kind === "generates" && keptStepIds.has(e.source)) usedEntityIds.add(e.target);
  }
  for (const entity of flow.entities) {
    if (!usedEntityIds.has(entity.id)) continue;
    nodeLines.push(`  ${assign(`entity:${entity.id}`)}(${quoted([entity.label])})`);
  }

  const keyOf = (id: string) => (keptStepIds.has(id) ? `step:${id}` : `entity:${id}`);
  const isDrawn = (key: string) => idOf.has(key);
  for (const e of flow.edges) {
    const from = keyOf(e.source);
    const to = keyOf(e.target);
    // derived は両端の Entity が描かれているときだけ
    if (e.kind === "derived" && !(entityById.has(e.source) && entityById.has(e.target))) continue;
    if (!isDrawn(from) || !isDrawn(to)) continue;
    const arrow = e.kind === "orderOnly" || e.kind === "derived" ? "-.->" : "-->";
    edgeLines.push(`  ${idOf.get(from)} ${arrow} ${idOf.get(to)}`);
  }

  // 他ノート宛ての辺（informed_by など）は端に [[ノート名]] のノードを置く
  const stepOfBlock = new Map<string, string>();
  for (const s of collectSteps(doc)) {
    stepOfBlock.set(s.blockId, s.blockId);
    for (const c of s.childBlockIds) stepOfBlock.set(c, s.blockId);
  }
  const noteNodes = new Map<string, string>();
  for (const link of doc.pages?.[0]?.provLinks ?? []) {
    if (!link.targetNoteId) continue;
    const stepId = stepOfBlock.get(link.sourceBlockId) ?? link.sourceBlockId;
    if (!keptStepIds.has(stepId)) continue;
    let nid = noteNodes.get(link.targetNoteId);
    if (!nid) {
      nid = assign(`note:${link.targetNoteId}`);
      noteNodes.set(link.targetNoteId, nid);
      const name = noteTitleOf(link.targetNoteId) ?? link.targetNoteId;
      nodeLines.push(`  ${nid}[${quoted([`[[${name}]]`])}]`);
    }
    edgeLines.push(`  ${nid} -.-> ${idOf.get(`step:${stepId}`)}`);
  }

  if (omitted > 0) {
    const nid = assign("omitted");
    nodeLines.push(`  ${nid}[${quoted([`…ほか ${omitted} 件`])}]`);
    const last = keptSteps[keptSteps.length - 1];
    edgeLines.push(`  ${idOf.get(`step:${last.id}`)} -.-> ${nid}`);
  }

  return [
    "```mermaid",
    "flowchart TD",
    ...nodeLines,
    ...edgeLines,
    "```",
    "Graphium の手順の流れ（StepFlow）と同じ投影です",
  ].join("\n");
}
