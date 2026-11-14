// 会話の中に描くグラフの画面（MCP Apps の View）。手順の流れ・来歴・全体グラフを 1 つの画面で描く。
//
// 道具の結果の _meta["graphium/graph"]（graph-views.ts の GraphPayload）を受け取って cytoscape で描く。
// 全体グラフ（live）のときは、画面専用の道具 graph_activity を数秒おきに呼び、外の AI がこの MCP で
// 読んだ・たどった・書いたものを光らせる（アプリのチャットの横の全体グラフと同じ考え方）。
// ホストが PiP（会話の横に浮かせる表示）や全画面に対応していれば、ボタンで切り替えられる。
//
// ⚠️ ページの題などの文字は cytoscape の canvas と textContent にだけ入れる。HTML として解釈しない。
// ⚠️ 外のサイトから何も読まない（ライブラリも同梱）。CSP を空のまま通すため。

import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";

import type { GraphNodeKind, GraphPayload } from "../graph-views";
import { INLINE_LABEL_COLORS } from "../../features/inline-label/colors";
import { flowPositions } from "./flow-layout";

cytoscape.use(fcose);

type Lang = "ja" | "en";
const TEXT: Record<Lang, Record<string, string>> = {
  ja: {
    loading: "グラフを読み込んでいます…",
    failed: "グラフを表示できませんでした",
    empty: "描くものがありません",
    fit: "全体を表示",
    pip: "横に浮かせる",
    inline: "会話に戻す",
    fullscreen: "全画面",
    truncated: "大きいので {shown} / {total} 件を描いています",
    live: "AI が触れたものを光らせています",
    read: "読んだ",
    seen: "検索に出た",
    wrote: "書いた",
    walked: "たどった線",
    out: "フォルダの外",
    step: "手順",
    material: "材料",
    tool: "装置",
    output: "生成物",
    note: "ノート",
    topic: "トピック",
    claim: "知見",
    atom: "洞察",
    source: "資料",
    hint: "ノードを押すと名前と id が出ます",
  },
  en: {
    loading: "Loading the graph…",
    failed: "Could not show the graph",
    empty: "Nothing to draw",
    fit: "Fit",
    pip: "Float beside the chat",
    inline: "Back to the chat",
    fullscreen: "Full screen",
    truncated: "Large graph: showing {shown} of {total}",
    live: "Highlighting what the assistant touches",
    read: "Read",
    seen: "In search results",
    wrote: "Written",
    walked: "Walked",
    out: "Outside the folder",
    step: "Step",
    material: "Input",
    tool: "Tool",
    output: "Output",
    note: "Note",
    topic: "Topic",
    claim: "Claim",
    atom: "Insight",
    source: "Source",
    hint: "Tap a node to see its name and id",
  },
};

let lang: Lang = navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (TEXT[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));

// 色はアプリにそろえる（ノート #5b8fb9・ナレッジの種類ごとの色・インラインラベルの色・ブランドグリーン）
const KIND_FILL: Record<GraphNodeKind, string> = {
  step: "#f2f6f1",
  material: INLINE_LABEL_COLORS.material.border,
  tool: INLINE_LABEL_COLORS.tool.border,
  output: INLINE_LABEL_COLORS.output.border,
  entity: "#b9b9b9",
  note: "#5b8fb9",
  claim: "#c46d56",
  topic: "#9b6dcc",
  answer: "#9b6dcc",
  atom: "#6ba89e",
  summary: "#9b6dcc",
  source: "#a3927a",
};
const FOREST = "#4B7A52";
const AMBER = "#d4952b";

const root = document.getElementById("root")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderMessage(message: string): void {
  root.replaceChildren(el("p", "muted", message));
}

let cy: Core | null = null;
let current: GraphPayload | null = null;
let hostCtx: McpUiHostContext | undefined;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let cursor = 0;

function shortLabel(s: string, max = 28): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function elementsOf(p: GraphPayload): ElementDefinition[] {
  const showLabel = p.mode !== "knowledge";
  const nodes: ElementDefinition[] = p.nodes.map((n) => ({
    group: "nodes",
    data: {
      id: n.id,
      label: showLabel ? shortLabel(n.label) + (n.sub ? `\n${shortLabel(n.sub, 34)}` : "") : "",
      full: n.label,
      kind: n.kind,
      fill: KIND_FILL[n.kind] ?? "#999",
      rank: n.rank ?? 0,
    },
    classes: [n.kind, n.focus ? "focus" : "", n.out ? "out" : "", p.mode === "knowledge" ? "kg" : ""].filter(Boolean).join(" "),
  }));
  const edges: ElementDefinition[] = p.edges.map((e) => ({
    group: "edges",
    data: { id: `e:${e.id}`, source: e.source, target: e.target, kind: e.kind },
    classes: e.kind,
  }));
  return [...nodes, ...edges];
}

function layoutOf(p: GraphPayload): cytoscape.LayoutOptions {
  if (p.mode === "knowledge") {
    return { name: "fcose", quality: "default", animate: false, randomize: true, nodeRepulsion: 6000, idealEdgeLength: 60, packComponents: true } as cytoscape.LayoutOptions;
  }
  if (p.mode === "lineage") {
    // 段（上流 → 起点 → 下流）を左から右に並べる
    const byRank = new Map<number, string[]>();
    for (const n of p.nodes) {
      const r = n.rank ?? 0;
      byRank.set(r, [...(byRank.get(r) ?? []), n.id]);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [r, ids] of byRank) ids.forEach((id, i) => pos.set(id, { x: r * 230, y: (i - (ids.length - 1) / 2) * 70 }));
    return { name: "preset", positions: (node: cytoscape.NodeSingular) => pos.get(node.id()) ?? { x: 0, y: 0 }, animate: false } as cytoscape.LayoutOptions;
  }
  // 手順の流れ: 線の向きに沿った最長経路で段を決め、左から右へ並べる（flow-layout.ts）
  const pos = flowPositions(p.nodes, p.edges);
  return { name: "preset", positions: (node: cytoscape.NodeSingular) => pos.get(node.id()) ?? { x: 0, y: 0 }, animate: false } as cytoscape.LayoutOptions;
}

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "data(fill)",
      label: "data(label)",
      "font-family": "Inter, system-ui, -apple-system, 'Hiragino Sans', sans-serif",
      "font-size": 11,
      color: "#2c3b2f",
      "text-wrap": "wrap",
      "text-max-width": "150px",
      "text-valign": "bottom",
      "text-margin-y": 4,
      width: 14,
      height: 14,
      "border-width": 1,
      "border-color": "#ffffff",
      "min-zoomed-font-size": 7,
    },
  },
  {
    selector: "node.step",
    style: {
      shape: "round-rectangle",
      width: 170,
      height: 44,
      "text-valign": "center",
      "text-margin-y": 0,
      "border-color": FOREST,
      "border-width": 1.5,
      "font-weight": 600,
    },
  },
  { selector: "node.material, node.tool, node.output, node.entity", style: { shape: "ellipse", width: 16, height: 16 } },
  { selector: "node.topic, node.answer", style: { width: 20, height: 20 } },
  { selector: "node.source", style: { shape: "round-rectangle", width: 14, height: 14 } },
  { selector: "node.focus", style: { "border-width": 3, "border-color": FOREST } },
  { selector: "node.out", style: { opacity: 0.25 } },
  { selector: "node.labeled", style: { label: "data(full)", "font-size": 10, "text-max-width": "140px" } },
  { selector: "node.seen", style: { "border-width": 2, "border-color": "#8fbf8f" } },
  { selector: "node.read", style: { "background-color": FOREST, width: 18, height: 18, "border-color": "#ffffff", opacity: 1 } },
  { selector: "node.step.read", style: { "background-color": "#dcebd9", width: 170, height: 44 } },
  { selector: "node.wrote", style: { "border-width": 3, "border-color": AMBER, opacity: 1 } },
  { selector: "node.selected", style: { "border-width": 3, "border-color": "#2c3b2f" } },
  // 全体グラフは 1,000 件を超えると縮尺が 0.3 前後になり、上の大きさでは光っても見えない（実データで確認）。
  // 触れたものはアプリのチャットの横と同じく大きくし、題名を常に出す
  {
    selector: "node.kg.read, node.kg.wrote, node.kg.selected",
    style: {
      width: 42,
      height: 42,
      "font-size": 28,
      "font-weight": 600,
      "text-max-width": "420px",
      "text-outline-color": "#fbfcf8",
      "text-outline-width": 4,
      "min-zoomed-font-size": 0,
      "z-index": 20,
    },
  },
  { selector: "node.kg.seen", style: { width: 26, height: 26, "border-width": 5 } },
  { selector: "edge.kg-walked", style: { width: 8 } },
  {
    selector: "edge",
    style: {
      width: 1,
      "line-color": "#c9d3c6",
      "curve-style": "bezier",
      "target-arrow-shape": "none",
      opacity: 0.7,
    },
  },
  { selector: "edge.used, edge.generates, edge.prov, edge.derived", style: { "target-arrow-shape": "triangle", "target-arrow-color": "#b5c2b1", "arrow-scale": 0.7 } },
  { selector: "edge.order", style: { "line-style": "dashed", "target-arrow-shape": "triangle", "arrow-scale": 0.7 } },
  { selector: "edge.reference, edge.connection", style: { "line-style": "dotted" } },
  { selector: "edge.knowledge", style: { "line-color": "#c9b8de" } },
  { selector: "edge.walked", style: { width: 3, "line-color": FOREST, opacity: 1, "z-index": 10 } },
] as unknown as cytoscape.StylesheetJson;

function legendItems(p: GraphPayload): [string, string][] {
  if (p.mode === "flow") return [["step", "#dcebd9"], ["material", KIND_FILL.material], ["tool", KIND_FILL.tool], ["output", KIND_FILL.output]];
  const base: [string, string][] = [["note", KIND_FILL.note], ["topic", KIND_FILL.topic], ["claim", KIND_FILL.claim], ["atom", KIND_FILL.atom], ["source", KIND_FILL.source]];
  return p.live ? [...base, ["read", FOREST], ["wrote", AMBER]] : base;
}

function displayModes(): string[] {
  return (hostCtx?.availableDisplayModes as string[] | undefined) ?? [];
}

function render(p: GraphPayload): void {
  cy?.destroy();
  cy = null;
  if (p.nodes.length === 0) {
    renderMessage(tr("empty"));
    return;
  }
  const card = el("div", "card");
  const header = el("header");
  const title = el("div", "title", p.title);
  const meta = el("div", "meta");
  const metaParts = [`${p.nodes.length} nodes · ${p.edges.length} edges`];
  if (p.truncated) metaParts.push(tr("truncated", p.truncated));
  if (p.live) metaParts.push(tr("live"));
  meta.textContent = metaParts.join(" — ");
  const actions = el("div", "actions");
  const fit = el("button", "btn", tr("fit"));
  fit.onclick = () => cy?.fit(undefined, 24);
  actions.append(fit);
  const mode = hostCtx?.displayMode ?? "inline";
  if (mode !== "inline" && displayModes().includes("inline")) {
    const back = el("button", "btn", tr("inline"));
    back.onclick = () => void app.requestDisplayMode({ mode: "inline" });
    actions.append(back);
  } else {
    if (displayModes().includes("pip")) {
      const pip = el("button", "btn", tr("pip"));
      pip.onclick = () => void app.requestDisplayMode({ mode: "pip" });
      actions.append(pip);
    }
    if (displayModes().includes("fullscreen")) {
      const full = el("button", "btn", tr("fullscreen"));
      full.onclick = () => void app.requestDisplayMode({ mode: "fullscreen" });
      actions.append(full);
    }
  }
  header.append(title, meta, actions);
  const canvas = el("div", "graph");
  canvas.style.height = mode === "inline" ? "460px" : "calc(100vh - 120px)";
  const legend = el("div", "legend");
  for (const [key, color] of legendItems(p)) {
    const item = el("span", "legend-item");
    const dot = el("span", "dot");
    dot.style.background = color;
    item.append(dot, document.createTextNode(tr(key)));
    legend.append(item);
  }
  const info = el("div", "info muted", tr("hint"));
  card.append(header, canvas, legend, info);
  root.replaceChildren(card);

  cy = cytoscape({
    container: canvas,
    elements: elementsOf(p),
    style: STYLE,
    layout: layoutOf(p),
    minZoom: 0.05,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });
  cy.fit(undefined, 24);
  cy.on("tap", "node", (evt) => {
    const n = evt.target as cytoscape.NodeSingular;
    cy?.nodes(".selected").removeClass("selected");
    n.addClass("selected labeled");
    info.textContent = `${n.data("full")}  —  ${n.id()}`;
  });
  if (p.live) startPolling();
}

// ── 触れたものを光らせる（live） ─────────────────────────────

type ActivityEvent = { seq: number; kind: "read" | "seen" | "walk" | "wrote"; id: string; from?: string };

function pulse(node: cytoscape.NodeSingular): void {
  // 終わったら style の上書きを外し、クラスの大きさ（node.kg.read など）に戻す
  node
    .animate({ style: { width: 64, height: 64 } }, { duration: 250 })
    .animate({ style: { width: 42, height: 42 } }, { duration: 350, complete: () => void node.removeStyle("width height") });
}

function applyEvents(events: ActivityEvent[]): void {
  if (!cy) return;
  for (const e of events) {
    const node = cy.getElementById(e.id);
    if (e.kind === "walk" && e.from) {
      const edge = cy.edges().filter((x) => (x.source().id() === e.from && x.target().id() === e.id) || (x.source().id() === e.id && x.target().id() === e.from));
      edge.addClass(current?.mode === "knowledge" ? "walked kg-walked" : "walked");
    }
    if (node.empty()) continue;
    if (e.kind === "seen") {
      if (!node.hasClass("read")) node.addClass("seen");
      continue;
    }
    node.removeClass("seen").addClass(e.kind === "wrote" ? "wrote labeled" : "read labeled");
    if (!node.hasClass("step")) pulse(node);
  }
}

async function poll(): Promise<void> {
  try {
    const res = await app.callServerTool({ name: "graph_activity", arguments: { since: cursor } });
    const sc = res.structuredContent as { events?: ActivityEvent[]; cursor?: number } | undefined;
    if (sc?.events?.length) applyEvents(sc.events);
    if (typeof sc?.cursor === "number") cursor = sc.cursor;
  } catch {
    // 一時的に届かなくても止めない（次の回でまた聞く）
  }
}

function startPolling(): void {
  stopPolling();
  cursor = 0;
  const tick = async () => {
    await poll();
    pollTimer = setTimeout(tick, document.hidden ? 8000 : 2500);
  };
  void tick();
}

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function isPayload(v: unknown): v is GraphPayload {
  const p = v as GraphPayload | undefined;
  return !!p && Array.isArray(p.nodes) && Array.isArray(p.edges) && typeof p.mode === "string";
}

function applyContext(ctx: McpUiHostContext | undefined): void {
  if (ctx) hostCtx = { ...hostCtx, ...ctx };
  if (hostCtx?.locale) lang = hostCtx.locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

renderMessage(TEXT[lang].loading);

const app = new App({ name: "Graphium graph", version: "1.0.0" });

app.ontoolresult = (result) => {
  const payload = (result._meta as Record<string, unknown> | undefined)?.["graphium/graph"];
  if (isPayload(payload)) {
    current = payload;
    render(payload);
  } else {
    renderMessage(TEXT[lang].failed);
  }
};
app.onhostcontextchanged = (ctx) => {
  const before = `${lang}:${hostCtx?.displayMode}`;
  applyContext(ctx);
  if (current && `${lang}:${hostCtx?.displayMode}` !== before) render(current);
};
app.onteardown = async () => {
  stopPolling();
  return {};
};

app
  .connect()
  .then(() => {
    const before = `${lang}:${hostCtx?.displayMode}`;
    applyContext(app.getHostContext());
    if (current && `${lang}:${hostCtx?.displayMode}` !== before) render(current);
  })
  .catch(() => renderMessage(TEXT[lang].failed));
