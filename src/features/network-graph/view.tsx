// ノート間ネットワークグラフ（Obsidian 風）
// Cytoscape.js で2ホップの派生関係を可視化

import { useEffect, useRef, useCallback } from "react";
import cytoscape from "cytoscape";
import type { NoteGraphData } from "./graph-builder";

// ── スタイル定義 ──

const NODE_COLORS = {
  current: "#3B82F6", // 青（現在のノート）
  hop1: "#8B5CF6", // 紫（1ホップ）
  hop2: "#94A3B8", // グレー（2ホップ）
} as const;

function getNodeColor(hop: number, isCurrent: boolean): string {
  if (isCurrent) return NODE_COLORS.current;
  if (hop === 1) return NODE_COLORS.hop1;
  return NODE_COLORS.hop2;
}

function getNodeSize(isCurrent: boolean): number {
  return isCurrent ? 40 : 28;
}

const cytoscapeStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "100px",
      "font-size": "10px",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "background-color": "data(color)",
      width: "data(size)",
      height: "data(size)",
      "border-width": 2,
      "border-color": "data(borderColor)",
      color: "#64748B",
    },
  },
  {
    selector: "node:active",
    style: {
      "overlay-opacity": 0.1,
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#CBD5E1",
      "target-arrow-color": "#CBD5E1",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "bezier",
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
      const color = getNodeColor(node.hop, node.isCurrent);
      elements.push({
        data: {
          id: node.id,
          label: node.title,
          color,
          borderColor: node.isCurrent ? "#1D4ED8" : color,
          size: getNodeSize(node.isCurrent),
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
      layout: {
        name: "cose",
        animate: false,
        nodeRepulsion: 8000,
        idealEdgeLength: 120,
        gravity: 0.3,
        padding: 40,
      } as cytoscape.LayoutOptions,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.3,
      maxZoom: 3,
    });

    // ノードクリックでナビゲーション
    cy.on("tap", "node", (evt) => {
      const nodeId = evt.target.id();
      const isCurrent = evt.target.data("isCurrent");
      if (!isCurrent) {
        handleNavigate(nodeId);
      }
    });

    // ホバー時のカーソル変更
    cy.on("mouseover", "node", (evt) => {
      const isCurrent = evt.target.data("isCurrent");
      if (!isCurrent) {
        containerRef.current!.style.cursor = "pointer";
      }
    });
    cy.on("mouseout", "node", () => {
      containerRef.current!.style.cursor = "default";
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
    <div className="flex flex-col h-full">
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
      </div>
      {/* グラフ */}
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
