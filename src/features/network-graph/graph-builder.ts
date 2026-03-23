// ノート間の派生関係からネットワークグラフデータを構築
// 2ホップ以内の関係ノードを抽出

import type { ProvNoteDocument, ProvNoteFile } from "../../lib/google-drive";

export type NoteNode = {
  id: string;
  title: string;
  isCurrent: boolean;
  /** 現在ノートからのホップ数（0=自分, 1=直接, 2=2ホップ） */
  hop: number;
};

export type NoteEdge = {
  source: string;
  target: string;
  /** 引用元ブロックのテキスト（派生元ブロック内容） */
  sourceBlockLabel?: string;
};

export type NoteGraphData = {
  nodes: NoteNode[];
  edges: NoteEdge[];
};

/**
 * ドキュメント内のブロックからテキストを抽出する
 */
function extractBlockText(
  doc: ProvNoteDocument | undefined,
  blockId: string | undefined,
): string | undefined {
  if (!doc || !blockId) return undefined;
  const MAX_LEN = 30;

  // 全ページのブロックを再帰探索
  for (const page of doc.pages) {
    const text = findBlockText(page.blocks, blockId);
    if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
  }
  return undefined;
}

/** ブロック配列から指定IDのブロックを探してテキストを返す */
function findBlockText(blocks: any[], targetId: string): string | undefined {
  for (const block of blocks) {
    if (block.id === targetId) {
      // テキスト系ブロック
      if (Array.isArray(block.content)) {
        const text = block.content
          .map((c: any) => (c.type === "text" ? c.text : ""))
          .join("")
          .trim();
        if (text) return text;
      }
      return block.type ?? "";
    }
    // 子ブロックを再帰探索
    if (Array.isArray(block.children) && block.children.length > 0) {
      const found = findBlockText(block.children, targetId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * 全ノートの派生関係から2ホップのネットワークグラフを構築
 */
export function buildNoteGraph(
  currentNoteId: string | null,
  files: ProvNoteFile[],
  docs: Map<string, ProvNoteDocument>
): NoteGraphData {
  if (!currentNoteId) return { nodes: [], edges: [] };

  // 全エッジを収集（派生元 → 派生先の方向）
  const allEdges: NoteEdge[] = [];
  // 隣接リスト（双方向）
  const adjacency = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string, sourceBlockLabel?: string) => {
    allEdges.push({ source: from, target: to, sourceBlockLabel });
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  };

  // 存在するファイル ID のセット（孤児リンクを除外）
  const fileIds = new Set(files.map((f) => f.id));

  for (const [fileId, doc] of docs) {
    // derivedFromNoteId: このノートの親（存在チェック）
    if (doc.derivedFromNoteId && fileIds.has(doc.derivedFromNoteId)) {
      // 派生元ブロックのテキストを取得
      const blockLabel = extractBlockText(
        docs.get(doc.derivedFromNoteId),
        doc.derivedFromBlockId,
      );
      addEdge(doc.derivedFromNoteId, fileId, blockLabel);
    }
    // noteLinks: このノートの子（存在チェック）
    if (doc.noteLinks) {
      for (const link of doc.noteLinks) {
        if (fileIds.has(link.targetNoteId)) {
          const blockLabel = extractBlockText(doc, link.sourceBlockId);
          addEdge(fileId, link.targetNoteId, blockLabel);
        }
      }
    }
  }

  // BFS で2ホップ以内のノードを取得
  const hopMap = new Map<string, number>();
  hopMap.set(currentNoteId, 0);
  const queue = [currentNoteId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const currentHop = hopMap.get(nodeId)!;
    if (currentHop >= 2) continue;

    const neighbors = adjacency.get(nodeId);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!hopMap.has(neighbor)) {
        hopMap.set(neighbor, currentHop + 1);
        queue.push(neighbor);
      }
    }
  }

  // ファイル名マップ
  const fileNameMap = new Map<string, string>();
  for (const f of files) {
    fileNameMap.set(f.id, f.name.replace(/\.provnote\.json$/, ""));
  }

  // ノードを構築
  const nodeIds = new Set(hopMap.keys());
  const nodes: NoteNode[] = [];
  for (const [id, hop] of hopMap) {
    const title =
      docs.get(id)?.title ?? fileNameMap.get(id) ?? "不明なノート";
    nodes.push({
      id,
      title,
      isCurrent: id === currentNoteId,
      hop,
    });
  }

  // 関連エッジのみ抽出（両端が含まれるもの）
  const edges = allEdges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  // 重複エッジ除去
  const edgeSet = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    const key = `${e.source}->${e.target}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return { nodes, edges: uniqueEdges };
}
