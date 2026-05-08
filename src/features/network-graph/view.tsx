// ノート間ネットワークグラフ（Obsidian 風）
// Cytoscape.js + fcose で派生関係をヌルヌル可視化
// design.md テーマカラー準拠

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
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
  // ホバー中のノード（フルラベルに切り替え）
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
  const [expanded, setExpanded] = useState(false);

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
      const color = getNodeColor(node.hop, node.isCurrent, node.isWiki);
      const baseTitle = node.isWiki ? `🤖 ${node.title}` : node.title;
      elements.push({
        data: {
          id: node.id,
          isWiki: node.isWiki,
          label: truncate(baseTitle, 18),
          fullLabel: baseTitle,
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
      // ラベル衝突を抑えるため、ホバー時にフルラベルを表示する設定
      // （ノード自体の label は data.label = 省略形）
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 4,
    });

    // fcose レイアウト実行（要素描画後にアニメーション開始）
    // ラベル重なり対策 + ホップ距離の可視化:
    //   - ノード反発と理想エッジ長を大きめにとって全体間隔を確保
    //   - idealEdgeLength を hop 差に応じて変える（中心→hop1 は短い、hop2 へは長い）
    //     ことで「ホップ数が近いほど中心に近い」配置になる。
    //   - hop 数が多いノード自体に少し負の gravity をかけて外側へ押し出す
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
      const isWiki = evt.target.data("isWiki");
      if (!isCurrent) {
        handleNavigate(isWiki ? `wiki:${nodeId}` : nodeId);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, handleNavigate, expanded]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        派生関係がありません
      </div>
    );
  }

  const legendBar = (
    <div className="px-3 py-2 border-b border-border flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS.current }} />
        現在
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS.hop1 }} />
        1ホップ
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS.hop2 }} />
        2ホップ
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rotate-45" style={{ backgroundColor: NODE_COLORS.wiki, width: 8, height: 8 }} />
        Wiki
      </span>
      <span className="ml-auto flex items-center gap-1">
        <span>{data.nodes.length} ノード / {data.edges.length} エッジ</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={expanded ? "閉じる (Esc)" : "全画面表示"}
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
          style={{ background: BG_COLOR, width: "min(1400px, 95vw)", height: "92vh" }}
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
    <div className="flex flex-col h-full" style={{ background: BG_COLOR }}>
      {legendBar}
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
