// 全体グラフの島（community）に「何の島か」を添えるための要約。
//
// 島は内容の近さではなく「同じ資料・知見でつながっている」まとまり（作業の系譜）
// なので、名前も推測で付けず、島の中で実際につながりの多いメンバーと、
// よく引かれている資料から取る（AI は使わない）。

import type { NoteGraphData, NoteNode } from "./graph-builder";
import { kindOf, type GraphKind } from "./graph-kind";
import { rankByCentroid } from "./content-islands";

export interface IslandMemberRef {
  id: string;
  title: string;
  isWiki: boolean;
  externalUrl?: string;
  /** 島の中で直接つながっている相手の数（衛星を含む）。代表・資料の並び順に使う */
  score: number;
}

export interface IslandSummary {
  /** community id（島配置の重心ダミーと同じ） */
  id: string;
  /** 島に属する全ノード id（中心の種類・その他・衛星）。件数に使う */
  memberIds: string[];
  /** 島の芯: 中心の種類と、それに畳まれた衛星。名前の位置と「この島に寄る」に使う
   *  （段ごとに広げた所属は島の外に置かれたノードも含むので、位置には使わない） */
  anchorIds: string[];
  /** 島の中心の種類（crystal なら話題）の件数 */
  focusCount: number;
  /** 島の中心の種類のうち、つながりの多い順（上限 maxRepresentatives） */
  representatives: IslandMemberRef[];
  /** 島に属する外部ソース（資料）のうち、島の中で引かれている数の多い順 */
  topSources: IslandMemberRef[];
  /** 種類ごとの件数（衛星を含む） */
  counts: Partial<Record<GraphKind, number>>;
  /** 代表の並べ方。links = 島の中のつながりの多い順、centroid = 内容の重心に近い順 */
  rankedBy: "links" | "centroid";
  /** 島ではなく「島の下に並べた資料とその周り」のまとめ（unislandedIds に資料があるとき 1 件だけ）。
   *  representatives は空、topSources にその資料を全件入れる */
  unislanded?: boolean;
}

/** 「どの島にも届かない資料」のまとめの id（community id と衝突しない値） */
export const UNISLANDED_ID = "__unislanded__";

/**
 * 島ごとの要約を作る。
 *
 * - 所属: `communities` に入っているノードはその島。入っていないノードは、直接
 *   隣接する所属済みノードの島の多数派（同数なら文字列順で小さい方）。これを段ごとに
 *   外へ広げる（話題 → 知見 → 知見の元のノート・資料）。畳んだ葉
 *   （`foldedInto`: 葉 → 親）は親の島。
 * - 島として扱うのは、中心の種類（`focusIds`）のメンバーが `minFocusMembers`
 *   以上あるもの（島配置が重心を置くのと同じ「2 以上」が既定）。
 * - 代表・資料の順位は「島の中で直接つながっている相手の数」。同数ならタイトル順。
 *   `topicVectors` を渡すと（内容の島）、代表だけは島の重心に近い順にする。
 * - 戻り値は島の大きさ（メンバー数）の多い順。`unislandedIds` に資料があれば、そのまとめを
 *   最後に 1 件足す。
 */
export function summarizeIslands(
  data: NoteGraphData,
  communities: Map<string, string>,
  opts: {
    focusIds: Set<string>;
    foldedOutNodes?: NoteNode[];
    foldedInto?: Map<string, string>;
    minFocusMembers?: number;
    maxRepresentatives?: number;
    maxSources?: number;
    /** 渡すと代表を「島の重心に近い順」にする（内容の島）。無ければつながりの多い順 */
    topicVectors?: ReadonlyMap<string, number[]> | null;
    /** 島の下に並べたノード（配置が話題から届かなかった資料とその知見など）。資料を含めば、
     *  最後に 1 件のまとめ（unislanded: true）として足す。島の所属とは別に、配置が
     *  実際に下へ並べた集合を使う（画面の一群と見出しの対象を一致させるため） */
    unislandedIds?: ReadonlySet<string> | null;
  },
): IslandSummary[] {
  const minFocus = opts.minFocusMembers ?? 2;
  const maxReps = opts.maxRepresentatives ?? 5;
  const maxSources = opts.maxSources ?? 5;
  const folded = opts.foldedOutNodes ?? [];
  const foldedInto = opts.foldedInto ?? new Map<string, string>();

  const nodeById = new Map<string, NoteNode>();
  for (const n of data.nodes) nodeById.set(n.id, n);
  for (const n of folded) if (!nodeById.has(n.id)) nodeById.set(n.id, n);

  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const e of data.edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    link(e.source, e.target);
    link(e.target, e.source);
  }
  // 衛星は親とだけつながっている扱い（畳む前の辺は消えているため）
  for (const [leaf, parent] of foldedInto) {
    if (!nodeById.has(leaf) || !nodeById.has(parent)) continue;
    link(leaf, parent);
    link(parent, leaf);
  }

  // 所属: community → 隣接の多数派を段ごとに外へ広げる（話題 → 知見 → ノート・資料）。
  // 各段は前の段までの所属だけを見る（同じ段の中で決めた所属に引きずられない）
  const islandOf = new Map<string, string>();
  for (const [id, c] of communities) if (nodeById.has(id)) islandOf.set(id, c);
  for (;;) {
    const decided = new Map<string, string>();
    for (const n of data.nodes) {
      if (islandOf.has(n.id)) continue;
      const counts = new Map<string, number>();
      for (const nb of adjacency.get(n.id) ?? []) {
        const c = islandOf.get(nb);
        if (c !== undefined) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      let best: string | undefined;
      let bestCount = 0;
      for (const c of [...counts.keys()].sort()) {
        const k = counts.get(c)!;
        if (k > bestCount) {
          best = c;
          bestCount = k;
        }
      }
      if (best !== undefined) decided.set(n.id, best);
    }
    if (decided.size === 0) break;
    for (const [id, c] of decided) islandOf.set(id, c);
  }
  for (const n of folded) {
    const parent = foldedInto.get(n.id);
    const c = parent ? islandOf.get(parent) : undefined;
    if (c !== undefined) islandOf.set(n.id, c);
  }

  const membersByIsland = new Map<string, string[]>();
  for (const [id, c] of islandOf) {
    const list = membersByIsland.get(c);
    if (list) list.push(id);
    else membersByIsland.set(c, [id]);
  }

  const ref = (id: string, score: number): IslandMemberRef => {
    const n = nodeById.get(id)!;
    return { id, title: n.title, isWiki: !!n.isWiki, externalUrl: n.externalUrl, score };
  };
  const byScoreThenTitle = (a: IslandMemberRef, b: IslandMemberRef) =>
    b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

  const result: IslandSummary[] = [];
  for (const [islandId, memberIds] of membersByIsland) {
    const focusMembers = memberIds.filter((id) => opts.focusIds.has(id));
    if (focusMembers.length < minFocus) continue;
    const focusSet = new Set(focusMembers);
    const inIsland = (id: string) => islandOf.get(id) === islandId;
    const innerDegree = (id: string) => {
      // 同じ相手との重複辺は 1 回だけ数える
      const seen = new Set<string>();
      for (const nb of adjacency.get(id) ?? []) if (inIsland(nb)) seen.add(nb);
      return seen.size;
    };
    const counts: Partial<Record<GraphKind, number>> = {};
    const sources: IslandMemberRef[] = [];
    for (const id of memberIds) {
      const kind = kindOf(nodeById.get(id)!);
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (kind === "external") sources.push(ref(id, innerDegree(id)));
    }
    result.push({
      id: islandId,
      memberIds,
      anchorIds: [
        ...focusMembers,
        ...folded.filter((n) => focusSet.has(foldedInto.get(n.id) ?? "")).map((n) => n.id),
      ],
      focusCount: focusMembers.length,
      representatives: (opts.topicVectors
        ? rankByCentroid(focusMembers, opts.topicVectors).map((id) => ref(id, innerDegree(id)))
        : focusMembers.map((id) => ref(id, innerDegree(id))).sort(byScoreThenTitle)
      ).slice(0, maxReps),
      rankedBy: opts.topicVectors ? "centroid" : "links",
      topSources: sources.sort(byScoreThenTitle).slice(0, maxSources),
      counts,
    });
  }
  result.sort((a, b) => b.memberIds.length - a.memberIds.length || a.id.localeCompare(b.id));

  // 島の下に並べた資料とその周り（知見・衛星）。島の名前より後に置くので、重なれば
  // 島の名前が優先される
  const looseSet = opts.unislandedIds;
  if (looseSet && looseSet.size > 0) {
    const loose = [
      ...[...looseSet].filter((id) => nodeById.has(id)),
      ...folded.filter((n) => !looseSet.has(n.id) && looseSet.has(foldedInto.get(n.id) ?? "")).map((n) => n.id),
    ];
    const looseSources = loose.filter((id) => kindOf(nodeById.get(id)!) === "external");
    if (looseSources.length > 0) {
      const degree = (id: string) => new Set(adjacency.get(id) ?? []).size;
      const counts: Partial<Record<GraphKind, number>> = {};
      for (const id of loose) {
        const kind = kindOf(nodeById.get(id)!);
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
      result.push({
        id: UNISLANDED_ID,
        memberIds: loose,
        anchorIds: loose,
        focusCount: 0,
        representatives: [],
        rankedBy: "links",
        topSources: looseSources.map((id) => ref(id, degree(id))).sort(byScoreThenTitle),
        counts,
        unislanded: true,
      });
    }
  }
  return result;
}
