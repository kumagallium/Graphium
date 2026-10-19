import type cytoscape from "cytoscape";
import type { NoteNode } from "./graph-builder";

/**
 * 全体グラフの「絞り込み」をその場で適用する（組み直し・並べ直しなし）。
 *
 * 以前は、検索は対象以外を薄くし、フォルダは対象だけでグラフを作り直していた。
 * 薄くすると薄いノードが残ってごちゃつき、作り直すと 1 操作ごとに物理配置が
 * 走り直して重かった。ここでは配置はそのまま、一致しないノードを描かない
 * （`filtered-out` クラス → display: none。端点が消えた辺は Cytoscape が描かない）。
 *
 * - 一致（主役）: 検索はタイトル（fullLabel）の部分一致、フォルダは選んだフォルダの
 *   ノート。両方あれば両方を満たすもの。`search-hit`（琥珀の枠、Enter で巡回）
 * - 周辺（文脈）: 一致したノードから本物の辺で 1 ホップ。`filter-context` で少し薄く
 *   描く。一致だけ残すと点になって関係が読めないので、何とつながるかを残す。
 *   周辺に触れる辺も `filter-context`。表示中のノード同士の辺はすべて描かれる
 * - 未分類を隠す: フォルダを持てるのに付いていない通常ノートは、主役にも周辺にもしない
 * - 不可視の重心ダミー（cluster-hub）と射影の辺は辿らない・触らない
 */
export type GraphFilter = {
  query: string;
  /** 小文字キー。空なら絞らない */
  contexts: ReadonlySet<string>;
  hideUncategorized: boolean;
};

export type GraphFilterResult = {
  /** 描かれているノード数（周辺を含む） */
  visible: number;
  /** 検索に一致したノード数（検索が空なら 0） */
  hits: number;
};

export function applyGraphFilter(
  cy: cytoscape.Core,
  nodes: readonly NoteNode[],
  filter: GraphFilter,
): GraphFilterResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const q = filter.query.trim().toLowerCase();
  const useFolders = filter.contexts.size > 0;
  const nodeHasFolder = (n: NoteNode) => (n.noteContexts ?? []).some((c) => filter.contexts.has(c.toLowerCase()));
  const canHaveFolder = (n: NoteNode) => !n.external && !n.isWiki;
  const isUncategorized = (n: NoteNode) => canHaveFolder(n) && (n.noteContexts ?? []).length === 0;

  // 件数に数えるのは実ノードだけ（不可視の重心ダミーと、畳んだ葉の衛星は除く。
  // 衛星は「全体」の側でも −n として畳まれている）
  const countable = (el: cytoscape.NodeSingular) => !el.hasClass("cluster-hub") && !el.data("satellite");
  cy.elements().removeClass("filtered-out search-hit filter-context");
  if (!q && !useFolders && !filter.hideUncategorized) {
    return { visible: cy.nodes().filter(countable).length, hits: 0 };
  }
  const realEdges = (el: cytoscape.NodeSingular) =>
    el.connectedEdges().filter((e) => !e.hasClass("cluster-edge") && !e.data("virtual"));

  // 1) 主役: 検索・フォルダの条件を満たすノード（未分類を隠すなら未分類は除く）
  const matched = new Set<string>();
  cy.nodes().forEach((el) => {
    if (el.hasClass("cluster-hub")) return;
    const n = byId.get(el.id());
    if (filter.hideUncategorized && n && isUncategorized(n)) return;
    const label = String(el.data("fullLabel") ?? "").toLowerCase();
    if (q && !label.includes(q)) return;
    if (useFolders && !(n && nodeHasFolder(n))) return;
    matched.add(el.id());
  });

  // 2) 周辺: 主役から本物の辺で 1 ホップ（未分類を隠すなら未分類は入れない）
  const context = new Set<string>();
  if (q || useFolders) {
    for (const id of matched) {
      realEdges(cy.getElementById(id))
        .connectedNodes()
        .forEach((m) => {
          if (matched.has(m.id()) || m.hasClass("cluster-hub")) return;
          const n = byId.get(m.id());
          if (filter.hideUncategorized && n && isUncategorized(n)) return;
          context.add(m.id());
        });
    }
  } else {
    // 「未分類を隠す」だけのときは、未分類以外を全部残す（周辺という概念は無い）
  }

  let visible = 0;
  let hits = 0;
  cy.nodes().forEach((el) => {
    if (el.hasClass("cluster-hub")) return;
    const id = el.id();
    if (matched.has(id)) {
      if (countable(el)) {
        visible++;
        if (q) hits++;
      }
      if (q) el.addClass("search-hit");
    } else if (context.has(id)) {
      if (countable(el)) visible++;
      el.addClass("filter-context");
    } else {
      el.addClass("filtered-out");
    }
  });
  // 周辺に触れる辺も薄く（主役どうしの辺はそのまま）
  cy.edges().forEach((e) => {
    if (e.hasClass("cluster-edge") || e.data("virtual")) return;
    if (context.has(e.source().id()) || context.has(e.target().id())) e.addClass("filter-context");
  });
  return { visible, hits };
}
