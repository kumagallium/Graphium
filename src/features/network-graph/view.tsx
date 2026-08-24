// ノート間ネットワークグラフ（Obsidian 風）
// Cytoscape.js + fcose で派生関係をヌルヌル可視化
// design.md テーマカラー準拠

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, RotateCcw, X } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import type { NoteGraphData } from "./graph-builder";
import type { WikiKind } from "../../lib/document-types";
import {
  knowledgeKindColor,
  knowledgeKindBorder,
  KNOWLEDGE_KIND_LEGEND_ORDER,
} from "./knowledge-colors";
import { useT } from "../../i18n";
import { resolveMediaThumbUrl } from "../asset-browser/media-thumbnails";
import { activityTypeLabelKey } from "../document-provenance/activity-label";
import { openExternalUrl } from "../../lib/external-link";
import { noteGraphScope } from "./graph-layout";
import {
  GRAPH_ACCENT_COLOR,
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
  seedUnplacedNodes,
  useGraphLayout,
} from "./use-graph-layout";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

// ── design.md テーマカラー準拠 ──

const NODE_COLORS = {
  current: "#4B7A52", // ブランドグリーン（現在のノート）
  hop1: "#5b8fb9",    // 落ち着いた青（1ホップ）
  hop2: "#b8c9be",    // 淡いグリーングレー（2ホップ）
  wiki: "#9b6dcc",    // パープル（Wiki ドキュメント）
  external: "#9aa0a6", // グレー（PDF / URL 等の外部ソース）
} as const;

const EDGE_COLOR = "#b8d4bb"; // 淡いグリーン

type ExternalKind = "pdf" | "url" | "document" | "chat" | "memo" | "media";

function getNodeColor(
  hop: number,
  isCurrent: boolean,
  isWiki?: boolean,
  external?: ExternalKind,
  wikiKind?: WikiKind,
): string {
  if (isCurrent) return NODE_COLORS.current;
  if (external) return NODE_COLORS.external;
  if (isWiki) return knowledgeKindColor(wikiKind);
  if (hop === 1) return NODE_COLORS.hop1;
  return NODE_COLORS.hop2;
}

function getBorderColor(
  hop: number,
  isCurrent: boolean,
  isWiki?: boolean,
  external?: ExternalKind,
  wikiKind?: WikiKind,
): string {
  if (isCurrent) return "#3d6844";
  if (external) return "#6e7378";
  if (isWiki) return knowledgeKindBorder(wikiKind);
  if (hop === 1) return "#4a7da6";
  return "#9cb5a4";
}

function getNodeSize(isCurrent: boolean): number {
  return isCurrent ? 40 : 28;
}

function getNodeShape(isCurrent: boolean, isWiki?: boolean, external?: ExternalKind): string {
  if (isCurrent) return "ellipse";
  if (external) return "rectangle";
  return isWiki ? "diamond" : "ellipse";
}

// ── Cytoscape スタイル ──

const cytoscapeStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      ...baseNodeStyle,
      "background-color": "data(color)",
      shape: "data(shape)" as any,
      width: "data(size)",
      height: "data(size)",
      "border-color": "data(borderColor)",
    },
  },
  ...interactionStyles,
  hoverFullLabelStyle,
  {
    selector: "edge",
    style: {
      ...baseEdgeStyle,
      "line-color": EDGE_COLOR,
      "target-arrow-color": EDGE_COLOR,
    },
  },
  // ホバーノードに接続するエッジ
  {
    selector: "edge.hover-connected",
    style: {
      width: 2.5,
      "line-color": GRAPH_ACCENT_COLOR,
      "target-arrow-color": GRAPH_ACCENT_COLOR,
      "z-index": 10,
    },
  },
  // 画像 / 動画メディアノード: サムネイルを背景画像として表示
  // contain で全体を見せる（縦横比は維持、余白は塗り色）。
  {
    selector: "node.thumb",
    style: {
      "background-image": "data(thumbUrl)" as any,
      "background-fit": "contain" as any,
      "background-opacity": 1 as any,
      "background-color": "#ffffff",
      "background-clip": "node" as any,
      shape: "round-rectangle",
      width: 40,
      height: 40,
    },
  },
];

// ── コンポーネント ──

export function NetworkGraphPanel({
  data,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
}: {
  data: NoteGraphData;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /** URL ソースノードをアプリ内（素材サイドピークのリーダー）で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースノードをメモギャラリーの該当詳細で開く。未指定なら表示のみ。 */
  onOpenMemo?: (captureId: string) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  // 画像 / 動画メディアノードのサムネイル静止画 URL を非同期解決して保持する。
  // プロバイダ依存の URL（media-server:// 等）は Cytoscape の background-image で
  // 直接読めない（動画はそもそも image MIME ではない）ため、resolveMediaThumbUrl を経由する。
  const [mediaThumbs, setMediaThumbs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const thumbableNodes = data.nodes.filter(
      (n) =>
        n.external === "media" &&
        (n.mediaType === "image" || n.mediaType === "video") &&
        n.mediaFileId,
    );
    if (thumbableNodes.length === 0) {
      setMediaThumbs(new Map());
      return;
    }
    let cancelled = false;
    const next = new Map<string, string>();
    Promise.all(
      thumbableNodes.map(async (n) => {
        const url = await resolveMediaThumbUrl({
          type: n.mediaType,
          url: n.externalUrl ?? "",
          fileId: n.mediaFileId!,
        });
        if (url) next.set(n.mediaFileId!, url);
      }),
    ).then(() => {
      if (!cancelled) setMediaThumbs(next);
    });
    return () => {
      cancelled = true;
    };
  }, [data.nodes]);
  const [expanded, setExpanded] = useState(false);

  // ── 手動配置の保存 ──
  //
  // スコープは中心ノート（isCurrent）。中心を持たないグラフは保存対象外にする。
  const currentNodeId = data.nodes.find((n) => n.isCurrent)?.id ?? null;
  const layoutScope = currentNodeId ? noteGraphScope(currentNodeId) : null;
  const {
    ready: layoutReady,
    positions: savedPositions,
    save: saveLayout,
    reset: resetLayout,
    hasSaved: hasSavedLayout,
    resetSeq: layoutResetSeq,
  } = useGraphLayout(layoutScope);
  // 保存のたびに参照が変わるので、グラフ構築 effect の依存には入れず ref で読む
  // （入れるとドラッグ→保存→再構築のループになる）
  const savedPositionsRef = useRef(savedPositions);
  savedPositionsRef.current = savedPositions;
  const saveLayoutRef = useRef(saveLayout);
  saveLayoutRef.current = saveLayout;

  const handleNavigate = useCallback(
    (noteId: string) => onNavigate(noteId),
    [onNavigate]
  );

  // Esc キーで拡大解除
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 保存済みの配置を読み終えるまで組まない。先に自動レイアウトで組んでしまうと、
    // 復元のたびにノードが飛んで見える
    if (!layoutReady) return;

    // グラフデータが空なら表示しない
    if (data.nodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      return;
    }

    // Cytoscape 要素を構築
    const elements: cytoscape.ElementDefinition[] = [];

    // ラベルが長いとノード周辺で重なるので、表示用に省略する。フルタイトルはツールチップで読める。
    const truncate = (s: string, max = 18): string =>
      [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;

    for (const node of data.nodes) {
      const color = getNodeColor(node.hop, node.isCurrent, node.isWiki, node.external, node.wikiKind);
      const mediaIcon =
        node.external === "media"
          ? node.mediaType === "video"
            ? "🎬"
            : node.mediaType === "audio"
            ? "🎵"
            : "🖼️"
          : "";
      const baseTitle = node.external === "pdf"
        ? `📄 ${node.title}`
        : node.external === "document"
        ? `📝 ${node.title}`
        : node.external === "url"
        ? `🔗 ${node.title}`
        : node.external === "chat"
        ? `💬 ${node.title}`
        : node.external === "memo"
        ? `🗒️ ${node.title}`
        : node.external === "media"
        ? `${mediaIcon} ${node.title}`
        : node.isWiki
        ? `🤖 ${node.title}`
        : node.title;
      // wiki ノードの成長サマリ（hover 時のフルラベルにのみ出す。通常表示は不変）
      const growthLine = node.growth
        ? (() => {
            const key = activityTypeLabelKey(node.growth.lastOp);
            const op = key ? t(key as never) : node.growth.lastOp;
            return `\n↗ ${t("graph.growthSummary", { count: String(node.growth.count), op })}`;
          })()
        : "";
      // 画像 / 動画メディアでサムネイルが解決済みなら背景画像表示にする
      const thumbUrl =
        node.external === "media" &&
        (node.mediaType === "image" || node.mediaType === "video") &&
        node.mediaFileId
          ? mediaThumbs.get(node.mediaFileId)
          : undefined;
      const hasThumb = !!thumbUrl;
      elements.push({
        data: {
          id: node.id,
          label: truncate(baseTitle, 18),
          fullLabel: baseTitle + growthLine,
          color,
          borderColor: getBorderColor(node.hop, node.isCurrent, node.isWiki, node.external, node.wikiKind),
          size: getNodeSize(node.isCurrent),
          shape: hasThumb ? "round-rectangle" : getNodeShape(node.isCurrent, node.isWiki, node.external),
          hop: node.hop,
          isCurrent: node.isCurrent,
          isWiki: !!node.isWiki,
          externalUrl: node.externalUrl,
          ...(hasThumb ? { thumbUrl } : {}),
        },
        ...(hasThumb ? { classes: "thumb" } : {}),
      });
    }

    for (const edge of data.edges) {
      elements.push({
        data: {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          label: edge.sourceBlockLabel ?? "",
        },
      });
    }

    // 保存済みの座標を要素に流し込む。1 つでも復元できたら自動レイアウトは流さず、
    // 新しく増えたノードだけ既存の並びの外周に置く（手で整えた並びを崩さない）
    const { unplacedIds, placedCount } = applySavedPositions(elements, savedPositionsRef.current);
    const useSavedLayout = placedCount > 0;

    // 既存インスタンスがあれば破棄
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cytoscapeStyle,
      layout: { name: "preset" },
      // ラベル衝突を抑えるため、ホバー時にフルラベルを表示する設定
      // （ノード自体の label は data.label = 省略形）
      ...GRAPH_INIT_OPTIONS,
    });

    // fcose レイアウト実行（要素描画後にアニメーション開始）
    // ラベル重なり対策 + ホップ距離の可視化:
    //   - ノード反発と理想エッジ長を大きめにとって全体間隔を確保
    //   - idealEdgeLength を hop 差に応じて変える（中心→hop1 は短い、hop2 へは長い）
    //     ことで「ホップ数が近いほど中心に近い」配置になる。
    //   - hop 数が多いノード自体に少し負の gravity をかけて外側へ押し出す
    if (useSavedLayout) {
      // 手動で整えた並びを復元。新しく増えたノードは外周に仮置きする
      seedUnplacedNodes(cy, unplacedIds);
      cy.fit(undefined, 20);
    } else {
    const layout = cy.layout({
      name: "fcose",
      animate: true,
      animationDuration: 800,
      animationEasing: "ease-out-cubic" as any,
      quality: "default",
      randomize: true,
      nodeRepulsion: (node: any) => {
        // hop が大きいほど周辺ノードと反発を弱め、現在ノード周辺を密にする
        const hop = node.data("hop") ?? 0;
        return 12000 + hop * 4000;
      },
      idealEdgeLength: (edge: any) => {
        // エッジが繋ぐノードの hop 差で理想の長さを変える
        const a = edge.source().data("hop") ?? 0;
        const b = edge.target().data("hop") ?? 0;
        const maxHop = Math.max(a, b);
        // 中心(0)とのエッジは短く、hop が深くなるほど長く
        if (maxHop <= 1) return 120;
        if (maxHop <= 2) return 220;
        return 300;
      },
      edgeElasticity: 0.35,
      gravity: 0.4,
      gravityRange: 4.0,
      nodeSeparation: 140,
      padding: 60,
    } as any);
    layout.on("layoutstop", () => {
      cy.fit(undefined, 20);
    });
    layout.run();
    }

    // ドラッグ終了で現在の並びを保存する
    const detachPersistence = attachCytoscapeLayoutPersistence(cy, (positions) =>
      saveLayoutRef.current(positions),
    );

    // ── ホバーエフェクト ──

    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      const neighborhood = node.neighborhood();

      // 全要素をフェード
      cy.elements().addClass("faded");

      // ホバーノード + 隣接をハイライト
      node.removeClass("faded").addClass("hover");
      neighborhood.removeClass("faded");
      neighborhood.nodes().addClass("hover-neighbor");
      neighborhood.edges().addClass("hover-connected");

      // カーソル変更（他ノートならポインター）
      const isCurrent = node.data("isCurrent");
      if (!isCurrent) {
        containerRef.current!.style.cursor = "pointer";
      }
    });

    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("faded hover hover-neighbor hover-connected");
      containerRef.current!.style.cursor = "default";
    });

    // ノードクリックでナビゲーション
    cy.on("tap", "node", (evt) => {
      const nodeId: string = evt.target.id();
      const isCurrent = evt.target.data("isCurrent");
      if (isCurrent) return;
      // 外部ソース: PDF はストレージプロバイダの blob URL、URL は元 URL
      const externalUrl: string | undefined = evt.target.data("externalUrl");
      if (nodeId.startsWith("pdf:")) {
        if (onOpenMedia) onOpenMedia(nodeId.slice(4));
        return;
      }
      if (nodeId.startsWith("document:")) {
        // Word(.docx) など document 素材を PDF と同じくアセットモーダルで開く
        if (onOpenMedia) onOpenMedia(nodeId.slice("document:".length));
        return;
      }
      if (nodeId.startsWith("chat:")) {
        // AI チャット由来ソースは開けるアセットが無いので何もしない
        return;
      }
      if (nodeId.startsWith("memo:")) {
        // メモ由来ソースはメモギャラリーの該当詳細を開く（未配線なら表示のみ）
        onOpenMemo?.(nodeId.slice("memo:".length));
        return;
      }
      if (nodeId.startsWith("url:")) {
        if (externalUrl) {
          // アプリ内リーダー（素材サイドピーク）を優先。未配線の文脈のみ外部ブラウザ。
          if (onOpenUrl) onOpenUrl(externalUrl);
          else void openExternalUrl(externalUrl);
        }
        return;
      }
      // 画像/動画/音声メディア: PDF と同じく onOpenMedia 経由でアセットモーダルを開く
      if (nodeId.startsWith("media:")) {
        if (onOpenMedia) onOpenMedia(nodeId.slice(6));
        return;
      }
      // wiki ノードは "wiki:" プレフィックスを付けて遷移
      const isWiki = !!evt.target.data("isWiki");
      handleNavigate(isWiki ? `wiki:${nodeId}` : nodeId);
    });

    cyRef.current = cy;

    return () => {
      detachPersistence();
      cy.destroy();
      cyRef.current = null;
    };
    // savedPositions / saveLayout は ref 経由で読む（依存に入れると
    // ドラッグ → 保存 → 再構築のループになる）
  }, [
    data,
    handleNavigate,
    onOpenMedia,
    onOpenUrl,
    onOpenMemo,
    expanded,
    mediaThumbs,
    layoutReady,
    layoutResetSeq,
  ]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t("panel.graph.empty")}
      </div>
    );
  }

  const legendBar = (
    <div className="px-3 py-2 border-b border-border flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS.current }} />
        {t("panel.graph.legend.current")}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS.hop1 }} />
        {t("panel.graph.legend.hop1")}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS.hop2 }} />
        {t("panel.graph.legend.hop2")}
      </span>
      {KNOWLEDGE_KIND_LEGEND_ORDER.map((kind) => (
        <span key={kind} className="flex items-center gap-1">
          <span
            className="inline-block rotate-45"
            style={{ backgroundColor: knowledgeKindColor(kind), width: 8, height: 8 }}
          />
          {t(`knowledge.kind.${kind}` as any)}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-1">
        {hasSavedLayout && (
          <button
            onClick={resetLayout}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t("graph.layout.resetHint")}
            aria-label={t("graph.layout.reset")}
          >
            <RotateCcw size={12} />
          </button>
        )}
        <span>{t("panel.graph.stats", { nodes: String(data.nodes.length), edges: String(data.edges.length) })}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={expanded ? t("panel.graph.collapse") : t("panel.graph.expand")}
        >
          {expanded ? <X size={12} /> : <Maximize2 size={12} />}
        </button>
      </span>
    </div>
  );

  // 拡大時は portal で画面全体に重ねる
  if (expanded) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: "rgba(0, 0, 0, 0.45)" }}
        onClick={() => setExpanded(false)}
      >
        <div
          className="relative flex flex-col rounded-lg shadow-2xl overflow-hidden"
          style={{ background: GRAPH_BG_COLOR, width: "min(1400px, 95vw)", height: "92vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {legendBar}
          <div ref={containerRef} className="flex-1" />
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: GRAPH_BG_COLOR }}>
      {legendBar}
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
