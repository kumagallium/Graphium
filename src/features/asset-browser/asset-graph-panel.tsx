// 素材グラフパネル — 中心素材 + 利用ノート + 派生関係を Cytoscape で可視化
// 旧 MediaDetailModal から分離して、MaterialSidePeek / 右パネル / Full view 等で再利用できる
// 形にしたもの。表示するか自体は呼び出し側で判定する（showGraph 判定はこのコンポーネントの中）。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, RotateCcw, X } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { assetGraphScope } from "../network-graph/graph-layout";
import {
  GRAPH_BG_COLOR,
  GRAPH_INIT_OPTIONS,
  baseEdgeStyle,
  baseNodeStyle,
  interactionStyles,
} from "../network-graph/graph-theme";
import {
  applySavedPositions,
  attachCytoscapeLayoutPersistence,
  seedUnplacedNodes,
  useGraphLayout,
} from "../network-graph/use-graph-layout";
import { useT } from "../../i18n";
import type { MediaIndex, MediaIndexEntry } from "./media-index";
import type { WikiKind } from "../../lib/document-types";
import {
  knowledgeKindColor,
  knowledgeKindBorder,
  KNOWLEDGE_KIND_LEGEND_ORDER,
} from "../network-graph/knowledge-colors";
import { isThumbnailable, resolveMediaThumbUrl } from "./media-thumbnails";

ensureCytoscapePlugins();

// ── グラフカラー（design.md 準拠） ──

const MEDIA_CENTER_COLOR = "#c08b3e";
const MEDIA_CENTER_BORDER = "#a6782f";
const MEDIA_RELATED_COLOR = "#d6b27f";
const MEDIA_RELATED_BORDER = "#a6782f";
const NOTE_NODE_COLOR = "#5b8fb9";
const NOTE_BORDER = "#4a7da6";
const EDGE_COLOR = "#b8d4bb";
const EDGE_DERIVED_COLOR = "#c7b389";

const graphStyle: cytoscape.StylesheetStyle[] = [
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
  {
    // 中心（今見ている素材）だけ少し強く。大きさは変えずウェイトで示す
    selector: "node.center-node",
    style: {
      "font-weight": "bold" as any,
    },
  },
  {
    selector: "edge",
    style: {
      ...baseEdgeStyle,
      "line-color": EDGE_COLOR,
      "target-arrow-color": EDGE_COLOR,
      opacity: 0.7,
    },
  },
  {
    selector: "edge.derived",
    style: {
      "line-color": EDGE_DERIVED_COLOR,
      "target-arrow-color": EDGE_DERIVED_COLOR,
      "line-style": "dashed" as any,
    },
  },
  {
    selector: "node.thumb",
    style: {
      "background-image": "data(thumbUrl)" as any,
      "background-fit": "contain" as any,
      "background-opacity": 1 as any,
      "background-color": "#ffffff",
      "background-clip": "node" as any,
      shape: "round-rectangle",
      width: 44,
      height: 44,
    },
  },
];

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function getMediaShape(type: MediaIndexEntry["type"]): string {
  if (type === "url") return "round-rectangle";
  if (type === "pdf") return "round-triangle";
  return "diamond";
}

export type KnowledgeKindLookup = (rawWikiId: string) => WikiKind | undefined;

function buildMediaGraph(
  entry: MediaIndexEntry,
  mediaIndex: MediaIndex | null,
  getKnowledgeKind: KnowledgeKindLookup | undefined,
  assetThumbUrls: Map<string, string>,
): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];
  const centerId = `media-${entry.fileId}`;

  // 中心ノード
  const centerThumb = isThumbnailable(entry) ? assetThumbUrls.get(entry.fileId) : undefined;
  const centerHasThumb = !!centerThumb;
  elements.push({
    data: {
      id: centerId,
      label: truncate(entry.name, 20),
      color: MEDIA_CENTER_COLOR,
      borderColor: MEDIA_CENTER_BORDER,
      shape: centerHasThumb ? "round-rectangle" : getMediaShape(entry.type),
      size: centerHasThumb ? 60 : 44,
      ...(centerHasThumb ? { thumbUrl: centerThumb } : {}),
    },
    classes: centerHasThumb ? "center-node thumb" : "center-node",
  });

  // 関連アセット
  const allMedia = mediaIndex?.media ?? [];
  const byFileId = new Map(allMedia.map((m) => [m.fileId, m]));
  const parents: MediaIndexEntry[] = [];
  for (const parentId of entry.derivedFromAssets ?? []) {
    const parent = byFileId.get(parentId);
    if (parent && parent.fileId !== entry.fileId) parents.push(parent);
  }
  const children: MediaIndexEntry[] = [];
  for (const m of allMedia) {
    if (m.fileId === entry.fileId) continue;
    if (m.derivedFromAssets?.includes(entry.fileId)) children.push(m);
  }

  for (const asset of [...parents, ...children]) {
    const assetNodeId = `media-${asset.fileId}`;
    const thumbUrl = isThumbnailable(asset) ? assetThumbUrls.get(asset.fileId) : undefined;
    const hasThumb = !!thumbUrl;
    elements.push({
      data: {
        id: assetNodeId,
        label: truncate(asset.name, 18),
        fullTitle: asset.name,
        color: MEDIA_RELATED_COLOR,
        borderColor: MEDIA_RELATED_BORDER,
        shape: hasThumb ? "round-rectangle" : getMediaShape(asset.type),
        size: hasThumb ? 44 : 30,
        ...(hasThumb ? { thumbUrl } : {}),
      },
      classes: hasThumb ? "clickable asset-node thumb" : "clickable asset-node",
    });
  }
  for (const parent of parents) {
    elements.push({
      data: {
        id: `edge-derived-${parent.fileId}-${entry.fileId}`,
        source: `media-${parent.fileId}`,
        target: centerId,
      },
      classes: "derived",
    });
  }
  for (const child of children) {
    elements.push({
      data: {
        id: `edge-derived-${entry.fileId}-${child.fileId}`,
        source: centerId,
        target: `media-${child.fileId}`,
      },
      classes: "derived",
    });
  }

  // 使用ノート
  const seenNotes = new Set<string>();
  for (const usage of entry.usedIn) {
    if (seenNotes.has(usage.noteId)) continue;
    seenNotes.add(usage.noteId);

    const isKnowledge = usage.noteId.startsWith("wiki:");
    const rawId = isKnowledge ? usage.noteId.slice(5) : usage.noteId;
    const kind = isKnowledge ? getKnowledgeKind?.(rawId) : undefined;
    const color = isKnowledge ? knowledgeKindColor(kind) : NOTE_NODE_COLOR;
    const borderColor = isKnowledge ? knowledgeKindBorder(kind) : NOTE_BORDER;
    const shape = isKnowledge ? "diamond" : "ellipse";

    elements.push({
      data: {
        id: usage.noteId,
        label: truncate(usage.noteTitle, 18),
        fullTitle: usage.noteTitle,
        color,
        borderColor,
        shape,
        size: 32,
      },
      classes: "clickable note-node",
    });

    elements.push({
      data: {
        id: `edge-${entry.fileId}-${usage.noteId}`,
        source: centerId,
        target: usage.noteId,
      },
    });
  }

  return elements;
}

/**
 * 素材グラフが描画可能か判定する（呼び出し側で UI 表示制御に使う）。
 * 中心メディアしかない場合（孤立アセット）は false を返す。
 */
export function shouldShowAssetGraph(
  entry: MediaIndexEntry,
  mediaIndex: MediaIndex | null | undefined,
): boolean {
  // SidePeek が保持する entry は state スナップショットで、翻訳/PROV 化で usedIn が
  // 増えても古いままになる。最新の mediaIndex から引き直して判定する。
  const resolved = mediaIndex?.media.find((m) => m.fileId === entry.fileId) ?? entry;
  const hasUsages = resolved.usedIn.length > 0;
  const hasRelatedAssets =
    (resolved.derivedFromAssets && resolved.derivedFromAssets.length > 0) ||
    (mediaIndex?.media ?? []).some(
      (m) => m.fileId !== entry.fileId && m.derivedFromAssets?.includes(entry.fileId),
    );
  return hasUsages || hasRelatedAssets;
}

export type AssetGraphPanelProps = {
  entry: MediaIndexEntry;
  mediaIndex?: MediaIndex | null;
  getKnowledgeKind?: KnowledgeKindLookup;
  /** ノートノードクリック時（アセット画面を離れて全画面で開く） */
  onNavigateNote: (noteId: string) => void;
  /** 指定時はノートノードクリックで「離脱せず右に SidePeek で開く」挙動に切り替える */
  onOpenNoteSidePeek?: (noteId: string) => void;
  /** 関連アセットノードクリック時（中心を切り替え） */
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
  /** 凡例を表示するか（コンパクト表示時は省略可） */
  showLegend?: boolean;
  /** 拡大表示（Maximize2）ボタンを出すか。既定 true。
   *  ノートの NetworkGraphView と同じ pattern で portal modal で全画面表示する。 */
  enableExpand?: boolean;
};

export function AssetGraphPanel({
  entry: entryProp,
  mediaIndex,
  getKnowledgeKind,
  onNavigateNote,
  onOpenNoteSidePeek,
  onSwitchAsset,
  showLegend = true,
  enableExpand = true,
}: AssetGraphPanelProps) {
  const t = useT();
  // 開いたまま翻訳/PROV 化で usedIn が増えた場合に追従できるよう、最新の mediaIndex から
  // entry を引き直す（prop の entry は SidePeek の state スナップショットで古くなりうる）。
  const entry = mediaIndex?.media.find((m) => m.fileId === entryProp.fileId) ?? entryProp;
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [expanded, setExpanded] = useState(false);

  // ── 手動配置の保存（ノート周辺グラフ・手順フロー・全体グラフと同じ仕組み）──
  const {
    ready: layoutReady,
    positions: savedPositions,
    save: saveLayout,
    reset: resetLayout,
    hasSaved: hasSavedLayout,
    resetSeq: layoutResetSeq,
  } = useGraphLayout(assetGraphScope(entry.fileId));
  const savedPositionsRef = useRef(savedPositions);
  savedPositionsRef.current = savedPositions;
  const saveLayoutRef = useRef(saveLayout);
  saveLayoutRef.current = saveLayout;

  // ESC で拡大解除（ノート graph と同じ挙動）
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  // サムネイル URL を解決
  const [assetThumbUrls, setAssetThumbUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const allMedia = mediaIndex?.media ?? [];
    const targets: MediaIndexEntry[] = [];
    if (isThumbnailable(entry)) targets.push(entry);
    for (const m of allMedia) {
      if (m.fileId === entry.fileId) continue;
      if (!isThumbnailable(m)) continue;
      if (
        entry.derivedFromAssets?.includes(m.fileId) ||
        m.derivedFromAssets?.includes(entry.fileId)
      ) {
        targets.push(m);
      }
    }
    if (targets.length === 0) {
      setAssetThumbUrls(new Map());
      return;
    }
    let cancelled = false;
    const next = new Map<string, string>();
    Promise.all(
      targets.map(async (a) => {
        const url = await resolveMediaThumbUrl(a);
        if (url) next.set(a.fileId, url);
      }),
    ).then(() => {
      if (!cancelled) setAssetThumbUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [entry, mediaIndex]);

  // グラフ描画
  useEffect(() => {
    if (!graphContainerRef.current) return;
    // 保存済みの配置を読み終えるまで組まない（読み込み後に並べ直して見えないように）
    if (!layoutReady) return;
    const elements = buildMediaGraph(entry, mediaIndex ?? null, getKnowledgeKind, assetThumbUrls);

    // 保存済みの座標を流し込む。1 つでも復元できたら fcose は流さず、
    // 新しく現れたノードだけ外周に仮置きする（手で整えた並びを崩さない）
    const { unplacedIds, placedCount } = applySavedPositions(elements, savedPositionsRef.current);
    const useSavedLayout = placedCount > 0;

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: graphContainerRef.current,
      elements,
      style: graphStyle,
      layout: { name: "preset" },
      ...GRAPH_INIT_OPTIONS,
      // 素材まわりは小さなグラフなので、引きすぎないよう下限を上げる
      minZoom: 0.3,
      maxZoom: 3,
    });

    if (useSavedLayout) {
      seedUnplacedNodes(cy, unplacedIds);
      cy.fit(undefined, 20);
    } else {
    const layout = cy.layout({
      name: "fcose",
      animate: true,
      animationDuration: 600,
      animationEasing: "ease-out-cubic" as any,
      quality: "default",
      randomize: true,
      nodeRepulsion: 5000,
      idealEdgeLength: 100,
      edgeElasticity: 0.45,
      gravity: 0.3,
      gravityRange: 3.0,
      nodeSeparation: 60,
      padding: 30,
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

    cy.on("mouseover", "node.clickable", (evt) => {
      evt.target.addClass("hover");
      if (graphContainerRef.current) graphContainerRef.current.style.cursor = "pointer";
    });
    cy.on("mouseout", "node.clickable", () => {
      cy.nodes().removeClass("hover");
      if (graphContainerRef.current) graphContainerRef.current.style.cursor = "default";
    });

    cy.on("tap", "node.note-node", (evt) => {
      (onOpenNoteSidePeek ?? onNavigateNote)(evt.target.id());
    });
    cy.on("tap", "node.asset-node", (evt) => {
      const nodeId = evt.target.id();
      const fileId = nodeId.replace(/^media-/, "");
      const next = mediaIndex?.media.find((m) => m.fileId === fileId);
      if (next) onSwitchAsset?.(next);
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
    entry,
    mediaIndex,
    getKnowledgeKind,
    onNavigateNote,
    onOpenNoteSidePeek,
    onSwitchAsset,
    assetThumbUrls,
    expanded,
    layoutReady,
    layoutResetSeq,
  ]);

  // 凡例 + 拡大トグル（拡大時 / 通常時で共通）
  const legendBar = (showLegend || enableExpand) ? (
    <div className="px-4 py-2 border-b border-border flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground shrink-0">
      {showLegend && (
        <>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: MEDIA_CENTER_COLOR, transform: "rotate(45deg)" }}
            />
            {t("asset.legendMedia")}
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: NOTE_NODE_COLOR }}
            />
            {t("asset.legendNote")}
          </span>
          {KNOWLEDGE_KIND_LEGEND_ORDER.map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5"
                style={{
                  backgroundColor: knowledgeKindColor(kind),
                  transform: "rotate(45deg)",
                }}
              />
              {t(`knowledge.kind.${kind}` as any)}
            </span>
          ))}
        </>
      )}
      <span className="ml-auto flex items-center gap-2">
        {showLegend && (
          <span className="text-[10px] text-muted-foreground/60">
            {t("asset.clickToNavigate")}
          </span>
        )}
        {/* 手で整えた並びがあるときだけ、自動配置に戻す入口を出す */}
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
        {enableExpand && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={expanded ? t("asset.graph.close") + " (Esc)" : t("asset.graph.expand")}
          >
            {expanded ? <X size={12} /> : <Maximize2 size={12} />}
          </button>
        )}
      </span>
    </div>
  ) : null;

  // 拡大時は portal で画面全体に重ねる（ノート NetworkGraphView と同じ pattern）
  if (expanded) {
    return createPortal(
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-6"
        style={{ background: "rgba(0, 0, 0, 0.45)" }}
        onClick={() => setExpanded(false)}
      >
        <div
          className="relative flex flex-col rounded-lg shadow-2xl overflow-hidden"
          style={{ background: GRAPH_BG_COLOR, width: "min(1400px, 95vw)", height: "92vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {legendBar}
          <div ref={graphContainerRef} className="flex-1" />
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="flex flex-col h-full">
      {legendBar}
      <div
        ref={graphContainerRef}
        className="flex-1"
        style={{ background: GRAPH_BG_COLOR }}
      />
    </div>
  );
}
