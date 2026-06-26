// 全ノードグラフ（Obsidian 風グローバルグラフ）のサンプル Storybook ストーリー。
//
// 目的: 「kind でノード色分け」「関係種別でエッジ線種」「層フィルタ」の
//       見た目をサンプルデータで合意するための叩き台。実アプリのデータには
//       まだ繋がない（スタイル合意が先）。
//
// 配色は新規に発明せず、実アプリと同じものを使う:
//   - Knowledge kind の色 → knowledge-colors.ts をそのまま import
//   - note / 外部ソース / エッジ色 → network-graph/view.tsx の定義に合わせる
// こうすることで、ここで合意した見た目がそのまま本実装に持ち込める。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { knowledgeKindColor, knowledgeKindBorder } from "./knowledge-colors";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

// ── ノードの kind と層（hourglass のレイヤー） ──

// グラフ上のノード種別。Knowledge の 4 kind に加えて、通常ノートと外部ソースを持つ。
type GraphKind =
  | "external" // 外部ソース（pdf:/url:/document:/chat:）
  | "note" // 通常ノート（human）
  | "summary" // Knowledge: 要約
  | "claim" // Knowledge: 主張
  | "atom" // Knowledge: 原子（砂時計の首）
  | "synthesis"; // Knowledge: 統合（legacy／旧データ用）

// 層 = 砂時計の抽象度レベル。フィルタの単位になる。
type LayerId = "source" | "note" | "crystal" | "synth";

const KIND_LAYER: Record<GraphKind, LayerId> = {
  external: "source",
  note: "note",
  claim: "crystal",
  atom: "crystal",
  summary: "synth",
  synthesis: "synth",
};

const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: "source", label: "原料（外部ソース）", hint: "PDF / URL / 文書 / Chat" },
  { id: "note", label: "ノート", hint: "手で書いた生のノート" },
  { id: "crystal", label: "結晶（Claim・Atom）", hint: "主張と原子＝砂時計の首" },
  { id: "synth", label: "統合（Summary・Synthesis）", hint: "要約・発想" },
];

// 列レイアウト用: 左→右で抽象度が上がる列の定義。
// 各列に「意味の違う kind」をまとめ、砂時計の発散→収束→発散を横並びで見せる。
const COLUMNS: { kinds: GraphKind[]; label: string }[] = [
  { kinds: ["external"], label: "原料" },
  { kinds: ["note"], label: "ノート" },
  { kinds: ["claim"], label: "Claim" },
  { kinds: ["atom"], label: "Atom" },
  { kinds: ["summary", "synthesis"], label: "統合" },
];

function columnIndexOf(kind: GraphKind): number {
  return COLUMNS.findIndex((c) => c.kinds.includes(kind));
}

// ── kind 別の塗り色・border・形 ──
// note / external は view.tsx の NODE_COLORS に合わせる。Knowledge 4 種は
// knowledge-colors.ts の関数をそのまま使い、実アプリと完全に一致させる。

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

// kind 別の形。砂時計の首である atom を菱形で強調する。
const KIND_SHAPE: Record<GraphKind, string> = {
  external: "round-rectangle",
  note: "ellipse",
  summary: "round-rectangle",
  claim: "round-rectangle",
  atom: "diamond",
  synthesis: "hexagon",
};

// kind 別のノードサイズ。atom（首）を少し大きくして主役に見せる。
const KIND_SIZE: Record<GraphKind, number> = {
  external: 26,
  note: 34,
  summary: 34,
  claim: 32,
  atom: 38,
  synthesis: 40,
};

const KIND_LEGEND: { kind: GraphKind; label: string }[] = [
  { kind: "external", label: "外部ソース" },
  { kind: "note", label: "ノート" },
  { kind: "claim", label: "Claim（主張）" },
  { kind: "atom", label: "Atom（原子）" },
  { kind: "summary", label: "Summary（要約）" },
  { kind: "synthesis", label: "Synthesis（統合）" },
];

// ── エッジの関係種別と線種 ──
// 実データのエッジ源に対応:
//   derived   = derivedFromNoteId / noteLinks(derived_from) / derivedFromClaims
//   used      = sourceUrl / sourcePdfFileId / MediaIndex.usedIn（素材利用）
//   reference = knowledgeLinks（参照）
type Relation = "derived" | "used" | "reference";

const REL_COLOR: Record<Relation, string> = {
  derived: "#4B7A52", // ブランドグリーン（派生＝主役）
  used: "#9aa0a6", // グレー（素材利用）
  reference: "#5b8fb9", // 青（参照）
};

const REL_LEGEND: { rel: Relation; label: string; dashed: boolean }[] = [
  { rel: "derived", label: "派生（上流→下流）", dashed: false },
  { rel: "used", label: "素材利用（ソース→ノート）", dashed: false },
  { rel: "reference", label: "参照（knowledge link）", dashed: true },
];

// ── サンプルデータ（熱電材料の研究を題材にした砂時計） ──

type SampleNode = { id: string; label: string; kind: GraphKind };
type SampleEdge = { source: string; target: string; rel: Relation };

const SAMPLE_NODES: SampleNode[] = [
  // 原料（外部ソース）
  { id: "ext1", label: "📄 先行研究A.pdf", kind: "external" },
  { id: "ext2", label: "🔗 arXiv:2401.xxxx", kind: "external" },
  { id: "ext3", label: "📝 実験プロトコル.docx", kind: "external" },
  { id: "ext4", label: "💬 AI Chat", kind: "external" },
  // ノート
  { id: "n1", label: "アニール条件の検討", kind: "note" },
  { id: "n2", label: "Cu系試料の作製", kind: "note" },
  { id: "n3", label: "XRD測定メモ", kind: "note" },
  { id: "n4", label: "ゼーベック係数の測定", kind: "note" },
  { id: "n5", label: "文献まとめ（A論文）", kind: "note" },
  { id: "n6", label: "異常データの考察", kind: "note" },
  { id: "n7", label: "再現性チェック", kind: "note" },
  // Claim（主張）
  { id: "c1", label: "高温アニールで相純度が上がる", kind: "claim" },
  { id: "c2", label: "Cu過剰でn型化する", kind: "claim" },
  { id: "c3", label: "粒径が熱伝導を支配する", kind: "claim" },
  { id: "c4", label: "測定誤差は接触抵抗由来", kind: "claim" },
  { id: "c5", label: "ロット間ばらつきが大きい", kind: "claim" },
  // Atom（原子＝砂時計の首）
  { id: "a1", label: "アニール温度→相純度", kind: "atom" },
  { id: "a2", label: "ドープでキャリア型が反転", kind: "atom" },
  { id: "a3", label: "粒界散乱がκを下げる", kind: "atom" },
  // 統合
  { id: "s1", label: "要約: Cu系熱電材料の作製指針", kind: "summary" },
  { id: "y1", label: "統合: 高ZTへの設計方針", kind: "synthesis" },
];

const SAMPLE_EDGES: SampleEdge[] = [
  // 素材利用（外部ソース → ノート）
  { source: "ext1", target: "n5", rel: "used" },
  { source: "ext2", target: "n5", rel: "used" },
  { source: "ext2", target: "n4", rel: "used" },
  { source: "ext3", target: "n2", rel: "used" },
  { source: "ext4", target: "n6", rel: "used" },
  // 派生（ノート → Claim）
  { source: "n1", target: "c1", rel: "derived" },
  { source: "n3", target: "c1", rel: "derived" },
  { source: "n2", target: "c2", rel: "derived" },
  { source: "n4", target: "c2", rel: "derived" },
  { source: "n3", target: "c3", rel: "derived" },
  { source: "n6", target: "c4", rel: "derived" },
  { source: "n7", target: "c5", rel: "derived" },
  { source: "n2", target: "c5", rel: "derived" },
  // 派生（Claim → Atom：砂時計の首へ収束）
  { source: "c1", target: "a1", rel: "derived" },
  { source: "c2", target: "a2", rel: "derived" },
  { source: "c3", target: "a3", rel: "derived" },
  // 派生（ノート → Summary、Atom → Synthesis：首から再発散）
  { source: "n1", target: "s1", rel: "derived" },
  { source: "n2", target: "s1", rel: "derived" },
  { source: "a1", target: "y1", rel: "derived" },
  { source: "a2", target: "y1", rel: "derived" },
  { source: "a3", target: "y1", rel: "derived" },
  // 参照（knowledge link：破線）
  { source: "c1", target: "n5", rel: "reference" },
  { source: "a2", target: "c2", rel: "reference" },
  { source: "c5", target: "c2", rel: "reference" },
  { source: "y1", target: "s1", rel: "reference" },
];

// ── Cytoscape スタイル ──

const graphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "100px",
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
      "font-weight": "bold" as any,
      "z-index": 999,
    },
  },
  { selector: "node.faded", style: { opacity: 0.12 } },
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
  {
    selector: "edge.hover-connected",
    style: { width: 2.6, opacity: 1, "z-index": 10 },
  },
  { selector: "edge.faded", style: { opacity: 0.06 } },
];

// ── グラフ描画コンポーネント ──

function SampleGlobalGraph({
  nodes,
  edges,
  visibleLayers,
  height = 560,
  layoutMode = "force",
  hideReferences = false,
}: {
  nodes: SampleNode[];
  edges: SampleEdge[];
  visibleLayers: Set<LayerId>;
  height?: number;
  layoutMode?: "force" | "columns";
  hideReferences?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  // 表示中の層だけにフィルタしたノード・エッジ
  const { shownNodes, shownEdges } = useMemo(() => {
    const visibleIds = new Set(
      nodes.filter((n) => visibleLayers.has(KIND_LAYER[n.kind])).map((n) => n.id),
    );
    return {
      shownNodes: nodes.filter((n) => visibleIds.has(n.id)),
      shownEdges: edges.filter(
        (e) =>
          visibleIds.has(e.source) &&
          visibleIds.has(e.target) &&
          !(hideReferences && e.rel === "reference"),
      ),
    };
  }, [nodes, edges, visibleLayers, hideReferences]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 列レイアウト時の各ノード座標を事前計算（kind の列 × 列内の縦位置）
    const X_GAP = 240;
    const Y_GAP = 86;
    const posById = new Map<string, { x: number; y: number }>();
    if (layoutMode === "columns") {
      const byCol = new Map<number, SampleNode[]>();
      for (const n of shownNodes) {
        const ci = columnIndexOf(n.kind);
        if (!byCol.has(ci)) byCol.set(ci, []);
        byCol.get(ci)!.push(n);
      }
      for (const [ci, list] of byCol) {
        list.forEach((n, i) => {
          posById.set(n.id, { x: ci * X_GAP, y: (i - (list.length - 1) / 2) * Y_GAP });
        });
      }
    }

    const elements: cytoscape.ElementDefinition[] = [];
    for (const node of shownNodes) {
      elements.push({
        data: {
          id: node.id,
          label: node.label,
          color: kindFill(node.kind),
          borderColor: kindBorder(node.kind),
          shape: KIND_SHAPE[node.kind],
          size: KIND_SIZE[node.kind],
        },
        ...(layoutMode === "columns" && posById.has(node.id)
          ? { position: posById.get(node.id) }
          : {}),
      });
    }
    for (const edge of shownEdges) {
      const dashed = edge.rel === "reference";
      elements.push({
        data: {
          id: `${edge.source}->${edge.target}:${edge.rel}`,
          source: edge.source,
          target: edge.target,
          color: REL_COLOR[edge.rel],
          lineStyle: dashed ? "dashed" : "solid",
        },
      });
    }

    if (cyRef.current) cyRef.current.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: graphStyle,
      layout: { name: "preset" },
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 3,
      boxSelectionEnabled: false,
    });

    if (layoutMode === "columns") {
      // 事前計算した座標をそのまま使う（preset）。アニメーションは無し。
      cy.fit(undefined, 40);
    } else {
      const layout = cy.layout({
        name: "fcose",
        animate: true,
        animationDuration: 700,
        randomize: true,
        quality: "default",
        nodeRepulsion: 9000,
        idealEdgeLength: 110,
        edgeElasticity: 0.4,
        gravity: 0.35,
        nodeSeparation: 120,
        padding: 50,
      } as any);
      layout.on("layoutstop", () => cy.fit(undefined, 24));
      layout.run();
    }

    // ホバーで隣接を強調・それ以外をフェード
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
      containerRef.current!.style.cursor = "default";
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [shownNodes, shownEdges, layoutMode]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        background: "#fafdf7",
        borderRadius: 10,
        border: "1px solid #d5e0d7",
      }}
    />
  );
}

// ── 凡例 ──

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px 16px",
        padding: "10px 12px",
        fontSize: 11,
        color: "#6b7f6e",
        fontFamily: "Inter, system-ui, sans-serif",
        borderBottom: "1px solid #d5e0d7",
        alignItems: "center",
      }}
    >
      <strong style={{ color: "#3a4a3d", fontWeight: 700 }}>kind</strong>
      {KIND_LEGEND.map(({ kind, label }) => (
        <span key={kind} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 11,
              height: 11,
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
      <span style={{ width: 1, height: 14, background: "#d5e0d7" }} />
      <strong style={{ color: "#3a4a3d", fontWeight: 700 }}>関係</strong>
      {REL_LEGEND.map(({ rel, label, dashed }) => (
        <span key={rel} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 18,
              height: 0,
              borderTop: `2px ${dashed ? "dashed" : "solid"} ${REL_COLOR[rel]}`,
              display: "inline-block",
            }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── 層フィルタ・チップ ──

function LayerChips({
  visible,
  onToggle,
}: {
  visible: Set<LayerId>;
  onToggle: (id: LayerId) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "10px 12px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {LAYERS.map((layer) => {
        const on = visible.has(layer.id);
        return (
          <button
            key={layer.id}
            onClick={() => onToggle(layer.id)}
            title={layer.hint}
            style={{
              display: "inline-flex",
              flexDirection: "column",
              gap: 1,
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: on ? "#4B7A52" : "#f0f5ef",
              color: on ? "#fff" : "#6b7f6e",
              border: `1px solid ${on ? "#3d6844" : "#d5e0d7"}`,
              transition: "all 120ms ease",
            }}
          >
            <span>{layer.label}</span>
            <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.85 }}>
              {layer.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Storybook ──

const meta: Meta = {
  title: "Graph/Global Graph (sample)",
  parameters: { layout: "fullscreen" },
};
export default meta;

// 全ノードグラフ（kind 色分け + 関係線種 + 凡例）
export const Default: StoryObj = {
  name: "全ノードグラフ（kind色分け・関係線種）",
  render: () => (
    <div style={{ padding: 16 }}>
      <Legend />
      <div style={{ marginTop: 12 }}>
        <SampleGlobalGraph
          nodes={SAMPLE_NODES}
          edges={SAMPLE_EDGES}
          visibleLayers={new Set<LayerId>(["source", "note", "crystal", "synth"])}
        />
      </div>
    </div>
  ),
};

// 層フィルタ付き（層トグルでごちゃつきを抑える）
export const LayeredFilter: StoryObj = {
  name: "層フィルタ付き",
  render: () => {
    function Demo() {
      const [visible, setVisible] = useState<Set<LayerId>>(
        new Set<LayerId>(["source", "note", "crystal", "synth"]),
      );
      const toggle = (id: LayerId) =>
        setVisible((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      return (
        <div style={{ padding: 16 }}>
          <Legend />
          <LayerChips visible={visible} onToggle={toggle} />
          <SampleGlobalGraph
            nodes={SAMPLE_NODES}
            edges={SAMPLE_EDGES}
            visibleLayers={visible}
            height={520}
          />
        </div>
      );
    }
    return <Demo />;
  },
};

// 結晶レイヤーのみ（砂時計の首にフォーカス）
export const CrystalOnly: StoryObj = {
  name: "結晶レイヤーのみ（Claim・Atom）",
  render: () => (
    <div style={{ padding: 16 }}>
      <Legend />
      <div style={{ marginTop: 12 }}>
        <SampleGlobalGraph
          nodes={SAMPLE_NODES}
          edges={SAMPLE_EDGES}
          visibleLayers={new Set<LayerId>(["crystal"])}
        />
      </div>
    </div>
  ),
};

// 列ヘッダ（左→右で抽象度が上がることを示す帯）
function ColumnHeader() {
  return (
    <div
      style={{
        display: "flex",
        marginTop: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {COLUMNS.map((col, i) => (
        <div
          key={col.label}
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 12,
            fontWeight: 700,
            color: "#3a4a3d",
            padding: "6px 0",
            borderBottom: "2px solid #d5e0d7",
            position: "relative",
          }}
        >
          {col.label}
          {i < COLUMNS.length - 1 && (
            <span
              style={{
                position: "absolute",
                right: -7,
                top: 4,
                color: "#9aa0a6",
                fontSize: 13,
              }}
            >
              ▸
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// 列レイアウト（kind ごとに列を揃える＝砂時計の発散→収束→発散を横並びに）
export const Columns: StoryObj = {
  name: "列レイアウト（kindごとに列で整列）",
  render: () => (
    <div style={{ padding: 16 }}>
      <Legend />
      <ColumnHeader />
      <div style={{ marginTop: 4 }}>
        <SampleGlobalGraph
          nodes={SAMPLE_NODES}
          edges={SAMPLE_EDGES}
          visibleLayers={new Set<LayerId>(["source", "note", "crystal", "synth"])}
          layoutMode="columns"
          height={560}
        />
      </div>
    </div>
  ),
};

// ── レイアウト切替トグル ──
function LayoutToggle({
  mode,
  onChange,
}: {
  mode: "force" | "columns";
  onChange: (m: "force" | "columns") => void;
}) {
  const opts: { id: "force" | "columns"; label: string }[] = [
    { id: "force", label: "有機的（force）" },
    { id: "columns", label: "列（layer）" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #d5e0d7",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {opts.map((o) => {
        const on = mode === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              background: on ? "#4B7A52" : "#fafdf7",
              color: on ? "#fff" : "#6b7f6e",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// 切替プレイグラウンド（合意した最終形: レイアウト切替 + 層フィルタ + 参照トグル）
export const Playground: StoryObj = {
  name: "切替プレイグラウンド（force⇄列）",
  render: () => {
    function Demo() {
      const [mode, setMode] = useState<"force" | "columns">("force");
      const [hideRefs, setHideRefs] = useState(false);
      const [visible, setVisible] = useState<Set<LayerId>>(
        new Set<LayerId>(["source", "note", "crystal", "synth"]),
      );
      const toggle = (id: LayerId) =>
        setVisible((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      // 列モードに切り替えたら参照（破線）は既定で隠す（交差を抑えて派生の流れを見せる）
      const switchMode = (m: "force" | "columns") => {
        setMode(m);
        setHideRefs(m === "columns");
      };
      return (
        <div style={{ padding: 16, fontFamily: "Inter, system-ui, sans-serif" }}>
          <Legend />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "10px 12px",
              flexWrap: "wrap",
            }}
          >
            <LayoutToggle mode={mode} onChange={switchMode} />
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#6b7f6e",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={hideRefs}
                onChange={(e) => setHideRefs(e.target.checked)}
              />
              参照（破線）を隠す
            </label>
          </div>
          <LayerChips visible={visible} onToggle={toggle} />
          {mode === "columns" && <ColumnHeader />}
          <div style={{ marginTop: mode === "columns" ? 4 : 12 }}>
            <SampleGlobalGraph
              nodes={SAMPLE_NODES}
              edges={SAMPLE_EDGES}
              visibleLayers={visible}
              layoutMode={mode}
              hideReferences={hideRefs}
              height={520}
            />
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};
