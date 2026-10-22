// 来歴スタックビューのモデルを実データ（docs / processIndex / mediaIndex）から組み立てる純関数。
// 上流の経路は buildLineageTree の結果で決め、下流（子）は lineage-builder と同じ関係を
// 親 → 子の向きに 1 度だけ逆引きして作る。文言は呼び出し側（i18n）から labels で受け取る。

import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";
import { parseExternalSource } from "./external-source";
import type { LineageNode } from "./lineage-builder";
import { createCrossNoteOutputResolver, type ProcessIndex, type ProcessIndexEntry } from "./process-index";
import type {
  LineageStackModel,
  StackGroup,
  StackNode,
  StackOpenTarget,
  StackStep,
} from "./lineage-stack-model";

export type LineageStackLabels = {
  wholeNote: string;
  sources: string;
  groupMaterials: string;
  groupNotes: string;
  groupKnowledge: string;
  groupClaims: string;
  groupTopics: string;
};

export type BuildLineageStackInput = {
  currentId: string | null;
  tree: LineageNode | null;
  files: GraphiumFile[];
  docs: Map<string, GraphiumDocument>;
  mediaIndex: MediaIndex | null;
  processIndex: ProcessIndex | null;
  labels: LineageStackLabels;
};

export const VIRTUAL_ROOT_ID = "__sources__";
/** 1 箱に並べる札の上限 */
const GROUP_LIMIT = 20;
/** 1 段に並べる札の総数の上限（経路上の札は常に残す） */
const LEVEL_LIMIT = 60;
/** モデル全体のノード総数の上限（経路上のノードは超えても必ず含める） */
const NODE_LIMIT = 400;
const HEADING_MAX = 30;
const BODY_MAX = 120;
const OUTPUT_MAX = 6;
const SOURCES_MAX = 6;

// ── ブロック走査 ──

type AnyBlock = { id?: string; type?: string; content?: unknown; children?: AnyBlock[] };

/** インライン content の text を連結する（表 content などの配列でないものは空） */
function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content as { text?: unknown; content?: unknown }[]) {
    if (typeof item?.text === "string") out += item.text;
    else if (item?.content) out += inlineText(item.content);
  }
  return out;
}

/** 全ページのブロックを文書順に深さ優先でたどる */
function walkBlocks(doc: GraphiumDocument, visit: (b: AnyBlock) => void): void {
  const walk = (blocks: AnyBlock[] | undefined) => {
    if (!blocks) return;
    for (const b of blocks) {
      visit(b);
      walk(b.children);
    }
  };
  for (const page of doc.pages ?? []) walk(page.blocks as AnyBlock[]);
}

function truncate(text: string, max: number, ellipsis: boolean): string {
  return text.length > max ? text.slice(0, max) + (ellipsis ? "…" : "") : text;
}

type HeadingInfo = { key: string; text: string; order: number };

/** ブロック id → それを含む見出し（見出し自身は自分）。見出しの前にあるブロックは載らない */
function buildHeadingLookup(doc: GraphiumDocument): Map<string, HeadingInfo> {
  const lookup = new Map<string, HeadingInfo>();
  let current: HeadingInfo | null = null;
  let order = 0;
  walkBlocks(doc, (b) => {
    if (b.type === "heading" && b.id) {
      current = { key: `h:${b.id}`, text: truncate(inlineText(b.content).trim(), HEADING_MAX, true), order: order++ };
    }
    if (b.id && current) lookup.set(b.id, current);
  });
  return lookup;
}

/** 本文の先頭テキスト（見出し・段落の text を文書順に連結して 120 字） */
function bodyPreview(doc: GraphiumDocument | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  let len = 0;
  walkBlocks(doc, (b) => {
    if (len >= BODY_MAX) return;
    if (b.type !== "heading" && b.type !== "paragraph") return;
    const text = inlineText(b.content).trim();
    if (!text) return;
    parts.push(text);
    len += text.length + 1;
  });
  return parts.join(" ").slice(0, BODY_MAX);
}

// ── 逆引き（親 → 子） ──

type BoxSpec =
  | { type: "heading"; key: string; text: string; order: number }
  | { type: "whole" }
  | { type: "notes" }
  | { type: "claims" }
  | { type: "topics" };

type ChildEntry = { childId: string; box: BoxSpec };

const stripFileExt = (name: string) => name.replace(/\.(graphium|provnote)\.json$/, "");

export function buildLineageStack(input: BuildLineageStackInput): LineageStackModel | null {
  const { tree, files, docs, mediaIndex, processIndex, labels } = input;
  if (!tree) return null;
  const currentId = input.currentId ?? tree.id;

  const fileNameMap = new Map<string, string>();
  for (const f of files) fileNameMap.set(f.id, stripFileExt(f.name));

  const mediaByFileId = new Map<string, { name: string; url: string }>();
  const mediaByUrl = new Map<string, { name: string }>();
  for (const m of mediaIndex?.media ?? []) {
    mediaByFileId.set(m.fileId, { name: m.name, url: m.url });
    if (m.type === "url") mediaByUrl.set(m.url, { name: m.name });
  }

  const processByNote = new Map<string, ProcessIndexEntry>();
  for (const p of processIndex?.processes ?? []) processByNote.set(p.noteId, p);

  const isKnowledge = (id: string) => docs.get(id)?.source === "ai";

  // ── 上流: 頂点と経路 ──
  const pathToVertex = findFirstPath(tree);
  const vertices = collectVertices(tree);
  const pathSet = new Set<string>();

  let rootId: string;
  let initialPath: string[];
  const isVirtualRoot = vertices.length >= 2; // 頂点が複数あるときだけ仮想ルートを立てる
  if (isVirtualRoot) {
    rootId = VIRTUAL_ROOT_ID;
    initialPath = [VIRTUAL_ROOT_ID, ...pathToVertex];
  } else {
    // 頂点が 1 種類（または current 自身だけ）→ 最初に見つかった頂点を root にする
    initialPath = pathToVertex;
    rootId = pathToVertex[0];
  }
  for (const id of initialPath) pathSet.add(id);

  // ── 名前・種類・開く先の解決 ──
  const titleOf = (id: string): string => {
    const ext = parseExternalSource(id);
    if (ext?.kind === "pdf") return mediaByFileId.get(ext.key)?.name ?? `PDF ${ext.key.slice(0, 8)}`;
    if (ext?.kind === "document") return mediaByFileId.get(ext.key)?.name ?? `Document ${ext.key.slice(0, 8)}`;
    if (ext?.kind === "url") return mediaByUrl.get(ext.key)?.name ?? ext.key;
    if (ext?.kind === "chat") return "AI Chat";
    if (ext?.kind === "memo") return "Memo";
    if (ext) return id;
    return docs.get(id)?.title ?? fileNameMap.get(id) ?? "(unknown)";
  };

  const openOf = (id: string): StackOpenTarget | undefined => {
    const ext = parseExternalSource(id);
    if (ext) {
      if (ext.kind === "pdf" || ext.kind === "document") return { type: "media", fileId: ext.key };
      if (ext.kind === "url") return { type: "url", url: ext.key };
      if (ext.kind === "memo") return { type: "memo", captureId: ext.key };
      return undefined;
    }
    return { type: "note", navId: isKnowledge(id) ? `wiki:${id}` : id };
  };

  // ── 組み立て中のノード（fillBoxes / ensureNode から参照する） ──
  const nodes: Record<string, StackNode> = {};
  const queue: string[] = [];
  let nodeCount = 0;
  const resolveOutput = createCrossNoteOutputResolver(processIndex);

  // ── 下流: 逆引きインデックス（1 度だけ） ──
  const entriesByParent = new Map<string, ChildEntry[]>();
  const pushEntry = (parentId: string, childId: string, box: BoxSpec) => {
    if (parentId === childId) return;
    if (!docs.has(childId)) return; // ゴミ箱などで docs に無いノートは子にしない
    if (!parseExternalSource(parentId) && !docs.has(parentId)) return;
    const list = entriesByParent.get(parentId) ?? [];
    list.push({ childId, box });
    entriesByParent.set(parentId, list);
  };

  const headingLookups = new Map<string, Map<string, HeadingInfo>>();
  const boxOfBlock = (parentId: string, blockId: string | undefined): BoxSpec => {
    if (!blockId) return { type: "whole" };
    const parentDoc = docs.get(parentId);
    if (!parentDoc) return { type: "whole" };
    let lookup = headingLookups.get(parentId);
    if (!lookup) {
      lookup = buildHeadingLookup(parentDoc);
      headingLookups.set(parentId, lookup);
    }
    const h = lookup.get(blockId);
    if (!h || !h.text) return { type: "whole" };
    return { type: "heading", key: h.key, text: h.text, order: h.order };
  };

  for (const [docId, doc] of docs) {
    if (doc.derivedFromNoteId) {
      pushEntry(doc.derivedFromNoteId, docId, boxOfBlock(doc.derivedFromNoteId, doc.derivedFromBlockId));
    }
    for (const link of doc.noteLinks ?? []) {
      if (link.type === "derived_from") {
        pushEntry(docId, link.targetNoteId, boxOfBlock(docId, link.sourceBlockId));
      }
    }
    if (doc.source === "ai") {
      for (const src of doc.wikiMeta?.derivedFromNotes ?? []) {
        pushEntry(src, docId, { type: "claims" });
      }
      const kind = doc.wikiMeta?.kind;
      if (kind === "atom" || kind === "topic") {
        for (const c of doc.wikiMeta?.derivedFromClaims ?? []) pushEntry(c, docId, { type: "topics" });
      }
    } else {
      if (doc.sourceUrl) pushEntry(`url:${doc.sourceUrl}`, docId, { type: "notes" });
      if (doc.sourcePdfFileId) pushEntry(`pdf:${doc.sourcePdfFileId}`, docId, { type: "notes" });
    }
  }

  const boxLabel = (box: BoxSpec): string => {
    switch (box.type) {
      case "heading":
        return box.text;
      case "whole":
        return labels.wholeNote;
      case "notes":
        return labels.groupNotes;
      case "claims":
        return labels.groupClaims;
      case "topics":
        return labels.groupTopics;
    }
  };
  const boxKey = (box: BoxSpec): string => (box.type === "heading" ? box.key : box.type);
  const boxRank = (box: BoxSpec): number =>
    ({ heading: 0, whole: 1, notes: 2, claims: 3, topics: 4 })[box.type];

  /**
   * 箱の列を札にする。経路上の札は常に残し、残りは 1 箱 20・1 段 60・ノード総数 400 の
   * 予算内で title 順に採る。採れなかった分は箱の more に数える（予算が尽きた箱は children が空）
   */
  const fillBoxes = (boxes: { key: string; label: string; ids: string[] }[]): StackGroup[] => {
    let levelLeft = LEVEL_LIMIT - boxes.reduce((n, b) => n + b.ids.filter((id) => pathSet.has(id)).length, 0);
    return boxes.map(({ key, label, ids }) => {
      const sorted = [...ids].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
      const children: string[] = [];
      let inBox = sorted.filter((id) => pathSet.has(id)).length;
      for (const id of sorted) {
        if (pathSet.has(id)) {
          children.push(id);
        } else if (inBox < GROUP_LIMIT && levelLeft > 0 && (nodes[id] || nodeCount < NODE_LIMIT)) {
          children.push(id);
          inBox++;
          levelLeft--;
          ensureNode(id); // 採った時点で作る（総数の予算を即座に減らす）
        }
      }
      for (const id of children) ensureNode(id);
      const g: StackGroup = { key, label, children };
      if (sorted.length > children.length) g.more = sorted.length - children.length;
      return g;
    });
  };

  /** 親の子を箱に分ける（同じ子が複数の経路で来たら 1 つに。見出しの箱を優先） */
  const groupsOfParent = (parentId: string): StackGroup[] => {
    const entries = entriesByParent.get(parentId) ?? [];
    const byChild = new Map<string, BoxSpec>();
    for (const e of entries) {
      const prev = byChild.get(e.childId);
      if (!prev || (prev.type !== "heading" && e.box.type === "heading")) byChild.set(e.childId, e.box);
    }
    const boxes = new Map<string, { box: BoxSpec; ids: string[] }>();
    for (const [childId, box] of byChild) {
      const k = boxKey(box);
      const b = boxes.get(k) ?? { box, ids: [] };
      b.ids.push(childId);
      boxes.set(k, b);
    }
    const ordered = [...boxes.values()]
      .sort((a, b) => {
        const r = boxRank(a.box) - boxRank(b.box);
        if (r !== 0) return r;
        return a.box.type === "heading" && b.box.type === "heading" ? a.box.order - b.box.order : 0;
      })
      .map(({ box, ids }) => ({ key: boxKey(box), label: boxLabel(box), ids }));
    return fillBoxes(ordered);
  };

  // ── ノードの中身 ──
  const stepsOf = (entry: ProcessIndexEntry) =>
    entry.graph.steps.filter((s) => !s.externalOrigin && !s.noteRef);

  const procContent = (entry: ProcessIndexEntry): { steps: StackStep[]; outputs: string[] } => {
    const own = stepsOf(entry);
    const steps: StackStep[] = own.map((s) => {
      const froms: string[] = [];
      for (const link of entry.crossNoteLinks ?? []) {
        if (link.type !== "informed_by" || link.sourceBlockId !== s.id || !link.targetNoteId) continue;
        const resolved = link.targetEntityId
          ? resolveOutput({
              noteId: link.targetNoteId,
              sourceModifiedAt: link.targetSourceModifiedAt,
              stepId: link.targetBlockId,
              entityIdentity: link.targetEntityId,
              identityStable: link.targetEntityStable,
              outputIndex: link.targetEntityIndex,
              outputCount: link.targetEntityCount,
            })
          : null;
        const noteTitle = resolved?.noteTitle ?? link.targetNoteTitle ?? link.targetNoteId;
        const label = resolved?.label ?? link.targetEntityLabel ?? "";
        froms.push(label ? `${noteTitle} · ${label}` : noteTitle);
      }
      return froms.length > 0 ? { name: s.name, inputFrom: froms.join(" / ") } : { name: s.name };
    });

    const ownIds = new Set(own.map((s) => s.id));
    const entityById = new Map(entry.graph.entities.map((e) => [e.id, e]));
    const outputs: string[] = [];
    for (const edge of entry.graph.edges) {
      if (edge.kind !== "generates" || !ownIds.has(edge.source)) continue;
      const e = entityById.get(edge.target);
      if (!e || e.kind !== "output" || outputs.includes(e.label)) continue;
      outputs.push(e.label);
      if (outputs.length >= OUTPUT_MAX) break;
    }
    return { steps, outputs };
  };

  const sourcesOf = (doc: GraphiumDocument): string[] => {
    const ids = [...(doc.wikiMeta?.derivedFromNotes ?? []), ...(doc.wikiMeta?.derivedFromClaims ?? [])];
    const names: string[] = [];
    for (const id of ids) {
      const name = titleOf(id);
      if (!names.includes(name)) names.push(name);
      if (names.length >= SOURCES_MAX) break;
    }
    return names;
  };

  const makeNode = (id: string): StackNode => {
    const base = { id, title: titleOf(id), isCurrent: id === currentId, groups: [] as StackGroup[], links: [], open: openOf(id) };
    const ext = parseExternalSource(id);
    if (ext) return { ...base, kind: "asset" };
    const doc = docs.get(id);
    if (doc?.source === "ai") {
      const body = doc.wikiMeta?.evidenceSpan?.trim() || bodyPreview(doc);
      const node: StackNode = { ...base, kind: "knowledge", body: truncate(body, BODY_MAX, false) };
      const sources = sourcesOf(doc);
      if (sources.length > 0) node.sources = sources;
      return node;
    }
    const entry = processByNote.get(id);
    if (entry && stepsOf(entry).length > 0) {
      const { steps, outputs } = procContent(entry);
      return { ...base, kind: "proc", steps, outputs };
    }
    return { ...base, kind: "text", body: bodyPreview(doc) };
  };

  // ── BFS で root から組み立てる ──
  const ensureNode = (id: string) => {
    if (nodes[id]) return;
    nodeCount++;
    nodes[id] = makeNode(id);
    queue.push(id);
  };

  if (isVirtualRoot) {
    nodes[VIRTUAL_ROOT_ID] = {
      id: VIRTUAL_ROOT_ID,
      title: labels.sources,
      kind: "root",
      groups: vertexBoxes(vertices),
      links: [],
    };
  } else {
    ensureNode(rootId);
  }
  // 経路上のノードは子として列挙されなくても必ず nodes に入れる
  for (const id of initialPath) if (id !== VIRTUAL_ROOT_ID && !nodes[id]) ensureNode(id);

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const node = nodes[id];
    const onPath = pathSet.has(id);
    if (!onPath && nodeCount >= NODE_LIMIT) {
      // 上限超過: 子を持つのに展開しなかった印を残す（「派生なし」と取り違えさせない）
      if ((entriesByParent.get(id)?.length ?? 0) > 0) node.truncated = true;
      continue;
    }
    node.groups = groupsOfParent(id);
  }

  // 経路の次の札が箱に無ければ（docs 欠損など）ノートの箱に足して、その場に開けるようにする
  for (let i = 0; i < initialPath.length - 1; i++) {
    const parent = nodes[initialPath[i]];
    const next = initialPath[i + 1];
    if (!parent || !nodes[next]) continue;
    if (!parent.groups.some((g) => g.children.includes(next))) {
      const g = parent.groups.find((x) => x.key === "notes");
      if (g) g.children.push(next);
      else parent.groups.push({ key: "notes", label: labels.groupNotes, children: [next] });
    }
  }

  // 同じ段の札どうしの受け渡し（informed_by の参照元が同じ段にある）
  for (const node of Object.values(nodes)) {
    const siblings = new Set(node.groups.flatMap((g) => g.children));
    const seen = new Set<string>();
    for (const b of siblings) {
      for (const link of processByNote.get(b)?.crossNoteLinks ?? []) {
        const a = link.targetNoteId;
        if (link.type !== "informed_by" || !a || a === b || !siblings.has(a)) continue;
        const k = `${a}->${b}`;
        if (seen.has(k)) continue;
        seen.add(k);
        node.links.push({ from: a, to: b });
      }
    }
  }

  return { nodes, rootId, initialPath };

  // ── 内部ヘルパー（vertices / 分類） ──

  function vertexKind(id: string): "materials" | "notes" | "knowledge" {
    if (parseExternalSource(id)) return "materials";
    return isKnowledge(id) ? "knowledge" : "notes";
  }
  function vertexBoxes(ids: string[]): StackGroup[] {
    const defs = [
      { key: "materials", label: labels.groupMaterials },
      { key: "notes", label: labels.groupNotes },
      { key: "knowledge", label: labels.groupKnowledge },
    ];
    const out: { key: string; label: string; ids: string[] }[] = [];
    for (const d of defs) {
      const members = ids.filter((id) => vertexKind(id) === d.key);
      if (members.length === 0) continue;
      out.push({ key: d.key, label: d.label, ids: members });
    }
    return fillBoxes(out);
  }
}

// ── tree の走査（上流） ──

/** 頂点（親が無く cycle でない末端）の id を重複なしで集める */
function collectVertices(tree: LineageNode): string[] {
  const out: string[] = [];
  const visit = (n: LineageNode) => {
    if (n.cycle) return;
    if (n.parents.length === 0) {
      if (!out.includes(n.id)) out.push(n.id);
      return;
    }
    for (const p of n.parents) visit(p);
  };
  visit(tree);
  return out;
}

/** 最初に見つかった頂点から current までの経路（上から下の順）。 */
function findFirstPath(tree: LineageNode): string[] {
  const walk = (n: LineageNode, trail: string[]): string[] | null => {
    if (n.cycle) return null;
    const next = [n.id, ...trail];
    if (n.parents.length === 0) return next;
    for (const p of n.parents) {
      const found = walk(p, next);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []) ?? [tree.id];
}
