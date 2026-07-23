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
import { Search } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { knowledgeKindColor, knowledgeKindBorder } from "./knowledge-colors";
import { openExternalUrl } from "../../lib/external-link";
import { aggregateNoteContexts, noteContextHue } from "../note-context/context-tags";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { useT } from "../../i18n";
import type { NoteNode, NoteGraphData, EdgeRelation } from "./graph-builder";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

// ── kind / 層 ──

type GraphKind = "external" | "note" | "summary" | "claim" | "atom" | "synthesis";
type LayerId = "source" | "note" | "crystal" | "synth";

/** NoteNode から kind を判定する。 */
function kindOf(n: NoteNode): GraphKind {
  if (n.external) return "external";
  if (n.isWiki) {
    const k = n.wikiKind;
    if (k === "claim" || k === "atom" || k === "synthesis") return k;
    // 撤退済み / 未知の wikiKind（旧 meta-atom 等）は synthesis（統合）扱いにフォールバック。
    // ここで GraphKind 外の値を返すと KIND_LAYER 引きが undefined になり、層フィルタで
    // 常に弾かれて silent に消える（meta-atom が見えなかった原因）。
    // 注: summary は buildGlobalGraph 側でグラフから除外済みなのでここには来ない。
    return "synthesis";
  }
  return "note";
}

const KIND_LAYER: Record<GraphKind, LayerId> = {
  external: "source",
  note: "note",
  claim: "crystal",
  atom: "crystal",
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
 */
export function filterGlobalGraph(
  data: NoteGraphData,
  opts: {
    visibleLayers: Set<LayerId>;
    hideReferences?: boolean;
    hideIsolated?: boolean;
    contextFilter?: Set<string>;
    hideUncategorized?: boolean;
  },
): NoteGraphData {
  const {
    visibleLayers,
    hideReferences = false,
    hideIsolated = false,
    contextFilter,
    hideUncategorized = false,
  } = opts;
  const visibleIds = new Set(
    data.nodes.filter((n) => visibleLayers.has(KIND_LAYER[kindOf(n)])).map((n) => n.id),
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
};

const KIND_SIZE: Record<GraphKind, number> = {
  external: 26,
  note: 32,
  summary: 32,
  claim: 30,
  atom: 36,
  synthesis: 38,
};

const REL_COLOR: Record<EdgeRelation, string> = {
  derived: "#4B7A52",
  used: "#9aa0a6",
  reference: "#5b8fb9",
};

const BG_COLOR = "#fafdf7";

// ── Cytoscape スタイル ──

const graphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      // auto(既定)は折返し行の字間が崩れて描画される(cytoscape の複数行描画の不具合回避)
      "text-justification": "center" as any,
      "text-max-width": "150px",
      "font-size": "10px",
      "font-family":
        "Atkinson Hyperlegible Next, BIZ UDPGothic, Inter, system-ui, sans-serif",
      "text-valign": "bottom",
      "text-margin-y": 5,
      color: "#3a4a3d",
      "background-color": "data(color)",
      "border-color": "data(borderColor)",
      "border-width": 2,
      shape: "data(shape)" as any,
      width: "data(size)",
      height: "data(size)",
      "transition-property": "opacity, width, height, border-width" as any,
      "transition-duration": 180,
      "transition-timing-function": "ease-in-out-sine" as any,
    },
  },
  {
    selector: "node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.06,
      "overlay-color": "#000",
      label: "data(fullLabel)" as any,
      "font-weight": "bold" as any,
      "z-index": 999,
    },
  },
  { selector: "node.faded", style: { opacity: 0.12 } },
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
      width: 1.6,
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "line-style": "data(lineStyle)" as any,
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 28,
      "control-point-weights": 0.5,
      opacity: 0.85,
      "transition-property": "opacity, width" as any,
      "transition-duration": 180,
    },
  },
  { selector: "edge.hover-connected", style: { width: 2.6, opacity: 1, "z-index": 10 } },
  { selector: "edge.faded", style: { opacity: 0.06 } },
  {
    // 「文脈で寄せる」用の不可視エッジ。描画・操作はさせず fcose の引力計算にだけ効かせる
    // （display:none だとレイアウト対象から外れるので opacity 0 で隠す）。
    selector: "edge.cluster-edge",
    style: { opacity: 0, events: "no" as any },
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

// ── キャンバス（クロムなし。オーバーレイや Storybook から使う） ──

export function GlobalGraphCanvas({
  data,
  visibleLayers,
  hideReferences = false,
  hideIsolated = false,
  colorMode = "kind",
  contextFilter,
  hideUncategorized = false,
  clusterByContext = false,
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
  /** 同じ文脈タグのノードを不可視エッジで引き寄せ、クラスターとして固まらせる。 */
  clusterByContext?: boolean;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // mouseout ハンドラ（cy 構築時のクロージャ）から最新の検索クエリ・色モードを
  // 参照するための ref。state を deps に入れて cy を作り直すと再レイアウトが走るため。
  const searchRef = useRef(searchQuery);
  searchRef.current = searchQuery;
  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;
  // Enter 巡回の現在位置（クエリが変わったら 0 に戻す）
  const jumpIndexRef = useRef(0);

  // 表示中の層・参照・文脈タグ・未分類・孤立フィルタを適用
  const { nodes: shownNodes, edges: shownEdges } = useMemo(
    () =>
      filterGlobalGraph(data, {
        visibleLayers,
        hideReferences,
        hideIsolated,
        contextFilter,
        hideUncategorized,
      }),
    [data, visibleLayers, hideReferences, hideIsolated, contextFilter, hideUncategorized],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    if (shownNodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      return;
    }

    const elements: cytoscape.ElementDefinition[] = [];
    for (const node of shownNodes) {
      const kind = kindOf(node);
      const full = `${nodeIcon(node)}${node.title}`;
      // 色は構築時点のモードで塗る。モード切替時は色 effect が data を書き換える
      // （cy を作り直さない＝レイアウトを保つ）。
      const { fill, border } = nodeColors(node, colorModeRef.current);
      elements.push({
        data: {
          id: node.id,
          label: truncate(full),
          fullLabel: full,
          color: fill,
          borderColor: border,
          shape: KIND_SHAPE[kind],
          size: KIND_SIZE[kind],
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

    if (cyRef.current) cyRef.current.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: graphStyle,
      layout: { name: "preset" },
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 3,
      boxSelectionEnabled: false,
      // 俯瞰用の読み取り専用グラフ。ノードはドラッグで動かせないようにし
      // （autoungrabify）、背景でもノード上でもドラッグでパンできるようにする。
      // クリック（tap）はナビゲーションに使うので、ドラッグと自然に共存する。
      userPanningEnabled: true,
      autoungrabify: true,
    });
    // パン可能であることを示すため掴むカーソルにする。
    containerRef.current.style.cursor = "grab";

    // 「文脈で寄せる」時はクラスター内を固めるだけでなく、クラスター**間**を離す:
    // 仮想エッジ（短い理想長・強い弾性）が塊を作り、実エッジは理想長を大きく伸ばし
    // 弾性も落として「緩い腕」にする。反発を強め・中心重力をほぼ切って塊同士を
    // 引き離す。値は Storybook「文脈クラスター（大規模）」で見た目調整したもの。
    const lay = cy.layout({
      name: "fcose",
      animate: true,
      animationDuration: 700,
      randomize: true,
      quality: "default",
      nodeRepulsion: clusterByContext ? 30000 : 9000,
      idealEdgeLength: (edge: any) =>
        edge.data("virtual") ? 35 : clusterByContext ? 300 : 110,
      edgeElasticity: (edge: any) =>
        edge.data("virtual") ? 0.9 : clusterByContext ? 0.2 : 0.4,
      gravity: clusterByContext ? 0.06 : 0.3,
      nodeSeparation: 120,
      padding: 50,
    } as any);
    lay.on("layoutstop", () => cy.fit(undefined, 30));
    lay.run();

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
      cy.destroy();
      cyRef.current = null;
    };
  }, [shownNodes, shownEdges, clusterByContext, onNavigate, onOpenMedia, onOpenUrl, onOpenMemo]);

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
    <div
      ref={containerRef}
      style={{ width: "100%", height, background: BG_COLOR }}
    />
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
function LayerChips({
  visible,
  counts,
  onToggle,
}: {
  visible: Set<LayerId>;
  counts: Record<LayerId, number>;
  onToggle: (id: LayerId) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_LAYERS.map((id) => {
        const on = visible.has(id);
        const count = counts[id] ?? 0;
        const empty = count === 0;
        return (
          <button
            key={id}
            onClick={() => !empty && onToggle(id)}
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
    };
    const withIsolated = filterGlobalGraph(data, { ...base, hideIsolated: false });
    const connectedOnly = filterGlobalGraph(data, { ...base, hideIsolated: true });
    return {
      shown: showIsolated ? withIsolated : connectedOnly,
      isolatedCount: withIsolated.nodes.length - connectedOnly.nodes.length,
    };
  }, [data, visible, hideRefs, showIsolated, selectedContexts, hideUncategorized]);

  // 各層のノード総数（孤立含む・フィルタ前）。チップの件数表示に使う。
  const layerCounts = useMemo(() => {
    const m: Record<LayerId, number> = { source: 0, note: 0, crystal: 0, synth: 0 };
    for (const n of data.nodes) m[KIND_LAYER[kindOf(n)]]++;
    return m;
  }, [data]);

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
    <div className="flex flex-col h-full w-full" style={{ background: BG_COLOR }}>
      {/* ヘッダー / ツールバー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-wrap">
        <span className="text-sm font-bold text-foreground">{t("globalGraph.title")}</span>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={hideRefs} onChange={(e) => setHideRefs(e.target.checked)} />
          {t("globalGraph.hideReferences")}
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title={t("globalGraph.showIsolatedHint")}>
          <input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} />
          {t("globalGraph.showIsolated")}
          {isolatedCount > 0 && <span className="opacity-70">({isolatedCount})</span>}
        </label>
        <LayerChips visible={visible} counts={layerCounts} onToggle={toggleLayer} />
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
            {shown.nodes.length} / {shown.edges.length}
          </span>
        </span>
      </div>
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
            clusterByContext={clusterByContext}
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
    </div>
  );
}
