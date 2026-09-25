// NoteNode から「kind」を判定する共通ロジック。
//
// global-graph-view.tsx（表示）と global-graph-structure.ts（構造の純関数）の両方が
// 使うため、どちらにも属さない小さなモジュールに切り出す。global-graph-view.tsx が
// export する kindOf を global-graph-structure.ts が import すると循環依存になる
// （lint:deps の no-circular に引っかかる）ため、ここに一本化する。

import type { NoteNode } from "./graph-builder";

export type GraphKind = "external" | "note" | "summary" | "claim" | "atom" | "synthesis" | "topic";

/** NoteNode から kind を判定する。 */
export function kindOf(n: NoteNode): GraphKind {
  if (n.external) return "external";
  if (n.isWiki) {
    const k = n.wikiKind;
    if (k === "claim" || k === "atom" || k === "synthesis" || k === "topic") return k;
    // 撤退済み / 未知の wikiKind（旧 meta-atom 等）は synthesis（統合）扱いにフォールバック。
    // ここで GraphKind 外の値を返すと KIND_LAYER 引きが undefined になり、層フィルタで
    // 常に弾かれて silent に消える（meta-atom が見えなかった原因）。
    // 注: summary は buildGlobalGraph 側でグラフから除外済みなのでここには来ない。
    return "synthesis";
  }
  return "note";
}
