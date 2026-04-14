// ──────────────────────────────────────────────
// PROVグラフ可視化（Cytoscape.js + ELK レイアウト）
//
// Phase 3: ProvJsonLd 埋め込み形式からノード・エッジを抽出
//
// design.md ラベル色パレット準拠:
//   Activity  = 楕円・落ち着いた青 (#5b8fb9)
//   Entity    = 丸四角・ブランドグリーン (#4B7A52)
//   Result    = 丸四角・テラコッタ (#c26356)
//   Parameter = ダイヤ・落ち着いたアンバー (#c08b3e)
// ──────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import cytoscape from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ProvJsonLd, ProvJsonLdNode, ProvAttribute } from "./generator";
import { extractRelations, type FlatRelation } from "./generator";
import { t, getDisplayLabelName } from "../../i18n";

// 後方互換
type ProvDocument = ProvJsonLd;

// ── design.md ラベル色パレット ──

const THEME = {
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

/**
 * ノードのサブタイプを判定（Entity を材料・ツール・結果に分離）
 */
function getNodeSubtype(node: ProvJsonLdNode): string {
  if (node["@type"] === "prov:Entity") {
    if (node["@id"].startsWith("param_")) return "parameter";
    if (node["@id"].startsWith("result_")) return "result";
    if (node["graphium:entityType"] === "tool") return "tool";
    return "entity"; // material またはサブタイプなし
  }
  return node["@type"];
}

/**
 * ProvJsonLd → Cytoscape elements 変換
 * Phase 3: 埋め込み関係からエッジを抽出
 */
export function provToCytoscapeElements(doc: ProvJsonLd): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];
  const nodeIdSet = new Set(doc["@graph"].map((n) => n["@id"]));

  // 予約済み graphium: キー（ビュー表示対象外）
  const RESERVED_KEYS = new Set([
    "graphium:blockId", "graphium:attributes", "graphium:warnings", "graphium:entityType",
  ]);

  let attrNodeIdx = 0;
  let edgeIdx = 0;

  // ノード
  for (const node of doc["@graph"]) {
    const label = node["rdfs:label"];

    elements.push({
      data: {
        id: node["@id"],
        label,
        type: node["@type"],
        subtype: getNodeSubtype(node),
      },
    });

    // ── graphium: key-value プロパティ → ダイヤモンドノード ──
    for (const key of Object.keys(node)) {
      if (key.startsWith("graphium:") &&
          !RESERVED_KEYS.has(key) &&
          typeof node[key as `graphium:${string}`] === "string") {
        const shortKey = key.replace("graphium:", "");
        const value = node[key as `graphium:${string}`] as string;
        const attrId = `attr_${node["@id"]}_${attrNodeIdx++}`;

        elements.push({
          data: {
            id: attrId,
            label: `${shortKey}=${value}`,
            type: "graphium:Attribute",
            subtype: "parameter",
          },
        });
        // エッジ: 親ノード → 属性ノード（フロー順方向）
        elements.push({
          data: {
            id: `edge-${edgeIdx++}`,
            source: node["@id"],
            target: attrId,
            label: "hasAttribute",
          },
        });
      }
    }

    // ── graphium:attributes 配列 → ダイヤモンドノード ──
    if (node["graphium:attributes"]) {
      for (const attr of node["graphium:attributes"] as ProvAttribute[]) {
        const attrId = `attr_${node["@id"]}_${attrNodeIdx++}`;

        elements.push({
          data: {
            id: attrId,
            label: attr["rdfs:label"],
            type: "graphium:Attribute",
            subtype: "parameter",
          },
        });
        elements.push({
          data: {
            id: `edge-${edgeIdx++}`,
            source: node["@id"],
            target: attrId,
            label: "hasAttribute",
          },
        });
      }
    }
  }

  // エッジ: 埋め込み PROV 関係から抽出
  const relations = extractRelations(doc);

  for (const rel of relations) {
    if (!nodeIdSet.has(rel.from) || !nodeIdSet.has(rel.to)) {
      continue;
    }

    const relLabel = rel["@type"].replace("prov:", "").replace("graphium:", "");

    // 全リレーションを反転（PROV来歴方向 → 実験フロー順方向）
    const source = rel.to;
    const target = rel.from;

    elements.push({
      data: {
        id: `edge-${edgeIdx++}`,
        source,
        target,
        label: relLabel,
      },
    });
  }

  return elements;
}

// ── ELK layered レイアウト ──

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
  "text-max-width": "120px",
  "font-size": "11px",
  "font-family": "Inter, system-ui, sans-serif",
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
    selector: 'edge[label = "parameter"]',
    style: { "line-color": THEME.edge.parameter, "target-arrow-color": THEME.edge.parameter, "line-style": "dashed" },
  },
  // hasAttribute エッジ（アンバー・点線 — 属性プロパティ）
  {
    selector: 'edge[label = "hasAttribute"]',
    style: { "line-color": THEME.edge.parameter, "target-arrow-color": THEME.edge.parameter, "line-style": "dashed" },
  },
];

// ── ホバーイベント設定 ──

function setupHoverEffects(cy: cytoscape.Core) {
  cy.on("mouseover", "node", (evt) => {
    const node = evt.target;
    const neighborhood = node.neighborhood();

    cy.elements().addClass("faded");

    node.removeClass("faded").addClass("hover");
    neighborhood.removeClass("faded");
    neighborhood.nodes().addClass("hover-neighbor");
    neighborhood.edges().addClass("hover-connected");
  });

  cy.on("mouseout", "node", () => {
    cy.elements().removeClass("faded hover hover-neighbor hover-connected");
  });
}

// ── グラフコンポーネント ──

function CytoscapeGraph({
  doc,
  height = 450,
}: {
  doc: ProvJsonLd;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = provToCytoscapeElements(doc);
    if (elements.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cyStyles,
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 4,
    });

    cyRef.current = cy;

    setupHoverEffects(cy);

    let cancelled = false;

    cy.layout({ name: "breadthfirst", directed: true, spacingFactor: 1.5 } as any).run();
    cy.fit(undefined, 20);
    applyElkLayout(cy).then(() => {
      if (!cancelled) cy.fit(undefined, 20);
    }).catch((err) => {
      console.warn("[PROV] ELK レイアウト失敗（breadthfirst を維持）:", err);
    });

    return () => {
      cancelled = true;
      cy.destroy();
      cyRef.current = null;
    };
  }, [doc]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        background: THEME.background,
      }}
    />
  );
}

/**
 * PROVドキュメントの可視化パネル
 */
export function ProvGraphPanel({ doc }: { doc: ProvJsonLd | null }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded]);

  if (!doc) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
          {t("provPanel.noLabelsMessage")}
        </div>
      </div>
    );
  }

  // 統計情報の計算
  const relations = extractRelations(doc);
  const attrCount = doc["@graph"].reduce((sum, n) => {
    let count = 0;
    if (n["graphium:attributes"]) count += (n["graphium:attributes"] as ProvAttribute[]).length;
    for (const key of Object.keys(n)) {
      if (key.startsWith("graphium:") && !["graphium:blockId", "graphium:attributes", "graphium:warnings"].includes(key) && typeof n[key as `graphium:${string}`] === "string") count++;
    }
    return sum + count;
  }, 0);

  const legendBar = (
    <div style={legendBarStyle}>
      <LegendDot color={THEME.activity.bg} shape="circle" label={getDisplayLabelName("[手順]")} />
      <LegendDot color={THEME.entity.bg} shape="square" label={getDisplayLabelName("[材料]")} />
      <LegendDot color={THEME.tool.bg} shape="diamond" label={getDisplayLabelName("[ツール]")} />
      <LegendDot color={THEME.result.bg} shape="square" label={getDisplayLabelName("[結果]")} />
      <LegendDot color={THEME.parameter.bg} shape="square" label={getDisplayLabelName("[属性]")} />

      <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#9ca3af" }}>
          {t("provPanel.graphStats", { nodes: String(doc["@graph"].length + attrCount), relations: String(relations.length + attrCount) })}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={expandBtnStyle}
          title={expanded ? t("common.close") : t("provPanel.expandView")}
        >
          {expanded ? "✕" : "⤢"}
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div style={panelStyle}>
        {legendBar}
        <CytoscapeGraph doc={doc} />
      </div>

      {/* 拡大モーダル */}
      {expanded && createPortal(
        <div style={modalOverlayStyle} onClick={() => setExpanded(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            {legendBar}
            <CytoscapeGraph doc={doc} height={window.innerHeight - 120} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── 凡例ドット ──

function LegendDot({ color, shape, label }: { color: string; shape: "circle" | "square" | "diamond"; label: string }) {
  const dotStyle: React.CSSProperties = {
    display: "inline-block",
    width: 10,
    height: 10,
    marginRight: 3,
    verticalAlign: "middle",
    background: color,
    ...(shape === "circle" ? { borderRadius: "50%" } : {}),
    ...(shape === "square" ? { borderRadius: 2 } : {}),
    ...(shape === "diamond" ? { borderRadius: 1, transform: "rotate(45deg) scale(0.8)" } : {}),
  };

  return (
    <span>
      <span style={dotStyle} />
      {label}
    </span>
  );
}

// ── スタイル定数 ──

const panelStyle: React.CSSProperties = {
  border: `1px solid ${THEME.border}`,
  borderRadius: 8,
  background: THEME.background,
  overflow: "hidden",
};

const legendBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  padding: "6px 12px",
  borderBottom: `1px solid ${THEME.muted}`,
  fontSize: 10,
  color: THEME.mutedFg,
  alignItems: "center",
};

const expandBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 14,
  lineHeight: 1,
  background: THEME.muted,
  border: `1px solid ${THEME.border}`,
  borderRadius: 4,
  cursor: "pointer",
  color: THEME.mutedFg,
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const modalContentStyle: React.CSSProperties = {
  width: "calc(100vw - 64px)",
  height: "calc(100dvh - 64px)",
  background: THEME.background,
  borderRadius: 12,
  border: `1px solid ${THEME.border}`,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};
