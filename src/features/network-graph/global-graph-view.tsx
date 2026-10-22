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
import { TOPIC_TYPES, type TopicType } from "../../lib/document-types";
import type { ReactNode } from "react";
import { RotateCcw, Search } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { knowledgeKindColor, knowledgeKindBorder } from "./knowledge-colors";
import { openExternalUrl } from "../../lib/external-link";
import { classifyNodeTap } from "./external-source";
import { SIDE_PEEK_INLINE_MIN_WIDTH } from "../../hooks/use-resizable-width";

/** 来歴パネル（graph-lineage-side-panel.tsx）の幅と、ピークを並べるときに残すキャンバスの幅 */
const GRAPH_LINEAGE_PANEL_WIDTH = 360;
const GRAPH_CANVAS_MIN_WIDTH = 360;
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
import { fitAvoidingHint } from "./fit-with-clearance";
import {
  GRAPH_BG_COLOR,
  GRAPH_INIT_OPTIONS,
  baseEdgeStyle,
  baseNodeStyle,
  hoverFullLabelStyle,
  interactionStyles,
  GRAPH_LABEL_FONT_SIZE,
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
import { resolveOverlaps, resolveGroupedOverlaps, type OverlapItem } from "./overlap-resolver";
import { pullBySimilarity, type SimilarityItem } from "./similarity-pull";
import { loadSimilarityVectors } from "./similarity-vectors";
import { visibleNeighborhood } from "./hover-neighborhood";
import { applyGraphFilter, type GraphFilter } from "./graph-filter";
import { summarizeIslands } from "./island-summary";
import { IslandLabelsOverlay, IslandPanel } from "./island-labels";

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
    /** 隠すトピックの種類（"unset" = 未分類）。topicTypeById が無ければ無視 */
    hideTopicTypes?: Set<string>;
    topicTypeById?: ReadonlyMap<string, { topicType?: TopicType } | undefined>;
  },
): NoteGraphData {
  const {
    visibleLayers,
    hideReferences = false,
    hideIsolated = false,
    contextFilter,
    hideUncategorized = false,
    hideAtoms = false,
    hideTopicTypes,
    topicTypeById,
  } = opts;
  const hideByTopicType = (n: NoteNode): boolean =>
    !!hideTopicTypes && hideTopicTypes.size > 0 && !!topicTypeById && kindOf(n) === "topic"
    && hideTopicTypes.has(topicTypeById.get(n.id)?.topicType ?? "unset");
  const visibleIds = new Set(
    data.nodes
      .filter((n) => visibleLayers.has(KIND_LAYER[kindOf(n)]))
      .filter((n) => !(hideAtoms && kindOf(n) === "atom"))
      .filter((n) => !hideByTopicType(n))
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

/** これより多いノードを物理配置するときは、配置アニメーションを切る */
const LAYOUT_ANIMATION_MAX_NODES = 300;

const REL_COLOR: Record<EdgeRelation, string> = {
  derived: "#4B7A52",
  used: "#9aa0a6",
  reference: "#5b8fb9",
};


// ── Cytoscape スタイル ──

/** ズーム z でのラベルのフォント（モデル座標 px）。画面上の大きさは px·z = 11·√z で、
 *  寄せても文字がノードほど大きくならず、引くと 7px を切って描かれなくなる。 */
export function labelFontSizeForZoom(zoom: number): number {
  const base = parseFloat(GRAPH_LABEL_FONT_SIZE);
  return Math.max(4, Math.min(base, base / Math.sqrt(Math.max(zoom, 0.05))));
}

export const globalGraphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      ...baseNodeStyle,
      // 画面上のフォントがこれより小さくなる倍率ではラベルを描かない（灰色の帯にしない）
      "min-zoomed-font-size": 7,
      // 全体グラフはアニメーションを切る。ホバーで全要素（2,000 超）の不透明度が
      // 同時に 0.2 秒アニメーションし、1 回のホバーが重くなっていた（計測で約 2 倍）
      "transition-duration": 0 as any,
      "background-color": "data(color)",
      "border-color": "data(borderColor)",
      shape: "data(shape)" as any,
      width: "data(size)",
      height: "data(size)",
    },
  },
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
    selector: "edge",
    style: {
      ...baseEdgeStyle,
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "line-style": "data(lineStyle)" as any,
      // 全体グラフはエッジが多いので、既定より少しだけ引く
      opacity: 0.85,
      "transition-duration": 0 as any,
    },
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
  // 絞り込みの「周辺」（一致から 1 ホップ）は少し薄く。主役と文脈を見分けるため。
  // ホバーの faded より前に置き、ホバー時はさらに薄くなれるようにする
  { selector: "node.filter-context", style: { opacity: 0.55 } },
  { selector: "edge.filter-context", style: { opacity: 0.4 } },
  // ホバー時の faded / hover は、辺の基本スタイル（opacity 0.85）や衛星ノード（0.85）より
  // 後に置く。Cytoscape は後の規則が勝つので、前に置くと薄くならない（ホバーしても
  // 無関係な矢印と畳んだ知見が目立ったままだった）。不可視の cluster-edge / cluster-hub は
  // opacity 0 を保ちたいので faded の後ろに置く。search-hit は faded より優先するため最後。
  ...interactionStyles,
  hoverFullLabelStyle,
  { selector: "edge.hover-connected", style: { width: 2.5, opacity: 1, "z-index": 10 } },
  {
    // 「文脈で寄せる」・島の重心・射影用の不可視エッジ。描画・操作はさせず
    // fcose の引力計算にだけ効かせる（display:none だとレイアウト対象から
    // 外れるので opacity 0 で隠す）。これらの要素は data(color)/data(lineStyle)
    // を持たない（隠すだけで見た目は関係ない）ので、汎用 edge セレクタの
    // data() マッピングに任せず、ここで固定値を明示して cytoscape の
    // 「マップ先の data が無い」警告を避ける。
    selector: "edge.cluster-edge",
    style: {
      opacity: 0,
      events: "no" as any,
      "line-color": "#000" as any,
      "target-arrow-color": "#000" as any,
      "line-style": "solid" as any,
    },
  },
  {
    // クラスタ重心のダミーハブノード。見えない・触れないがレイアウトには参加し、
    // ハブ同士の反発でクラスタ間の距離を生む。
    selector: "node.cluster-hub",
    style: {
      opacity: 0,
      events: "no" as any,
      label: "",
      width: 1,
      height: 1,
      // 汎用 node セレクタの data(color)/data(borderColor)/data(shape) マッピング
      // に任せない（ダミーなので data を持たせていない）。cluster-edge と同じ理由。
      "background-color": "#000" as any,
      "border-color": "#000" as any,
      shape: "ellipse" as any,
    },
  },
  // 絞り込み（検索・フォルダ・未分類）で外れたノードは描かない。配置は保つ。
  // 端点が消えた辺は Cytoscape が描かない
  { selector: "node.filtered-out", style: { display: "none" as any } },
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
    /** 留め置き（手で動かして保存した）ノード。配置の対象から外し、最後の並べ直しにも触れない */
    pinnedIds?: Set<string>;
    /** 島（community）の割り当て。重なりをほぐすときに島を保つために使う */
    communities?: Map<string, string>;
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
  for (const id of runOrphanCleanupPass(cy, shownNodes, shownEdges, positionedIds)) positionedIds.add(id);
  const leftover = placeLeftoverComponents(cy, shownNodes, shownEdges, positionedIds, opts.pinnedIds);
  spreadOverlappingNodes(
    cy,
    opts.pinnedIds ?? new Set(),
    opts.communities ? { communities: opts.communities, leftover } : undefined,
  );
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
): Set<string> {
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
  return new Set(cleanupPositions.keys());
}

/**
 * 幾何配置の最後に、重なったノードを押し離してほぐす（resolveOverlaps）。
 * 留め置きだけを動かさない。物理で置いた話題も動かす——fcose の nodeSeparation
 * は「つながり」で大きくした話題の寸法を見ないので話題どうしも重なり、話題を
 * 固定すると知見が話題の隙間に挟まって逃げ場を失う。動くのは重なった分だけ
 * なので島の骨格は保たれる。不可視の重心ダミーは除く。
 */
function spreadOverlappingNodes(
  cy: cytoscape.Core,
  fixedIds: Set<string>,
  islands?: { communities: Map<string, string>; leftover: Map<string, number> },
): void {
  const items: OverlapItem[] = [];
  cy.nodes().forEach((n: any) => {
    if (n.hasClass("cluster-hub")) return;
    const p = n.position();
    const size = Number(n.data("size")) || KIND_SIZE.note;
    items.push({ id: n.id(), x: p.x, y: p.y, r: size / 2, fixed: fixedIds.has(n.id()) || n.locked() });
  });
  // 島を保ってほぐす: 全部まとめて押し離すと、混んだ島ほど外へ広がって隣の島と
  // 溶け合い、全体が 1 つの円盤になる。島（community）の中で重なりを解いてから、
  // 島を円盤とみなして島どうしを離す。島の割り当ては、community を持つノードは
  // その community、島の下に並べた残り成分は成分ごと、それ以外は最寄りの
  // community メンバー（幾何配置で島の近くに置かれているので位置で決まる）。
  let moved: Map<string, { x: number; y: number }>;
  if (islands && islands.communities.size > 0) {
    const anchors = items.filter((it) => islands.communities.has(it.id));
    const groupOfId = new Map<string, string>();
    for (const it of items) {
      const left = islands.leftover.get(it.id);
      if (left !== undefined) {
        groupOfId.set(it.id, `leftover:${left}`);
        continue;
      }
      const own = islands.communities.get(it.id);
      if (own !== undefined) {
        groupOfId.set(it.id, own);
        continue;
      }
      let best: OverlapItem | null = null;
      let bestD = Infinity;
      for (const a of anchors) {
        const d = (a.x - it.x) ** 2 + (a.y - it.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) groupOfId.set(it.id, islands.communities.get(best.id)!);
    }
    moved = resolveGroupedOverlaps(items, (id) => groupOfId.get(id), { gap: 6, islandGap: 40 });
  } else {
    moved = resolveOverlaps(items, { gap: 6 });
  }
  for (const it of items) {
    if (it.fixed) continue;
    const p = moved.get(it.id);
    if (!p || (p.x === it.x && p.y === it.y)) continue;
    cy.getElementById(it.id).position(p);
  }
}

/**
 * 幾何配置のどの経路にも当たらなかった実ノード（話題を持たない成分: 資料とその
 * 知見だけ、ノートどうしだけ、など）を、島の外側に成分ごとの小さな塊として並べる。
 * 置かないと全部が原点に重なって 1 点の山になる。成分ごとに、つながりの多い
 * ノードを中心に残りを輪に置き、島の下に左から右へ並べて幅を超えたら折り返す。
 * 衛星（foldedInto）は親と一緒に置かれるのでここでは扱わない。
 */
function placeLeftoverComponents(
  cy: cytoscape.Core,
  shownNodes: NoteNode[],
  shownEdges: NoteEdge[],
  positionedIds: Set<string>,
  pinnedIds: Set<string> = new Set(),
): Map<string, number> {
  const componentOf = new Map<string, number>();
  const leftover = shownNodes.filter((n) => !positionedIds.has(n.id) && !pinnedIds.has(n.id));
  if (leftover.length === 0) return componentOf;
  const leftoverIds = new Set(leftover.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const n of leftover) adjacency.set(n.id, []);
  for (const e of shownEdges) {
    if (!leftoverIds.has(e.source) || !leftoverIds.has(e.target)) continue;
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  }
  // 連結成分（残りの中だけで辿る）
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const n of leftover) {
    if (seen.has(n.id)) continue;
    const comp: string[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      comp.push(id);
      for (const nb of adjacency.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    components.push(comp);
  }
  components.sort((a, b) => b.length - a.length);

  // 置き場: 配置済みノードの箱の下。無ければ原点から
  const placed = cy.nodes().filter((n: any) => positionedIds.has(n.id()) || pinnedIds.has(n.id()));
  const bb = placed.length > 0 ? placed.boundingBox() : { x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0 };
  const rowWidth = Math.max(bb.w, 1200);
  const GAP = 40;
  let x = bb.x1;
  let y = bb.y2 + 160;
  let rowHeight = 0;
  components.forEach((comp, compIdx) => {
    for (const id of comp) componentOf.set(id, compIdx);
    const radius = comp.length === 1 ? 0 : 24 + 8 * Math.sqrt(comp.length);
    const cell = 2 * radius + 60;
    if (x + cell > bb.x1 + rowWidth && x > bb.x1) {
      x = bb.x1;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const cx = x + cell / 2;
    const cy0 = y + cell / 2;
    // つながりの多いノードを中心に、残りを輪に
    const sorted = [...comp].sort((a, b) => (adjacency.get(b)?.length ?? 0) - (adjacency.get(a)?.length ?? 0));
    sorted.forEach((id, i) => {
      const el = cy.getElementById(id);
      if (el.empty()) return;
      if (i === 0) {
        el.position({ x: cx, y: cy0 });
        return;
      }
      const angle = ((i - 1) / (sorted.length - 1)) * 2 * Math.PI;
      el.position({ x: cx + radius * Math.cos(angle), y: cy0 + radius * Math.sin(angle) });
    });
    x += cell;
    rowHeight = Math.max(rowHeight, cell);
  });
  return componentOf;
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
 *   (3) 原料: 隣接する話題・共有知見の平均位置（資料から直接組んだ話題が引く
 *       資料は、その話題の島の中に立つ）。話題に隣接しない原料は隣接ノートの平均位置。
 *   (3b) 話題を持たず、ノートにも隣接しない知見（資料だけを引く知見）: 隣接する
 *       原料の平均位置。資料を介して、同じ資料の話題の島に入る。
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
    /** 留め置き（手で動かして保存した）ノード。最後の並べ直しに触れない */
    pinnedIds?: Set<string>;
    /** 島（community）の割り当て。重なりをほぐすときに島を保つために使う */
    communities?: Map<string, string>;
    /** 「意味で寄せる」（実験）: 埋め込みと、話題 → 島（community）の対応。
     *  onStats は結んだペア数などをツールバー表示に返す */
    similarity?: {
      vectors: Map<string, number[]>;
      communities: Map<string, string>;
      onStats?: (stats: { participants: number; pairs: number }) => void;
    };
  },
): Set<string> {
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

  // (3) 原料: 隣接する話題・共有知見の平均位置。無ければ隣接ノートの平均位置
  const externalIds = shownNodes.filter((n) => kindOf(n) === "external").map((n) => n.id);
  const externalPositions = averageOfReference(externalIds, positionedKnowledge);
  const externalsWithoutKnowledge = externalIds.filter((id) => !externalPositions.has(id));
  for (const [id, p] of averageOfReference(externalsWithoutKnowledge, new Set(noteIds))) externalPositions.set(id, p);
  dedupeSpiral(externalPositions);
  applyPositions(externalPositions);

  // (3b) 話題を持たずノートにも隣接しない知見: 隣接する原料の平均位置
  const sourceOnlyClaimIds = shownNodes
    .filter((n) => (kindOf(n) === "claim" || kindOf(n) === "atom") && !sharedClaimIds.has(n.id) && !foldedInto.has(n.id))
    .map((n) => n.id);
  const sourceOnlyPositions = averageOfReference(sourceOnlyClaimIds, new Set(externalPositions.keys()));
  dedupeSpiral(sourceOnlyPositions);
  applyPositions(sourceOnlyPositions);

  // (3c) 意味で寄せる（実験）: 同じ島の中で、埋め込みの近い知見どうしを寄せる。
  // 島は話題の community で決め、知見は隣接する話題（無ければ隣接する資料の話題）の
  // 島に属するとみなす。留め置き・衛星は対象外。重なりは後段のパスがほぐす。
  if (opts.similarity) {
    const { vectors, communities } = opts.similarity;
    const groupOf = (id: string): string | undefined => {
      for (const nb of adjacency.get(id) ?? []) {
        if (topicIds.has(nb)) return communities.get(nb) ?? nb;
      }
      for (const nb of adjacency.get(id) ?? []) {
        const nbNode = nodeById.get(nb);
        if (!nbNode || kindOf(nbNode) !== "external") continue;
        for (const t of adjacency.get(nb) ?? []) {
          if (topicIds.has(t)) return communities.get(t) ?? t;
        }
      }
      return undefined;
    };
    const items: SimilarityItem[] = [];
    for (const n of shownNodes) {
      const k = kindOf(n);
      if (k !== "claim" && k !== "atom") continue;
      if (foldedInto.has(n.id) || opts.pinnedIds?.has(n.id)) continue;
      const group = groupOf(n.id);
      if (!group) continue;
      const el = cy.getElementById(n.id);
      if (el.empty()) continue;
      const p = el.position();
      items.push({ id: n.id, x: p.x, y: p.y, group, vector: vectors.get(n.id) });
    }
    const pulled = pullBySimilarity(items);
    opts.similarity.onStats?.({ participants: pulled.participants, pairs: pulled.pairs });
    for (const it of items) {
      const p = pulled.positions.get(it.id);
      if (p && (p.x !== it.x || p.y !== it.y)) cy.getElementById(it.id).position(p);
    }
  }

  // (4) 後始末
  const positionedIds = new Set<string>([
    ...topicIds,
    ...sharedPositions.keys(),
    ...notePositions.keys(),
    ...externalPositions.keys(),
    ...sourceOnlyPositions.keys(),
  ]);
  for (const n of foldedOutNodes) positionedIds.add(n.id);
  for (const id of runOrphanCleanupPass(cy, shownNodes, shownEdges, positionedIds)) positionedIds.add(id);
  const leftover = placeLeftoverComponents(cy, shownNodes, shownEdges, positionedIds, opts.pinnedIds);
  spreadOverlappingNodes(
    cy,
    opts.pinnedIds ?? new Set(),
    opts.communities ? { communities: opts.communities, leftover } : undefined,
  );
  // 島の下に並べたノード（話題の届かない資料とその知見など）。島の名前の
  // 「トピック未作成の資料」の見出しに使う
  return new Set(leftover.keys());
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

/** 「この島に寄る」の倍率の上限（小さな島で画面いっぱいにしない） */
const ISLAND_FOCUS_MAX_ZOOM = 1.2;
/** 島のパネルが右側に取る幅（パネル 280＋左右の余白） */
const ISLAND_PANEL_SPACE = 300;

/** ノードを開く（クリックと島のパネルで共通。2 ホップグラフ view.tsx と同じ振り分け） */
function openGraphNode(
  id: string,
  info: { isWiki: boolean; externalUrl?: string },
  h: {
    onNavigate?: (noteId: string) => void;
    onOpenMedia?: (fileId: string) => void;
    onOpenUrl?: (url: string) => void;
    onOpenMemo?: (captureId: string) => void;
  },
): void {
  if (id.startsWith("pdf:")) {
    h.onOpenMedia?.(id.slice(4));
    return;
  }
  if (id.startsWith("document:")) {
    h.onOpenMedia?.(id.slice("document:".length));
    return;
  }
  if (id.startsWith("chat:")) return;
  if (id.startsWith("memo:")) {
    // メモ由来ソースはメモギャラリーの該当詳細を開く（未配線なら表示のみ）
    h.onOpenMemo?.(id.slice("memo:".length));
    return;
  }
  if (id.startsWith("url:")) {
    if (info.externalUrl) {
      // アプリ内（素材の URL リーダー）を優先。未配線の文脈のみ外部ブラウザ。
      if (h.onOpenUrl) h.onOpenUrl(info.externalUrl);
      else void openExternalUrl(info.externalUrl);
    }
    return;
  }
  h.onNavigate?.(info.isWiki ? `wiki:${id}` : id);
}

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
  similarityVectors = null,
  onSimilarityStats,
  topicVectors = null,
  topicVectorsPending = false,
  onIslandGrouping,
  sizeMode = "kind",
  layoutMode = "plain",
  focusLayer = "note",
  precomputedFold,
  islandLabels = false,
  searchQuery = "",
  searchJumpToken = 0,
  onSearchHits,
  onVisibleCount,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
  selectedNodeId = null,
  onSelectNode,
  onOpenNodeDirect,
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
  /** 島配置のときに島の名前（つながりの最も多い中心の種類のタイトル）を重ねて出し、
   *  クリックで島の中身をパネルに出す（既定 false）。 */
  islandLabels?: boolean;
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
  /** 「意味で寄せる」（実験）: ページ id → 埋め込みベクトル。null/未指定なら寄せない。
   *  layoutMode: islands かつ focusLayer: crystal のときだけ効く。 */
  similarityVectors?: Map<string, number[]> | null;
  /** 「意味で寄せる」が結んだペア数などを返す（ツールバーの件数表示用） */
  onSimilarityStats?: (stats: { participants: number; pairs: number }) => void;
  /** 「内容の島」用の埋め込み（ページ id → ベクトル）。渡すと、島の中心が知見・洞察の
   *  ときに話題を内容の近さで島に分ける。null ならつながりの島 */
  topicVectors?: Map<string, number[]> | null;
  /** 内容の島の埋め込みを読み込み中。読み終えるまで組まない（つながりの島で 1 回組んで
   *  から並べ直すとちらつくため） */
  topicVectorsPending?: boolean;
  /** 実際に使った島の分け方を返す（埋め込みが足りずつながりに戻したかを表示するため） */
  onIslandGrouping?: (grouping: "content" | "connection" | null) => void;
  /** タイトル部分一致でヒットを強調する検索クエリ。クラス操作のみでレイアウトは動かさない。 */
  searchQuery?: string;
  /** インクリメントされるたびに次の検索ヒットへパンする（Enter 連打で巡回）。 */
  searchJumpToken?: number;
  /** 検索ヒット件数の通知（クエリ空なら 0）。 */
  onSearchHits?: (count: number) => void;
  /** 絞り込み後に描かれているノード数を親へ返す（ヘッダの「表示 n / 全体 m」用） */
  onVisibleCount?: (count: number) => void;
  onNavigate?: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /** URL ソースノードをアプリ内で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースノードをメモギャラリーの該当詳細で開く。未指定なら表示のみ。 */
  onOpenMemo?: (captureId: string) => void;
  /** 来歴パネルの対象にしているノード（素の id）。見た目だけ付け外しする（cy は作り直さない） */
  selectedNodeId?: string | null;
  /** 渡すと、外部ソース以外のノードのクリックは開かずに選ぶだけになる */
  onSelectNode?: (id: string, info: { isWiki: boolean }) => void;
  /** ダブルクリックで選んですぐ開く（onSelectNode と対で使う） */
  onOpenNodeDirect?: (id: string, info: { isWiki: boolean }) => void;
  height?: number | string;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // クリック振り分けのハンドラは ref 経由で最新を読む（依存に入れて cy を作り直さない）
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;
  const onOpenNodeDirectRef = useRef(onOpenNodeDirect);
  onOpenNodeDirectRef.current = onOpenNodeDirect;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  // 開くハンドラも同じく ref で読む。note-app は毎回新しい関数を渡すので、依存に入れると
  // 親が再描画するたび（ノードを選んだだけでも）cy が作り直され、ダブルクリックの 2 回目が
  // 新しい cy に届いて dbltap にならない
  const openHandlersRef = useRef({ onNavigate, onOpenMedia, onOpenUrl, onOpenMemo });
  openHandlersRef.current = { onNavigate, onOpenMedia, onOpenUrl, onOpenMemo };
  // mouseout ハンドラ（cy 構築時のクロージャ）から最新の検索クエリ・色モードを
  // 参照するための ref。state を deps に入れて cy を作り直すと再レイアウトが走るため。
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
  // グラフ構築 effect の依存に入れない（案内の出入りで作り直さない）
  const showSelectionHintRef = useRef(showSelectionHint);
  // 件数表示のコールバックは ref 経由で呼ぶ（依存に入れると組み直しの引き金になる）
  const onSimilarityStatsRef = useRef(onSimilarityStats);
  onSimilarityStatsRef.current = onSimilarityStats;
  showSelectionHintRef.current = showSelectionHint;
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
  const lastSimilarityRef = useRef<Map<string, number[]> | null>(null);
  const lastTopicVectorsRef = useRef<Map<string, number[]> | null>(null);
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
    // contextFilter / hideUncategorized はここ（組み直し）では使わない。
    // その場で隠す絞り込み（applyGraphFilter）に回す
    const filtered = filterGlobalGraph(data, {
      visibleLayers,
      hideReferences,
      hideIsolated,
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

  // crystal フォーカスは話題だけを物理配置に参加させる専用の分析結果を使う
  // （要素構築時の projection エッジ・後段の fcose 対象コレクション・幾何配置の
  // どこからも参照するので、ここで 1 回だけ計算する）。effectiveFocus を使う
  // ——layoutMode: plain のときは focusLayer に関わらず crystal 扱いにしない
  // （plain に戻したのに crystal の幾何配置が fcose の結果を上書きしてしまう
  // 事故を避ける）。
  // 話題が 1 つも無い（知識層を作り始めたばかりで知見だけ、または話題の層を
  // 隠している）ときは crystal 専用の経路を使わない。物理対象が空になり、
  // 幾何配置の土台も無く、全ノードが原点に重なって 1 点に潰れる。知見・洞察を
  // フォーカスにした汎用の島配置（isFocused ベース）に落とす。
  const crystalAnalysis = useMemo(() => {
    if (layoutMode !== "islands" || effectiveFocus !== "crystal") return null;
    const candidate = analyzeCrystalIslands({ nodes: shownNodes, edges: shownEdges }, { topicVectors });
    return candidate.topicIds.size > 0 ? candidate : null;
  }, [layoutMode, effectiveFocus, shownNodes, shownEdges, topicVectors]);
  const onIslandGroupingRef = useRef(onIslandGrouping);
  onIslandGroupingRef.current = onIslandGrouping;
  useEffect(() => {
    onIslandGroupingRef.current?.(crystalAnalysis?.grouping ?? null);
  }, [crystalAnalysis]);
  // 内容の島のときだけ、代表を内容の重心に近い順にする
  const contentVectors = crystalAnalysis?.grouping === "content" ? topicVectors : null;
  // 島（community）。重心ダミーの配置と、最後の重なり解消（島を保つ）と、島の名前で使う
  const islandCommunities = useMemo(
    () =>
      layoutMode === "islands"
        ? crystalAnalysis?.communities ?? detectFocusCommunities({ nodes: shownNodes, edges: shownEdges }, focusLayer)
        : null,
    [layoutMode, crystalAnalysis, shownNodes, shownEdges, focusLayer],
  );
  // 島の下に並べたノード（話題の届かない資料など）。配置のたびに幾何配置が返す。並べ直さない
  // 組み直し（keepCurrent）では前回のものを使う（並びも前回のまま）
  const [looseIds, setLooseIds] = useState<Set<string> | null>(null);
  // 島の名前と中身（代表・よく引かれている資料・件数）。中心の種類は配置と同じ
  const islandSummaries = useMemo(() => {
    if (!islandLabels || !islandCommunities) return [];
    const focusIds =
      crystalAnalysis?.topicIds ??
      new Set(shownNodes.filter((n) => isFocused(n, effectiveFocus)).map((n) => n.id));
    return summarizeIslands({ nodes: shownNodes, edges: shownEdges }, islandCommunities, {
      focusIds,
      foldedOutNodes,
      foldedInto,
      topicVectors: contentVectors,
      // 知識層の島のときだけ、島の下に並べた資料をまとめて見せる
      unislandedIds: crystalAnalysis ? looseIds : null,
    });
  }, [islandLabels, islandCommunities, crystalAnalysis, shownNodes, shownEdges, effectiveFocus, foldedOutNodes, foldedInto, contentVectors, looseIds]);
  // 配置が終わった cy（島の名前はランダムな初期位置には出さない）。構築・破棄で入れ替わる
  const [settledCy, setSettledCy] = useState<cytoscape.Core | null>(null);
  const [selectedIslandId, setSelectedIslandId] = useState<string | null>(null);
  const selectedIsland = islandSummaries.find((s) => s.id === selectedIslandId) ?? null;

  useEffect(() => {
    if (!containerRef.current) return;
    // 保存済みの配置を読み終えるまで組まない（読み込み後に並べ直して見えないように）
    if (!layoutReady) return;
    // 内容の島の埋め込みを読み終えるまで組まない（つながりの島で組んでから並べ直すとちらつく）
    if (topicVectorsPending) return;
    // 「文脈で寄せる」の切り替え直後か
    const clusterChanged = lastClusterRef.current !== clusterByContext;
    lastClusterRef.current = clusterByContext;
    // 「配置: 標準 / 島」の切替直後か（並べ直しのトリガーとして clusterChanged と同格に扱う）
    const layoutChanged = lastLayoutModeRef.current !== layoutMode;
    lastLayoutModeRef.current = layoutMode;
    // フォーカス種類の切替直後か（同様に並べ直しのトリガーにする）
    const focusChanged = lastFocusLayerRef.current !== focusLayer;
    lastFocusLayerRef.current = focusLayer;
    // 「意味で寄せる」の ON/OFF（ベクトルの有無）の切替直後か。並べ直さないと、
    // 引き継いだ座標のまま（keepCurrent）で幾何パスが走らず何も変わらない
    const similarityChanged = lastSimilarityRef.current !== similarityVectors;
    lastSimilarityRef.current = similarityVectors;
    // 島の分け方（内容 / つながり）の切替直後か。島が変わるので並べ直す
    const groupingChanged = lastTopicVectorsRef.current !== topicVectors;
    lastTopicVectorsRef.current = topicVectors;
    const modeChanged = clusterChanged || layoutChanged || focusChanged || similarityChanged || groupingChanged;
    if (shownNodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      setSettledCy(null);
      return;
    }

    // crystalAnalysis / islandCommunities は effect の外（useMemo）で計算済み。
    // 島の名前（IslandLabelsOverlay）も同じ割り当てを使う

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
      // crystal は上で計算済みの crystalAnalysis.communities を使い回す
      // （detectFocusCommunities("crystal") は内部で analyzeCrystalIslands を
      // 呼ぶだけなので、同じ入力に対する二重計算を避ける）。
      const communities = islandCommunities ?? new Map<string, string>();
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
    // 手で動かしたノード（保存）は「留め置き」: 自動配置の間も動かさない固定点。
    // 全体グラフの保存は動かしたノードだけを書く（attachCytoscapeLayoutPersistence の
    // moved）ので、保存＝留め置きの集合。以前は 1 回のドラッグで全ノードの座標を
    // 保存し、保存が 1 件でもあると自動配置を止めて新しいノードを外周の円に仮置き
    // していた。知識層はノードが増え続けるので、その円がドラッグのたびに保存へ
    // 焼き付き、「円周に張り付くノード」が意味も無く残っていた。
    const pinnedIds = new Set<string>(persisted ? shownNodes.filter((n) => persisted[n.id]).map((n) => n.id) : []);
    // ノードが増えていない組み直し（中身の変化・削除・フィルタで減っただけ）は並べ直さない。
    // 全ノードが留め置きで埋まっているときも同じ（並べるものが無い）。
    const contentOnlyRebuild = !!carry && unplacedIds.length === 0;
    const keepCurrent = contentOnlyRebuild || (pinnedIds.size > 0 && unplacedIds.length === 0);
    // 自動レイアウトのアニメーション中にユーザーが掴んだら、レイアウト側が引き下がる
    let layoutStoppedByUser = false;
    let detachGrabStop: (() => void) | null = null;
    // 自動レイアウトが走っている最中か（途中で組み直されたら引き継がず、次は最初から並べる）
    let layoutRunning = false;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: globalGraphStyle,
      layout: { name: "preset" },
      ...GRAPH_INIT_OPTIONS,
      // 全体グラフだけは俯瞰のためにズームの下限を広く取る（他のグラフは 0.2–4）
      minZoom: 0.1,
      maxZoom: 3,
      // ドラッグ・ズームの最中は直前の描画を 1 枚の画像として動かし、止まったら
      // 描き直す。全ノード・全辺・全ラベルを毎フレーム描くと遅いフレームが
      // 約 50ms になっていた（計測で約 9ms に）。動かしている間だけ少しぼやける
      textureOnViewport: true,
    } as cytoscape.CytoscapeOptions);
    // 背景はドラッグでパンできる。ノードの上ではドラッグが「動かす」に変わる
    containerRef.current.style.cursor = "grab";

    // ラベルの大きさはズームの平方根でしか増やさない（寄せても文字が巨大にならず、
    // 引くと min-zoomed-font-size で描かれなくなる）。Obsidian の見え方に寄せる。
    // 1,300 ノードへの一括 style は軽くないので 1 フレームぶん間引き、0.5px 未満の変化は
    // 捨てる（rAF は隠れたタブで止まるので setTimeout）。
    let labelTimer: ReturnType<typeof setTimeout> | null = null;
    let lastLabelPx = 0;
    const applyLabelScale = () => {
      labelTimer = null;
      const px = labelFontSizeForZoom(cy.zoom());
      if (Math.abs(px - lastLabelPx) < 0.5) return;
      lastLabelPx = px;
      cy.nodes().style("font-size", `${px}px`);
    };
    // ズームの最中は書き換えない（全ノードの style 書き換えは 100ms 前後かかる）。
    // 止まって 150ms たってから 1 回だけ合わせる
    cy.on("zoom", () => {
      if (labelTimer) clearTimeout(labelTimer);
      labelTimer = setTimeout(applyLabelScale, 150);
    });

    // 「文脈で寄せる」時はクラスター内を固めるだけでなく、クラスター**間**を離す:
    // 仮想エッジ（短い理想長・強い弾性）が塊を作り、実エッジは理想長を大きく伸ばし
    // 弾性も落として「緩い腕」にする。反発を強め・中心重力をほぼ切って塊同士を
    // 引き離す。値は Storybook「文脈クラスター（大規模）」で見た目調整したもの。
    if (keepCurrent) {
      // 並べ直さない。視点は直前のまま保つ（unplacedIds は空）
      const vp = carry?.viewport;
      if (vp && Math.abs(vp.w - cy.width()) < 2 && Math.abs(vp.h - cy.height()) < 2) {
        cy.viewport({ zoom: vp.zoom, pan: vp.pan });
      } else {
        fitAvoidingHint(cy, 30, showSelectionHintRef.current);
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
    // 留め置きノードは配置の間ロックする。Cytoscape はロック中のノードへの
    // position() 書き込みと layoutPositions を無視するので、2 段目の幾何配置
    // （平均位置・衛星リング・後始末）も素通りする。終わったら外す（掴めるように）。
    const pinnedEles = cy.nodes().filter((n: any) => pinnedIds.has(n.id()));
    pinnedEles.lock();
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

    // 1 段目の物理にも固定点として渡す（ロックだけだと fcose は動かせる前提で
    // 力を計算し、結果の書き込みだけが捨てられる）。物理対象に無い id は渡さない。
    const fixedNodeConstraint = physicsEles
      .nodes()
      .filter((n: any) => pinnedIds.has(n.id()))
      .map((n: any) => ({ nodeId: n.id(), position: { x: n.position("x"), y: n.position("y") } }));
    const lay = physicsEles.layout({
      name: "fcose",
      ...(fixedNodeConstraint.length > 0 ? { fixedNodeConstraint } : {}),
      // 大きなグラフでは配置のアニメーションを切る。数百ノードを 700ms 動かすと
      // 全ラベル付きの描き直しが続き、組み直しのたびに長く点滅して見える
      animate: physicsEles.nodes().length <= LAYOUT_ANIMATION_MAX_NODES,
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
      // フォーカス以外の実ノードと衛星を直接配置する。ドラッグで途中で止めた
      // ときは、1 段目がまだ収束していない位置に対して幾何配置をかけると
      // 指で掴んでいるノードの下で他ノードが飛ぶ事故になるので、その場合は
      // 幾何配置ごと止める（fit も同じ理由で止める。既存どおり）。
      if (!layoutStoppedByUser) {
        if (crystalAnalysis) {
          const leftoverIds = placeCrystalIslandGeometry(cy, {
            shownNodes,
            shownEdges,
            foldedOutNodes,
            foldedInto,
            sharedClaimIds: crystalAnalysis.sharedClaimIds,
            pinnedIds,
            communities: islandCommunities ?? undefined,
            similarity: similarityVectors
              ? {
                  vectors: similarityVectors,
                  communities: crystalAnalysis.communities,
                  onStats: (st) => onSimilarityStatsRef.current?.(st),
                }
              : undefined,
          });
          setLooseIds(leftoverIds);
        } else if (islands) {
          placeIslandGeometry(cy, {
            shownNodes,
            shownEdges,
            focusIds,
            foldedOutNodes,
            foldedInto,
            pinnedIds,
            communities: islandCommunities ?? undefined,
          });
        }
      }
      pinnedEles.unlock();
      // ドラッグで止めた場合は fit しない（勝手に視点が動くと戻されたように見える）
      if (!layoutStoppedByUser) fitAvoidingHint(cy, 30, showSelectionHintRef.current);
      // 島の名前はここから出す（配置中のランダムな位置には出さない）
      setSettledCy(cy);
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
    // 全体グラフは動かしたノードだけ保存する（保存先はスコープ単位でマージされる）。
    // 全ノードを保存すると、自動配置の結果ごと固定されて以後の組み直しが
    // 一切走らなくなり、増えたノードの置き場が無くなる。
    const detachPersistence = attachCytoscapeLayoutPersistence(cy, (_positions, movedMultiple, moved) => {
      saveLayoutRef.current(moved, movedMultiple);
      endDragRef.current();
    });
    const onDragStart = () => beginDrag();
    cy.on("drag", "node", onDragStart);
    // 複数選択中はグループを囲む矩形を出す（React Flow と同じ見え方）
    const detachSelectionBounds = attachSelectionBoundsOverlay(cy);

    // ホバーで隣接を強調
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      // 本物の 1 ホップだけ（不可視の射影・ダミーの辺は辿らない）
      const nb = visibleNeighborhood(node);
      // まとめて 1 回で描き直す（要素ごとに再計算させない）
      cy.batch(() => {
        cy.elements().addClass("faded");
        node.removeClass("faded").addClass("hover");
        nb.removeClass("faded");
        nb.edges().addClass("hover-connected");
      });
      containerRef.current!.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      // ホバーで付けたクラスだけを外す。絞り込みのクラス（filtered-out など）は
      // ホバーで触らないので、掛け直さない（全要素の付け外しは描き直しを増やす）
      cy.batch(() => cy.$(".faded, .hover, .hover-connected").removeClass("faded hover hover-connected"));
      containerRef.current!.style.cursor = "grab";
    });

    // ノードクリック → ナビゲーション（2 ホップグラフ view.tsx と同じ振り分け）
    cy.on("tap", "node", (evt) => {
      const id: string = evt.target.id();
      const isWiki = !!evt.target.data("isWiki");
      const select = onSelectNodeRef.current;
      if (select && classifyNodeTap(id, { hasSelect: true }) === "select") {
        select(id, { isWiki });
        return;
      }
      openGraphNode(
        id,
        { isWiki, externalUrl: evt.target.data("externalUrl") },
        openHandlersRef.current,
      );
    });
    // ダブルクリック: 選んでそのまま開く（直前の tap で選択済み）
    cy.on("dbltap", "node", (evt) => {
      const id: string = evt.target.id();
      const direct = onOpenNodeDirectRef.current;
      if (direct && classifyNodeTap(id, { hasSelect: true }) === "select") {
        direct(id, { isWiki: !!evt.target.data("isWiki") });
      }
    });
    // cy を作り直した直後も、選択中のノードに見た目を戻す
    const pickedId = selectedNodeIdRef.current;
    if (pickedId) cy.getElementById(pickedId).addClass("lineage-picked");

    cyRef.current = cy;
    // 並べ直さないときは座標が確定しているので、すぐ島の名前を出せる
    if (keepCurrent) setSettledCy(cy);
    return () => {
      // ズームが止まった後のラベル更新が、破棄した cy に届かないように
      if (labelTimer) clearTimeout(labelTimer);
      cy.off("drag", "node", onDragStart);
      detachSelectionBounds();
      detachGrabStop?.();
      detachPersistence();
      // 次のグラフ（この cleanup の直後に組まれる）へ座標と視点を渡してから破棄する
      carryOver.keep(cy, !layoutRunning || layoutStoppedByUser);
      cy.destroy();
      cyRef.current = null;
      setSettledCy(null);
    };
    // savedPositions / saveLayout は ref 経由で読む（依存に入れると
    // ドラッグ → 保存 → 再構築のループになる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    renderKey,
    clusterByContext,
    layoutMode,
    focusLayer,
    similarityVectors,
    topicVectors,
    topicVectorsPending,
    layoutReady,
    layoutResetSeq,
    beginDrag,
  ]);

  // 来歴パネルの対象ノードの見た目（class の付け外しのみ。cy は作り直さない）
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.$(".lineage-picked").removeClass("lineage-picked");
      if (selectedNodeId) cy.getElementById(selectedNodeId).addClass("lineage-picked");
    });
  }, [selectedNodeId]);

  // キャンバスの幅が変わったとき（来歴パネル・ピークが横に並んだ／閉じた）に追従する。
  // cytoscape はウィンドウのリサイズしか拾わないので、自分で resize する。視点は左上に
  // 固定のまま動かさない — ダブルクリックの 1 回目で来歴パネルが開いて幅が変わるので、
  // 中心を保とうと pan すると 2 回目のクリックがノードから外れる。
  // 来歴の対象ノードが隠れたときだけ、ダブルクリックが済むのを待ってからそのノードへ寄せる
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let prev = { w: el.clientWidth, h: el.clientHeight };
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!cy || w === 0 || h === 0 || (w === prev.w && h === prev.h)) {
        prev = { w, h };
        return;
      }
      prev = { w, h };
      cy.resize();
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        revealTimer = null;
        const pickedId = selectedNodeIdRef.current;
        const live = cyRef.current;
        if (!pickedId || !live) return;
        const node = live.getElementById(pickedId);
        if (node.empty()) return;
        const p = node.renderedPosition();
        if (p.x < 0 || p.y < 0 || p.x > live.width() || p.y > live.height()) {
          live.animate({ center: { eles: node } }, { duration: 200 });
        }
      }, 400);
    });
    ro.observe(el);
    return () => {
      if (revealTimer) clearTimeout(revealTimer);
      ro.disconnect();
    };
  }, []);

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

  // 絞り込み（検索・フォルダ・未分類）: その場で隠すだけ（destroy・再レイアウトなし）。
  // メイン effect より後に宣言してあるので、cy 再構築直後にも再適用される。
  const filterRef = useRef<GraphFilter>({ query: "", contexts: new Set(), hideUncategorized: false });
  filterRef.current = { query: searchQuery, contexts: contextFilter ?? new Set(), hideUncategorized };
  const allNodesRef = useRef<NoteNode[]>([]);
  allNodesRef.current = foldedOutNodes.length > 0 ? [...shownNodes, ...foldedOutNodes] : shownNodes;
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      onSearchHits?.(0);
      return;
    }
    const r = applyGraphFilter(cy, allNodesRef.current, filterRef.current);
    jumpIndexRef.current = 0;
    onSearchHits?.(r.hits);
    onVisibleCount?.(r.visible);
  }, [searchQuery, contextFilter, hideUncategorized, shownNodes, shownEdges, foldedOutNodes, onSearchHits, onVisibleCount]);

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
      {islandSummaries.length > 0 && (
        <IslandLabelsOverlay
          cy={settledCy}
          islands={islandSummaries}
          selectedId={selectedIsland?.id ?? null}
          onSelect={(id) => setSelectedIslandId((prev) => (prev === id ? null : id))}
        />
      )}
      {selectedIsland && (
        <IslandPanel
          island={selectedIsland}
          grouping={crystalAnalysis?.grouping ?? "note"}
          onClose={() => setSelectedIslandId(null)}
          onOpen={(m) =>
            openGraphNode(m.id, { isWiki: m.isWiki, externalUrl: m.externalUrl }, { onNavigate, onOpenMedia, onOpenUrl, onOpenMemo })
          }
          onFocus={() => {
            const cy = cyRef.current;
            if (!cy) return;
            const eles = cy.collection();
            for (const id of selectedIsland.anchorIds) {
              const n = cy.getElementById(id);
              if (n.nonempty() && !n.hasClass("filtered-out")) eles.merge(n);
            }
            if (eles.empty()) return;
            // パネル（幅 280＋余白）に隠れない左側に収める。小さな島で寄りすぎないよう倍率に上限
            const bb = eles.boundingBox({});
            const pad = 60;
            const areaW = Math.max(cy.width() - ISLAND_PANEL_SPACE, cy.width() / 2);
            const zoom = Math.min(
              (areaW - pad * 2) / Math.max(bb.w, 1),
              (cy.height() - pad * 2) / Math.max(bb.h, 1),
              ISLAND_FOCUS_MAX_ZOOM,
            );
            const cx = (bb.x1 + bb.x2) / 2;
            const cyy = (bb.y1 + bb.y2) / 2;
            cy.stop();
            cy.animate(
              { zoom, pan: { x: areaW / 2 - cx * zoom, y: cy.height() / 2 - cyy * zoom }, duration: 300, easing: "ease-in-out-sine" } as any,
            );
          }}
        />
      )}
      <GraphSelectionHint show={showSelectionHint} />
      {/* 手で整えた並びがあるときだけ、自動配置に戻す入口を出す */}
      {hasSavedLayout && (
        <button
          onClick={() => {
            // 引き継ぎは次の構築で捨てられる（useGraphCarryOver が resetSeq の変化を見る）
            resetLayout();
          }}
          data-tooltip={t("graph.layout.resetHint")}
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
          data-tooltip={t("globalGraph.toggleUncategorizedHint")}
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
/** 「表示 ▾」メニュー。普段は触らない切替をまとめて、ツールバーを短く保つ */
function DisplayMenu({
  label,
  hint,
  items,
  radio,
}: {
  label: string;
  hint?: string;
  items: {
    key: string;
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    suffix?: string;
  }[];
  radio?: {
    label: string;
    hint?: string;
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    onChange: (v: string) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const activeCount = items.filter((it) => it.checked).length;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={hint}
        className={`px-2.5 py-1 rounded-md border border-border text-[11px] font-semibold transition-colors ${
          open ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {activeCount > 0 && <span className="ml-1 opacity-70">{activeCount}</span>}
        <span className="ml-1 opacity-60">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-40 min-w-[220px] rounded-md border border-border bg-background p-2 shadow-md flex flex-col gap-1.5"
        >
          {items.map((it) => (
            <label
              key={it.key}
              className="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer"
              data-tooltip={it.hint}
            >
              <input type="checkbox" checked={it.checked} onChange={(e) => it.onChange(e.target.checked)} />
              {it.label}
              {it.suffix && <span className="opacity-70">{it.suffix}</span>}
            </label>
          ))}
          {radio && (
            <div className="mt-1 pt-1.5 border-t border-border" data-tooltip={radio.hint}>
              <div className="text-[11px] text-muted-foreground mb-1">{radio.label}</div>
              <div className="flex gap-1">
                {radio.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => radio.onChange(o.value)}
                    className={`px-2 py-0.5 rounded border border-border text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                      radio.value === o.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
  topicTypeById,
  initialFoldLeaves,
  initialSizeMode,
  initialLayoutMode,
  initialFocusLayer,
  sidePanel,
  peek,
  selectedNodeId,
  onSelectNode,
  onOpenNodeDirect,
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
  /** トピック id → 種類（topicType）。渡すと「表示 ▾」に種類ごとの表示切替が出る */
  topicTypeById?: ReadonlyMap<string, { topicType?: TopicType } | undefined>;
  /** 俯瞰 / 時系列のどちらを表示するか（未指定なら俯瞰固定でサブタブも出さない） */
  /** 「葉を畳む」の初期値（未指定なら true が既定）。保存はしない。 */
  initialFoldLeaves?: boolean;
  /** 大きさモードの初期値（未指定なら "reach" が既定）。保存はしない。 */
  initialSizeMode?: "kind" | "reach";
  /** 配置モードの初期値（未指定なら "islands" が既定）。保存はしない。 */
  initialLayoutMode?: "plain" | "islands";
  /** フォーカス種類の初期値（未指定なら "note" が既定）。layoutMode: islands の
   *  ときだけ効く。保存はしない。 */
  initialFocusLayer?: FocusLayer;
  /** 俯瞰モードでキャンバスの右に並べる来歴パネル。null/未指定ならキャンバスだけ */
  sidePanel?: ReactNode;
  /** キャンバスと sidePanel の間に並べるピーク。floating=true は幅が足りず重ねる見た目 */
  peek?: (opts: { floating: boolean }) => ReactNode;
  /** 来歴パネルの対象ノード（素の id）。キャンバスに選択の見た目を付ける */
  selectedNodeId?: string | null;
  /** 外部ソース以外のノードのクリックを「選ぶだけ」にする */
  onSelectNode?: (id: string, info: { isWiki: boolean }) => void;
  /** ダブルクリックで選んですぐピークで開く */
  onOpenNodeDirect?: (id: string, info: { isWiki: boolean }) => void;
}) {
  const t = useT();
  // キャンバス行の幅（ピークを並べるか重ねるかの判定用）
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const hasSidePanel = !!sidePanel;
  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setRowWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSidePanel]);
  // この行は [キャンバス][ピーク][来歴 360px] で、ノート画面（レール 40px・右パネル下限 300px）と
  // 寸法が違うので専用に判定する: キャンバスが 360px 残らないならピークは重ねる。0 幅（未計測）は並べる
  const peekFloating =
    hasSidePanel &&
    rowWidth > 0 &&
    rowWidth - GRAPH_LINEAGE_PANEL_WIDTH - SIDE_PEEK_INLINE_MIN_WIDTH < GRAPH_CANVAS_MIN_WIDTH;
  const [hideRefs, setHideRefs] = useState(false);
  const [showIsolated, setShowIsolated] = useState(false);
  // トピックの種類ごとの非表示（"unset" は未分類）。種類情報が渡されたときだけメニューに出す
  const [hiddenTopicTypes, setHiddenTopicTypes] = useState<Set<string>>(new Set());
  const topicTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!topicTypeById) return counts;
    for (const n of data.nodes) {
      if (kindOf(n) !== "topic") continue;
      const key = topicTypeById.get(n.id)?.topicType ?? "unset";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [data, topicTypeById]);
  // 層（原料・ノート・知見・洞察）は常に全部表示する。以前は層チップで表示/非表示を
  // 切り替えられ、島配置では同じチップが「島の中心」の意味に変わっていたので、
  // 配置を切り替えると「なぜノードが減ったのか」分からない状態が起きていた。
  const visible = useMemo(() => new Set<LayerId>(ALL_LAYERS), []);
  // 色の軸（kind=種類 / context=文脈タグ）と、文脈タグ絞り込み（小文字キー）
  const [colorMode, setColorMode] = useState<GraphColorMode>("kind");
  const [selectedContexts, setSelectedContexts] = useState<Set<string>>(new Set());
  // 同じ文脈タグのノードを引き寄せてクラスターにする（レイアウト再実行を伴う）
  const [clusterByContext, setClusterByContext] = useState(false);
  // 未分類（タグ無しの通常ノート）を隠す。凡例の未分類チップでトグル
  const [hideUncategorized, setHideUncategorized] = useState(false);
  // 葉を畳む / 大きさをつながりで決める / 配置。既定は fold ON・reach・islands
  // （合意済みの既定値。initial* が渡されればそちらを優先する）。
  const [foldLeaves, setFoldLeaves] = useState(initialFoldLeaves ?? true);
  const [sizeMode] = useState<"kind" | "reach">(initialSizeMode ?? "reach");
  // 配置: 標準（今の fcose 定数）/ 島（つながりの多いノートが周りを引き寄せる）
  const [layoutMode] = useState<"plain" | "islands">(initialLayoutMode ?? "islands");
  // 島モードで「何を中心に島を作るか」（既定 note）。plain のときは無視される。
  // 島の中心。未指定（auto）なら、知識層のノードがあれば話題（crystal）、無ければノート。
  const [focusChoice, setFocusChoice] = useState<FocusLayer | "auto">(initialFocusLayer ?? "auto");
  const hasKnowledge = useMemo(
    () =>
      data.nodes.some((n) => {
        const k = kindOf(n);
        return k === "topic" || k === "claim" || k === "atom";
      }),
    [data],
  );
  const focusLayer: FocusLayer = focusChoice === "auto" ? (hasKnowledge ? "crystal" : "note") : focusChoice;
  // 島の名前（島配置のときだけ効く）。既定で出す
  const [showIslandLabels, setShowIslandLabels] = useState(true);
  // 内容で島を分ける（島の中心が知見・洞察のときだけ効く）。既定で内容。埋め込みが
  // 足りなければキャンバス側がつながりに戻し、onIslandGrouping で知らせる
  const [islandByContent, setIslandByContent] = useState(true);
  const [islandGrouping, setIslandGrouping] = useState<"content" | "connection" | null>(null);
  // 「意味で寄せる」（実験）: ON のとき埋め込みストアからベクトルを読み、島の中で
  // 似た知見を寄せる。ベクトルは 1 回読んだら持ち回る（ストアはセッション中ほぼ不変）。
  // 内容の島も同じベクトルを使う
  const [similarityPull, setSimilarityPull] = useState(false);
  const [similarityVectors, setSimilarityVectors] = useState<Map<string, number[]> | null>(null);
  const [similarityStats, setSimilarityStats] = useState<{ participants: number; pairs: number } | null>(null);
  const contentIslands = islandByContent && layoutMode === "islands" && focusLayer === "crystal";
  const needVectors = similarityPull || contentIslands;
  useEffect(() => {
    if (!needVectors || similarityVectors) return;
    let cancelled = false;
    loadSimilarityVectors()
      .then((m) => {
        if (!cancelled) setSimilarityVectors(m);
      })
      .catch(() => {
        if (!cancelled) setSimilarityVectors(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [needVectors, similarityVectors]);
  // layoutMode: islands のときだけ focusLayer を効かせる（plain の既定挙動は変えない）。
  const effectiveFocus: FocusLayer = layoutMode === "islands" ? focusLayer : "note";
  // 検索（ヒット強調 + Enter 巡回。レイアウトは動かさない）
  const [searchInput, setSearchInput] = useState("");
  const [searchJumpToken, setSearchJumpToken] = useState(0);
  const [searchHits, setSearchHits] = useState(0);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 層・参照・文脈タグフィルタ適用後の「全ノード版」と「連結のみ版」を両方求め、
  // 表示用サブグラフ（shown）と隠れている孤立ノード数（isolatedCount）を導く。
  const { shown, isolatedCount } = useMemo(() => {
    // フォルダ・未分類はその場で隠す（GlobalGraphCanvas の applyGraphFilter）ので
    // ここでは組み直さない — 1 操作ごとに物理配置が走り直すのを避ける
    const base = {
      visibleLayers: visible,
      hideReferences: hideRefs,
      hideAtoms: !insightsEnabled,
      hideTopicTypes: hiddenTopicTypes,
      topicTypeById,
    };
    const withIsolated = filterGlobalGraph(data, { ...base, hideIsolated: false });
    const connectedOnly = filterGlobalGraph(data, { ...base, hideIsolated: true });
    return {
      shown: showIsolated ? withIsolated : connectedOnly,
      isolatedCount: withIsolated.nodes.length - connectedOnly.nodes.length,
    };
  }, [data, visible, hideRefs, showIsolated, insightsEnabled, hiddenTopicTypes, topicTypeById]);

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

  // フォルダメニューの件数は、描かれ得るノード（孤立などで隠れたものを除く shown）で数える。
  // 全ノードで数えると「10 件」と出て 2 件しか残らない、という食い違いが起きる
  const folderTags = useMemo(() => aggregateNoteContexts(shown.nodes), [shown]);
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
    }
    // 文脈（フォルダ）モードでも層は全部表示のまま（原料・知見は色が付かないだけ）
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
          <>
            {/* 色の軸切替（種類 ⇄ フォルダ） */}
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
            {/* 表示 ▾: 普段は触らない切替をまとめる（参照・孤立・葉・意味で寄せる・島の中心） */}
            <DisplayMenu
              label={t("globalGraph.display")}
              hint={t("globalGraph.displayHint")}
              items={[
                {
                  key: "hideRefs",
                  label: t("globalGraph.hideReferences"),
                  checked: hideRefs,
                  onChange: setHideRefs,
                },
                {
                  key: "showIsolated",
                  label: t("globalGraph.showIsolated"),
                  hint: t("globalGraph.showIsolatedHint"),
                  checked: showIsolated,
                  onChange: setShowIsolated,
                  suffix: isolatedCount > 0 ? `(${isolatedCount})` : undefined,
                },
                {
                  key: "foldLeaves",
                  label: t("globalGraph.foldLeaves"),
                  hint: t("globalGraph.foldLeavesHint"),
                  checked: foldLeaves,
                  onChange: setFoldLeaves,
                  suffix: foldedTotal > 0 ? `(−${foldedTotal})` : undefined,
                },
                // トピックの種類ごとの表示（種類情報があるときだけ。未分類も 1 項目）
                ...([...TOPIC_TYPES, "unset"] as const)
                  .filter((ty) => (topicTypeCounts.get(ty) ?? 0) > 0)
                  .map((ty) => ({
                    key: `topicType:${ty}`,
                    label: t("globalGraph.showTopicType", { type: t(`wikiTypes.topicType.${ty}` as any) }),
                    checked: !hiddenTopicTypes.has(ty),
                    onChange: (v: boolean) => setHiddenTopicTypes((prev) => {
                      const next = new Set(prev);
                      if (v) next.delete(ty); else next.add(ty);
                      return next;
                    }),
                    suffix: `(${topicTypeCounts.get(ty)})`,
                  })),
                ...(layoutMode === "islands"
                  ? [
                      {
                        key: "islandLabels",
                        label: t("globalGraph.islandLabels"),
                        hint: t("globalGraph.islandLabelsHint"),
                        checked: showIslandLabels,
                        onChange: setShowIslandLabels,
                      },
                    ]
                  : []),
                ...(layoutMode === "islands" && focusLayer === "crystal"
                  ? [
                      {
                        key: "islandByContent",
                        label: t("globalGraph.islandByContent"),
                        // 埋め込みが足りずにつながりへ戻したときは、その理由をヒントで出す
                        hint:
                          islandByContent && islandGrouping === "connection"
                            ? t("globalGraph.islandByContentFallback")
                            : t("globalGraph.islandByContentHint"),
                        checked: islandByContent,
                        onChange: setIslandByContent,
                        suffix: islandByContent && islandGrouping === "connection" ? "(—)" : undefined,
                      },
                    ]
                  : []),
                ...(layoutMode === "islands" && focusLayer === "crystal"
                  ? [
                      {
                        key: "similarityPull",
                        label: t("globalGraph.similarityPull"),
                        hint: t("globalGraph.similarityPullHint"),
                        checked: similarityPull,
                        onChange: setSimilarityPull,
                        suffix:
                          similarityPull && similarityVectors
                            ? `(${similarityStats ? `${similarityStats.participants} · ${similarityStats.pairs}` : similarityVectors.size})`
                            : undefined,
                      },
                    ]
                  : []),
              ]}
              radio={
                layoutMode === "islands"
                  ? {
                      label: t("globalGraph.islandCenter"),
                      hint: t("globalGraph.focusHint"),
                      value: focusLayer,
                      options: [
                        { value: "crystal", label: t("globalGraph.layer.crystal"), disabled: !hasKnowledge },
                        { value: "note", label: t("globalGraph.layer.note") },
                      ],
                      onChange: (v) => setFocusChoice(v as FocusLayer),
                    }
                  : undefined
              }
            />
            {colorMode === "context" && (
              <label
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
                data-tooltip={t("globalGraph.clusterByContextHint")}
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
              {/* フォルダで絞る（凡例のチップと同じ選択を共有。色モードに関わらず出す） */}
              {folderTags.length > 0 && (
                <DisplayMenu
                  label={t("globalGraph.folderFilter")}
                  hint={t("globalGraph.folderFilterHint")}
                  items={folderTags.map(({ value, count }) => ({
                    key: value.toLowerCase(),
                    label: value,
                    checked: selectedContexts.has(value.toLowerCase()),
                    onChange: () => toggleContext(value.toLowerCase()),
                    suffix: `(${count})`,
                  }))}
                />
              )}
              {/* 検索: 一致しないノードをその場で隠す + Enter で一致へ順にパン（Esc でクリア） */}
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
              <span className="text-[11px] text-muted-foreground" data-tooltip={t("globalGraph.visibleOfHint")}>
                {t("globalGraph.visibleOf", {
                  n: String(visibleCount ?? displayedNodeCount),
                  m: String(displayedNodeCount),
                })}
              </span>
            </span>
          </>
      </div>
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
          {/* キャンバス行: [キャンバス] [ピーク] [来歴パネル] を横に並べる */}
          <div ref={rowRef} className="flex flex-1 min-h-0">
          <div className="flex-1 min-h-0 min-w-0">
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
                similarityVectors={similarityPull ? similarityVectors : null}
                topicVectors={contentIslands ? similarityVectors : null}
                topicVectorsPending={contentIslands && similarityVectors === null}
                onIslandGrouping={setIslandGrouping}
                islandLabels={showIslandLabels}
                onSimilarityStats={setSimilarityStats}
                searchQuery={searchInput}
                searchJumpToken={searchJumpToken}
                onSearchHits={setSearchHits}
                onVisibleCount={setVisibleCount}
                onNavigate={onSelectNote}
                onOpenMedia={onOpenMedia}
                onOpenUrl={onOpenUrl}
                onOpenMemo={onOpenMemo}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                onOpenNodeDirect={onOpenNodeDirect}
                height="100%"
              />
            )}
          </div>
          {sidePanel && peek?.({ floating: peekFloating })}
          {sidePanel}
          </div>
        </>
    </div>
  );
}
