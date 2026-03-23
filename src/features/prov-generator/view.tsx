// ──────────────────────────────────────────────
// PROVグラフ可視化（Cytoscape.js + ELK レイアウト）
//
// design.md ラベル色パレット準拠:
//   Activity  = 楕円・落ち着いた青 (#5b8fb9)
//   Entity    = 丸四角・ブランドグリーン (#4B7A52)
//   Result    = 丸四角・テラコッタ (#c26356)
//   Parameter = ダイヤ・落ち着いたアンバー (#c08b3e)
// ──────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import cytoscape from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ProvDocument, ProvNode } from "./generator";

// ── design.md ラベル色パレット ──

const THEME = {
  // ノード色
  activity:  { bg: "#5b8fb9", border: "#4a7da6", text: "#ffffff" },
  entity:    { bg: "#4B7A52", border: "#3d6844", text: "#ffffff" },
  result:    { bg: "#c26356", border: "#a8513f", text: "#ffffff" },
  parameter: { bg: "#c08b3e", border: "#a67630", text: "#ffffff" },
  sample:    { bg: "#8b7ab5", border: "#7466a0", text: "#ffffff" },
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

// ── 試料ごとのグラフ分離 ──

type SampleSplit = { sampleId: string; doc: ProvDocument };

/** ProvDocument を試料ごとに分離する。共通ノードは各グラフに含める */
function splitDocBySample(doc: ProvDocument): SampleSplit[] {
  const sampleIds = [...new Set(
    doc["@graph"].filter((n) => n.sampleId).map((n) => n.sampleId!)
  )].sort();

  if (sampleIds.length === 0) return [];

  // 共通ノード（sampleId なし）
  const commonNodes = doc["@graph"].filter((n) => !n.sampleId);

  return sampleIds.map((sid) => {
    const sampleNodes = doc["@graph"].filter((n) => n.sampleId === sid);
    const graphNodes = [...commonNodes, ...sampleNodes];
    const nodeIdSet = new Set(graphNodes.map((n) => n["@id"]));

    // 両端が含まれるリレーションのみ抽出
    const filteredRelations = doc.relations.filter(
      (r) => nodeIdSet.has(r.from) && nodeIdSet.has(r.to)
    );

    return {
      sampleId: sid,
      doc: { ...doc, "@graph": graphNodes, relations: filteredRelations },
    };
  });
}

/**
 * ノードのサブタイプを判定（Entity を [使用したもの] と [結果] に分離）
 */
function getNodeSubtype(node: ProvNode): string {
  if (node["@type"] === "prov:Entity") {
    return node["@id"].startsWith("result_") ? "result" : "entity";
  }
  return node["@type"];
}

/**
 * PROVドキュメント → Cytoscape elements 変換
 */
function provToCytoscapeElements(doc: ProvDocument): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];

  // ノード
  for (const node of doc["@graph"]) {
    let label = node.label;
    if (node.sampleId) label += `\n[${node.sampleId}]`;
    if (node.params) {
      const paramStr = Object.entries(node.params).map(([k, v]) => `${k}=${v}`).join("\n");
      label += `\n${paramStr}`;
    }

    elements.push({
      data: {
        id: node["@id"],
        label,
        type: node["@type"],
        subtype: getNodeSubtype(node),
      },
    });
  }

  // エッジ（実験フロー方向: 原因→結果 に反転して表示）
  // PROV-DM は来歴方向（結果→原因）だが、可視化は順方向にする
  //   used:            PROV: Activity→Entity  → 表示: Entity→Activity（材料が手順に入る）
  //   wasGeneratedBy:  PROV: Entity→Activity  → 表示: Activity→Entity（手順が結果を出す）
  //   wasInformedBy:   PROV: Act2→Act1        → 表示: Act1→Act2（手順1の後に手順2）
  //   parameter:       PROV: Activity→Param   → 表示: Param→Activity（条件が手順に入る）
  const nodeIds = new Set(elements.map((e) => e.data.id));
  for (let i = 0; i < doc.relations.length; i++) {
    const rel = doc.relations[i];
    const relLabel = rel["@type"].replace("prov:", "").replace("matprov:", "");
    if (!nodeIds.has(rel.from) || !nodeIds.has(rel.to)) {
      console.warn(`[PROV] エッジ無視: ${rel.from} → ${rel.to}（ノード不在）`);
      continue;
    }

    // 全リレーションを反転（PROV来歴方向 → 実験フロー順方向）
    const source = rel.to;
    const target = rel.from;

    elements.push({
      data: {
        id: `edge-${i}`,
        source,
        target,
        label: relLabel,
      },
    });
  }

  return elements;
}

// ── ELK layered レイアウト ──

// ノードタイプ別の固定サイズ（ELK レイアウト計算用）
const NODE_SIZES: Record<string, { width: number; height: number }> = {
  "prov:Activity": { width: 150, height: 60 },
  "prov:Entity": { width: 150, height: 50 },
  "matprov:Parameter": { width: 130, height: 50 },
};
const DEFAULT_NODE_SIZE = { width: 140, height: 50 };

async function applyElkLayout(cy: cytoscape.Core) {
  const elk = new ELK();

  // Cytoscape → ELK グラフ変換（固定サイズを使用）
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

  // ELK 計算結果を Cytoscape にアニメーション付きで反映
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
  // スムーズなトランジション
  "transition-property": "background-color, border-color, opacity, width, height" as any,
  "transition-duration": 200,
  "transition-timing-function": "ease-in-out-sine" as any,
};

const cyStyles: cytoscape.StylesheetStyle[] = [
  // Activity ノード（楕円・落ち着いた青）
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
  // Entity ノード — [使用したもの]（丸四角・ブランドグリーン）
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
  // Entity ノード — [結果]（丸四角・テラコッタ）
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
  // Parameter ノード（ダイヤ・落ち着いたアンバー）
  {
    selector: 'node[subtype = "matprov:Parameter"]',
    style: {
      ...commonNodeStyle,
      "background-color": THEME.parameter.bg,
      "border-color": THEME.parameter.border,
      color: THEME.parameter.text,
      shape: "diamond",
    },
  },

  // ── ホバーエフェクト ──

  // ホバー中のノード: 少し明るく + 影（overlay で表現）
  {
    selector: "node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.08,
      "overlay-color": "#000",
    },
  },
  // ホバーノードに接続するエッジ: 太く
  {
    selector: "edge.hover-connected",
    style: {
      width: 3.5,
      "z-index": 10,
    },
  },
  // ホバーノードの隣接ノード: そのまま
  {
    selector: "node.hover-neighbor",
    style: {
      opacity: 1,
    },
  },
  // フェード対象（ホバー時に接続のないノード・エッジ）
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
      label: "data(label)",
      "font-size": "9px",
      "font-family": "Inter, system-ui, sans-serif",
      "text-rotation": "autorotate" as any,
      "text-margin-y": -10,
      "text-background-color": THEME.background,
      "text-background-opacity": 0.85,
      "text-background-padding": "2px" as any,
      color: "#4a5568",
      "line-color": THEME.edge.default,
      "target-arrow-color": THEME.edge.default,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.9,
      // 同一ノード間の複数エッジを分離して描画
      "curve-style": "unbundled-bezier" as any,
      "control-point-distances": 40,
      "control-point-weights": 0.5,
      width: 2,
      opacity: 1,
      // スムーズなトランジション
      "transition-property": "opacity, width, line-color, target-arrow-color" as any,
      "transition-duration": 200,
      "transition-timing-function": "ease-in-out-sine" as any,
    },
  },
  // wasInformedBy エッジ（落ち着いた青 — Activity 間フロー）
  {
    selector: 'edge[label = "wasInformedBy"]',
    style: { "line-color": THEME.edge.wasInformedBy, "target-arrow-color": THEME.edge.wasInformedBy },
  },
  // used エッジ（ブランドグリーン — Entity→Activity）
  {
    selector: 'edge[label = "used"]',
    style: { "line-color": THEME.edge.used, "target-arrow-color": THEME.edge.used },
  },
  // wasGeneratedBy エッジ（テラコッタ — Activity→Result）
  {
    selector: 'edge[label = "wasGeneratedBy"]',
    style: { "line-color": THEME.edge.wasGeneratedBy, "target-arrow-color": THEME.edge.wasGeneratedBy },
  },
  // parameter エッジ（アンバー・点線）
  {
    selector: 'edge[label = "parameter"]',
    style: { "line-color": THEME.edge.parameter, "target-arrow-color": THEME.edge.parameter, "line-style": "dashed" },
  },
];

// ── ホバーイベント設定 ──

function setupHoverEffects(cy: cytoscape.Core) {
  cy.on("mouseover", "node", (evt) => {
    const node = evt.target;
    const neighborhood = node.neighborhood();

    // 全要素をフェード
    cy.elements().addClass("faded");

    // ホバーノード + 隣接ノード・エッジをハイライト
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
  doc: ProvDocument;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = provToCytoscapeElements(doc);
    if (elements.length === 0) return;

    // 初期レイアウトは preset（位置なし = 原点）で即座に描画
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

    // ホバーエフェクト設定
    setupHoverEffects(cy);

    let cancelled = false;

    // 階層レイアウト: breadthfirst → ELK
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
 *
 * 試料ごとにタブで切り替え、階層レイアウトで表示する。
 * 試料が1つだけの場合はタブバーを非表示にする。
 */
export function ProvGraphPanel({ doc }: { doc: ProvDocument | null }) {
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // 試料分離（メモ化）
  const sampleSplits = useMemo(() => (doc ? splitDocBySample(doc) : []), [doc]);

  // アクティブ試料が無効になったら最初の試料にリセット
  useEffect(() => {
    if (sampleSplits.length > 0) {
      const ids = sampleSplits.map((s) => s.sampleId);
      if (!activeSample || !ids.includes(activeSample)) {
        setActiveSample(ids[0]);
      }
    } else {
      setActiveSample(null);
    }
  }, [sampleSplits, activeSample]);

  // Escape キーでモーダルを閉じる
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
          エディタにラベルを付けてから「PROV生成」を実行してください
        </div>
      </div>
    );
  }

  // 表示する ProvDocument を決定
  const activeDoc = activeSample
    ? sampleSplits.find((s) => s.sampleId === activeSample)?.doc ?? doc
    : doc;
  const showTabs = sampleSplits.length > 1;

  const sampleTabs = showTabs ? (
    <div style={tabBarStyle}>
      {sampleSplits.map(({ sampleId }) => (
        <button
          key={sampleId}
          onClick={() => setActiveSample(sampleId)}
          style={{
            ...tabStyle,
            borderBottom: activeSample === sampleId ? `2px solid ${THEME.primary}` : "2px solid transparent",
            color: activeSample === sampleId ? THEME.primary : THEME.mutedFg,
            fontWeight: activeSample === sampleId ? 600 : 400,
          }}
        >
          {sampleId}
        </button>
      ))}
    </div>
  ) : null;

  const legendBar = (
    <div style={legendBarStyle}>
      <LegendDot color={THEME.activity.bg} shape="circle" label="手順" />
      <LegendDot color={THEME.entity.bg} shape="square" label="使用" />
      <LegendDot color={THEME.result.bg} shape="square" label="結果" />
      <LegendDot color={THEME.parameter.bg} shape="diamond" label="属性" />

      <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#9ca3af" }}>
          {activeDoc["@graph"].length} ノード · {activeDoc.relations.length} リレーション
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={expandBtnStyle}
          title={expanded ? "閉じる" : "拡大表示"}
        >
          {expanded ? "✕" : "⤢"}
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div style={panelStyle}>
        {sampleTabs}
        {legendBar}
        <CytoscapeGraph doc={activeDoc} />
      </div>

      {/* 拡大モーダル */}
      {expanded && createPortal(
        <div style={modalOverlayStyle} onClick={() => setExpanded(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            {sampleTabs}
            {legendBar}
            <CytoscapeGraph doc={activeDoc} height={window.innerHeight - 120} />
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

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: `1px solid ${THEME.border}`,
  background: THEME.muted,
};

const tabStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  background: "none",
  border: "none",
  cursor: "pointer",
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
  height: "calc(100vh - 64px)",
  background: THEME.background,
  borderRadius: 12,
  border: `1px solid ${THEME.border}`,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

