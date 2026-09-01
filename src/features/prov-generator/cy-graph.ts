// Cytoscape のスタイル定義と ELK レイアウト。
// prov-generator/view.tsx と network-graph/activity-graph.tsx の双方が共有する。
// React コンポーネント（ActivityGraphEditor）に依存しないことで、
// network-graph ↔ prov-generator の循環依存を避ける。

import cytoscape from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";

// ── design.md ラベル色パレット ──
export const THEME = {
  // ノード色
  activity:  { bg: "#5b8fb9", border: "#4a7da6", text: "#ffffff" },
  entity:    { bg: "#4B7A52", border: "#3d6844", text: "#ffffff" },  // 材料
  tool:      { bg: "#c08b3e", border: "#a67630", text: "#ffffff" },  // ツール（菱形）
  result:    { bg: "#c26356", border: "#a8513f", text: "#ffffff" },
  parameter: { bg: "#8fa394", border: "#7a9082", text: "#ffffff" },  // 属性（グレー四角）
  // エッジ色
  edge: {
    wasInformedBy:  "#5b8fb9",
    used:           "#4B7A52",
    wasGeneratedBy: "#c26356",
    wasDerivedFrom: "#8b7ab5",  // LINK_TYPE_META.derived_from と同系色
    parameter:      "#c08b3e",
    default:        "#6b7f6e",
  },
  // UI 色
  background: "#fafdf7",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  primary: "#4B7A52",
} as const;

// ── ELK layered レイアウト / Cytoscape スタイル ──
const NODE_SIZES: Record<string, { width: number; height: number }> = {
  "prov:Activity": { width: 150, height: 60 },
  "prov:Entity": { width: 150, height: 50 },
};
const DEFAULT_NODE_SIZE = { width: 140, height: 50 };

export async function applyElkLayout(cy: cytoscape.Core) {
  const elk = new ELK();

  const elkNodes = cy.nodes().map((n) => {
    const size = NODE_SIZES[n.data("type")] ?? DEFAULT_NODE_SIZE;
    return { id: n.id(), width: size.width, height: size.height };
  });
  const elkEdges = cy.edges().map((e) => ({
    id: e.id(),
    sources: [e.source().id()],
    targets: [e.target().id()],
  }));

  const elkGraph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.layered.spacing.edgeNodeBetweenLayers": "30",
    },
    children: elkNodes,
    edges: elkEdges,
  });

  // 非同期レイアウト中に cy が破棄された場合（アンマウント / StrictMode 二重マウント）は中断
  if (cy.destroyed()) return;

  cy.batch(() => {
    for (const elkNode of elkGraph.children ?? []) {
      const node = cy.getElementById(elkNode.id);
      if (node.length > 0 && elkNode.x != null && elkNode.y != null) {
        node.position({
          x: elkNode.x + (elkNode.width ?? 0) / 2,
          y: elkNode.y + (elkNode.height ?? 0) / 2,
        });
      }
    }
  });

  cy.fit(undefined, 20);
}

// ── Cytoscape スタイル定義（design.md 準拠） ──

const commonNodeStyle = {
  label: "data(label)",
  "text-wrap": "wrap" as any,
  // auto(既定)は折返し行の字間が崩れて描画される(cytoscape の複数行描画の不具合回避)
  "text-justification": "center" as any,
  "text-max-width": "120px",
  "font-size": "11px",
  "font-family": "Atkinson Hyperlegible Next, BIZ UDPGothic, Inter, system-ui, sans-serif",
  "text-valign": "center" as const,
  "text-halign": "center" as const,
  "border-width": 2,
  width: "label",
  height: "label",
  padding: "14px",
  "transition-property": "background-color, border-color, opacity, width, height" as any,
  "transition-duration": 200,
  "transition-timing-function": "ease-in-out-sine" as any,
};

export const cyStyles: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node[subtype = "prov:Activity"]',
    style: {
      ...commonNodeStyle,
      "background-color": THEME.activity.bg,
      "border-color": THEME.activity.border,
      color: THEME.activity.text,
      shape: "ellipse",
    },
  },
  {
    selector: 'node[subtype = "entity"]',
    style: {
      ...commonNodeStyle,
      "background-color": THEME.entity.bg,
      "border-color": THEME.entity.border,
      color: THEME.entity.text,
      shape: "round-rectangle",
    },
  },
  {
    selector: 'node[subtype = "tool"]',
    style: {
      ...commonNodeStyle,
      "background-color": THEME.tool.bg,
      "border-color": THEME.tool.border,
      color: THEME.tool.text,
      shape: "diamond",
    },
  },
  {
    selector: 'node[subtype = "result"]',
    style: {
      ...commonNodeStyle,
      "background-color": THEME.result.bg,
      "border-color": THEME.result.border,
      color: THEME.result.text,
      shape: "round-rectangle",
    },
  },
  {
    selector: 'node[subtype = "parameter"]',
    style: {
      ...commonNodeStyle,
      "background-color": THEME.parameter.bg,
      "border-color": THEME.parameter.border,
      color: THEME.parameter.text,
      shape: "round-rectangle",
    },
  },
  // ── メディア Entity / 属性（サムネイル付き — 画像・動画のみ） ──
  // Cytoscape は background-image を描画時（cytoscape() 直後の rAF）に取得する。
  // ここが塗るのは data.thumbnailUrl の値そのもので、このスタイルは中身を検証しない。
  // remote URL が入っていれば描画の時点で第三者へ GET が飛ぶので、「何を入れてよいか」の
  // 判定は elements を組み立てる側で完結させる決まりにしてある。
  // 現状 thumbnailUrl を書くのは prov-generator/view.tsx（provToCytoscapeElements と、
  // その後の非同期解決ループ）だけで、載るのはローカル参照 —— アプリ内スキーム・
  // blob: ・data:image/ ・media-text のプレビュー参照 —— に限られる。
  // http(s) はサムネイルを付けずに落とす（背景画像の無い素のノードになる）。
  {
    selector: "node[thumbnailUrl]",
    style: {
      "background-image": "data(thumbnailUrl)" as any,
      "background-image-crossorigin": "anonymous" as any,
      "background-fit": "cover" as any,
      "background-image-opacity": 0.85,
      "background-opacity": 0.1,
      width: 50,
      height: 50,
      "text-valign": "bottom" as const,
      "text-margin-y": 4,
      "padding": "8px",
    },
  },
  // ── ホバーエフェクト ──
  {
    selector: "node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.08,
      "overlay-color": "#000",
    },
  },
  {
    selector: "edge.hover-connected",
    style: {
      width: 3.5,
      "z-index": 10,
    },
  },
  {
    selector: "node.hover-neighbor",
    style: {
      opacity: 1,
    },
  },
  {
    selector: "node.faded",
    style: {
      opacity: 0.15,
    },
  },
  {
    selector: "edge.faded",
    style: {
      opacity: 0.08,
    },
  },
  // ── エッジ（共通） ──
  {
    selector: "edge",
    style: {
      // エッジラベルは非表示（ユーザーに PROV 用語を意識させない）
      "line-color": THEME.edge.default,
      "target-arrow-color": THEME.edge.default,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.9,
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 40,
      "control-point-weights": 0.5,
      width: 2,
      opacity: 1,
      "transition-property": "opacity, width, line-color, target-arrow-color" as any,
      "transition-duration": 200,
      "transition-timing-function": "ease-in-out-sine" as any,
    },
  },
  {
    selector: 'edge[label = "wasInformedBy"]',
    style: { "line-color": THEME.edge.wasInformedBy, "target-arrow-color": THEME.edge.wasInformedBy },
  },
  {
    selector: 'edge[label = "used"]',
    style: { "line-color": THEME.edge.used, "target-arrow-color": THEME.edge.used },
  },
  {
    selector: 'edge[label = "wasGeneratedBy"]',
    style: { "line-color": THEME.edge.wasGeneratedBy, "target-arrow-color": THEME.edge.wasGeneratedBy },
  },
  {
    selector: 'edge[label = "wasDerivedFrom"]',
    style: { "line-color": THEME.edge.wasDerivedFrom, "target-arrow-color": THEME.edge.wasDerivedFrom },
  },
  {
    selector: 'edge[label = "parameter"]',
    style: { "line-color": THEME.edge.parameter, "target-arrow-color": THEME.edge.parameter, "line-style": "dashed" },
  },
  // hasAttribute エッジ（アンバー・点線 — 属性プロパティ）
  {
    selector: 'edge[label = "hasAttribute"]',
    style: { "line-color": THEME.edge.parameter, "target-arrow-color": THEME.edge.parameter, "line-style": "dashed" },
  },
];
