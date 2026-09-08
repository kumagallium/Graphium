// ノート周辺グラフ（network-graph）に足す「共有ライブラリ由来ノード」の組み立て。
// §25b F 節: forkedFrom（派生元）と、このノートの共有コピーに来ている提案を
// グラフ上に出す。React 非依存の純関数で、NoteNode / NoteEdge の形に整えるだけ
// （実際に既存の buildNoteGraph の結果とマージして NetworkGraphPanel に渡すのは
// 呼び出し側 = note-app 側の役目）。
//
// ノード ID は手元のノート ID 空間と衝突しないよう "shared:<id>" / "proposal:<id>"
// の prefix を付ける（buildNoteGraph の pdf:/url:/media: 等と同じ作法）。
// 全体グラフ（buildGlobalGraph）には出さない — 共有側のノードは手元のノート ID
// 空間に無いため、まずノート周辺だけに留める（仕様書の決定どおり）。

import type { GraphiumDocument } from "../../lib/document-types";
import type { NoteEdge, NoteNode } from "../network-graph/graph-builder";
import type { SharedEntry } from "../../lib/storage/shared";
import { proposalEntriesFor, readProposalExtra } from "./share-proposal";

export type NoteSharedGraphData = {
  nodes: NoteNode[];
  edges: NoteEdge[];
};

/** entries から id で共有エントリを探し、extra.title を読む（無ければ undefined）。 */
function titleOf(entries: readonly SharedEntry[], id: string): string | undefined {
  const entry = entries.find((e) => e.id === id);
  const title = (entry?.extra as { title?: unknown } | undefined)?.title;
  return typeof title === "string" && title ? title : undefined;
}

/**
 * ノート周辺グラフに足す共有ライブラリ由来のノード・エッジを組み立てる。
 *
 * - 派生元（doc.forkedFrom）があれば "shared" ノードを 1 つ足し、
 *   `ノート → shared ノード` の破線エッジを張る（派生 = derived 方向）。
 * - このノート自身が共有エントリを持つ（doc.sharedRef）場合、そのエントリへの
 *   提案（entries 中の type "proposal" で extra.target が一致するもの）を
 *   "proposal" ノードとして足し、`proposal ノード → ノート` の破線エッジを張る。
 *
 * @param doc       いま開いているノートの最新本文（forkedFrom / sharedRef を読む）
 * @param noteId    このノートの ID（エッジの端点に使う）
 * @param entries   共有ライブラリの全エントリ（Library ストアが持つもの）
 */
export function buildNoteSharedGraph(
  doc: Pick<GraphiumDocument, "forkedFrom" | "sharedRef">,
  noteId: string,
  entries: readonly SharedEntry[],
): NoteSharedGraphData {
  const nodes: NoteNode[] = [];
  const edges: NoteEdge[] = [];

  if (doc.forkedFrom?.sharedId) {
    const sharedId = doc.forkedFrom.sharedId;
    const nodeId = `shared:${sharedId}`;
    nodes.push({
      id: nodeId,
      title: titleOf(entries, sharedId) ?? doc.forkedFrom.authorName ?? sharedId,
      isCurrent: false,
      hop: 1,
      sharedKind: "shared",
    });
    edges.push({ source: noteId, target: nodeId, relation: "derived", dashed: true });
  }

  const ownSharedId = doc.sharedRef?.id;
  if (ownSharedId) {
    for (const proposal of proposalEntriesFor(ownSharedId, entries)) {
      const extra = readProposalExtra(proposal);
      if (!extra) continue;
      const nodeId = `proposal:${proposal.id}`;
      nodes.push({
        id: nodeId,
        title: extra.title || extra.targetTitle || proposal.id,
        isCurrent: false,
        hop: 1,
        sharedKind: "proposal",
      });
      edges.push({ source: nodeId, target: noteId, relation: "derived", dashed: true });
    }
  }

  return { nodes, edges };
}
