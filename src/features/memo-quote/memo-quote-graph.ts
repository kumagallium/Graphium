// 近傍グラフ（右パネル「グラフ」→「近傍」）に、このノートが引用しているメモを足す純関数。
//
// ノードは既存の `memo:<captureId>`（external: "memo"、🗒️、クリックでメモのピーク）を使い、
// 線は `memo:<id>` → いまのノート（used）。note-shared-graph.ts と同じく、buildNoteGraph の結果へ
// 呼び出し側（NoteGraphTabPanel）が合成する。rebuildGraph の依存に captureIndex を入れずに済み、
// メモが増減しても即反映される。全体グラフ（buildGlobalGraph）は触らない。
//
// 入力は「いまのノートの memoQuotes（本文が正）」と captureIndex。
// - 本文にブロックが無い紐づけは出さない
// - ゴミ箱・完全削除のメモは出さない（アーカイブしたメモは参照が残るので出す）
// - 題はメモ本文の先頭 1 行を 40 字（buildMemoPeekEntry と同じ規則）

import type { MemoQuoteRef } from "../../lib/document-types";
import type { NoteEdge, NoteGraphData, NoteNode } from "../network-graph/graph-builder";
import type { CaptureIndex } from "../mobile-capture/capture-store";
import { buildMemoPeekEntry } from "../asset-browser/media-index";
import { findQuoteMemo, liveMemoQuoteEntries } from "./memo-quote";

export type MemoQuoteGraphInput = {
  /** いまのノートの紐づけ（blockId → 値） */
  memoQuotes: Record<string, MemoQuoteRef> | Map<string, MemoQuoteRef> | undefined | null;
  /** 本文にあるブロックの ID（無いブロックの紐づけを除くため） */
  liveBlockIds: ReadonlySet<string>;
  captureIndex: CaptureIndex | null | undefined;
};

/** メモのノード ID（graph-builder の既存規約 `memo:<captureId>`） */
export function memoNodeId(captureId: string): string {
  return `memo:${captureId}`;
}

/** 同じメモを複数のブロックで引用していても 1 ノードにまとめる。引用の新しい順は問わない */
export function buildMemoQuoteGraph(
  input: MemoQuoteGraphInput,
  noteNodeId: string,
): NoteGraphData {
  const nodes: NoteNode[] = [];
  const edges: NoteEdge[] = [];
  const seen = new Set<string>();
  for (const [, ref] of liveMemoQuoteEntries(input.memoQuotes, input.liveBlockIds)) {
    if (seen.has(ref.captureId)) continue;
    const memo = findQuoteMemo(input.captureIndex, ref.captureId);
    if (!memo || memo.deletedAt) continue;
    seen.add(ref.captureId);
    const id = memoNodeId(memo.id);
    nodes.push({
      id,
      title: buildMemoPeekEntry(memo).name,
      isCurrent: false,
      hop: 1,
      external: "memo",
    });
    edges.push({ source: id, target: noteNodeId, relation: "used" });
  }
  return { nodes, edges };
}

/**
 * buildNoteGraph の結果へメモの引用を足す。
 * - 既に同じ `memo:<id>` のノードがあれば（ナレッジ化の派生元など）増やさない。固定の仮の題
 *   "Memo" だけは実際の題に置き換える
 * - 同じ 2 点の線が既にあれば（グラフは向きを畳んで 1 本にする）足さない
 * - 足すものが無ければ data をそのまま返す（参照が変わらない）
 */
export function mergeMemoQuoteGraph(
  data: NoteGraphData,
  extra: NoteGraphData,
): NoteGraphData {
  if (extra.nodes.length === 0) return data;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const addNodes: NoteNode[] = [];
  const retitle = new Map<string, string>();
  for (const node of extra.nodes) {
    const existing = byId.get(node.id);
    if (!existing) addNodes.push(node);
    else if (existing.title === "Memo" && node.title !== "Memo") retitle.set(node.id, node.title);
  }
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const existingPairs = new Set(data.edges.map((e) => pairKey(e.source, e.target)));
  const addEdges = extra.edges.filter((e) => !existingPairs.has(pairKey(e.source, e.target)));
  if (addNodes.length === 0 && addEdges.length === 0 && retitle.size === 0) return data;
  return {
    nodes: [
      ...data.nodes.map((n) => (retitle.has(n.id) ? { ...n, title: retitle.get(n.id)! } : n)),
      ...addNodes,
    ],
    edges: [...data.edges, ...addEdges],
  };
}
