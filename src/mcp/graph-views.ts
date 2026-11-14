// 会話の中に描くグラフ（MCP Apps の graph-view）に渡すデータを組む。
//
// 3 種類を同じ形（GraphPayload）にそろえ、画面は 1 つで描く:
//   - flow      : ノート 1 件の手順の流れ（材料・道具 → 手順 → 生成物）。get_note_steps の mermaid と同じ投影
//                 （generateProvDocument → provDocToFlowGraph）。独自に手順の関係を推論しない
//   - lineage   : 来歴（trace_lineage と同じ traceLineage の結果）
//   - knowledge : 全体グラフ（アプリの全体グラフと同じ buildGlobalGraph）。フォルダの外は薄く描く
//
// 画面向けのデータは結果の _meta に載せる（モデルの文脈には入れない。app-tools.ts と同じ方針）。

import type { GraphiumDocument } from "../lib/document-types";
import { syncLocale } from "../i18n";
import { generateProvDocument } from "../features/prov-generator/generator";
import { pageToGeneratorInput } from "../features/prov-generator/page-input";
import { provDocToFlowGraph, type FlowGraphData } from "../features/network-graph/activity-graph-adapter";
import { buildGlobalGraph } from "../features/network-graph/graph-builder";
import { kindOf, type GraphKind } from "../features/network-graph/graph-kind";
import { collectFolderScopeIds, normalizeFolderScope } from "../features/note-context/folder-scope";
import type { MediaIndex } from "../features/asset-browser/media-index";
import type { LineageResult } from "./lineage";
import { describeSource, isExternalSourceId } from "./sources";
import { allEntries } from "./search";
import { appDataDir, readNoteIndex, resolveGraphiumRoot } from "./vault";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 結果の _meta にグラフを載せるキー（画面だけが読む） */
export const GRAPH_META_KEY = "graphium/graph";

export type GraphNodeKind =
  // flow
  | "step"
  | "material"
  | "tool"
  | "output"
  | "entity"
  // lineage / knowledge
  | "note"
  | "claim"
  | "topic"
  | "answer"
  | "atom"
  | "summary"
  | "source";

export type GraphNode = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  /** 手順の条件など、ラベルの下に小さく出す 1 行 */
  sub?: string;
  /** 起点（来歴の始まり・手順ノートそのもの）。枠を太くする */
  focus?: boolean;
  /** フォルダの範囲の外（薄く描く） */
  out?: boolean;
  /** 来歴の段（上流は負、下流は正、起点 0）。来歴の配置に使う */
  rank?: number;
  /** アプリの全体グラフの種類（knowledge / lineage）。色・形・大きさをアプリと同じ関数で決めるのに使う */
  graphKind?: GraphKind;
};

export type GraphEdgeKind = "used" | "generates" | "order" | "derived" | "reference" | "prov" | "knowledge" | "connection";

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
};

export type GraphPayload = {
  mode: "flow" | "lineage" | "knowledge";
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 描いたノードの数と、上限で切る前の数（切ったときだけ） */
  truncated?: { shown: number; total: number };
  /** knowledge: 範囲にしたフォルダ */
  folder?: string;
  /** knowledge: 画面が graph_activity で触れたものを光らせるか */
  live?: boolean;
};

// ── flow ─────────────────────────────────────────────────────

/** 描く手順の上限（get_note_steps の mermaid と同じ）。超えた分は描かない */
export const MAX_FLOW_STEPS_VIEW = 80;

function flowOf(doc: GraphiumDocument): FlowGraphData {
  const page = doc.pages?.[0];
  if (!page) return { steps: [], entities: [], edges: [] };
  syncLocale("ja");
  try {
    return provDocToFlowGraph(generateProvDocument(pageToGeneratorInput(page)));
  } catch {
    return { steps: [], entities: [], edges: [] };
  }
}

/** 条件を「キー: 値」で短く 1 行にする */
function paramsLine(params: { key?: string | null; value?: string }[] | undefined, max = 3): string | undefined {
  if (!params || params.length === 0) return undefined;
  const parts = params.slice(0, max).map((p) => (p.key ? `${p.key}: ${p.value ?? ""}` : (p.value ?? ""))).filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.join(" · ") + (params.length > max ? " …" : "");
}

export function buildFlowPayload(doc: GraphiumDocument): GraphPayload | null {
  const flow = flowOf(doc);
  if (flow.steps.length === 0) return null;
  const steps = flow.steps.slice(0, MAX_FLOW_STEPS_VIEW);
  const stepIds = new Set(steps.map((s) => s.id));
  const nodes: GraphNode[] = steps.map((s) => ({
    id: s.id,
    label: s.name,
    kind: "step",
    ...(paramsLine(s.params as never) ? { sub: paramsLine(s.params as never) } : {}),
  }));
  const entityKind = (k: string): GraphNodeKind =>
    k === "material" || k === "tool" || k === "output" ? k : "entity";
  const entityIds = new Set<string>();
  for (const e of flow.entities) {
    entityIds.add(e.id);
    nodes.push({
      id: e.id,
      label: e.label,
      kind: entityKind(e.kind),
      ...(paramsLine(e.attrs as never) ? { sub: paramsLine(e.attrs as never) } : {}),
    });
  }
  const known = new Set([...stepIds, ...entityIds]);
  const edges: GraphEdge[] = [];
  for (const e of flow.edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    const kind: GraphEdgeKind = e.kind === "used" ? "used" : e.kind === "generates" ? "generates" : e.kind === "orderOnly" ? "order" : "derived";
    edges.push({ id: e.id, source: e.source, target: e.target, kind });
  }
  // 手順に 1 本も線がつながらない実体（手順の上限で切った側だけにいたもの）は落とす
  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  const kept = nodes.filter((n) => n.kind === "step" || touched.has(n.id));
  return {
    mode: "flow",
    title: doc.title ?? "",
    nodes: kept,
    edges,
    ...(flow.steps.length > steps.length ? { truncated: { shown: steps.length, total: flow.steps.length } } : {}),
  };
}

// ── lineage ──────────────────────────────────────────────────

/** 来歴・全体グラフのノードの種類 → アプリの全体グラフの種類 */
export function graphKindOf(kind: GraphNodeKind): GraphKind {
  if (kind === "source") return "external";
  if (kind === "claim" || kind === "topic" || kind === "answer" || kind === "atom" || kind === "summary") return kind;
  return "note";
}

function kindOfNoteId(id: string): GraphNodeKind {
  if (isExternalSourceId(id)) return "source";
  const entry = allEntries().find((e) => e.noteId === id);
  const k = entry?.wikiKind;
  if (k === "claim" || k === "topic" || k === "answer" || k === "atom" || k === "summary") return k;
  return "note";
}

function labelOf(id: string, fallback?: string): string {
  if (isExternalSourceId(id)) return describeSource(id).title;
  return fallback || allEntries().find((e) => e.noteId === id)?.title || id;
}

export function buildLineagePayload(result: LineageResult, startTitle: string): GraphPayload {
  const nodes = new Map<string, GraphNode>();
  const startKind = kindOfNoteId(result.noteId);
  nodes.set(result.noteId, { id: result.noteId, label: startTitle, kind: startKind, graphKind: graphKindOf(startKind), focus: true, rank: 0 });
  const edges = new Map<string, GraphEdge>();
  const add = (list: LineageResult["upstream"], sign: -1 | 1 | 0) => {
    for (const n of list) {
      if (!nodes.has(n.noteId)) {
        const kind = kindOfNoteId(n.noteId);
        nodes.set(n.noteId, {
          id: n.noteId,
          label: labelOf(n.noteId, n.title),
          kind,
          graphKind: graphKindOf(kind),
          rank: sign === 0 ? 0 : sign * n.depth,
        });
      }
      const from = n.fromId ?? result.noteId;
      // 線は「元 → 派生」の向きにそろえる（上流をたどったときは相手が元）
      const [source, target] = sign < 0 ? [n.noteId, from] : [from, n.noteId];
      const layer = n.via?.layer ?? "prov";
      const kind: GraphEdgeKind = layer === "knowledge" ? "knowledge" : layer === "connection" ? "connection" : "prov";
      const id = `${source}->${target}`;
      if (!edges.has(id)) edges.set(id, { id, source, target, kind });
    }
  };
  add(result.upstream, -1);
  add(result.downstream, 1);
  add(result.connections, 0);
  return { mode: "lineage", title: startTitle, nodes: [...nodes.values()], edges: [...edges.values()] };
}

// ── knowledge ───────────────────────────────────────────────

/** 全体グラフで描くノードの上限（会話の中の画面なので、アプリより絞る） */
export const MAX_KNOWLEDGE_NODES = 1200;

function readMediaIndexRaw(root: string): MediaIndex | null {
  const path = join(appDataDir(root), "media-index.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as MediaIndex;
    return raw && Array.isArray(raw.media) ? raw : null;
  } catch {
    return null;
  }
}

export function buildKnowledgePayload(
  options: { folder?: string; maxNodes?: number } = {},
  root = resolveGraphiumRoot(),
): GraphPayload | null {
  const index = readNoteIndex(root);
  if (!index) return null;
  syncLocale("ja");
  const data = buildGlobalGraph(index, readMediaIndexRaw(root));
  const folder = normalizeFolderScope(options.folder);
  const scope = folder ? collectFolderScopeIds(allEntries(root), folder) : null;

  // 資料（pdf: など）は、範囲の中のページとつながっていれば範囲の中
  const inScope = (id: string) => !scope || scope.has(id);
  const sourceInScope = new Set<string>();
  if (scope) {
    for (const e of data.edges) {
      if (isExternalSourceId(e.source) && inScope(e.target)) sourceInScope.add(e.source);
      if (isExternalSourceId(e.target) && inScope(e.source)) sourceInScope.add(e.target);
    }
  }

  const toKind = (n: (typeof data.nodes)[number]): GraphNodeKind => {
    if (n.external) return "source";
    const k = n.wikiKind;
    if (n.isWiki && (k === "claim" || k === "topic" || k === "answer" || k === "atom" || k === "summary")) return k;
    return "note";
  };
  let nodes: GraphNode[] = data.nodes
    .filter((n) => n.external !== "media")
    .map((n) => {
      const out = scope ? !(scope.has(n.id) || sourceInScope.has(n.id)) : false;
      return { id: n.id, label: n.title, kind: toKind(n), graphKind: kindOf(n), ...(out ? { out: true } : {}) };
    });
  const total = nodes.length;
  const maxNodes = options.maxNodes ?? MAX_KNOWLEDGE_NODES;
  if (nodes.length > maxNodes) {
    // 範囲の外から落とし、それでも多ければ線の多いものを残す
    const degree = new Map<string, number>();
    for (const e of data.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    nodes = [...nodes]
      .sort((a, b) => Number(!!a.out) - Number(!!b.out) || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, maxNodes);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = data.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      kind: e.relation === "reference" ? "reference" : e.relation === "used" ? "used" : "derived",
    }));
  return {
    mode: "knowledge",
    title: folder ? `Knowledge graph — ${folder}` : "Knowledge graph",
    nodes,
    edges,
    ...(nodes.length < total ? { truncated: { shown: nodes.length, total } } : {}),
    ...(folder ? { folder } : {}),
    live: true,
  };
}
