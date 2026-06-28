// 全ノードグラフ（Obsidian 風グローバルグラフ）の本番ビュー。
//
// buildGlobalGraph が返す NoteGraphData を描画する。サイドバーの「全体グラフ」から
// 全画面オーバーレイ（GlobalGraphOverlay）で開く想定。
//
// 見た目は Storybook（global-graph.stories.tsx）で合意したもの:
//   - ノード色 = kind（external / note / summary / claim / atom / synthesis）
//   - エッジ線種 = relation（derived=実線緑 / used=実線グレー / reference=破線青）
//   - レイアウト切替（有機的 force ⇄ 列）。列モードでは参照（破線）を既定で隠す。
// 配色は knowledge-colors.ts と 2 ホップグラフ（view.tsx）に合わせている。

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import cytoscape from "cytoscape";
import { ensureCytoscapePlugins } from "../../lib/cytoscape-setup";
import { knowledgeKindColor, knowledgeKindBorder } from "./knowledge-colors";
import { openExternalUrl } from "../../lib/external-link";
import { useT } from "../../i18n";
import type { NoteNode, NoteGraphData, EdgeRelation } from "./graph-builder";

// fcose レイアウト登録（重複防止）
ensureCytoscapePlugins();

export type GlobalGraphLayout = "force" | "columns";

// ── kind / 層 ──

type GraphKind = "external" | "note" | "summary" | "claim" | "atom" | "synthesis";
type LayerId = "source" | "note" | "crystal" | "synth";

/** NoteNode から kind を判定する。 */
function kindOf(n: NoteNode): GraphKind {
  if (n.external) return "external";
  if (n.isWiki) return (n.wikiKind as GraphKind) ?? "summary";
  return "note";
}

const KIND_LAYER: Record<GraphKind, LayerId> = {
  external: "source",
  note: "note",
  claim: "crystal",
  atom: "crystal",
  summary: "synth",
  synthesis: "synth",
};

const ALL_LAYERS: LayerId[] = ["source", "note", "crystal", "synth"];

// 列レイアウト用: 左→右で抽象度が上がる列。
const COLUMNS: { kinds: GraphKind[]; layerKey: LayerId }[] = [
  { kinds: ["external"], layerKey: "source" },
  { kinds: ["note"], layerKey: "note" },
  { kinds: ["claim"], layerKey: "crystal" },
  { kinds: ["atom"], layerKey: "crystal" },
  { kinds: ["summary", "synthesis"], layerKey: "synth" },
];

function columnIndexOf(kind: GraphKind): number {
  return COLUMNS.findIndex((c) => c.kinds.includes(kind));
}

/**
 * 層フィルタ・参照フィルタ・孤立ノード除外を適用したサブグラフを返す。
 * オーバーレイ（件数表示）とキャンバス（描画）で同じ結果を使うため切り出している。
 *
 * hideIsolated: 実データではリンクの無いノートが大半を占める（Obsidian と同じ）。
 *   既定で孤立ノードを隠すと、連結した「網」だけが残って俯瞰しやすくなる。
 */
export function filterGlobalGraph(
  data: NoteGraphData,
  opts: { visibleLayers: Set<LayerId>; hideReferences?: boolean; hideIsolated?: boolean },
): NoteGraphData {
  const { visibleLayers, hideReferences = false, hideIsolated = false } = opts;
  const visibleIds = new Set(
    data.nodes.filter((n) => visibleLayers.has(KIND_LAYER[kindOf(n)])).map((n) => n.id),
  );
  const edges = data.edges.filter(
    (e) =>
      visibleIds.has(e.source) &&
      visibleIds.has(e.target) &&
      !(hideReferences && e.relation === "reference"),
  );
  let nodes = data.nodes.filter((n) => visibleIds.has(n.id));
  if (hideIsolated) {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  return { nodes, edges };
}

// ── 配色（knowledge-colors.ts と view.tsx に一致） ──

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

const KIND_SHAPE: Record<GraphKind, string> = {
  external: "round-rectangle",
  note: "ellipse",
  summary: "round-rectangle",
  claim: "round-rectangle",
  atom: "diamond",
  synthesis: "hexagon",
};

const KIND_SIZE: Record<GraphKind, number> = {
  external: 26,
  note: 32,
  summary: 32,
  claim: 30,
  atom: 36,
  synthesis: 38,
};

const REL_COLOR: Record<EdgeRelation, string> = {
  derived: "#4B7A52",
  used: "#9aa0a6",
  reference: "#5b8fb9",
};

const BG_COLOR = "#fafdf7";

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
      label: "data(fullLabel)" as any,
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
  { selector: "edge.hover-connected", style: { width: 2.6, opacity: 1, "z-index": 10 } },
  { selector: "edge.faded", style: { opacity: 0.06 } },
];

function nodeIcon(n: NoteNode): string {
  if (n.external === "pdf") return "📄 ";
  if (n.external === "document") return "📝 ";
  if (n.external === "url") return "🔗 ";
  if (n.external === "chat") return "💬 ";
  if (n.isWiki) return "🤖 ";
  return "";
}

function truncate(s: string, max = 16): string {
  return [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
}

// ── キャンバス（クロムなし。オーバーレイや Storybook から使う） ──

export function GlobalGraphCanvas({
  data,
  layout,
  visibleLayers,
  hideReferences = false,
  hideIsolated = false,
  onNavigate,
  onOpenMedia,
  height = 560,
}: {
  data: NoteGraphData;
  layout: GlobalGraphLayout;
  visibleLayers: Set<LayerId>;
  hideReferences?: boolean;
  hideIsolated?: boolean;
  onNavigate?: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  height?: number | string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  // 表示中の層・参照・孤立フィルタを適用
  const { nodes: shownNodes, edges: shownEdges } = useMemo(
    () => filterGlobalGraph(data, { visibleLayers, hideReferences, hideIsolated }),
    [data, visibleLayers, hideReferences, hideIsolated],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    if (shownNodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      return;
    }

    // 列レイアウトの座標（kind の列 × 列内の縦位置）
    const X_GAP = 240;
    const Y_GAP = 84;
    const posById = new Map<string, { x: number; y: number }>();
    if (layout === "columns") {
      const byCol = new Map<number, NoteNode[]>();
      for (const n of shownNodes) {
        const ci = columnIndexOf(kindOf(n));
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
      const kind = kindOf(node);
      const full = `${nodeIcon(node)}${node.title}`;
      elements.push({
        data: {
          id: node.id,
          label: truncate(full),
          fullLabel: full,
          color: kindFill(kind),
          borderColor: kindBorder(kind),
          shape: KIND_SHAPE[kind],
          size: KIND_SIZE[kind],
          isWiki: !!node.isWiki,
          external: node.external,
          externalUrl: node.externalUrl,
        },
        ...(layout === "columns" && posById.has(node.id)
          ? { position: posById.get(node.id) }
          : {}),
      });
    }
    for (const edge of shownEdges) {
      const rel: EdgeRelation = edge.relation ?? "derived";
      elements.push({
        data: {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          color: REL_COLOR[rel],
          lineStyle: rel === "reference" ? "dashed" : "solid",
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
      minZoom: 0.1,
      maxZoom: 3,
      boxSelectionEnabled: false,
    });

    if (layout === "columns") {
      cy.fit(undefined, 40);
    } else {
      const lay = cy.layout({
        name: "fcose",
        animate: true,
        animationDuration: 700,
        randomize: true,
        quality: "default",
        nodeRepulsion: 9000,
        idealEdgeLength: 110,
        edgeElasticity: 0.4,
        gravity: 0.3,
        nodeSeparation: 120,
        padding: 50,
      } as any);
      lay.on("layoutstop", () => cy.fit(undefined, 30));
      lay.run();
    }

    // ホバーで隣接を強調
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

    // ノードクリック → ナビゲーション（2 ホップグラフ view.tsx と同じ振り分け）
    cy.on("tap", "node", (evt) => {
      const id: string = evt.target.id();
      const externalUrl: string | undefined = evt.target.data("externalUrl");
      if (id.startsWith("pdf:")) {
        onOpenMedia?.(id.slice(4));
        return;
      }
      if (id.startsWith("document:")) {
        onOpenMedia?.(id.slice("document:".length));
        return;
      }
      if (id.startsWith("chat:")) return;
      if (id.startsWith("url:")) {
        if (externalUrl) void openExternalUrl(externalUrl);
        return;
      }
      const isWiki = !!evt.target.data("isWiki");
      onNavigate?.(isWiki ? `wiki:${id}` : id);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [shownNodes, shownEdges, layout, onNavigate, onOpenMedia]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, background: BG_COLOR }}
    />
  );
}

// ── 凡例・トグル・層チップ・列ヘッダ ──

function Legend() {
  const t = useT();
  const kindItems: { kind: GraphKind; label: string }[] = [
    { kind: "external", label: t("globalGraph.kind.external") },
    { kind: "note", label: t("globalGraph.kind.note") },
    { kind: "claim", label: t("knowledge.kind.claim") },
    { kind: "atom", label: t("knowledge.kind.atom") },
    { kind: "summary", label: t("knowledge.kind.summary") },
    { kind: "synthesis", label: t("knowledge.kind.synthesis") },
  ];
  const relItems: { rel: EdgeRelation; label: string; dashed: boolean }[] = [
    { rel: "derived", label: t("globalGraph.relation.derived"), dashed: false },
    { rel: "used", label: t("globalGraph.relation.used"), dashed: false },
    { rel: "reference", label: t("globalGraph.relation.reference"), dashed: true },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {kindItems.map(({ kind, label }) => (
        <span key={kind} className="flex items-center gap-1">
          <span
            style={{
              width: 10,
              height: 10,
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
      <span className="w-px h-3 bg-border" />
      {relItems.map(({ rel, label, dashed }) => (
        <span key={rel} className="flex items-center gap-1">
          <span
            style={{
              width: 16,
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

function LayoutToggle({
  mode,
  onChange,
}: {
  mode: GlobalGraphLayout;
  onChange: (m: GlobalGraphLayout) => void;
}) {
  const t = useT();
  const opts: { id: GlobalGraphLayout; label: string }[] = [
    { id: "force", label: t("globalGraph.layout.force") },
    { id: "columns", label: t("globalGraph.layout.columns") },
  ];
  return (
    <div className="inline-flex rounded-md overflow-hidden border border-border">
      {opts.map((o) => {
        const on = mode === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`px-3 py-1 text-xs font-semibold transition-colors ${
              on ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LayerChips({
  visible,
  onToggle,
}: {
  visible: Set<LayerId>;
  onToggle: (id: LayerId) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_LAYERS.map((id) => {
        const on = visible.has(id);
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {t(`globalGraph.layer.${id}` as any)}
          </button>
        );
      })}
    </div>
  );
}

function ColumnHeader() {
  const t = useT();
  return (
    <div className="flex">
      {COLUMNS.map((col, i) => (
        <div
          key={col.kinds[0]}
          className="flex-1 text-center text-xs font-bold text-foreground py-1.5 border-b-2 border-border relative"
        >
          {t(`globalGraph.column.${col.kinds[0]}` as any)}
          {i < COLUMNS.length - 1 && (
            <span className="absolute -right-1.5 top-1 text-muted-foreground text-xs">▸</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 全画面オーバーレイ ──

export function GlobalGraphOverlay({
  data,
  onNavigate,
  onOpenMedia,
  onClose,
}: {
  data: NoteGraphData;
  onNavigate?: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<GlobalGraphLayout>("force");
  const [hideRefs, setHideRefs] = useState(false);
  const [showIsolated, setShowIsolated] = useState(false);
  const [visible, setVisible] = useState<Set<LayerId>>(new Set(ALL_LAYERS));

  // 層・参照フィルタ適用後の「全ノード版」と「連結のみ版」を両方求め、
  // 表示用サブグラフ（shown）と隠れている孤立ノード数（isolatedCount）を導く。
  const { shown, isolatedCount } = useMemo(() => {
    const withIsolated = filterGlobalGraph(data, { visibleLayers: visible, hideReferences: hideRefs, hideIsolated: false });
    const connectedOnly = filterGlobalGraph(data, { visibleLayers: visible, hideReferences: hideRefs, hideIsolated: true });
    return {
      shown: showIsolated ? withIsolated : connectedOnly,
      isolatedCount: withIsolated.nodes.length - connectedOnly.nodes.length,
    };
  }, [data, visible, hideRefs, showIsolated]);

  const switchMode = (m: GlobalGraphLayout) => {
    setMode(m);
    // 列モードは参照（破線）を既定で隠して交差を抑える
    setHideRefs(m === "columns");
  };
  const toggleLayer = (id: LayerId) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Esc で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleNavigate = (noteId: string) => {
    onNavigate?.(noteId);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: BG_COLOR }}
      role="dialog"
      aria-modal="true"
    >
      {/* ヘッダー / ツールバー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-wrap">
        <span className="text-sm font-bold text-foreground">{t("globalGraph.title")}</span>
        <LayoutToggle mode={mode} onChange={switchMode} />
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={hideRefs} onChange={(e) => setHideRefs(e.target.checked)} />
          {t("globalGraph.hideReferences")}
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title={t("globalGraph.showIsolatedHint")}>
          <input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} />
          {t("globalGraph.showIsolated")}
          {isolatedCount > 0 && <span className="opacity-70">({isolatedCount})</span>}
        </label>
        <LayerChips visible={visible} onToggle={toggleLayer} />
        <span className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {shown.nodes.length} / {shown.edges.length}
          </span>
          <button
            onClick={onClose}
            title={t("common.close")}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </span>
      </div>
      {/* 凡例 + 列ヘッダ */}
      <div className="px-4 py-2 border-b border-border flex flex-col gap-2">
        <Legend />
        {mode === "columns" && <ColumnHeader />}
      </div>
      {/* キャンバス */}
      <div className="flex-1 min-h-0">
        {shown.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t("globalGraph.empty")}
          </div>
        ) : (
          <GlobalGraphCanvas
            data={data}
            layout={mode}
            visibleLayers={visible}
            hideReferences={hideRefs}
            hideIsolated={!showIsolated}
            onNavigate={handleNavigate}
            onOpenMedia={onOpenMedia}
            height="100%"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
