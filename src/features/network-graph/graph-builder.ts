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
};

export type NoteGraphData = {
  nodes: NoteNode[];
  edges: NoteEdge[];
};

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

  const addEdge = (from: string, to: string) => {
    allEdges.push({ source: from, target: to });
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  };

  for (const [fileId, doc] of docs) {
    // derivedFromNoteId: このノートの親
    if (doc.derivedFromNoteId) {
      addEdge(doc.derivedFromNoteId, fileId);
    }
    // noteLinks: このノートの子
    if (doc.noteLinks) {
      for (const link of doc.noteLinks) {
        addEdge(fileId, link.targetNoteId);
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
