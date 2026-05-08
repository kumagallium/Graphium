// 現在ノートを根として、上流方向（派生元）に PROV エッジを辿るリネージツリーを構築
// レイヤー2 PROV: derivedFromNoteId / noteLinks(derived_from) / wikiMeta.derivedFromNotes /
// wikiMeta.derivedFromConcepts / pdf:/url: 外部ソース
//
// メモリ memo: Layer1 (Document Provenance) は対象外。Layer2 のみ。

import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";

export type LineageNodeKind = "note" | "wiki" | "pdf" | "url";

export type LineageNode = {
  id: string;
  /** UI 上の表示タイトル */
  title: string;
  /** ナビゲーション用の正規化 ID（wiki 経路は "wiki:<id>"、外部ソースは null） */
  navId: string | null;
  isCurrent: boolean;
  kind: LineageNodeKind;
  /** 根（current）からの距離 */
  depth: number;
  /** この親に至った関係種別 */
  relations: LineageRelation[];
  /** 上流の親ノード群 */
  parents: LineageNode[];
  /** 巡回検出により打ち切ったか */
  cycle?: boolean;
  /** 外部リンク先 URL: PDF は CDN URL、URL は元 URL */
  externalUrl?: string;
};

export type LineageRelation =
  | "derivedFrom" // 子側 derivedFromNoteId
  | "noteLink" // 親側 noteLinks(derived_from)
  | "wiki" // wikiMeta.derivedFromNotes (wiki ← 通常ノート)
  | "wikiConcept" // wikiMeta.derivedFromConcepts (atom ← concept)
  | "external"; // pdf:/url: 外部ソース

const MAX_DEPTH = 10;

type ParentRef = { parentId: string; relation: LineageRelation };

/**
 * 親 → 子 の逆引きインデックスを 1 度だけ構築する
 * (子 noteId → その親候補 [ {parentId, relation} ])
 *
 * parentId は通常ノート / wiki の素 ID、または "pdf:<id>" / "url:<url>" の prefix 付き ID
 */
function buildReverseParentIndex(
  docs: Map<string, GraphiumDocument>,
  fileIds: Set<string>,
): Map<string, ParentRef[]> {
  const index = new Map<string, ParentRef[]>();
  const add = (childId: string, parentId: string, relation: LineageRelation) => {
    if (!fileIds.has(childId)) return;
    if (childId === parentId) return;
    // 内部ノード参照（pdf:/url: 以外）は fileIds に存在することを確認
    const isExternal = parentId.startsWith("pdf:") || parentId.startsWith("url:");
    if (!isExternal && !fileIds.has(parentId)) return;
    const list = index.get(childId) ?? [];
    list.push({ parentId, relation });
    index.set(childId, list);
  };

  for (const [docId, doc] of docs) {
    if (doc.derivedFromNoteId) {
      add(docId, doc.derivedFromNoteId, "derivedFrom");
    }
    if (doc.noteLinks) {
      for (const link of doc.noteLinks) {
        if (link.type === "derived_from") {
          add(link.targetNoteId, docId, "noteLink");
        }
      }
    }
    if (doc.source === "ai" && doc.wikiMeta?.derivedFromNotes) {
      for (const sourceId of doc.wikiMeta.derivedFromNotes) {
        // pdf:/url: は外部ソースとして扱う（fileIds チェックをスキップ）
        if (sourceId.startsWith("pdf:") || sourceId.startsWith("url:")) {
          add(docId, sourceId, "external");
        } else {
          add(docId, sourceId, "wiki");
        }
      }
    }
    // 通常ノートの top-level sourceUrl（url-to-prov 由来）→ 外部 URL 親
    if (doc.source !== "ai" && doc.sourceUrl) {
      add(docId, `url:${doc.sourceUrl}`, "external");
    }
    // 通常ノートの top-level sourcePdfFileId（pdf-to-prov 由来）→ PDF 親
    if (doc.source !== "ai" && doc.sourcePdfFileId) {
      add(docId, `pdf:${doc.sourcePdfFileId}`, "external");
    }
    if (
      doc.source === "ai" &&
      doc.wikiMeta?.kind === "atom" &&
      doc.wikiMeta?.derivedFromConcepts
    ) {
      for (const conceptId of doc.wikiMeta.derivedFromConcepts) {
        add(docId, conceptId, "wikiConcept");
      }
    }
  }
  return index;
}

export function buildLineageTree(
  currentNoteId: string | null,
  files: GraphiumFile[],
  docs: Map<string, GraphiumDocument>,
  mediaIndex: MediaIndex | null = null,
): LineageNode | null {
  if (!currentNoteId) return null;
  const currentDoc = docs.get(currentNoteId);
  if (!currentDoc) return null;

  const fileIds = new Set(files.map((f) => f.id));
  const fileNameMap = new Map<string, string>();
  for (const f of files) {
    fileNameMap.set(f.id, f.name.replace(/\.(graphium|provnote)\.json$/, ""));
  }
  const parentIndex = buildReverseParentIndex(docs, fileIds);

  const mediaByFileId = new Map<string, { name: string; url: string; type: string }>();
  const mediaByUrl = new Map<string, { name: string; url: string }>();
  if (mediaIndex) {
    for (const m of mediaIndex.media) {
      mediaByFileId.set(m.fileId, { name: m.name, url: m.url, type: m.type });
      if (m.type === "url") mediaByUrl.set(m.url, { name: m.name, url: m.url });
    }
  }

  const titleOfInternal = (id: string) =>
    docs.get(id)?.title ?? fileNameMap.get(id) ?? "(unknown)";
  const isWikiOf = (id: string) => docs.get(id)?.source === "ai";

  const buildNode = (id: string, depth: number, relations: LineageRelation[]): LineageNode => {
    if (id.startsWith("pdf:")) {
      const fileId = id.slice(4);
      const m = mediaByFileId.get(fileId);
      return {
        id,
        title: m?.name ?? `PDF ${fileId.slice(0, 8)}`,
        navId: null,
        isCurrent: false,
        kind: "pdf",
        depth,
        relations,
        parents: [],
        externalUrl: m?.url,
      };
    }
    if (id.startsWith("url:")) {
      const url = id.slice(4);
      const m = mediaByUrl.get(url);
      return {
        id,
        title: m?.name ?? url,
        navId: null,
        isCurrent: false,
        kind: "url",
        depth,
        relations,
        parents: [],
        externalUrl: url,
      };
    }
    const wiki = isWikiOf(id);
    return {
      id,
      title: titleOfInternal(id),
      navId: wiki ? `wiki:${id}` : id,
      isCurrent: id === currentNoteId,
      kind: wiki ? "wiki" : "note",
      depth,
      relations,
      parents: [],
    };
  };

  const visit = (id: string, depth: number, ancestors: Set<string>, relations: LineageRelation[]): LineageNode => {
    const baseNode = buildNode(id, depth, relations);
    if (baseNode.kind === "pdf" || baseNode.kind === "url") return baseNode;
    if (depth >= MAX_DEPTH) return baseNode;
    if (ancestors.has(id)) return { ...baseNode, cycle: true };

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);

    const rels = parentIndex.get(id) ?? [];
    const grouped = new Map<string, LineageRelation[]>();
    for (const { parentId, relation } of rels) {
      const arr = grouped.get(parentId) ?? [];
      if (!arr.includes(relation)) arr.push(relation);
      grouped.set(parentId, arr);
    }

    const parents: LineageNode[] = [];
    for (const [parentId, parentRelations] of grouped) {
      parents.push(visit(parentId, depth + 1, nextAncestors, parentRelations));
    }
    parents.sort((a, b) => a.title.localeCompare(b.title));
    baseNode.parents = parents;
    return baseNode;
  };

  return visit(currentNoteId, 0, new Set(), []);
}

/** ツリーに含まれる全ノード数（現在ノート含む） */
export function countLineageNodes(node: LineageNode | null): number {
  if (!node) return 0;
  let n = 1;
  for (const p of node.parents) n += countLineageNodes(p);
  return n;
}
