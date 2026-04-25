// ノート間ネットワークグラフ（Obsidian 風）
// Cytoscape.js + fcose で派生関係をヌルヌル可視化
// design.md テーマカラー準拠

import { useEffect, useRef, useCallback } from "react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import type { NoteGraphData } from "./graph-builder";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

// ── design.md テーマカラー準拠 ──

const NODE_COLORS = {
  current: "#4B7A52", // ブランドグリーン（現在のノート）
  hop1: "#5b8fb9",    // 落ち着いた青（1ホップ）
  hop2: "#b8c9be",    // 淡いグリーングレー（2ホップ）
  wiki: "#9b6dcc",    // パープル（Wiki ドキュメント）
} as const;

const EDGE_COLOR = "#b8d4bb"; // 淡いグリーン
const BG_COLOR = "#fafdf7";   // テーマ背景

function getNodeColor(hop: number, isCurrent: boolean, isWiki?: boolean): string {
  if (isCurrent) return NODE_COLORS.current;
  if (isWiki) return NODE_COLORS.wiki;
  if (hop === 1) return NODE_COLORS.hop1;
  return NODE_COLORS.hop2;
}

function getBorderColor(hop: number, isCurrent: boolean, isWiki?: boolean): string {
  if (isCurrent) return "#3d6844";
  if (isWiki) return "#7b4fb0";
  if (hop === 1) return "#4a7da6";
  return "#9cb5a4";
}

function getNodeSize(isCurrent: boolean): number {
  return isCurrent ? 40 : 28;
}

function getNodeShape(isCurrent: boolean, isWiki?: boolean): string {
  if (isCurrent) return "ellipse";
  return isWiki ? "diamond" : "ellipse";
}

// ── Cytoscape スタイル ──

const cytoscapeStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "100px",
      "font-size": "10px",
      "font-family": "Atkinson Hyperlegible Next, BIZ UDPGothic, Inter, system-ui, sans-serif",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "background-color": "data(color)",
      shape: "data(shape)" as any,
      width: "data(size)",
      height: "data(size)",
      "border-width": 2,
      "border-color": "data(borderColor)",
      color: "#6b7f6e",
      // スムーズなトランジション
      "transition-property": "background-color, border-color, opacity, width, height" as any,
      "transition-duration": 200,
      "transition-timing-function": "ease-in-out-sine" as any,
    },
  },
  {
    selector: "node:active",
    style: {
      "overlay-opacity": 0.08,
    },
  },
  // ホバー中のノード
  {
    selector: "node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.06,
      "overlay-color": "#000",
    },
  },
  // ホバーノードの隣接ノード
  {
    selector: "node.hover-neighbor",
    style: {
      opacity: 1,
    },
  },
  // フェード対象
  {
    selector: "node.faded",
    style: {
      opacity: 0.15,
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": EDGE_COLOR,
      "target-arrow-color": EDGE_COLOR,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 30,
      "control-point-weights": 0.5,
      opacity: 1,
      // スムーズなトランジション
      "transition-property": "opacity, width, line-color" as any,
      "transition-duration": 200,
      "transition-timing-function": "ease-in-out-sine" as any,
    },
  },
  // ホバーノードに接続するエッジ
  {
    selector: "edge.hover-connected",
    style: {
      width: 2.5,
      "line-color": "#4B7A52",
      "target-arrow-color": "#4B7A52",
      "z-index": 10,
    },
  },
  {
    selector: "edge.faded",
    style: {
      opacity: 0.08,
    },
  },
];

// ── コンポーネント ──

export function NetworkGraphPanel({
  data,
  onNavigate,
}: {
  data: NoteGraphData;
  onNavigate: (noteId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const handleNavigate = useCallback(
    (noteId: string) => onNavigate(noteId),
    [onNavigate]
  );

  useEffect(() => {
    if (!containerRef.current) return;

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

    for (const node of data.nodes) {
      const color = getNodeColor(node.hop, node.isCurrent, node.isWiki);
      elements.push({
        data: {
          id: node.id,
          label: node.isWiki ? `🤖 ${node.title}` : node.title,
          color,
          borderColor: getBorderColor(node.hop, node.isCurrent, node.isWiki),
          size: getNodeSize(node.isCurrent),
          shape: getNodeShape(node.isCurrent, node.isWiki),
          hop: node.hop,
          isCurrent: node.isCurrent,
        },
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

    // 既存インスタンスがあれば破棄
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cytoscapeStyle,
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 4,
    });

    // fcose レイアウト実行（要素描画後にアニメーション開始）
    const layout = cy.layout({
      name: "fcose",
      animate: true,
      animationDuration: 800,
      animationEasing: "ease-out-cubic" as any,
      quality: "default",
      randomize: true,
      nodeRepulsion: 6000,
      idealEdgeLength: 120,
      edgeElasticity: 0.45,
      gravity: 0.25,
      gravityRange: 3.8,
      nodeSeparation: 80,
      padding: 40,
    } as any);
    layout.on("layoutstop", () => {
      cy.fit(undefined, 20);
    });
    layout.run();

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
      const nodeId = evt.target.id();
      const isCurrent = evt.target.data("isCurrent");
      if (!isCurrent) {
        handleNavigate(nodeId);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, handleNavigate]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        派生関係がありません
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: BG_COLOR }}>
      {/* 凡例 */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: NODE_COLORS.current }}
          />
          現在
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: NODE_COLORS.hop1 }}
          />
          1ホップ
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: NODE_COLORS.hop2 }}
          />
          2ホップ
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rotate-45"
            style={{ backgroundColor: NODE_COLORS.wiki, width: 8, height: 8 }}
          />
          Wiki
        </span>
      </div>
      {/* グラフ */}
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
