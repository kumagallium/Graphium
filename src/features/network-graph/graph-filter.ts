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
 * - 検索: タイトル（fullLabel）の部分一致。一致したノードに `search-hit`（Enter で巡回）
 * - フォルダ: 選んだフォルダのノート。フォルダを持てない知見・原料は、残るノートに
 *   直接つながるものだけ残す（作り直し方式と同じ意味）
 * - 未分類を隠す: フォルダを持てるのに付いていない通常ノートを消す
 * - 不可視の重心ダミー（cluster-hub）は触らない
 */
export type GraphFilter = {
  query: string;
  /** 小文字キー。空なら絞らない */
  contexts: ReadonlySet<string>;
  hideUncategorized: boolean;
};

export type GraphFilterResult = {
  /** 描かれているノード数 */
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

  // 件数に数えるのは実ノードだけ（不可視の重心ダミーと、畳んだ葉の衛星は除く。
  // 衛星は「全体」の側でも −n として畳まれている）
  const countable = (el: cytoscape.NodeSingular) => !el.hasClass("cluster-hub") && !el.data("satellite");
  cy.elements().removeClass("filtered-out search-hit");
  if (!q && !useFolders && !filter.hideUncategorized) {
    return { visible: cy.nodes().filter(countable).length, hits: 0 };
  }

  // 1) フォルダ: まず「フォルダを持つノート」を決め、持てないノードはその隣接で残す
  const folderKeep = new Set<string>();
  if (useFolders) {
    cy.nodes().forEach((el) => {
      const n = byId.get(el.id());
      if (n && nodeHasFolder(n)) folderKeep.add(el.id());
    });
    cy.nodes().forEach((el) => {
      const n = byId.get(el.id());
      if (!n || canHaveFolder(n)) return;
      const nb = el
        .connectedEdges()
        .filter((e) => !e.hasClass("cluster-edge") && !e.data("virtual"))
        .connectedNodes();
      if (nb.toArray().some((m) => folderKeep.has(m.id()))) folderKeep.add(el.id());
    });
  }

  let visible = 0;
  let hits = 0;
  cy.nodes().forEach((el) => {
    if (el.hasClass("cluster-hub")) return;
    const n = byId.get(el.id());
    const label = String(el.data("fullLabel") ?? "").toLowerCase();
    const matchQuery = !q || label.includes(q);
    const matchFolder = !useFolders || folderKeep.has(el.id());
    const matchUncat = !filter.hideUncategorized || !n || !canHaveFolder(n) || (n.noteContexts ?? []).length > 0;
    if (matchQuery && matchFolder && matchUncat) {
      if (countable(el)) visible++;
      if (q) {
        if (countable(el)) hits++;
        el.addClass("search-hit");
      }
    } else {
      el.addClass("filtered-out");
    }
  });
  return { visible, hits };
}
