// 一覧（ノート・ナレッジ）の「参照先」「被参照」「派生」の数え方
//
// ページ同士の関係は 2 種類ある。
//   - もと・派生: そのページを何から作ったか（wikiMeta.derivedFromNotes / derivedFromClaims）。
//     知見はノートから、洞察とトピックは知見や資料から作る
//   - 参照: 本文から張ったリンク（@ など）
// ナレッジの本文は出典として「もと」へ必ずリンクするので、参照をそのまま数えると、もと・派生と
// 同じ数字が参照先・被参照にも並ぶ。ここでは「もと・派生の関係は参照先・被参照に数えない」の
// 1 つの規則で、ノート一覧とナレッジ一覧の両方の数字を出す（一覧ごとに別々に数えると、同じ
// 「被参照」という列名で中身の違う数字になる）。
//
// どの数も相手のページの数（同じ相手を本文で何度引いても 1）。自分自身へのリンクは数えない。

import type { GraphiumIndex } from "./index-file";

export interface PageLinkCounts {
  /** 参照先: このページの本文からリンクしているページの数（もとを除く） */
  outgoing: number;
  /** 被参照: このページへ本文からリンクしているページの数（このページから作ったページを除く） */
  incoming: number;
  /** 派生: このページをもとに作られたページの数 */
  derived: number;
}

const EMPTY: PageLinkCounts = { outgoing: 0, incoming: 0, derived: 0 };

/**
 * 索引からページごとの数を作る。
 * extraUpstream は、索引とは別に持っている「もと」の一覧（ナレッジ一覧が読み込み済みの
 * wikiMeta.derivedFromClaims など）。索引の値と合わせて使う
 */
export function buildLinkCounts(
  index: GraphiumIndex | null,
  extraUpstream?: ReadonlyMap<string, readonly string[]>,
): Map<string, PageLinkCounts> {
  const counts = new Map<string, PageLinkCounts>();
  if (!index) return counts;
  const at = (id: string): PageLinkCounts => {
    let c = counts.get(id);
    if (!c) {
      c = { outgoing: 0, incoming: 0, derived: 0 };
      counts.set(id, c);
    }
    return c;
  };
  for (const entry of index.notes) {
    const upstream = new Set<string>([
      ...(entry.derivedFromNotes ?? []),
      ...(entry.derivedFromClaims ?? []),
      ...(extraUpstream?.get(entry.noteId) ?? []),
    ]);
    upstream.delete(entry.noteId);
    const targets = new Set<string>();
    for (const link of entry.outgoingLinks ?? []) {
      const target = link.targetNoteId;
      if (!target || target === entry.noteId || upstream.has(target)) continue;
      targets.add(target);
    }
    at(entry.noteId).outgoing = targets.size;
    for (const target of targets) at(target).incoming += 1;
    for (const source of upstream) at(source).derived += 1;
  }
  return counts;
}

/** 索引に無いページ（数がまだ無い）は全部 0 として読む */
export function linkCountsOf(counts: ReadonlyMap<string, PageLinkCounts>, noteId: string): PageLinkCounts {
  return counts.get(noteId) ?? EMPTY;
}
