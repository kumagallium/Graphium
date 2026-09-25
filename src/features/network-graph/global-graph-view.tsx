// 全ノードグラフ（Obsidian 風グローバルグラフ）の本番ビュー。
//
// buildGlobalGraph が返す NoteGraphData を描画する。サイドバーの「全体グラフ」から
// 全画面オーバーレイ（GlobalGraphOverlay）で開く想定。
//
// 見た目は Storybook（global-graph.stories.tsx）で合意したもの:
//   - ノード色 = kind（external / note / summary / claim / atom / synthesis）
//   - エッジ線種 = relation（derived=実線緑 / used=実線グレー / reference=破線青）
//   - レイアウト切替（有機的 force ⇄ 列）。列モードでは参照（破線）を既定で隠す。
// 配色は knowledge-colors.ts と 2 ホップグラフ（view.tsx）に合わせている。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { RotateCcw, Search, Network, Waypoints } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { knowledgeKindColor, knowledgeKindBorder } from "./knowledge-colors";
import { openExternalUrl } from "../../lib/external-link";
import { aggregateNoteContexts, noteContextHue } from "../note-context/context-tags";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { useT } from "../../i18n";
import type { NoteNode, NoteGraphData, NoteEdge, EdgeRelation } from "./graph-builder";
import {
  computeReachScores,
  computeTopicReachScores,
  computeFocusFoldResult,
  detectFocusCommunities,
  analyzeCrystalIslands,
  isFocused,
  type FocusLayer,
} from "./global-graph-structure";
import { globalGraphScope } from "./graph-layout";
import { useGraphDataKey, useGraphRenderKey, useGraphStructureKey } from "./graph-identity";
import { GraphSelectionHint } from "./GraphSelectionHint";
import {
  GRAPH_BG_COLOR,
  GRAPH_INIT_OPTIONS,
  baseEdgeStyle,
  baseNodeStyle,
  hoverFullLabelStyle,
  interactionStyles,
} from "./graph-theme";
import {
  applySavedPositions,
  attachCytoscapeLayoutPersistence,
  attachSelectionBoundsOverlay,
  seedUnplacedNodes,
  stopLayoutOnGrab,
  useGraphCarryOver,
  useGraphLayout,
} from "./use-graph-layout";
import { listSearchInputProps } from "@/hooks/use-list-search-hotkey";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

// ── kind / 層 ──

// kind 判定（kindOf）は graph-kind.ts に切り出してある。global-graph-structure.ts
// もそこから使う（このファイルから export すると global-graph-structure.ts との
// 循環依存になり lint:deps の no-circular に引っかかるため）。
export type { GraphKind } from "./graph-kind";
export { kindOf } from "./graph-kind";
import type { GraphKind } from "./graph-kind";
import { kindOf } from "./graph-kind";

type LayerId = "source" | "note" | "crystal" | "synth";

const KIND_LAYER: Record<GraphKind, LayerId> = {
  external: "source",
  note: "note",
  claim: "crystal",
  atom: "crystal",
  topic: "crystal",
  summary: "synth",
  synthesis: "synth",
};

// 表示する層は 原料 → ノート → 結晶(claim/atom) の 3 つ。
// 統合(synth)層は撤退済み kind（summary/synthesis/meta-atom）専用だったが、
// それらを buildGlobalGraph で除外したので層自体を廃止する。
const ALL_LAYERS: LayerId[] = ["source", "note", "crystal"];

/**
 * 層フィルタ・参照フィルタ・文脈タグ絞り込み・孤立ノード除外を適用したサブグラフを返す。
 * オーバーレイ（件数表示）とキャンバス（描画）で同じ結果を使うため切り出している。
 *
 * hideIsolated: 実データではリンクの無いノートが大半を占める（Obsidian と同じ）。
 *   既定で孤立ノードを隠すと、連結した「網」だけが残って俯瞰しやすくなる。
 *
 * contextFilter: 文脈タグ（noteContexts）の小文字キー集合。空/未指定なら絞り込まない。
 *   選択タグを持つノートに加え「タグを持たない隣接ノード」（素材・知見・未分類）も残す —
 *   実験 A に絞ったときにその素材や生まれた知見は一緒に見え、別タグの実験 B は消える。
 *
 * hideUncategorized: 未分類（タグを持てるのにタグ無しの通常ノート）を消す。
 *   external / wiki は「文脈を持たせられない」層であって未分類とは別物なので対象外
 *   （ContextLegend の未分類カウントと同じ定義）。contextFilter の「タグ無し隣接を
 *   残す」ルールより優先される（明示的に消すと言っているため）。
 *
 * hideAtoms: 設定の features.insights（「洞察を使う」）が OFF のとき、Atom ノードを
 *   結晶(crystal)層から間引く。claim と atom は同じ層（KIND_LAYER）を共有していて
 *   層フィルタでは分離できないため、kind で個別に弾く。
 */
export function filterGlobalGraph(
  data: NoteGraphData,
  opts: {
    visibleLayers: Set<LayerId>;
    hideReferences?: boolean;
    hideIsolated?: boolean;
    contextFilter?: Set<string>;
    hideUncategorized?: boolean;
    hideAtoms?: boolean;
  },
): NoteGraphData {
  const {
    visibleLayers,
    hideReferences = false,
    hideIsolated = false,
    contextFilter,
    hideUncategorized = false,
    hideAtoms = false,
  } = opts;
  const visibleIds = new Set(
    data.nodes
      .filter((n) => visibleLayers.has(KIND_LAYER[kindOf(n)]))
      .filter((n) => !(hideAtoms && kindOf(n) === "atom"))
      .map((n) => n.id),
  );
  let edges = data.edges.filter(
    (e) =>
      visibleIds.has(e.source) &&
      visibleIds.has(e.target) &&
      !(hideReferences && e.relation === "reference"),
  );
  let nodes = data.nodes.filter((n) => visibleIds.has(n.id));
  if (contextFilter && contextFilter.size > 0) {
    const hasSelectedTag = (n: NoteNode) =>
      (n.noteContexts ?? []).some((c) => contextFilter.has(c.toLowerCase()));
    const taggedIds = new Set(nodes.filter(hasSelectedTag).map((n) => n.id));
    const neighborIds = new Set<string>();
    for (const e of edges) {
      if (taggedIds.has(e.source)) neighborIds.add(e.target);
      if (taggedIds.has(e.target)) neighborIds.add(e.source);
    }
    nodes = nodes.filter((n) => {
      if (taggedIds.has(n.id)) return true;
      if (!neighborIds.has(n.id)) return false;
      // タグを持たない隣接（素材・知見・未分類）は残し、別タグのノートは消す
      return (n.noteContexts ?? []).length === 0;
    });
    const kept = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  }
  if (hideUncategorized) {
    nodes = nodes.filter(
      (n) => n.external || n.isWiki || (n.noteContexts && n.noteContexts.length > 0),
    );
    const kept = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  }
  if (hideIsolated) {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  return { nodes, edges };
}

// ── 配色（knowledge-colors.ts と view.tsx に一致） ──

const NOTE_FILL = "#5b8fb9";
const NOTE_BORDER = "#4a7da6";
const EXT_FILL = "#9aa0a6";
const EXT_BORDER = "#6e7378";

function kindFill(kind: GraphKind): string {
  if (kind === "note") return NOTE_FILL;
  if (kind === "external") return EXT_FILL;
  return knowledgeKindColor(kind);
}
function kindBorder(kind: GraphKind): string {
  if (kind === "note") return NOTE_BORDER;
  if (kind === "external") return EXT_BORDER;
  return knowledgeKindBorder(kind);
}

// ── 文脈タグ色モード ──
//
// 色 = 文脈タグ（noteContextHue の名前ハッシュ、ContextBadge と同系統）、形 = kind のまま。
// 種類の情報は形状（ellipse/round-rect/diamond）で残るので、色の軸だけ差し替わる。
// 外部ソースは文脈を持たないので従来のグレーのまま（形も round-rect で区別が付く）。

/** 文脈タグ未付与ノートの色。design.md の 2 ホップ色（間接・背景的の意味論）に合わせる。 */
const UNCAT_FILL = "#b8c9be";
const UNCAT_BORDER = "#9cb5a4";

export type GraphColorMode = "kind" | "context";

/** ノードの塗り・境界色を色モードに応じて返す。
 *  彩度 40% / 明度 56% は design.md ラベル色パレット（S 10-51% / L 39-60% の
 *  「落ち着いた彩度の自然色」）の中心に合わせた値。高彩度化しないこと。
 *  注意: cytoscape のカラーパーサはモダン CSS の空白区切り hsl(h s% l%) を解釈できず
 *  黙ってデフォルト色（グレー）に落ちる。必ずカンマ区切りで渡すこと
 *  （React DOM に渡す ContextBadge / ContextLegend は空白区切りでも動くが、別系統）。 */
function nodeColors(node: NoteNode, mode: GraphColorMode): { fill: string; border: string } {
  const kind = kindOf(node);
  if (mode === "context" && kind !== "external") {
    const ctx = node.noteContexts?.[0];
    if (!ctx) return { fill: UNCAT_FILL, border: UNCAT_BORDER };
    const h = noteContextHue(ctx);
    return { fill: `hsl(${h}, 40%, 56%)`, border: `hsl(${h}, 40%, 44%)` };
  }
  return { fill: kindFill(kind), border: kindBorder(kind) };
}

const KIND_SHAPE: Record<GraphKind, string> = {
  external: "round-rectangle",
  note: "ellipse",
  summary: "round-rectangle",
  claim: "round-rectangle",
  atom: "diamond",
  synthesis: "hexagon",
  // 話題は知見を束ねるページ。claim（角丸四角）と atom（ダイヤ）の中間として
  // 角丸四角のまま据え置き、サイズで claim / atom との中間感を出す。
  topic: "round-rectangle",
};

const KIND_SIZE: Record<GraphKind, number> = {
  external: 26,
  note: 32,
  summary: 32,
  claim: 30,
  atom: 36,
  synthesis: 38,
  topic: 33,
};

const REL_COLOR: Record<EdgeRelation, string> = {
  derived: "#4B7A52",
  used: "#9aa0a6",
  reference: "#5b8fb9",
};


// ── Cytoscape スタイル ──

const graphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      ...baseNodeStyle,
      "background-color": "data(color)",
      "border-color": "data(borderColor)",
      shape: "data(shape)" as any,
      width: "data(size)",
      height: "data(size)",
    },
  },
  ...interactionStyles,
  hoverFullLabelStyle,
  {
    // 葉を畳んだ相手ノード: 枠を 1 段太くして「畳んだものを持っている」ことを示す
    // （実寸は変えたくないので width/height ではなく border-width のみ）
    selector: "node[folded > 0]",
    style: { "border-width": 3 },
  },
  {
    // 畳んだ葉を衛星として残したノード（layoutMode: islands + fold ON）。
    // 量感は出すが主役ではないので少し透過・低い z-index にする。
    selector: "node[?satellite]",
    style: { opacity: 0.85, "z-index": 1 },
  },
  {
    // 検索ヒット: 琥珀色の太枠 + フルラベル表示。faded より優先されるよう後段に置く
    selector: "node.search-hit",
    style: {
      "border-width": 4,
      "border-color": "#d99a2b",
      label: "data(fullLabel)" as any,
      "font-weight": "bold" as any,
      "z-index": 900,
    },
  },
  {
    selector: "edge",
    style: {
      ...baseEdgeStyle,
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "line-style": "data(lineStyle)" as any,
      // 全体グラフはエッジが多いので、既定より少しだけ引く
      opacity: 0.85,
    },
  },
  { selector: "edge.hover-connected", style: { width: 2.5, opacity: 1, "z-index": 10 } },
  {
    // 「文脈で寄せる」用の不可視エッジ。描画・操作はさせず fcose の引力計算にだけ効かせる
    // （display:none だとレイアウト対象から外れるので opacity 0 で隠す）。
    selector: "edge.cluster-edge",
    style: { opacity: 0, events: "no" as any },
  },
  {
    // 衛星と親（畳み先）を結ぶ実エッジ。見えるが控えめ（細め・薄め・矢印無し）。
    // 物理（fcose の 1 段目）には参加させない——2 段目の幾何配置の後に見た目だけ足す。
    selector: "edge.satellite-edge",
    style: {
      width: 0.8,
      opacity: 0.35,
      "target-arrow-shape": "none" as any,
      "line-style": "solid" as any,
    },
  },
  {
    // クラスタ重心のダミーハブノード。見えない・触れないがレイアウトには参加し、
    // ハブ同士の反発でクラスタ間の距離を生む。
    selector: "node.cluster-hub",
    style: { opacity: 0, events: "no" as any, label: "", width: 1, height: 1 },
  },
];

function nodeIcon(n: NoteNode): string {
  if (n.external === "pdf") return "📄 ";
  if (n.external === "document") return "📝 ";
  if (n.external === "url") return "🔗 ";
  if (n.external === "chat") return "💬 ";
  if (n.external === "memo") return "🗒️ ";
  if (n.isWiki) return "🤖 ";
  return "";
}

function truncate(s: string, max = 16): string {
  return [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
}

/**
 * 検索クエリでノードを強調する（クラス操作のみ・レイアウトは動かさない）。
 * ヒット: search-hit（太枠 + フルラベル）、非ヒット: faded。ヒット同士のエッジは見せたまま残す。
 * クエリが空なら全解除。戻り値はヒット件数。
 */
function applySearchHighlight(cy: cytoscape.Core, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  cy.elements().removeClass("faded search-hit");
  if (!q) return 0;
  const hits = cy
    .nodes()
    .filter((n) => String(n.data("fullLabel") ?? "").toLowerCase().includes(q));
  cy.elements().addClass("faded");
  hits.removeClass("faded").addClass("search-hit");
  hits.edgesWith(hits).removeClass("faded");
  return hits.length;
}

/**
 * layoutMode: islands の 2 段目（幾何）。1 段目の fcose（ノート + 重心ダミー +
 * フォーカス種類同士の実辺 + 重心の不可視エッジ）が決めた位置を土台に、
 * フォーカス以外の実ノード（例: focus=note なら知見・原料・話題）と衛星
 * （畳んだ葉）を幾何計算だけで直接置く。fcose の 1 段目には混ぜない
 * ——質量が大きく、混ぜると島が分かれなくなる。
 *
 * - フォーカス以外の実ノード: 直接隣接するフォーカスノード（shownEdges の
 *   実辺のみ。重心の不可視エッジ・衛星の不可視エッジは数えない）の位置の
 *   平均に置く。隣接フォーカスノードが 1 つならそこから半径 40（角度は id の
 *   ハッシュで決定的）。同じ点に重なる場合は id 順に 8px ずつ螺旋状にずらす。
 *   隣接フォーカスノードが無いものは触らない（元の位置のまま）。
 * - 衛星: 親ノートの周りのリングに等間隔で置く。半径 = 親の size/2 + 14、
 *   1 リング 12 個まで、超えたら半径 +12 の次のリング。角度は index から決定的に。
 * - 後始末（最後に必ず実行）: 上のどれでも位置が決まらなかった実ノード（例:
 *   隣接するフォーカスノードが無い「橋」）を、隣接ノードの平均位置（隣接も
 *   未配置なら無向 BFS で最寄りの配置済みノードへ）に置く。辺が 1 本も無い
 *   （孤立ノード）ものは触らない——hideIsolated の扱いに従う（既定では
 *   filterGlobalGraph の時点で除かれている）。
 */
function placeIslandGeometry(
  cy: cytoscape.Core,
  opts: {
    shownNodes: NoteNode[];
    shownEdges: NoteEdge[];
    focusIds: Set<string>;
    foldedOutNodes: NoteNode[];
    foldedInto: Map<string, string>;
  },
): void {
  const { shownNodes, shownEdges, focusIds, foldedOutNodes, foldedInto } = opts;

  // ── フォーカス以外の実ノード: 隣接フォーカスノードの平均位置 ──
  const focusNeighborsOf = new Map<string, string[]>();
  for (const e of shownEdges) {
    const sourceIsFocus = focusIds.has(e.source);
    const targetIsFocus = focusIds.has(e.target);
    if (sourceIsFocus && !targetIsFocus) {
      const list = focusNeighborsOf.get(e.target);
      if (list) list.push(e.source);
      else focusNeighborsOf.set(e.target, [e.source]);
    } else if (targetIsFocus && !sourceIsFocus) {
      const list = focusNeighborsOf.get(e.source);
      if (list) list.push(e.target);
      else focusNeighborsOf.set(e.source, [e.target]);
    }
  }

  // 決定的な疑似角度（id のハッシュ）。乱数は使わない。
  const hashAngle = (id: string): number => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 360) * (Math.PI / 180);
  };

  const positions = new Map<string, { x: number; y: number }>();
  for (const [nodeId, focusNeighborIds] of focusNeighborsOf) {
    if (focusNeighborIds.length === 0) continue;
    if (focusNeighborIds.length === 1) {
      const focusNode = cy.getElementById(focusNeighborIds[0]);
      if (focusNode.empty()) continue;
      const p = focusNode.position();
      const angle = hashAngle(nodeId);
      positions.set(nodeId, { x: p.x + 40 * Math.cos(angle), y: p.y + 40 * Math.sin(angle) });
      continue;
    }
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const focusNodeId of focusNeighborIds) {
      const focusNode = cy.getElementById(focusNodeId);
      if (focusNode.empty()) continue;
      sumX += focusNode.position().x;
      sumY += focusNode.position().y;
      count++;
    }
    if (count === 0) continue;
    positions.set(nodeId, { x: sumX / count, y: sumY / count });
  }

  // 同じ点に重なるものを id 順に 8px ずつ螺旋状にずらす
  const byRoundedPoint = new Map<string, string[]>();
  for (const [nodeId, p] of positions) {
    const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
    const list = byRoundedPoint.get(key);
    if (list) list.push(nodeId);
    else byRoundedPoint.set(key, [nodeId]);
  }
  for (const ids of byRoundedPoint.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    sorted.forEach((nodeId, i) => {
      if (i === 0) return; // 先頭はそのまま
      const base = positions.get(nodeId)!;
      const angle = i * 2.4; // 黄金角に近い値で重なりを避ける
      const radius = 8 * i;
      positions.set(nodeId, { x: base.x + radius * Math.cos(angle), y: base.y + radius * Math.sin(angle) });
    });
  }

  for (const [nodeId, p] of positions) {
    const node = cy.getElementById(nodeId);
    if (!node.empty()) node.position(p);
  }

  // ── 衛星: 親ノートの周りのリング ──
  const byParent = new Map<string, string[]>();
  for (const node of foldedOutNodes) {
    const parentId = foldedInto.get(node.id);
    if (!parentId) continue;
    const list = byParent.get(parentId);
    if (list) list.push(node.id);
    else byParent.set(parentId, [node.id]);
  }
  const RING_CAPACITY = 12;
  for (const [parentId, satelliteIds] of byParent) {
    const parent = cy.getElementById(parentId);
    if (parent.empty()) continue;
    const ppos = parent.position();
    const parentSize = Number(parent.data("size")) || KIND_SIZE.note;
    satelliteIds.forEach((satId, index) => {
      const ring = Math.floor(index / RING_CAPACITY);
      const indexInRing = index % RING_CAPACITY;
      const radius = parentSize / 2 + 14 + ring * 12;
      const angle = (indexInRing / RING_CAPACITY) * 2 * Math.PI;
      const sat = cy.getElementById(satId);
      if (!sat.empty()) {
        sat.position({ x: ppos.x + radius * Math.cos(angle), y: ppos.y + radius * Math.sin(angle) });
      }
    });
  }

  // ── 後始末: まだ位置が決まっていない実ノードを最寄りに置く ──
  const positionedIds = new Set<string>(focusIds);
  for (const id of positions.keys()) positionedIds.add(id);
  for (const node of foldedOutNodes) positionedIds.add(node.id);
  runOrphanCleanupPass(cy, shownNodes, shownEdges, positionedIds);
}

/**
 * まだ位置が決まっていない実ノード（`positionedIds` に入っていないもの）を、
 * 隣接ノードの平均位置（隣接も未配置なら無向 BFS で最寄りの配置済みノードへ）に
 * 置く。辺を 1 本でも持つものだけ対象にする（辺が無い孤立ノードは既定で
 * filterGlobalGraph に除かれているはずだが、hideIsolated が OFF で残っている
 * 場合も含めて触らない＝孤立ノードの今までの扱いのまま）。
 * layoutMode: islands の各幾何配置関数（placeIslandGeometry /
 * placeCrystalIslandGeometry）が最後に必ず呼ぶ。
 */
function runOrphanCleanupPass(
  cy: cytoscape.Core,
  shownNodes: NoteNode[],
  shownEdges: NoteEdge[],
  positionedIds: Set<string>,
): void {
  const adjacency = new Map<string, string[]>();
  for (const n of shownNodes) adjacency.set(n.id, []);
  for (const e of shownEdges) {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  }

  const orphanIds = shownNodes
    .map((n) => n.id)
    .filter((id) => !positionedIds.has(id) && (adjacency.get(id) ?? []).length > 0);

  const cleanupPositions = new Map<string, { x: number; y: number }>();
  const positionOf = (id: string): { x: number; y: number } | null => {
    const cached = cleanupPositions.get(id);
    if (cached) return cached;
    const el = cy.getElementById(id);
    return el.empty() ? null : el.position();
  };
  for (const id of orphanIds) {
    const neighbors = adjacency.get(id) ?? [];
    const positionedNeighbors = neighbors.filter((nb) => positionedIds.has(nb) || cleanupPositions.has(nb));
    if (positionedNeighbors.length > 0) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (const nb of positionedNeighbors) {
        const p = positionOf(nb);
        if (!p) continue;
        sumX += p.x;
        sumY += p.y;
        count++;
      }
      if (count > 0) cleanupPositions.set(id, { x: sumX / count, y: sumY / count });
      continue;
    }
    // 隣接も未配置 → 無向 BFS で最寄りの配置済みノードを探す
    const visited = new Set<string>([id]);
    let frontier = [id];
    let nearest: string | null = null;
    while (frontier.length > 0 && !nearest) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of adjacency.get(cur) ?? []) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          if (positionedIds.has(nb) || cleanupPositions.has(nb)) {
            nearest = nb;
            break;
          }
          next.push(nb);
        }
        if (nearest) break;
      }
      frontier = next;
    }
    if (nearest) {
      const p = positionOf(nearest);
      if (p) cleanupPositions.set(id, { x: p.x, y: p.y });
    }
  }

  // 同じ点に重なるものを id 順に 8px ずつ螺旋状にずらす
  const byRoundedCleanupPoint = new Map<string, string[]>();
  for (const [id, p] of cleanupPositions) {
    const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
    const list = byRoundedCleanupPoint.get(key);
    if (list) list.push(id);
    else byRoundedCleanupPoint.set(key, [id]);
  }
  for (const ids of byRoundedCleanupPoint.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    sorted.forEach((id, i) => {
      if (i === 0) return;
      const base = cleanupPositions.get(id)!;
      const angle = i * 2.4;
      const radius = 8 * i;
      cleanupPositions.set(id, { x: base.x + radius * Math.cos(angle), y: base.y + radius * Math.sin(angle) });
    });
  }

  for (const [id, p] of cleanupPositions) {
    const node = cy.getElementById(id);
    if (!node.empty()) node.position(p);
  }
}

/**
 * crystal フォーカス専用の 2 段目（幾何）。1 段目の fcose が話題（topic）だけを
 * 置いた後、この順で幾何計算だけで直接置く:
 *   (1) 知見・洞察: 隣接する話題の平均位置。話題が 1 つならその話題の衛星リング
 *       （foldedOutNodes/foldedInto 経由。既に「葉知見」として shownNodes から
 *       除かれている）、2 つ以上（sharedClaimIds）なら平均位置に実ノードとして
 *       置く（size 30 は sizeForNode 側で設定済み）。
 *   (2) ノート: 隣接する（(1) で配置済みの）知見の平均位置。
 *   (1 続き) 話題を持たない知見（隣接ノートの衛星）は、親のノートが (2) で
 *       配置された後にリングへ置く。
 *   (3) 原料: 隣接ノートの平均位置。
 *   (4) 後始末（runOrphanCleanupPass）は他の配置方法と共通。
 */
function placeCrystalIslandGeometry(
  cy: cytoscape.Core,
  opts: {
    shownNodes: NoteNode[];
    shownEdges: NoteEdge[];
    foldedOutNodes: NoteNode[];
    foldedInto: Map<string, string>;
    sharedClaimIds: Set<string>;
  },
): void {
  const { shownNodes, shownEdges, foldedOutNodes, foldedInto, sharedClaimIds } = opts;
  const nodeById = new Map(shownNodes.map((n) => [n.id, n]));

  const dedupeSpiral = (positions: Map<string, { x: number; y: number }>) => {
    const byRounded = new Map<string, string[]>();
    for (const [id, p] of positions) {
      const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
      const list = byRounded.get(key);
      if (list) list.push(id);
      else byRounded.set(key, [id]);
    }
    for (const ids of byRounded.values()) {
      if (ids.length < 2) continue;
      const sorted = [...ids].sort();
      sorted.forEach((id, i) => {
        if (i === 0) return;
        const base = positions.get(id)!;
        const angle = i * 2.4;
        const radius = 8 * i;
        positions.set(id, { x: base.x + radius * Math.cos(angle), y: base.y + radius * Math.sin(angle) });
      });
    }
  };
  const applyPositions = (positions: Map<string, { x: number; y: number }>) => {
    for (const [id, p] of positions) {
      const el = cy.getElementById(id);
      if (!el.empty()) el.position(p);
    }
  };
  const placeRings = (byParent: Map<string, string[]>) => {
    const RING_CAPACITY = 12;
    for (const [parentId, ids] of byParent) {
      const parent = cy.getElementById(parentId);
      if (parent.empty()) continue;
      const ppos = parent.position();
      const parentSize = Number(parent.data("size")) || KIND_SIZE.note;
      ids.forEach((id, index) => {
        const ring = Math.floor(index / RING_CAPACITY);
        const indexInRing = index % RING_CAPACITY;
        const radius = parentSize / 2 + 14 + ring * 12;
        const angle = (indexInRing / RING_CAPACITY) * 2 * Math.PI;
        const el = cy.getElementById(id);
        if (!el.empty()) {
          el.position({ x: ppos.x + radius * Math.cos(angle), y: ppos.y + radius * Math.sin(angle) });
        }
      });
    }
  };
  // 無向・実辺のみの隣接（ノート↔共有知見、原料↔ノートの平均位置に使う）
  const adjacency = new Map<string, string[]>();
  for (const n of shownNodes) adjacency.set(n.id, []);
  for (const e of shownEdges) {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  }
  const averageOfReference = (
    candidateIds: string[],
    referenceIds: Set<string>,
  ): Map<string, { x: number; y: number }> => {
    const result = new Map<string, { x: number; y: number }>();
    for (const id of candidateIds) {
      const neighbors = (adjacency.get(id) ?? []).filter((nb) => referenceIds.has(nb));
      if (neighbors.length === 0) continue;
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (const nb of neighbors) {
        const el = cy.getElementById(nb);
        if (el.empty()) continue;
        const p = el.position();
        sumX += p.x;
        sumY += p.y;
        count++;
      }
      if (count > 0) result.set(id, { x: sumX / count, y: sumY / count });
    }
    return result;
  };

  // 衛星（葉知見）を親の種類で 2 グループに分ける（話題の衛星 / ノートの衛星）
  const byTopicParent = new Map<string, string[]>();
  const byNoteParent = new Map<string, string[]>();
  for (const n of foldedOutNodes) {
    const parentId = foldedInto.get(n.id);
    if (!parentId) continue;
    const parentNode = nodeById.get(parentId);
    if (!parentNode) continue;
    const bucket = kindOf(parentNode) === "topic" ? byTopicParent : byNoteParent;
    const list = bucket.get(parentId);
    if (list) list.push(n.id);
    else bucket.set(parentId, [n.id]);
  }

  // (1a) 話題が 1 つの知見: 話題の衛星リング（話題は 1 段目の fcose で配置済み）
  placeRings(byTopicParent);

  // (1b) 話題が 2 つ以上の共有知見: 隣接話題の平均位置に実ノードとして置く
  const topicIds = new Set(shownNodes.filter((n) => kindOf(n) === "topic").map((n) => n.id));
  const sharedPositions = averageOfReference([...sharedClaimIds], topicIds);
  dedupeSpiral(sharedPositions);
  applyPositions(sharedPositions);

  // (2) ノート: 隣接する（(1) で配置済みの）知見の平均位置
  const positionedKnowledge = new Set<string>([...topicIds, ...sharedClaimIds]);
  const noteIds = shownNodes.filter((n) => kindOf(n) === "note").map((n) => n.id);
  const notePositions = averageOfReference(noteIds, positionedKnowledge);
  dedupeSpiral(notePositions);
  applyPositions(notePositions);

  // (1 続き) 話題を持たない知見: ノートの衛星（ノート配置後）
  placeRings(byNoteParent);

  // (3) 原料: 隣接ノートの平均位置
  const externalIds = shownNodes.filter((n) => kindOf(n) === "external").map((n) => n.id);
  const externalPositions = averageOfReference(externalIds, new Set(noteIds));
  dedupeSpiral(externalPositions);
  applyPositions(externalPositions);

  // (4) 後始末
  const positionedIds = new Set<string>([...topicIds, ...sharedPositions.keys(), ...notePositions.keys(), ...externalPositions.keys()]);
  for (const n of foldedOutNodes) positionedIds.add(n.id);
  runOrphanCleanupPass(cy, shownNodes, shownEdges, positionedIds);
}

/**
 * ノードの大きさを決める（サイズモード + 配置モード + フォーカス種類を考慮）。
 * plain のときは今までどおり: sizeMode "reach" なら note だけ正規化 reach、
 * それ以外は種類ごとの固定値。islands のときは、フォーカス種類のノードは
 * plain と同じ規則（reach なら正規化 reach、それ以外は種類ごとの固定値）だが、
 * フォーカス以外の実ノード（橋）は固定 14（衛星は別枠で size 9 を直接指定する
 * ので、ここには来ない）。
 *
 * crystal フォーカスは話題を中心にする専用規則: 話題は reach（話題どうしの
 * reach。reachScores は呼び出し側で computeTopicReachScores に差し替え済み）で
 * 正規化、共有知見（claim/atom。shownNodes に残っている時点で共有知見——葉知見は
 * 衛星として既に除かれている）は種類に関わらず固定 KIND_SIZE.claim、ノート
 * （糊）・原料（橋）は固定 14。sizeMode に関わらずこの規則を使う。
 */
function sizeForNode(
  node: NoteNode,
  kind: GraphKind,
  opts: {
    layoutMode: "plain" | "islands";
    focus: FocusLayer;
    sizeMode: "kind" | "reach";
    reachScores: Map<string, number> | null;
    maxReachScore: number;
  },
): number {
  const { layoutMode, focus, sizeMode, reachScores, maxReachScore } = opts;
  const baseSize = KIND_SIZE[kind];
  if (layoutMode === "islands" && focus === "crystal") {
    if (kind === "topic") {
      // 32〜64（48 だと種類の他の値と近すぎ、80 だと重なりやすいので 32 を足す）
      if (sizeMode === "reach" && maxReachScore > 0) {
        return baseSize + 32 * ((reachScores?.get(node.id) ?? 0) / maxReachScore);
      }
      return baseSize;
    }
    if (kind === "claim" || kind === "atom") return KIND_SIZE.claim;
    return 14; // ノート・原料（幾何配置の橋）
  }
  if (layoutMode === "islands" && !isFocused(node, focus)) return 14;
  const isReachTarget = layoutMode === "islands" ? isFocused(node, focus) : kind === "note";
  if (sizeMode === "reach" && isReachTarget && maxReachScore > 0) {
    return baseSize + 48 * ((reachScores?.get(node.id) ?? 0) / maxReachScore);
  }
  return baseSize;
}

// ── キャンバス（クロムなし。オーバーレイや Storybook から使う） ──

export function GlobalGraphCanvas({
  data,
  visibleLayers,
  hideReferences = false,
  hideIsolated = false,
  colorMode = "kind",
  contextFilter,
  hideUncategorized = false,
  hideAtoms = false,
  clusterByContext = false,
  foldLeaves = false,
  sizeMode = "kind",
  layoutMode = "plain",
  focusLayer = "note",
  precomputedFold,
  searchQuery = "",
  searchJumpToken = 0,
  onSearchHits,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
  height = 560,
}: {
  data: NoteGraphData;
  visibleLayers: Set<LayerId>;
  hideReferences?: boolean;
  hideIsolated?: boolean;
  /** ノード色の軸。kind=種類（既定）/ context=文脈タグ。形状は常に kind のまま。 */
  colorMode?: GraphColorMode;
  /** 文脈タグ絞り込み（小文字キー）。filterGlobalGraph にそのまま渡す。 */
  contextFilter?: Set<string>;
  /** 未分類（タグ無しの通常ノート）を隠す。filterGlobalGraph にそのまま渡す。 */
  hideUncategorized?: boolean;
  /** Atom（洞察）ノードを隠す（features.insights OFF）。filterGlobalGraph にそのまま渡す。 */
  hideAtoms?: boolean;
  /** 同じ文脈タグのノードを不可視エッジで引き寄せ、クラスターとして固まらせる。 */
  clusterByContext?: boolean;
  /** ノート以外で次数 1 の「葉」を、繋がる相手（多くはノート）に畳んで `+n` にまとめる（既定 false = 今の挙動）。 */
  foldLeaves?: boolean;
  /** ノート（kind note）の大きさの決め方。kind=種類ごとの固定値（既定）/ reach=2 ホップ以内で届く別ノート数。 */
  sizeMode?: "kind" | "reach";
  /** fcose のレイアウト定数の決め方。plain=今の固定値（既定）/ islands=つながりの多いノート
   *  ほど周りを強く引き寄せ・ノート同士は強く反発させて「島」を作る。 */
  layoutMode?: "plain" | "islands";
  /** layoutMode: islands のときだけ効く「島の中心にする種類」。plain のときは
   *  無視され、常に "note" として扱う（既定の挙動を変えないため）。 */
  focusLayer?: FocusLayer;
  /** 呼び出し元（GlobalGraphView）が filterGlobalGraph + foldLeafNodes を先に済ませた
   *  結果。foldLeaves=true のときだけ使い、指定があれば内部での foldLeafNodes 再計算
   *  を省く（同じ入力に対する二重計算を避けるためのもの）。未指定なら自前で計算する
   *  （Storybook 等の単体利用はこちら）。foldedInto/foldedOutNodes は layoutMode:
   *  islands で畳んだ葉を「衛星」として描き直すために使う。 */
  precomputedFold?: {
    data: NoteGraphData;
    foldedCount: Map<string, number>;
    foldedInto: Map<string, string>;
    foldedOutNodes: NoteNode[];
  };
  /** タイトル部分一致でヒットを強調する検索クエリ。クラス操作のみでレイアウトは動かさない。 */
  searchQuery?: string;
  /** インクリメントされるたびに次の検索ヒットへパンする（Enter 連打で巡回）。 */
  searchJumpToken?: number;
  /** 検索ヒット件数の通知（クエリ空なら 0）。 */
  onSearchHits?: (count: number) => void;
  onNavigate?: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /** URL ソースノードをアプリ内で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースノードをメモギャラリーの該当詳細で開く。未指定なら表示のみ。 */
  onOpenMemo?: (captureId: string) => void;
  height?: number | string;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // mouseout ハンドラ（cy 構築時のクロージャ）から最新の検索クエリ・色モードを
  // 参照するための ref。state を deps に入れて cy を作り直すと再レイアウトが走るため。
  const searchRef = useRef(searchQuery);
  searchRef.current = searchQuery;
  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;
  // sizeMode / reachScores / maxReachScore も同様に ref 経由で読む。
  // メイン構築 effect は renderKey（shownNodes/shownEdges の中身）が変わったときだけ
  // 走るため、sizeMode 単独の切替では再構築されない（それは下のサイズ用 effect が
  // data 書き換えで反映する）。ただし構造変化（葉を畳む ON/OFF 等）で cy が作り直され
  // たときは、この ref を読んで最初から正しい size を入れる（そうしないと種類固定サイズ
  // で仮置きされたまま、サイズ用 effect の依存が変わらず再適用されずに残ってしまう）。
  const sizeModeRef = useRef(sizeMode);
  sizeModeRef.current = sizeMode;
  const reachScoresRef = useRef<Map<string, number> | null>(null);
  const maxReachScoreRef = useRef(0);
  // Enter 巡回の現在位置（クエリが変わったら 0 に戻す）
  const jumpIndexRef = useRef(0);

  // ── 手動配置の保存（周辺グラフ・手順フローと同じ仕組み・同じ保存先）──
  const {
    ready: layoutReady,
    positions: savedPositions,
    save: saveLayout,
    reset: resetLayout,
    hasSaved: hasSavedLayout,
    resetSeq: layoutResetSeq,
    showSelectionHint,
  } = useGraphLayout(globalGraphScope());
  const savedPositionsRef = useRef(savedPositions);
  savedPositionsRef.current = savedPositions;
  const saveLayoutRef = useRef(saveLayout);
  saveLayoutRef.current = saveLayout;
  // 「文脈で寄せる」は並べ直しそのものが目的の操作なので、保存済みの配置があっても
  // その切り替え直後だけは fcose を流す（並べ直した後にドラッグすればまた保存される）。
  // 比較は effect の中で行う — レンダー中に ref を更新すると StrictMode の
  // 二重レンダーで変化を食われる
  const lastClusterRef = useRef(clusterByContext);
  // layoutMode（配置: 標準 / 島）の切替も、clusterByContext と同じ扱いで並べ直しの
  // トリガーにする（保存済み配置・引き継ぎ座標を無視して fcose を流し直す）。
  const lastLayoutModeRef = useRef(layoutMode);
  // フォーカス種類の切替（islands 中）も同格の並べ直しトリガーにする
  // （フォーカスが変わると畳み方・島の中身が変わるため）。
  const lastFocusLayerRef = useRef(focusLayer);

  // layoutMode: islands のときだけ focusLayer を効かせる。plain のときは常に
  // "note"（今までの既定の挙動を変えないため）。
  const effectiveFocus: FocusLayer = layoutMode === "islands" ? focusLayer : "note";

  // 表示中の層・参照・文脈タグ・未分類・孤立フィルタを適用し、foldLeaves が
  // 有効なら「葉を畳む」を続けて掛ける（畳んだ相手ノード id → 個数が foldedCount）。
  // precomputedFold が渡されていれば（GlobalGraphView が先に計算済み）、同じ入力に対する
  // foldLeafNodes の二重計算を避けてそれをそのまま使う。
  // foldedOutNodes/foldedInto は、layoutMode: islands のときに畳んだ葉を「衛星」
  // として描き直すために持っておく（実際に使うのは cy 構築側）。
  const { nodes: shownNodes, edges: shownEdges, foldedCount, foldedOutNodes, foldedInto } = useMemo(() => {
    if (foldLeaves && precomputedFold) {
      return {
        nodes: precomputedFold.data.nodes,
        edges: precomputedFold.data.edges,
        foldedCount: precomputedFold.foldedCount,
        foldedOutNodes: precomputedFold.foldedOutNodes,
        foldedInto: precomputedFold.foldedInto,
      };
    }
    const filtered = filterGlobalGraph(data, {
      visibleLayers,
      hideReferences,
      hideIsolated,
      contextFilter,
      hideUncategorized,
      hideAtoms,
    });
    if (!foldLeaves) {
      return {
        ...filtered,
        foldedCount: new Map<string, number>(),
        foldedOutNodes: [] as NoteNode[],
        foldedInto: new Map<string, string>(),
      };
    }
    const folded = computeFocusFoldResult(filtered, effectiveFocus);
    const foldedOutNodes = filtered.nodes.filter((n) => folded.foldedInto.has(n.id));
    return {
      nodes: folded.data.nodes,
      edges: folded.data.edges,
      foldedCount: folded.foldedCount,
      foldedOutNodes,
      foldedInto: folded.foldedInto,
    };
  }, [
    data,
    visibleLayers,
    hideReferences,
    hideIsolated,
    contextFilter,
    hideUncategorized,
    hideAtoms,
    foldLeaves,
    precomputedFold,
    effectiveFocus,
  ]);
  // つながりで大きさ（reach）: 畳んだ後のサブグラフで計算する。sizeMode="reach" だけ
  // でなく layoutMode="islands"（引力で島を作る）も reachNorm を使うので、どちらか
  // 片方が有効なら計算する。reach スコアは表示中サブグラフの分布に対する相対値で使う
  // （絶対値だと生成データではほぼ全ノートが上限に張り付いてしまう）。
  // maxReachScore はその分布の最大値。
  const needsReach = sizeMode === "reach" || layoutMode === "islands";
  // crystal フォーカスは話題どうしの reach（他の crystal 種類込みだと知見の数が
  // 多く差が付きにくいため、話題限定で数える）。
  const reachScores = useMemo(
    () =>
      needsReach
        ? layoutMode === "islands" && focusLayer === "crystal"
          ? computeTopicReachScores({ nodes: shownNodes, edges: shownEdges })
          : computeReachScores({ nodes: shownNodes, edges: shownEdges }, { focus: effectiveFocus })
        : null,
    [shownNodes, shownEdges, needsReach, effectiveFocus, layoutMode, focusLayer],
  );
  const maxReachScore = useMemo(() => {
    if (!reachScores) return 0;
    let max = 0;
    for (const v of reachScores.values()) if (v > max) max = v;
    return max;
  }, [reachScores]);
  reachScoresRef.current = reachScores;
  maxReachScoreRef.current = maxReachScore;
  // 描画し直すかは中身で決める（data の参照はノート保存のたびに変わる）
  const shownKey = useGraphDataKey(shownNodes) + "|" + useGraphDataKey(shownEdges);
  // グラフの「形」。読み込み中に形が連続で変わる間は組み直しを 1 回にまとめる
  const structureKey = useGraphStructureKey(
    shownNodes.map((n) => n.id),
    shownEdges,
  );
  // ドラッグ中と読み込み中の連続変化は、組み直しを待たせて 1 回にする
  const { renderKey, beginDrag, endDrag } = useGraphRenderKey(shownKey, structureKey);
  // 組み直す直前の座標と視点。次のグラフが引き継ぐ
  const carryOver = useGraphCarryOver(layoutResetSeq);
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;

  useEffect(() => {
    if (!containerRef.current) return;
    // 保存済みの配置を読み終えるまで組まない（読み込み後に並べ直して見えないように）
    if (!layoutReady) return;
    // 「文脈で寄せる」の切り替え直後か
    const clusterChanged = lastClusterRef.current !== clusterByContext;
    lastClusterRef.current = clusterByContext;
    // 「配置: 標準 / 島」の切替直後か（並べ直しのトリガーとして clusterChanged と同格に扱う）
    const layoutChanged = lastLayoutModeRef.current !== layoutMode;
    lastLayoutModeRef.current = layoutMode;
    // フォーカス種類の切替直後か（同様に並べ直しのトリガーにする）
    const focusChanged = lastFocusLayerRef.current !== focusLayer;
    lastFocusLayerRef.current = focusLayer;
    const modeChanged = clusterChanged || layoutChanged || focusChanged;
    if (shownNodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      return;
    }

    // crystal フォーカスは話題だけを物理配置に参加させる専用の分析結果を使う
    // （要素構築時の projection エッジ・後段の fcose 対象コレクション・幾何配置の
    // どこからも参照するので、ここで 1 回だけ計算する）。
    const crystalAnalysis =
      focusLayer === "crystal" ? analyzeCrystalIslands({ nodes: shownNodes, edges: shownEdges }) : null;

    const elements: cytoscape.ElementDefinition[] = [];
    for (const node of shownNodes) {
      const kind = kindOf(node);
      const foldedN = foldedCount.get(node.id) ?? 0;
      const full = `${nodeIcon(node)}${node.title}`;
      // 畳んだ分の suffix はタイトルの truncate 後に付ける（truncate で "…" と
      // 混ざって読めなくならないように）。ただし layoutMode: islands のときは
      // 畳んだ葉を衛星として個別に描くので、親側に "+n" は付けない（衛星の量感で
      // 見えるため、二重に示さない）。
      const foldSuffix = foldedN > 0 && layoutMode !== "islands" ? ` +${foldedN}` : "";
      // 色は構築時点のモードで塗る。モード切替時は色 effect が data を書き換える
      // （cy を作り直さない＝レイアウトを保つ）。大きさも ref 経由で今の sizeMode /
      // reachScores を読んで最初から正しい値を入れる（構造変化で cy が作り直された
      // ときに、サイズ用 effect の依存が変わらず再適用されない事故を避けるため。
      // 切替時の書き換えは後段の大きさ用 effect が担う）。
      const { fill, border } = nodeColors(node, colorModeRef.current);
      const size = sizeForNode(node, kind, {
        layoutMode,
        focus: effectiveFocus,
        sizeMode: sizeModeRef.current,
        reachScores: reachScoresRef.current,
        maxReachScore: maxReachScoreRef.current,
      });
      elements.push({
        data: {
          id: node.id,
          label: `${truncate(full)}${foldSuffix}`,
          fullLabel: `${full}${foldSuffix}`,
          color: fill,
          borderColor: border,
          shape: KIND_SHAPE[kind],
          size,
          folded: foldedN,
          isWiki: !!node.isWiki,
          external: node.external,
          externalUrl: node.externalUrl,
        },
      });
    }
    for (const edge of shownEdges) {
      const rel: EdgeRelation = edge.relation ?? "derived";
      elements.push({
        data: {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          color: REL_COLOR[rel],
          lineStyle: rel === "reference" ? "dashed" : "solid",
        },
      });
    }
    if (clusterByContext) {
      // 「文脈で寄せる」: タグごとに不可視のハブノード（クラスタ重心）を置き、
      // メンバーを不可視エッジで繋いで fcose の引力で固まらせる。
      // ハブを実ノードでなくダミーにするのが分離の要 — ハブ自体が他ノード・
      // 他ハブと反発し合うのでクラスタ間が押し離される（実ノードをハブにすると
      // そのノードの実エッジや跨ぎタグ経由でクラスタ同士が引き寄り、塊が近づく）。
      // 複数タグのノートは複数ハブに繋がれ、クラスタの間に位置する（妥当な挙動）。
      const byTag = new Map<string, string[]>();
      for (const node of shownNodes) {
        for (const c of node.noteContexts ?? []) {
          const key = c.toLowerCase();
          const list = byTag.get(key);
          if (list) list.push(node.id);
          else byTag.set(key, [node.id]);
        }
      }
      for (const [key, ids] of byTag) {
        if (ids.length < 2) continue;
        const hubId = `cluster-hub:${key}`;
        elements.push({ data: { id: hubId }, classes: "cluster-hub" });
        for (const id of ids) {
          elements.push({
            data: {
              id: `cluster:${key}:${id}`,
              source: hubId,
              target: id,
              virtual: true,
            },
            classes: "cluster-edge",
          });
        }
      }
    }
    if (layoutMode === "islands") {
      // 「島の配置」: clusterByContext と同じ仕組み（不可視のダミー重心 + 不可視
      // エッジ）を、タグの代わりに detectFocusCommunities が見つけたコミュニティで
      // 作る。ハブ方式（assignIslands、reach 上位をハブにして割り当てる）はハブが
      // 少数しか取れない生成データでは全体が 1 つの塊になってしまったため、
      // コミュニティ検出に切り替えた（assignIslands 自体はテストのために残す）。
      // detectFocusCommunities はフォーカス種類の射影グラフでラベル伝播し、
      // フォーカス以外は隣接フォーカスノードの多数派に所属させる——focus が
      // "note" のとき detectCommunities（全ノード込み）を直接使うと、複数ノートに
      // 共有された知見が橋になって島をくっつけてしまう。
      // メンバー 2 以下のコミュニティは重心を置かない。
      // clusterByContext と併用されたときは両方の重心が置かれる。
      const communities = detectFocusCommunities({ nodes: shownNodes, edges: shownEdges }, focusLayer);
      const byCommunity = new Map<string, string[]>();
      for (const [nodeId, communityId] of communities) {
        const list = byCommunity.get(communityId);
        if (list) list.push(nodeId);
        else byCommunity.set(communityId, [nodeId]);
      }
      for (const [communityId, memberIds] of byCommunity) {
        if (memberIds.length < 2) continue;
        const dummyId = `island-hub:${communityId}`;
        elements.push({ data: { id: dummyId }, classes: "cluster-hub" });
        for (const memberId of memberIds) {
          elements.push({
            data: {
              id: `island:${communityId}:${memberId}`,
              source: dummyId,
              target: memberId,
              virtual: true,
            },
            classes: "cluster-edge",
          });
        }
      }
      if (focusLayer === "source") {
        // detectFocusCommunities がラベル伝播で使う「非フォーカスのノードを 1 つ
        // 共有していれば辺」という射影を、物理配置にも反映させる（そうしないと
        // ラベルは同じ島でも物理的に引き寄せられない）。物理専用の不可視エッジ
        // として足す（自然長 110・弾性 0.4）。focus が "note" のときはこの射影を
        // 使わない（ノートは知見を共有しやすく、共有隣接で繋ぐと島が溶けてしまう
        // ため）。focus が "crystal" のときも使わない——話題を中心にした専用の
        // 実辺グラフ（analyzeCrystalIslands）でコミュニティも物理配置も決める。
        const focusIdsForProjection = new Set(
          shownNodes.filter((n) => isFocused(n, focusLayer)).map((n) => n.id),
        );
        const focusNeighborsOfNonFocus = new Map<string, Set<string>>();
        for (const e of shownEdges) {
          const sourceIsFocus = focusIdsForProjection.has(e.source);
          const targetIsFocus = focusIdsForProjection.has(e.target);
          if (sourceIsFocus && !targetIsFocus) {
            const set = focusNeighborsOfNonFocus.get(e.target) ?? new Set<string>();
            set.add(e.source);
            focusNeighborsOfNonFocus.set(e.target, set);
          } else if (targetIsFocus && !sourceIsFocus) {
            const set = focusNeighborsOfNonFocus.get(e.source) ?? new Set<string>();
            set.add(e.target);
            focusNeighborsOfNonFocus.set(e.source, set);
          }
        }
        let projectionCounter = 0;
        for (const ids of focusNeighborsOfNonFocus.values()) {
          const list = [...ids];
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              projectionCounter++;
              elements.push({
                data: {
                  id: `island-projection:${projectionCounter}:${list[i]}:${list[j]}`,
                  source: list[i],
                  target: list[j],
                  virtual: true,
                  projection: true,
                },
                classes: "cluster-edge",
              });
            }
          }
        }
      }
      if (crystalAnalysis) {
        // crystal: 話題どうしの射影（共有する知見の数が 1 以上のペア）を物理専用の
        // 不可視エッジとして足す。共有数（sharedCount）は fcose 側で弾性に使う。
        for (const topicEdge of crystalAnalysis.topicEdges) {
          elements.push({
            data: {
              id: `island-projection:${topicEdge.source}:${topicEdge.target}`,
              source: topicEdge.source,
              target: topicEdge.target,
              virtual: true,
              projection: true,
              sharedCount: topicEdge.sharedCount,
            },
            classes: "cluster-edge",
          });
        }
      }
    }
    if (layoutMode === "islands" && foldLeaves && foldedOutNodes.length > 0) {
      // 「畳んだ葉を衛星として描く」: fold ON のときに畳んだ葉（知見・原料など）を
      // 消さずに、小さな衛星ノードとして親（畳み先）の周りに残す。id は元の
      // ノード id をそのまま使うので、クリックは既存のノードクリック経路
      // （cy.on("tap", "node", ...)）がそのまま働く。ラベルは畳んだ数量感だけを
      // 見せたいので空にし、フルラベルは残す（ホバー・検索ヒットで見える）。
      // 衛星と親の間には見える実エッジ（satellite-edge、細め・薄め・矢印無し）を
      // 張る——線が無いと衛星が親のものだと分かりにくい。物理（fcose の 1 段目）
      // には参加させない（2 段目の幾何配置の後に見た目だけ足す）。
      for (const node of foldedOutNodes) {
        const parentId = foldedInto.get(node.id);
        if (!parentId) continue;
        const kind = kindOf(node);
        const full = `${nodeIcon(node)}${node.title}`;
        const { fill, border } = nodeColors(node, colorModeRef.current);
        elements.push({
          data: {
            id: node.id,
            label: "",
            fullLabel: full,
            color: fill,
            borderColor: border,
            shape: KIND_SHAPE[kind],
            size: 9,
            satellite: true,
            isWiki: !!node.isWiki,
            external: node.external,
            externalUrl: node.externalUrl,
          },
        });
        elements.push({
          data: {
            id: `satellite:${parentId}:${node.id}`,
            source: parentId,
            target: node.id,
            satellite: true,
            color: fill,
          },
          classes: "satellite-edge",
        });
      }
    }

    // 前回の座標を常に引き継ぎ、手動保存があればそれを上に重ねる。
    // ただし「文脈で寄せる」「配置」の切り替え直後は、並べ直しが目的なのでどちらも無視する
    // take() は切り替え直後でも呼ぶ（自動配置に戻した直後かの判定もここで進む）
    const taken = carryOver.take();
    const carry = modeChanged ? null : taken;
    const carried = carry?.positions ?? null;
    const persisted = modeChanged ? null : savedPositionsRef.current;
    const basePositions = carried || persisted ? { ...(carried ?? {}), ...(persisted ?? {}) } : null;
    const { unplacedIds, placedCount } = applySavedPositions(elements, basePositions);
    // 手で整えた並び（保存）を持つノードが 1 つでもあれば fcose は流さない
    const persistedCount = persisted ? shownNodes.filter((n) => persisted[n.id]).length : 0;
    const useSavedLayout = persistedCount > 0;
    // ノードが増えていない組み直し（中身の変化・削除・フィルタで減っただけ）も並べ直さない
    const contentOnlyRebuild = !!carry && unplacedIds.length === 0;
    // 自動レイアウトのアニメーション中にユーザーが掴んだら、レイアウト側が引き下がる
    let layoutStoppedByUser = false;
    let detachGrabStop: (() => void) | null = null;
    // 自動レイアウトが走っている最中か（途中で組み直されたら引き継がず、次は最初から並べる）
    let layoutRunning = false;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: graphStyle,
      layout: { name: "preset" },
      ...GRAPH_INIT_OPTIONS,
      // 全体グラフだけは俯瞰のためにズームの下限を広く取る（他のグラフは 0.2–4）
      minZoom: 0.1,
      maxZoom: 3,
    });
    // 背景はドラッグでパンできる。ノードの上ではドラッグが「動かす」に変わる
    containerRef.current.style.cursor = "grab";

    // 「文脈で寄せる」時はクラスター内を固めるだけでなく、クラスター**間**を離す:
    // 仮想エッジ（短い理想長・強い弾性）が塊を作り、実エッジは理想長を大きく伸ばし
    // 弾性も落として「緩い腕」にする。反発を強め・中心重力をほぼ切って塊同士を
    // 引き離す。値は Storybook「文脈クラスター（大規模）」で見た目調整したもの。
    if (useSavedLayout || contentOnlyRebuild) {
      // 並べ直さない。新しく増えたノードだけ外周に仮置きし、視点は直前のまま保つ
      seedUnplacedNodes(cy, unplacedIds);
      const vp = carry?.viewport;
      if (vp && Math.abs(vp.w - cy.width()) < 2 && Math.abs(vp.h - cy.height()) < 2) {
        cy.viewport({ zoom: vp.zoom, pan: vp.pan });
      } else {
        cy.fit(undefined, 30);
      }
    } else {
    // 前回の座標があれば、そこから続きを計算する（読み込み中にノードが増える
    // たび全体を並べ直すと、配置替えが何度も走って見える）
    // 引き継いだ座標を持つノードが 1 つも無いときは最初から並べる（原点に重なったまま
    // 続きを並べると一直線に潰れる）
    const islands = layoutMode === "islands";
    // islands は切替のたびに並べ直す（前回座標からの「続き」はしない）。
    // 引き継いだ座標に混じって、ノート以外（今回は幾何で置く）の古い位置が
    // 残っていると土台が歪むため、常に randomize で 1 段目を走らせる。
    const gentle = !islands && !modeChanged && !!carried && placedCount > 0;
    if (gentle) seedUnplacedNodes(cy, unplacedIds);
    // 「島の配置」(layoutMode==="islands"): 2 段階で組む。
    //   1 段目（物理・fcose）: フォーカス種類のノード + 重心ダミー + それらの
    //     間の辺（直接の実辺 + 射影の不可視エッジ）だけを対象にする
    //     （cy.collection().layout(...)）。フォーカス以外の実ノード（例:
    //     focus=note なら知見・原料・話題）と衛星は質量が大きく、混ぜると
    //     1 つの密な網から分かれなかったため対象から外す。
    //   2 段目（幾何・layoutstop で同期的に）: フォーカス以外の実ノードは隣接
    //     フォーカスノードの平均位置へ、衛星は親ノートの周りのリングへ、
    //     幾何計算で直接置く（placeIslandGeometry）。
    // gravity・重心の弾性は clusterByContext と同じ考え方（引き寄せを弱め、
    // 塊同士が離れられるようにする）。plain / clusterByContext 単独のときは
    // どちらも今のまま（1 段のみ・cy 全体が対象）。
    const reachNorm = (id: string): number => {
      if (!reachScores || maxReachScore <= 0) return 0;
      return (reachScores.get(id) ?? 0) / maxReachScore;
    };
    const baseRepulsion = clusterByContext ? 30000 : 9000;
    const baseLen = clusterByContext ? 300 : 110;
    const baseEl = clusterByContext ? 0.2 : 0.4;

    // crystal フォーカスは話題だけが物理参加集合（analyzeCrystalIslands は
    // effect 冒頭で計算済み）。それ以外は generic な isFocused ベースの集合。
    // crystal の話題どうしの辺は実辺ではなく射影（projection）だけなので、
    // 下の physicsEdges フィルタは既存の projection 分岐がそのまま拾う。
    const focusIds =
      crystalAnalysis?.topicIds ??
      new Set(shownNodes.filter((n) => isFocused(n, effectiveFocus)).map((n) => n.id));
    // 1 段目の対象コレクション。islands のときだけ絞る（フォーカス種類 + 重心
    // ダミー + それらの間の辺で、重心の不可視エッジもメンバーがフォーカス種類の
    // ものだけに絞る——フォーカス以外向けの重心エッジは 2 段目で扱う）。
    let physicsEles: any = cy.elements();
    if (islands) {
      const physicsNodes = cy.nodes().filter((n: any) => n.hasClass("cluster-hub") || focusIds.has(n.id()));
      const physicsEdges = cy.edges().filter((e: any) => {
        if (e.data("satellite")) return false;
        if (e.data("projection")) return true; // 射影の不可視エッジ。両端は常にフォーカス種類
        if (e.data("virtual")) {
          const source = e.source();
          const target = e.target();
          const member = source.hasClass("cluster-hub") ? target : source;
          return focusIds.has(member.id());
        }
        return focusIds.has(e.source().id()) && focusIds.has(e.target().id());
      });
      physicsEles = physicsNodes.union(physicsEdges);
    }

    const lay = physicsEles.layout({
      name: "fcose",
      animate: true,
      animationDuration: gentle ? 400 : 700,
      randomize: !gentle,
      quality: "default",
      nodeRepulsion: islands
        ? (node: any) => baseRepulsion * (1 + 6 * reachNorm(node.id()))
        : baseRepulsion,
      idealEdgeLength: (edge: any) =>
        edge.data("projection")
          ? 110
          : edge.data("virtual")
            ? 35
            : islands
              ? baseLen * (1 - 0.6 * Math.max(reachNorm(edge.source().id()), reachNorm(edge.target().id())))
              : baseLen,
      edgeElasticity: (edge: any) =>
        edge.data("projection")
          // crystal の話題どうしの射影は共有する知見の数（sharedCount）に比例
          // して弾性を強める（source の射影は sharedCount を持たないので既定 1
          // ＝今までどおり 0.4 のまま）。
          ? 0.4 * Math.min(edge.data("sharedCount") ?? 1, 5)
          : edge.data("virtual")
            ? islands
              ? 1.2
              : 0.9
            : islands
              ? baseEl * (1 + 2 * Math.max(reachNorm(edge.source().id()), reachNorm(edge.target().id())))
              : baseEl,
      gravity: islands || clusterByContext ? 0.06 : 0.3,
      nodeSeparation: islands ? 60 : 120,
      padding: 50,
    } as any);
    lay.on("layoutstop", () => {
      layoutRunning = false;
      // 2 段目（幾何）: 1 段目が置いたフォーカスノード・重心の位置を土台に、
      // フォーカス以外の実ノードと衛星を直接配置する。ドラッグ中の移動を
      // 打ち消さないよう、fit の前に済ませる（fit 自体はドラッグで止めた場合は
      // スキップする）。
      if (crystalAnalysis) {
        placeCrystalIslandGeometry(cy, {
          shownNodes,
          shownEdges,
          foldedOutNodes,
          foldedInto,
          sharedClaimIds: crystalAnalysis.sharedClaimIds,
        });
      } else if (islands) {
        placeIslandGeometry(cy, { shownNodes, shownEdges, focusIds, foldedOutNodes, foldedInto });
      }
      // ドラッグで止めた場合は fit しない（勝手に視点が動くと戻されたように見える）
      if (!layoutStoppedByUser) cy.fit(undefined, 30);
    });
    layoutRunning = true;
    lay.run();
    detachGrabStop = stopLayoutOnGrab(cy, {
      stop: () => {
        layoutStoppedByUser = true;
        lay.stop();
      },
    });
    }

    // ドラッグ終了で現在の並びを保存し、その後で（待たせていた）組み直しを許可する
    const detachPersistence = attachCytoscapeLayoutPersistence(cy, (positions, movedMultiple) => {
      saveLayoutRef.current(positions, movedMultiple);
      endDragRef.current();
    });
    const onDragStart = () => beginDrag();
    cy.on("drag", "node", onDragStart);
    // 複数選択中はグループを囲む矩形を出す（React Flow と同じ見え方）
    const detachSelectionBounds = attachSelectionBoundsOverlay(cy);

    // ホバーで隣接を強調
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      const nb = node.neighborhood();
      cy.elements().addClass("faded");
      node.removeClass("faded").addClass("hover");
      nb.removeClass("faded");
      nb.edges().addClass("hover-connected");
      containerRef.current!.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("faded hover hover-connected");
      // 検索中なら hover で消えた強調・フェードを復元する
      applySearchHighlight(cy, searchRef.current);
      containerRef.current!.style.cursor = "grab";
    });

    // ノードクリック → ナビゲーション（2 ホップグラフ view.tsx と同じ振り分け）
    cy.on("tap", "node", (evt) => {
      const id: string = evt.target.id();
      const externalUrl: string | undefined = evt.target.data("externalUrl");
      if (id.startsWith("pdf:")) {
        onOpenMedia?.(id.slice(4));
        return;
      }
      if (id.startsWith("document:")) {
        onOpenMedia?.(id.slice("document:".length));
        return;
      }
      if (id.startsWith("chat:")) return;
      if (id.startsWith("memo:")) {
        // メモ由来ソースはメモギャラリーの該当詳細を開く（未配線なら表示のみ）
        onOpenMemo?.(id.slice("memo:".length));
        return;
      }
      if (id.startsWith("url:")) {
        if (externalUrl) {
          // アプリ内（素材の URL リーダー）を優先。未配線の文脈のみ外部ブラウザ。
          if (onOpenUrl) onOpenUrl(externalUrl);
          else void openExternalUrl(externalUrl);
        }
        return;
      }
      const isWiki = !!evt.target.data("isWiki");
      onNavigate?.(isWiki ? `wiki:${id}` : id);
    });

    cyRef.current = cy;
    return () => {
      cy.off("drag", "node", onDragStart);
      detachSelectionBounds();
      detachGrabStop?.();
      detachPersistence();
      // 次のグラフ（この cleanup の直後に組まれる）へ座標と視点を渡してから破棄する
      carryOver.keep(cy, !layoutRunning || layoutStoppedByUser);
      cy.destroy();
      cyRef.current = null;
    };
    // savedPositions / saveLayout は ref 経由で読む（依存に入れると
    // ドラッグ → 保存 → 再構築のループになる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    renderKey,
    clusterByContext,
    layoutMode,
    focusLayer,
    onNavigate,
    onOpenMedia,
    onOpenUrl,
    onOpenMemo,
    layoutReady,
    layoutResetSeq,
    beginDrag,
  ]);

  // 色モード切替: cy を作り直さず data 書き換えのみ（レイアウト・ズームを保つ）
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const byId = new Map(shownNodes.map((n) => [n.id, n]));
    cy.batch(() => {
      cy.nodes().forEach((cn) => {
        const n = byId.get(cn.id());
        if (!n) return;
        const { fill, border } = nodeColors(n, colorMode);
        cn.data("color", fill);
        cn.data("borderColor", border);
      });
    });
  }, [colorMode, shownNodes]);

  // 大きさモード切替: cy を作り直さず data 書き換えのみ（レイアウト・ズームを保つ）。
  // フォーカス以外（islands で残る橋ノード）・衛星は sizeForNode 内で別枠で扱う。
  // reach は絶対値ではなく、表示中フォーカスノードの分布に対する相対値で決める
  // （最大のノードが +48、0 なら +0＝今のまま）。
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const byId = new Map(shownNodes.map((n) => [n.id, n]));
    cy.batch(() => {
      cy.nodes().forEach((cn) => {
        const n = byId.get(cn.id());
        if (!n) return;
        const kind = kindOf(n);
        const size = sizeForNode(n, kind, { layoutMode, focus: effectiveFocus, sizeMode, reachScores, maxReachScore });
        cn.data("size", size);
      });
    });
  }, [sizeMode, reachScores, maxReachScore, shownNodes, layoutMode, effectiveFocus]);

  // 検索: クラス操作のみ（destroy・再レイアウトなし）。
  // メイン effect より後に宣言してあるので、cy 再構築直後にも再適用される。
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      onSearchHits?.(0);
      return;
    }
    const hits = applySearchHighlight(cy, searchQuery);
    jumpIndexRef.current = 0;
    onSearchHits?.(hits);
  }, [searchQuery, shownNodes, shownEdges, onSearchHits]);

  // Enter で次のヒットへパン（ズームは保持、巡回する）
  useEffect(() => {
    if (!searchJumpToken) return;
    const cy = cyRef.current;
    if (!cy) return;
    const hits = cy.nodes(".search-hit");
    if (hits.length === 0) return;
    const target = hits[jumpIndexRef.current % hits.length];
    jumpIndexRef.current += 1;
    cy.stop();
    cy.animate({ center: { eles: target }, duration: 300, easing: "ease-in-out-sine" } as any);
  }, [searchJumpToken]);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", background: GRAPH_BG_COLOR }} />
      <GraphSelectionHint show={showSelectionHint} />
      {/* 手で整えた並びがあるときだけ、自動配置に戻す入口を出す */}
      {hasSavedLayout && (
        <button
          onClick={() => {
            // 引き継ぎは次の構築で捨てられる（useGraphCarryOver が resetSeq の変化を見る）
            resetLayout();
          }}
          title={t("graph.layout.resetHint")}
          aria-label={t("graph.layout.reset")}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(30, 20, 10, 0.08)",
          }}
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  );
}

// ── 凡例・トグル・層チップ・列ヘッダ ──

// エッジ（relation）凡例。線の意味（派生/素材利用/参照）は色モードに依存しない共通概念
// なので、種類凡例（Legend）と文脈凡例（ContextLegend）の両方から使う。
// 表示中サブグラフに実在する relation だけ出す（画面と凡例が常に一致）。
function RelationLegendItems({ data }: { data: NoteGraphData }) {
  const t = useT();
  const presentRels = useMemo(
    () => new Set(data.edges.map((e) => e.relation ?? "derived")),
    [data],
  );
  const relItems = ([
    { rel: "derived", label: t("globalGraph.relation.derived"), dashed: false },
    { rel: "used", label: t("globalGraph.relation.used"), dashed: false },
    { rel: "reference", label: t("globalGraph.relation.reference"), dashed: true },
  ] as { rel: EdgeRelation; label: string; dashed: boolean }[]).filter((i) => presentRels.has(i.rel));
  return (
    <>
      {relItems.map(({ rel, label, dashed }) => (
        <span key={rel} className="flex items-center gap-1">
          <span
            style={{
              width: 16,
              height: 0,
              borderTop: `2px ${dashed ? "dashed" : "solid"} ${REL_COLOR[rel]}`,
              display: "inline-block",
            }}
          />
          {label}
        </span>
      ))}
    </>
  );
}

// 凡例は「今画面に出ているサブグラフ」駆動: 実際に描画中の kind / relation だけ出す。
// 孤立や層フィルタで synthesis(発想) 等が 1 つも見えなければ凡例にも出さない＝
// 画面と凡例が常に一致する。撤退済み kind の常設表示で混乱させないための作り。
function Legend({ data }: { data: NoteGraphData }) {
  const t = useT();
  const presentKinds = useMemo(() => new Set(data.nodes.map(kindOf)), [data]);
  const kindItems = ([
    { kind: "external", label: t("globalGraph.kind.external") },
    { kind: "note", label: t("globalGraph.kind.note") },
    { kind: "topic", label: t("knowledge.kind.topic") },
    { kind: "claim", label: t("knowledge.kind.claim") },
    { kind: "atom", label: t("knowledge.kind.atom") },
    { kind: "summary", label: t("knowledge.kind.summary") },
    { kind: "synthesis", label: t("knowledge.kind.synthesis") },
  ] as { kind: GraphKind; label: string }[]).filter((i) => presentKinds.has(i.kind));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {kindItems.map(({ kind, label }) => (
        <span key={kind} className="flex items-center gap-1">
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: kind === "atom" ? 2 : 4,
              transform: kind === "atom" ? "rotate(45deg)" : undefined,
              background: kindFill(kind),
              border: `2px solid ${kindBorder(kind)}`,
              display: "inline-block",
            }}
          />
          {label}
        </span>
      ))}
      {kindItems.length > 0 && data.edges.length > 0 && <span className="w-px h-3 bg-border" />}
      <RelationLegendItems data={data} />
    </div>
  );
}

// 文脈タグ色モードの凡例 兼 絞り込みチップ。
// タグ集計は全データ駆動（絞り込み後の shown 駆動だと、絞り込んだ瞬間に他のチップが
// 消えて解除できなくなる）。選択が空 = 絞り込みなし（全表示）。チップクリックでトグル。
// 見た目は ContextBadge（淡背景 + 濃文字）に合わせ、選択中は濃背景 + 白文字で反転。
// エッジ凡例（edgeData=表示中サブグラフ駆動）は共通概念なのでこちらのモードでも出す。
function ContextLegend({
  data,
  edgeData,
  selected,
  onToggle,
  hideUncategorized,
  onToggleUncategorized,
}: {
  data: NoteGraphData;
  /** エッジ凡例用の表示中サブグラフ（タグ集計の data とは駆動元が違う）。 */
  edgeData: NoteGraphData;
  /** 選択中タグ（小文字キー）。 */
  selected: Set<string>;
  onToggle: (key: string) => void;
  /** 未分類（タグ無しの通常ノート）を隠しているか。凡例の未分類チップがトグルになる。 */
  hideUncategorized: boolean;
  onToggleUncategorized: () => void;
}) {
  const t = useT();
  const tags = useMemo(() => aggregateNoteContexts(data.nodes), [data]);
  // 未分類 = 「文脈を持てるのに付いていない」通常ノートのみ。外部ソース・結晶
  // （wiki）は文脈を持たせられない層なのでカウントに含めない。
  const uncategorized = useMemo(
    () =>
      data.nodes.filter(
        (n) => !n.external && !n.isWiki && !(n.noteContexts && n.noteContexts.length > 0),
      ).length,
    [data],
  );
  if (tags.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>{t("globalGraph.noContexts")}</span>
        {edgeData.edges.length > 0 && <span className="w-px h-3 bg-border" />}
        <RelationLegendItems data={edgeData} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      {tags.map(({ value, count }) => {
        const key = value.toLowerCase();
        const h = noteContextHue(value);
        const on = selected.has(key);
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border transition-colors"
            style={
              on
                ? {
                    backgroundColor: `hsl(${h} 45% 45%)`,
                    color: "#fff",
                    borderColor: `hsl(${h} 45% 38%)`,
                  }
                : {
                    backgroundColor: `hsl(${h} 45% 45% / 0.12)`,
                    color: `hsl(${h} 45% 40%)`,
                    borderColor: `hsl(${h} 45% 45% / 0.30)`,
                  }
            }
          >
            {value}
            <span className="opacity-70">{count}</span>
          </button>
        );
      })}
      {uncategorized > 0 && (
        // タグチップと同じ操作体系: クリックで未分類の表示/非表示をトグル。
        // 非表示中は薄く + 打ち消し線で「消してある」ことを示す。
        <button
          onClick={onToggleUncategorized}
          title={t("globalGraph.toggleUncategorizedHint")}
          className={`flex items-center gap-1 text-muted-foreground transition-opacity ${
            hideUncategorized ? "opacity-40 line-through" : ""
          }`}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: UNCAT_FILL,
              border: `2px solid ${UNCAT_BORDER}`,
              display: "inline-block",
            }}
          />
          {t("globalGraph.uncategorized")}
          <span className="opacity-70">{uncategorized}</span>
        </button>
      )}
      {edgeData.edges.length > 0 && <span className="w-px h-3 bg-border mx-1" />}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <RelationLegendItems data={edgeData} />
      </span>
    </div>
  );
}

// 各層のチップに「その層に属するノード総数」を出す。
// 統合(60)のように数はあるのに孤立で非表示、という状態をユーザーが把握できる。
// 総数 0 の層はグレーアウトして押せなくする（その層がデータに無いことが分かる）。
//
// layoutMode: islands のときは「フォーカス（1 つ選ぶ）」に変わる（mode="focus"）。
// 選んだ種類が物理配置の中心になり、それ以外は小さくなって幾何配置される
// （global-graph-structure.ts の FocusLayer/detectFocusCommunities）。
// plain のときは今までどおり表示/非表示のトグル（mode="visibility"、既定）。
function LayerChips({
  visible,
  counts,
  onToggle,
  mode = "visibility",
  focus,
  onFocusChange,
}: {
  visible: Set<LayerId>;
  counts: Record<LayerId, number>;
  onToggle: (id: LayerId) => void;
  mode?: "visibility" | "focus";
  focus?: FocusLayer;
  onFocusChange?: (id: FocusLayer) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5" title={mode === "focus" ? t("globalGraph.focusHint") : undefined}>
      {ALL_LAYERS.map((id) => {
        const on = mode === "focus" ? focus === id : visible.has(id);
        const count = counts[id] ?? 0;
        const empty = count === 0;
        return (
          <button
            key={id}
            onClick={() => {
              if (empty) return;
              if (mode === "focus") onFocusChange?.(id as FocusLayer);
              else onToggle(id);
            }}
            disabled={empty}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
              empty
                ? "bg-muted/50 text-muted-foreground/40 border-border/50 cursor-default"
                : on
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {t(`globalGraph.layer.${id}` as any)}
            <span className="ml-1 opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 全体グラフビュー（右コンテンツ領域に描画。サイドバーは残る） ──
//
// 以前は全画面 portal だったが、他の画面（ノート一覧・素材など）と揃えて
// <main> 内に描画する content-area ビューにした。ノード単クリックは onSelectNote で
// 親に通知し、親側が共有 SidePeek を開いて中身をプレビューする（本開きは SidePeek 内から）。

export function GlobalGraphView({
  data,
  onSelectNote,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
  onClose,
  insightsEnabled = true,
  mode = "overview",
  onModeChange,
  timeline,
  initialFoldLeaves,
  initialSizeMode,
  initialLayoutMode,
  initialFocusLayer,
}: {
  data: NoteGraphData;
  /** ノード単クリック。noteId は wiki ノードに `wiki:` prefix が付く（SidePeek の規約に合わせる）。 */
  onSelectNote?: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /** URL ソースノードをアプリ内で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースノードをメモギャラリーの該当詳細で開く。未指定なら表示のみ。 */
  onOpenMemo?: (captureId: string) => void;
  /** Esc で全体グラフ表示を閉じてエディタに戻る（通常の画面切替は左ナビから行う）。 */
  onClose: () => void;
  /** 洞察（Atom）レイヤの表示可否（設定の features.insights、既定 true）。
   *  false のとき Atom ノードと凡例を隠す。claim / synthesis には影響しない。 */
  insightsEnabled?: boolean;
  /** 俯瞰 / 時系列のどちらを表示するか（未指定なら俯瞰固定でサブタブも出さない） */
  mode?: "overview" | "timeline";
  onModeChange?: (mode: "overview" | "timeline") => void;
  /** 時系列モードの本体（ローカルビュー）。渡されたときだけ「俯瞰 / 時系列」サブタブを出す */
  timeline?: ReactNode;
  /** 「葉を畳む」の初期値（Storybook の比較用。未指定なら false = 今の挙動）。保存はしない。 */
  initialFoldLeaves?: boolean;
  /** 大きさモードの初期値（Storybook の比較用。未指定なら "kind" = 今の挙動）。保存はしない。 */
  initialSizeMode?: "kind" | "reach";
  /** 配置モードの初期値（Storybook の比較用。未指定なら "plain" = 今の挙動）。保存はしない。 */
  initialLayoutMode?: "plain" | "islands";
  /** フォーカス種類の初期値（Storybook の比較用。未指定なら "note" = 今の挙動）。
   *  layoutMode: islands のときだけ効く。保存はしない。 */
  initialFocusLayer?: FocusLayer;
}) {
  const t = useT();
  const [hideRefs, setHideRefs] = useState(false);
  const [showIsolated, setShowIsolated] = useState(false);
  const [visible, setVisible] = useState<Set<LayerId>>(new Set(ALL_LAYERS));
  // 色の軸（kind=種類 / context=文脈タグ）と、文脈タグ絞り込み（小文字キー）
  const [colorMode, setColorMode] = useState<GraphColorMode>("kind");
  const [selectedContexts, setSelectedContexts] = useState<Set<string>>(new Set());
  // 同じ文脈タグのノードを引き寄せてクラスターにする（レイアウト再実行を伴う）
  const [clusterByContext, setClusterByContext] = useState(false);
  // 未分類（タグ無しの通常ノート）を隠す。凡例の未分類チップでトグル
  const [hideUncategorized, setHideUncategorized] = useState(false);
  // 構造の提案（Storybook 合意用の props 切替）: 葉を畳む / 大きさをつながりで決める
  const [foldLeaves, setFoldLeaves] = useState(initialFoldLeaves ?? false);
  const [sizeMode, setSizeMode] = useState<"kind" | "reach">(initialSizeMode ?? "kind");
  // 配置: 標準（今の fcose 定数）/ 島（つながりの多いノートが周りを引き寄せる）
  const [layoutMode, setLayoutMode] = useState<"plain" | "islands">(initialLayoutMode ?? "plain");
  // 島モードで「何を中心に島を作るか」（既定 note）。plain のときは無視される。
  const [focusLayer, setFocusLayer] = useState<FocusLayer>(initialFocusLayer ?? "note");
  // layoutMode: islands のときだけ focusLayer を効かせる（plain の既定挙動は変えない）。
  const effectiveFocus: FocusLayer = layoutMode === "islands" ? focusLayer : "note";
  // 配置切替。islands に入るときは層チップを「フォーカス」として使うので、
  // 表示している層を全部戻す（隠れていると島の中心にできない）。plain に戻す
  // ときはチップは今の表示/非表示のままにする（visible には触らない）。
  const changeLayoutMode = (m: "plain" | "islands") => {
    setLayoutMode(m);
    if (m === "islands") setVisible(new Set(ALL_LAYERS));
  };
  // 検索（ヒット強調 + Enter 巡回。レイアウトは動かさない）
  const [searchInput, setSearchInput] = useState("");
  const [searchJumpToken, setSearchJumpToken] = useState(0);
  const [searchHits, setSearchHits] = useState(0);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 層・参照・文脈タグフィルタ適用後の「全ノード版」と「連結のみ版」を両方求め、
  // 表示用サブグラフ（shown）と隠れている孤立ノード数（isolatedCount）を導く。
  const { shown, isolatedCount } = useMemo(() => {
    const base = {
      visibleLayers: visible,
      hideReferences: hideRefs,
      contextFilter: selectedContexts,
      hideUncategorized,
      hideAtoms: !insightsEnabled,
    };
    const withIsolated = filterGlobalGraph(data, { ...base, hideIsolated: false });
    const connectedOnly = filterGlobalGraph(data, { ...base, hideIsolated: true });
    return {
      shown: showIsolated ? withIsolated : connectedOnly,
      isolatedCount: withIsolated.nodes.length - connectedOnly.nodes.length,
    };
  }, [data, visible, hideRefs, showIsolated, selectedContexts, hideUncategorized, insightsEnabled]);

  // 「葉を畳む」を今の表示中サブグラフ（shown）に適用した結果。チェックの ON/OFF に
  // 関わらず常に計算する（OFF でも「畳んだらどれだけ減るか」をチェック横に出すため）。
  const foldResult = useMemo(
    () => computeFocusFoldResult(shown, effectiveFocus),
    [shown, effectiveFocus],
  );
  const foldedTotal = foldResult.foldedTotal;
  // 畳まれた葉の実体（layoutMode: islands で「衛星」として描き直すために Canvas へ渡す）
  const foldedOutNodes = useMemo(
    () => shown.nodes.filter((n) => foldResult.foldedInto.has(n.id)),
    [shown, foldResult],
  );
  // ヘッダー右の件数表示は「畳む」が ON なら畳んだ後の数（実際に描画される数）にする。
  // 各層チップ（原料/ノート/知見・洞察）は畳む前の総数のまま変えない。
  // foldResult.data は畳んだ葉（衛星として別描画するもの）を既に取り除いた集合
  // なので、ここには衛星を数え直す必要はない（畳む前の集合は shown 側）。
  const displayedNodeCount = foldLeaves ? foldResult.data.nodes.length : shown.nodes.length;
  const displayedEdgeCount = foldLeaves ? foldResult.data.edges.length : shown.edges.length;

  // 各層のノード総数（孤立含む・フィルタ前）。チップの件数表示に使う。
  // 洞察（features.insights）OFF の Atom だけは数えない — 機能として存在しない扱いなので、
  // 「結晶」チップの件数が描画されるノード数と食い違わないようにする（凡例と同じ扱い）。
  const layerCounts = useMemo(() => {
    const m: Record<LayerId, number> = { source: 0, note: 0, crystal: 0, synth: 0 };
    for (const n of data.nodes) {
      const kind = kindOf(n);
      if (!insightsEnabled && kind === "atom") continue;
      m[KIND_LAYER[kind]]++;
    }
    return m;
  }, [data, insightsEnabled]);

  const toggleLayer = (id: LayerId) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleContext = (key: string) =>
    setSelectedContexts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // モード切替は層の既定もセットで切り替える:
  // 文脈モードは「文脈を持てるノート層」だけを表示（原料・結晶は noteContexts を
  // 持たないため常に未分類となり、色分けのノイズ＋クラスター間の詰め物になる）。
  // 層チップは残すので、文脈モード中でも手動で原料・結晶を再表示できる。
  // 種類モードに戻したら全層+絞り込み解除+クラスターも解除（文脈系の状態を畳む）。
  const changeColorMode = (m: GraphColorMode) => {
    setColorMode(m);
    if (m === "kind") {
      setSelectedContexts(new Set());
      setClusterByContext(false);
      setHideUncategorized(false);
      setVisible(new Set(ALL_LAYERS));
    } else {
      setVisible(new Set<LayerId>(["note"]));
    }
  };

  // Esc で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="flex flex-col h-full w-full" style={{ background: GRAPH_BG_COLOR }}>
      {/* ヘッダー / ツールバー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-wrap">
        <span className="text-sm font-bold text-foreground">{t("globalGraph.title")}</span>
        {/* 俯瞰 / 時系列サブタブ（timeline が渡されたときだけ出す。graph-links-panel.tsx と同じ作り） */}
        {timeline && onModeChange && (
          <div className="flex items-center gap-0.5 rounded-md border border-border overflow-hidden">
            {([
              { key: "overview" as const, icon: <Network size={12} />, label: t("globalGraph.mode.overview") },
              { key: "timeline" as const, icon: <Waypoints size={12} />, label: t("globalGraph.mode.timeline") },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => onModeChange(tab.key)}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold transition-colors ${
                  mode === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {mode === "overview" && (
          <>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={hideRefs} onChange={(e) => setHideRefs(e.target.checked)} />
              {t("globalGraph.hideReferences")}
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title={t("globalGraph.showIsolatedHint")}>
              <input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} />
              {t("globalGraph.showIsolated")}
              {isolatedCount > 0 && <span className="opacity-70">({isolatedCount})</span>}
            </label>
            {/* 構造の提案（Storybook 合意用）: 葉を畳む */}
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title={t("globalGraph.foldLeavesHint")}>
              <input type="checkbox" checked={foldLeaves} onChange={(e) => setFoldLeaves(e.target.checked)} />
              {t("globalGraph.foldLeaves")}
              {foldedTotal > 0 && <span className="opacity-70">(−{foldedTotal})</span>}
            </label>
            <LayerChips
              visible={visible}
              counts={layerCounts}
              onToggle={toggleLayer}
              mode={layoutMode === "islands" ? "focus" : "visibility"}
              focus={focusLayer}
              onFocusChange={setFocusLayer}
            />
            {/* 色の軸切替（種類 ⇄ 文脈タグ） */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{t("globalGraph.colorBy")}</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                {(["kind", "context"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => changeColorMode(m)}
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      colorMode === m
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(`globalGraph.colorMode.${m}` as any)}
                  </button>
                ))}
              </div>
            </div>
            {/* 構造の提案（Storybook 合意用）: 大きさをつながりで決める */}
            <div className="flex items-center gap-1.5" title={t("globalGraph.sizeReachHint")}>
              <span className="text-[11px] text-muted-foreground">{t("globalGraph.size")}</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                {(["kind", "reach"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSizeMode(m)}
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      sizeMode === m
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(`globalGraph.size.${m}` as any)}
                  </button>
                ))}
              </div>
            </div>
            {/* 構造の提案（Storybook 合意用）: 引力で島を作る */}
            <div className="flex items-center gap-1.5" title={t("globalGraph.layoutIslandsHint")}>
              <span className="text-[11px] text-muted-foreground">{t("globalGraph.layout")}</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                {(["plain", "islands"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => changeLayoutMode(m)}
                    className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      layoutMode === m
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(`globalGraph.layout.${m}` as any)}
                  </button>
                ))}
              </div>
            </div>
            {colorMode === "context" && (
              <label
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
                title={t("globalGraph.clusterByContextHint")}
              >
                <input
                  type="checkbox"
                  checked={clusterByContext}
                  onChange={(e) => setClusterByContext(e.target.checked)}
                />
                {t("globalGraph.clusterByContext")}
              </label>
            )}
            <span className="ml-auto flex items-center gap-3">
              {/* 検索: ヒットを強調 + Enter でヒットへ順にパン（Esc でクリア） */}
              <span className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  {...compositionHandlers}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isImeKey(e)) {
                      setSearchJumpToken((v) => v + 1);
                    } else if (e.key === "Escape" && searchInput) {
                      // 検索中の Esc はクリアのみ（グラフ自体は閉じない）
                      e.stopPropagation();
                      setSearchInput("");
                    }
                  }}
                  {...listSearchInputProps}
                  placeholder={t("common.search")}
                  className="text-xs pl-7 pr-8 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 w-44 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                {searchInput.trim() && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">
                    {searchHits}
                  </span>
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {displayedNodeCount} / {displayedEdgeCount}
              </span>
            </span>
          </>
        )}
      </div>
      {mode === "timeline" ? (
        // 時系列モード: 俯瞰用の凡例・キャンバスは描かず、ローカルビュー本体をそのまま表示する
        <div className="flex-1 min-h-0">{timeline}</div>
      ) : (
        <>
          {/* 凡例（色モードに追従: ノード凡例だけ切替、エッジ凡例は共通で常時表示） */}
          <div className="px-4 py-2 border-b border-border">
            {colorMode === "context" ? (
              <ContextLegend
                data={data}
                edgeData={shown}
                selected={selectedContexts}
                onToggle={toggleContext}
                hideUncategorized={hideUncategorized}
                onToggleUncategorized={() => setHideUncategorized((v) => !v)}
              />
            ) : (
              <Legend data={shown} />
            )}
          </div>
          {/* キャンバス */}
          <div className="flex-1 min-h-0">
            {shown.nodes.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                {t("globalGraph.empty")}
              </div>
            ) : (
              <GlobalGraphCanvas
                data={data}
                visibleLayers={visible}
                hideReferences={hideRefs}
                hideIsolated={!showIsolated}
                colorMode={colorMode}
                contextFilter={selectedContexts}
                hideUncategorized={hideUncategorized}
                hideAtoms={!insightsEnabled}
                clusterByContext={clusterByContext}
                foldLeaves={foldLeaves}
                sizeMode={sizeMode}
                layoutMode={layoutMode}
                focusLayer={focusLayer}
                precomputedFold={{
                  data: foldResult.data,
                  foldedCount: foldResult.foldedCount,
                  foldedInto: foldResult.foldedInto,
                  foldedOutNodes,
                }}
                searchQuery={searchInput}
                searchJumpToken={searchJumpToken}
                onSearchHits={setSearchHits}
                onNavigate={onSelectNote}
                onOpenMedia={onOpenMedia}
                onOpenUrl={onOpenUrl}
                onOpenMemo={onOpenMemo}
                height="100%"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
