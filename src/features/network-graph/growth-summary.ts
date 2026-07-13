// Wiki（Knowledge）ノードの成長サマリ
// Layer 1（documentProvenance）の wiki_* 操作を集計し、lineage ツリーと
// 2 ホップグラフの hover ラベルに「どれだけ・どの操作で育ったか」を出すための
// 最小データを作る。フル docs が手に入る builder（buildLineageTree /
// buildNoteGraph）専用 — index しか持たない buildGlobalGraph では使えない。

import type { GraphiumDocument } from "../../lib/document-types";

/** wiki ノードの成長サマリ */
export type WikiGrowthSummary = {
  /** 生成後の成長操作（merge / cross-update / dedup-merge / regenerate / reinforce）の回数 */
  count: number;
  /** 最後の成長操作の種別（EditActivityType の wiki_*） */
  lastOp: string;
  /** 最後の成長操作の時刻（ISO） */
  lastAt: string;
};

/**
 * doc の編集来歴から成長サマリを集計する。
 * 「生成そのもの」（wiki_ingest / wiki_atomize）は数えず、生成後に育った操作だけを
 * 数える — 生成しただけの wiki にサマリを出してもノイズになるため。
 * 型は startsWith 判定なので、将来 wiki_* が増えても自動で拾う。
 */
export function summarizeWikiGrowth(
  doc: GraphiumDocument | undefined,
): WikiGrowthSummary | undefined {
  const activities = doc?.documentProvenance?.activities;
  if (!activities || activities.length === 0) return undefined;
  const growthOps = activities.filter(
    (a) =>
      a.type.startsWith("wiki_") &&
      a.type !== "wiki_ingest" &&
      a.type !== "wiki_atomize",
  );
  if (growthOps.length === 0) return undefined;
  const last = growthOps[growthOps.length - 1];
  return { count: growthOps.length, lastOp: last.type, lastAt: last.endedAt };
}
