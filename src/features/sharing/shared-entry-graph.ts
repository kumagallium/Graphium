// 共有エントリ 1 件を中心にした「隣接グラフ」の組み立て。
//
// なぜ逆引きタブと別に用意するか:
//   逆引き（ReverseLinksSection）は 引用 / 派生版 / テンプレート由来 を群ごとの
//   題名一覧で出す。読むには良いが、「自分の派生版がどれだけ広がったか」のような
//   量と繋がりは一覧では掴みにくい。同じ材料をもう 1 つの見方（図）で出す。
//
// note-shared-graph.ts と同じ流儀:
//   - React 非依存の純関数。投影（逆引き）と封筒（提案）を受け取って
//     NoteNode / NoteEdge を返すだけ。描くのは NetworkGraphPanel の担当
//   - ノード ID は "shared:<id>" / "proposal:<id>" の prefix 付き。
//     NetworkGraphPanel の tap ハンドラがこの prefix を見て
//     onOpenSharedEntry(<id>) を呼ぶので、prefix を外すと開けなくなる
//   - 共有エントリとの辺は破線（dashed）。手元のノートの実線と見分ける
//
// 中心ノードだけは sharedKind を付けない。isCurrent の見た目（緑・大きめ・実線）を
// そのまま使い、クリックしても何も起きない（NetworkGraphPanel が isCurrent で
// 早期 return する）ようにするため。

import type { NoteEdge, NoteNode } from "../network-graph/graph-builder";
import type { SharedEntry } from "../../lib/storage/shared";
import type { SharedReverseLinks } from "./shared-projection";
import { proposalEntriesFor, readProposalExtra } from "./share-proposal";

export type SharedEntryGraphData = {
  nodes: NoteNode[];
  edges: NoteEdge[];
  /** 中心を除いた隣接ノード数。0 のときは図を出さず案内文に切り替える */
  neighborCount: number;
};

export type SharedEntryGraphInput = {
  /** 中心に置く共有エントリの id */
  entryId: string;
  /** 中心ノードに出す題名 */
  entryTitle: string;
  /**
   * 投影から作った逆引き（buildReverseLinks の該当行）。
   * 未指定なら隣接は提案だけになる（本文をまだ読めていない状態）。
   */
  links?: SharedReverseLinks;
  /** 共有ライブラリの全エントリ。提案の抽出と、隣接の題名解決に使う */
  entries: readonly SharedEntry[];
  /**
   * 隣接ノードの題名解決。未指定なら封筒の extra.title、それも無ければ id。
   * 呼び出し側（UI）は sharedEntryTitle で「無題」まで面倒を見た関数を渡す。
   */
  titleOf?: (id: string) => string | null;
};

/** 封筒の extra.title を読む（無ければ null） */
function envelopeTitle(entries: readonly SharedEntry[], id: string): string | null {
  const entry = entries.find((e) => e.id === id);
  const title = (entry?.extra as { title?: unknown } | undefined)?.title;
  return typeof title === "string" && title.trim() ? title : null;
}

/**
 * 共有エントリを中心とした隣接グラフを組み立てる。
 *
 * 隣接に置くもの（逆引きタブと同じ材料）:
 *   - 来ている「変更の提案」   … 封筒から数える（proposalEntriesFor）
 *   - このエントリを引用している共有ノート（links.cites）
 *   - このエントリから派生した共有ノート（links.forks）
 *   - このテンプレートから作られた共有ノート（links.templates）
 *
 * エッジはどれも「隣接 → 中心」の向き。相手側がこのエントリを指している、
 * という逆引きの意味をそのまま辺の向きにしている。
 *
 * 同じ id が複数の群に出ることがある（引用もしていて派生でもある等）ので、
 * ノードも辺も 1 本目だけ残す —— NetworkGraphPanel は辺の id を
 * `source->target` で作るため、重複すると cytoscape 側で id が衝突する。
 */
export function buildSharedEntryGraph(input: SharedEntryGraphInput): SharedEntryGraphData {
  const { entryId, entryTitle, links, entries, titleOf } = input;
  const nodes: NoteNode[] = [];
  const edges: NoteEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  if (!entryId) return { nodes, edges, neighborCount: 0 };

  const centerId = `shared:${entryId}`;
  nodes.push({ id: centerId, title: entryTitle || entryId, isCurrent: true, hop: 0 });
  seenNodes.add(centerId);

  const addNeighbor = (
    nodeId: string,
    title: string,
    sharedKind: "shared" | "proposal",
    relation: NoteEdge["relation"],
  ): void => {
    if (!seenNodes.has(nodeId)) {
      seenNodes.add(nodeId);
      nodes.push({ id: nodeId, title, isCurrent: false, hop: 1, sharedKind });
    }
    const edgeKey = `${nodeId}->${centerId}`;
    if (seenEdges.has(edgeKey)) return;
    seenEdges.add(edgeKey);
    edges.push({ source: nodeId, target: centerId, relation, dashed: true });
  };

  // 提案は投影ではなく封筒から数える（逆引きタブと同じ理由 —— 本文を読めて
  // いなくても extra.target だけで何への提案か分かる）
  for (const proposal of proposalEntriesFor(entryId, entries)) {
    const extra = readProposalExtra(proposal);
    if (!extra) continue;
    const title = titleOf?.(proposal.id) ?? extra.title ?? "";
    addNeighbor(`proposal:${proposal.id}`, title || proposal.id, "proposal", "derived");
  }

  const groups: { ids: readonly string[]; relation: NoteEdge["relation"] }[] = [
    // 引用は参照、派生とテンプレート由来は派生
    { ids: links?.cites ?? [], relation: "reference" },
    { ids: links?.forks ?? [], relation: "derived" },
    { ids: links?.templates ?? [], relation: "derived" },
  ];
  for (const { ids, relation } of groups) {
    for (const id of ids) {
      // 自分自身は中心に既にいる（投影側でも弾いているが念のため）
      if (!id || id === entryId) continue;
      const title = titleOf?.(id) ?? envelopeTitle(entries, id) ?? id;
      addNeighbor(`shared:${id}`, title, "shared", relation);
    }
  }

  return { nodes, edges, neighborCount: nodes.length - 1 };
}
