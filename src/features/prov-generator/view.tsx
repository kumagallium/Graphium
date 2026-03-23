// ──────────────────────────────────────────────
// PROVグラフ可視化（Cytoscape.js + ELK レイアウト）
//
// prov-jsonld-viz のデザインパターンに準拠:
//   Activity = 楕円・緑
//   Entity   = 丸四角・青
//   Parameter = ダイヤ・オレンジ
// ──────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ProvDocument, ProvNode, ProvRelation } from "./generator";
import type { ProvWarning } from "./errors";

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

/**
 * Cytoscape グラフコンポーネント
 */
/**
 * ELK layered レイアウトを計算し、Cytoscape ノードに位置を適用する
 */
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

  // ELK 計算結果を Cytoscape に反映
  for (const elkNode of elkGraph.children ?? []) {
    const node = cy.getElementById(elkNode.id);
    if (node.length > 0 && elkNode.x != null && elkNode.y != null) {
      node.position({
        x: elkNode.x + (elkNode.width ?? 0) / 2,
        y: elkNode.y + (elkNode.height ?? 0) / 2,
      });
    }
  }

  cy.fit(undefined, 20);
}

// Cytoscape スタイル定義
const cyStyles: cytoscape.StylesheetStyle[] = [
  // Activity ノード（楕円・緑）
  {
    selector: 'node[type = "prov:Activity"]',
    style: {
      label: "data(label)",
      "text-wrap": "wrap" as any,
      "text-max-width": "120px",
      "font-size": "11px",
      "text-valign": "center",
      "text-halign": "center",
      "background-color": "#91BF6D",
      "border-color": "#388E3C",
      "border-width": 2,
      shape: "ellipse",
      width: "label",
      height: "label",
      padding: "14px",
      color: "#1a1a1a",
    },
  },
  // Entity ノード（丸四角・青）
  {
    selector: 'node[type = "prov:Entity"]',
    style: {
      label: "data(label)",
      "text-wrap": "wrap" as any,
      "text-max-width": "120px",
      "font-size": "11px",
      "text-valign": "center",
      "text-halign": "center",
      "background-color": "#8ECAE6",
      "border-color": "#1976D2",
      "border-width": 2,
      shape: "round-rectangle",
      width: "label",
      height: "label",
      padding: "14px",
      color: "#1a1a1a",
    },
  },
  // Parameter ノード（ダイヤ・オレンジ）
  {
    selector: 'node[type = "matprov:Parameter"]',
    style: {
      label: "data(label)",
      "text-wrap": "wrap" as any,
      "text-max-width": "120px",
      "font-size": "11px",
      "text-valign": "center",
      "text-halign": "center",
      "background-color": "#F4A361",
      "border-color": "#FFA000",
      "border-width": 2,
      shape: "diamond",
      width: "label",
      height: "label",
      padding: "14px",
      color: "#1a1a1a",
    },
  },
  // エッジ（共通）
  {
    selector: "edge",
    style: {
      label: "data(label)",
      "font-size": "9px",
      "text-rotation": "autorotate" as any,
      "text-margin-y": -10,
      "text-background-color": "#fff",
      "text-background-opacity": 0.8,
      "text-background-padding": "2px" as any,
      color: "#333",
      "line-color": "#666",
      "target-arrow-color": "#666",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      width: 2,
    },
  },
  // wasInformedBy エッジ（緑）
  {
    selector: 'edge[label = "wasInformedBy"]',
    style: { "line-color": "#388E3C", "target-arrow-color": "#388E3C" },
  },
  // used エッジ（青）
  {
    selector: 'edge[label = "used"]',
    style: { "line-color": "#1976D2", "target-arrow-color": "#1976D2" },
  },
  // wasGeneratedBy エッジ（赤）
  {
    selector: 'edge[label = "wasGeneratedBy"]',
    style: { "line-color": "#D32F2F", "target-arrow-color": "#D32F2F" },
  },
  // parameter エッジ（オレンジ・点線）
  {
    selector: 'edge[label = "parameter"]',
    style: { "line-color": "#FFA000", "target-arrow-color": "#FFA000", "line-style": "dashed" },
  },
];

function CytoscapeGraph({ doc, height = 450 }: { doc: ProvDocument; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = provToCytoscapeElements(doc);
    if (elements.length === 0) return;

    // breadthfirst で初期表示（即座に見える）
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cyStyles,
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.5 } as any,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;
    cy.fit(undefined, 20);

    // ELK layered で再レイアウト（非同期、完了後に上書き）
    let cancelled = false;
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
        background: "#fafbfc",
      }}
    />
  );
}

/**
 * PROVドキュメントの可視化パネル
 */
export function ProvGraphPanel({ doc }: { doc: ProvDocument | null }) {
  const [tab, setTab] = useState<"graph" | "json" | "warnings">("graph");
  const [viewMode, setViewMode] = useState<"all" | "split">("all");

  // 試料分離（メモ化）
  const sampleSplits = useMemo(() => (doc ? splitDocBySample(doc) : []), [doc]);
  const hasSamples = sampleSplits.length > 0;

  if (!doc) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
          エディタにラベルを付けてから「PROV生成」を実行してください
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* タブ */}
      <div style={tabBarStyle}>
        {(["graph", "json", "warnings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...tabStyle,
              borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              color: tab === t ? "#3b82f6" : "#6b7280",
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === "graph" ? "グラフ" : t === "json" ? "JSON-LD" : `警告 (${doc.warnings.length})`}
          </button>
        ))}
      </div>

      {/* 凡例 + 表示切替 */}
      {tab === "graph" && (
        <div style={{ display: "flex", gap: 12, padding: "6px 12px", borderBottom: "1px solid #f3f4f6", fontSize: 10, color: "#6b7280", alignItems: "center" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#91BF6D", marginRight: 3, verticalAlign: "middle" }} />Activity</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#8ECAE6", marginRight: 3, verticalAlign: "middle" }} />Entity</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, transform: "rotate(45deg)", background: "#F4A361", marginRight: 3, verticalAlign: "middle" }} />Parameter</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ color: "#9ca3af", marginRight: 4 }}>
              {doc["@graph"].length} ノード · {doc.relations.length} リレーション
            </span>
            {hasSamples && (
              <>
                <button
                  onClick={() => setViewMode("all")}
                  style={{
                    ...toggleBtnStyle,
                    background: viewMode === "all" ? "#3b82f6" : "#f3f4f6",
                    color: viewMode === "all" ? "#fff" : "#6b7280",
                  }}
                >
                  全体
                </button>
                <button
                  onClick={() => setViewMode("split")}
                  style={{
                    ...toggleBtnStyle,
                    background: viewMode === "split" ? "#3b82f6" : "#f3f4f6",
                    color: viewMode === "split" ? "#fff" : "#6b7280",
                  }}
                >
                  試料別
                </button>
              </>
            )}
          </span>
        </div>
      )}

      {/* コンテンツ */}
      {tab === "graph" && viewMode === "all" && <CytoscapeGraph doc={doc} />}
      {tab === "graph" && viewMode === "split" && (
        <div style={{ overflow: "auto", maxHeight: 900 }}>
          {sampleSplits.map(({ sampleId, doc: splitDoc }) => (
            <div key={sampleId}>
              <div style={sampleHeaderStyle}>
                <span style={sampleDotStyle} />
                {sampleId}
                <span style={{ marginLeft: 8, color: "#9ca3af", fontWeight: 400 }}>
                  {splitDoc["@graph"].length} ノード
                </span>
              </div>
              <CytoscapeGraph doc={splitDoc} height={320} />
            </div>
          ))}
        </div>
      )}
      {tab === "json" && <JsonView doc={doc} />}
      {tab === "warnings" && <WarningsView warnings={doc.warnings} />}
    </div>
  );
}

function JsonView({ doc }: { doc: ProvDocument }) {
  return (
    <pre style={{
      padding: 12, fontSize: 10, overflow: "auto",
      maxHeight: 400, background: "#f9fafb", margin: 0,
      fontFamily: "monospace", lineHeight: 1.5,
    }}>
      {JSON.stringify(doc, null, 2)}
    </pre>
  );
}

function WarningsView({ warnings }: { warnings: ProvWarning[] }) {
  if (warnings.length === 0) {
    return <div style={emptyStyle}>警告なし</div>;
  }
  return (
    <div style={{ padding: 12 }}>
      {warnings.map((w, i) => (
        <div key={i} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid #f3f4f6" }}>
          <span style={{
            fontSize: 9, padding: "1px 4px", borderRadius: 3,
            background: "#fef3c7", color: "#b45309", marginRight: 6, fontWeight: 600,
          }}>
            {w.type}
          </span>
          {w.message}
        </div>
      ))}
    </div>
  );
}

// スタイル定数
const panelStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fff",
  overflow: "hidden",
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
};

const tabStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  background: "none",
  border: "none",
  cursor: "pointer",
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  fontSize: 12,
  color: "#9ca3af",
  textAlign: "center",
};

const toggleBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: 10,
  fontWeight: 600,
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
};

const sampleHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 600,
  color: "#374151",
  background: "#f9fafb",
  borderTop: "1px solid #e5e7eb",
  borderBottom: "1px solid #f3f4f6",
};

const sampleDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#8b5cf6",
};
