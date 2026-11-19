// 会話の中に描くグラフの画面（MCP Apps の View）。手順の流れ・来歴・全体グラフを 1 つの画面で描く。
//
// 見た目はアプリにそろえる（ずらさないため、定義はアプリと共有する）:
//   - 全体グラフ: アプリの全体グラフのスタイル（global-graph-stylesheet.ts）をそのまま使い、
//     チャットの横のグラフと同じシンプル表示で描く。読んだ（ai-read）・書いた（ai-used）・
//     たどった線（ai-walked）・根拠のつながり（ai-link / 中継 evidence-links.ts）・
//     触れていないページの題名を隠す（label-muted）・読んだ瞬間の光（graph-firing の pulse）も同じ
//   - 手順の流れ: アプリの工程グラフの配色（flow-palette.ts、面の色は app.css の実値）
//   - 来歴: ノードの色・形はアプリの全体グラフと同じ定義（KIND_SHAPE / kindFill）
//
// 全体グラフ（live）のときは、画面専用の道具 graph_activity を数秒おきに呼び、外の AI がこの MCP で
// 読んだ・たどった・書いたものに印を付ける。ホストが PiP や全画面に対応していれば、ボタンで切り替えられる。
//
// ⚠️ ページの題などの文字は cytoscape の canvas と textContent にだけ入れる。HTML として解釈しない。
// ⚠️ 外のサイトから何も読まない（ライブラリも同梱）。CSP を空のまま通すため。

import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";

import type { GraphNode, GraphPayload } from "../graph-views";
import type { NoteNode } from "../../features/network-graph/graph-builder";
import type { GraphKind } from "../../features/network-graph/graph-kind";
import {
  applyZoomStyle,
  globalGraphStyle,
  kindBorder,
  kindFill,
  KIND_SHAPE,
  KIND_SIZE,
  LAYOUT_ANIMATION_MAX_NODES,
  nodeColors,
  REL_COLOR,
} from "../../features/network-graph/global-graph-stylesheet";
import { GRAPH_ACCENT_COLOR, GRAPH_BG_COLOR, GRAPH_FONT_FAMILY, GRAPH_LABEL_COLOR } from "../../features/network-graph/graph-theme";
import { evidenceRelays, isEvidenceLink } from "../../features/network-graph/evidence-links";
import { startGraphFiring } from "../../features/network-graph/graph-firing";
import { KIND_PALETTE } from "../../features/network-graph/flow-palette";
import { flowPositions } from "./flow-layout";

cytoscape.use(fcose);

type Lang = "ja" | "en";
const TEXT: Record<Lang, Record<string, string>> = {
  ja: {
    loading: "グラフを読み込んでいます…",
    failed: "グラフを表示できませんでした",
    failConnect: "Claude との接続に失敗しました",
    failNoRef: "道具の結果に、描くものの指定がありませんでした",
    failFetch: "グラフのデータを受け取れませんでした",
    failDetail: "詳しく",
    empty: "描くものがありません",
    fit: "全体を表示",
    pip: "横に浮かせる",
    inline: "会話に戻す",
    fullscreen: "全画面",
    truncated: "大きいので {shown} / {total} 件を描いています",
    live: "AI が触れたページに印を付けています",
    read: "読んだ",
    wrote: "書いた",
    walked: "たどった線",
    step: "手順",
    material: "材料",
    tool: "装置",
    output: "生成物",
    note: "ノート",
    knowledge: "ナレッジ",
    source: "資料",
    hint: "ノードを押すと名前と id が出ます",
  },
  en: {
    loading: "Loading the graph…",
    failed: "Could not show the graph",
    failConnect: "Could not connect to the host",
    failNoRef: "The tool result did not say what to draw",
    failFetch: "Could not get the graph data",
    failDetail: "Details",
    empty: "Nothing to draw",
    fit: "Fit",
    pip: "Float beside the chat",
    inline: "Back to the chat",
    fullscreen: "Full screen",
    truncated: "Large graph: showing {shown} of {total}",
    live: "Marking the pages the assistant touches",
    read: "Read",
    wrote: "Written",
    walked: "Walked",
    step: "Step",
    material: "Input",
    tool: "Tool",
    output: "Output",
    note: "Note",
    knowledge: "Knowledge",
    source: "Source",
    hint: "Tap a node to see its name and id",
  },
};

let lang: Lang = navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (TEXT[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));

// 工程グラフの面の色（app.css の --color-label-*-bg の実値。cytoscape は CSS 変数を読めない）
const FLOW_BG = {
  step: "#eaf1f6",
  material: "#edf5ee",
  tool: "#faf3e6",
  output: "#fbeae8",
  entity: "#f4f5f2",
} as const;
// アプリの全体グラフで読んだページの色（chat の横の ai-read と同じ）
const READ_FILL = "#c9e2ce";
const READ_BORDER = "#4f8a5c";
const USED_FILL = "#2f6b3a";

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
/**
 * これより前の出来事は光らせない。記録は別の会話の分も混ざるファイルなので、画面を開いた少し前
 * （同じ会話で、グラフを開く前に読んだ分は入る程度）からにする
 */
const LOOKBACK_MS = 30 * 60 * 1000;
const notBefore = new Date(Date.now() - LOOKBACK_MS).toISOString();
/** 全体グラフ: 読んだ・書いたページと、たどった線（[手前, 先]） */
const touched = { read: new Set<string>(), wrote: new Set<string>(), walked: [] as [string, string][] };

/** アプリの全体グラフと同じ切り詰め（16 文字） */
function truncate(s: string, max = 16): string {
  return [...s].length > max ? `${[...s].slice(0, max).join("")}…` : s;
}

function graphKindOfNode(n: GraphNode): GraphKind {
  return n.graphKind ?? "note";
}

/** kindFill などに渡すための最小の NoteNode（アプリの nodeColors と同じ判定を通す） */
function asNoteNode(n: GraphNode): NoteNode {
  const k = graphKindOfNode(n);
  return {
    id: n.id,
    title: n.label,
    isCurrent: false,
    hop: 0,
    ...(k === "external" ? { external: "pdf" as const } : {}),
    ...(k !== "note" && k !== "external" ? { isWiki: true, wikiKind: k === "synthesis" ? "synthesis" : k } : {}),
  } as NoteNode;
}

// ── 要素 ─────────────────────────────────────────────────────

function knowledgeElements(p: GraphPayload): ElementDefinition[] {
  const nodes: ElementDefinition[] = p.nodes.map((n) => {
    const kind = graphKindOfNode(n);
    const { fill, border } = nodeColors(asNoteNode(n), "simple");
    return {
      group: "nodes",
      data: {
        id: n.id,
        label: truncate(n.label),
        fullLabel: n.label,
        color: fill,
        borderColor: border,
        shape: KIND_SHAPE[kind],
        size: KIND_SIZE[kind],
      },
      classes: ["simple", n.out ? "scope-out" : ""].filter(Boolean).join(" "),
    };
  });
  const edges: ElementDefinition[] = p.edges.map((e) => {
    const rel = e.kind === "reference" ? "reference" : e.kind === "used" ? "used" : "derived";
    return {
      group: "edges",
      data: { id: `e:${e.id}`, source: e.source, target: e.target, color: REL_COLOR[rel], lineStyle: rel === "reference" ? "dashed" : "solid" },
      classes: "simple",
    };
  });
  return [...nodes, ...edges];
}

function flowElements(p: GraphPayload): ElementDefinition[] {
  const nodes: ElementDefinition[] = p.nodes.map((n) => {
    const k = n.kind === "step" ? "activity" : n.kind === "material" || n.kind === "tool" || n.kind === "output" ? n.kind : "block";
    const pal = KIND_PALETTE[k];
    const main = pal.main.startsWith("var(") ? "#a3a39d" : pal.main;
    const text = pal.text.startsWith("var(") ? "#7a7a74" : pal.text;
    const bg = FLOW_BG[n.kind as keyof typeof FLOW_BG] ?? FLOW_BG.entity;
    const label = truncate(n.label, n.kind === "step" ? 24 : 20) + (n.sub ? `\n${truncate(n.sub, 30)}` : "");
    return { group: "nodes", data: { id: n.id, label, fullLabel: n.label, main, text, bg }, classes: n.kind === "step" ? "flow-step" : "flow-entity" };
  });
  const edges: ElementDefinition[] = p.edges.map((e) => ({
    group: "edges",
    data: { id: `e:${e.id}`, source: e.source, target: e.target },
    classes: e.kind === "order" ? "flow-order" : "flow-io",
  }));
  return [...nodes, ...edges];
}

function lineageElements(p: GraphPayload): ElementDefinition[] {
  const nodes: ElementDefinition[] = p.nodes.map((n) => {
    const kind = graphKindOfNode(n);
    return {
      group: "nodes",
      data: { id: n.id, label: truncate(n.label, 22), fullLabel: n.label, fill: kindFill(kind), border: kindBorder(kind), shape: KIND_SHAPE[kind] },
      classes: ["lin", n.focus ? "focus" : ""].filter(Boolean).join(" "),
    };
  });
  const edges: ElementDefinition[] = p.edges.map((e) => ({
    group: "edges",
    data: { id: `e:${e.id}`, source: e.source, target: e.target },
    classes: `lin ${e.kind}`,
  }));
  return [...nodes, ...edges];
}

// ── 見た目 ───────────────────────────────────────────────────

/** 手順の流れ・来歴のスタイル（工程グラフ・全体グラフの配色と文字に合わせる） */
const FLOW_STYLE = [
  {
    selector: "node",
    style: {
      "font-family": GRAPH_FONT_FAMILY,
      "font-size": 11,
      color: GRAPH_LABEL_COLOR,
      "text-wrap": "wrap",
      "min-zoomed-font-size": 6,
    },
  },
  {
    // 工程カード: 角丸 8・青の枠 1.5px・薄い青の面（step-node-card.tsx）
    selector: "node.flow-step",
    style: {
      shape: "round-rectangle",
      width: 176,
      height: 46,
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "text-max-width": "160px",
      "background-color": "data(bg)",
      "border-width": 1.5,
      "border-color": "data(main)",
      color: "data(text)",
      "font-weight": 600,
      "font-size": 12,
    },
  },
  {
    // 材料・装置・生成物: ラベル色の枠と淡い面（entity-flow-node.tsx の帯の色）
    selector: "node.flow-entity",
    style: {
      shape: "round-rectangle",
      width: 132,
      height: 34,
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "text-max-width": "120px",
      "background-color": "data(bg)",
      "border-width": 1.5,
      "border-color": "data(main)",
      color: "data(text)",
      "font-size": 10.5,
    },
  },
  {
    selector: "edge.flow-io, edge.flow-order",
    style: { width: 1.4, "line-color": "#b9c3b6", "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": "#b9c3b6", "arrow-scale": 0.8 },
  },
  { selector: "edge.flow-order", style: { "line-style": "dashed" } },
  {
    // 来歴: 全体グラフと同じ色・形のノードに題名を添える
    selector: "node.lin",
    style: {
      shape: "data(shape)",
      width: 22,
      height: 22,
      "background-color": "data(fill)",
      "border-width": 1.5,
      "border-color": "data(border)",
      label: "data(label)",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "text-max-width": "150px",
    },
  },
  { selector: "node.lin.focus", style: { width: 30, height: 30, "border-width": 3, "border-color": GRAPH_ACCENT_COLOR, "font-weight": 600 } },
  { selector: "edge.lin", style: { width: 1.4, "line-color": REL_COLOR.derived, "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": REL_COLOR.derived, "arrow-scale": 0.8, opacity: 0.8 } },
  { selector: "edge.lin.knowledge", style: { "line-color": "#9b6dcc", "target-arrow-color": "#9b6dcc" } },
  { selector: "edge.lin.connection", style: { "line-style": "dashed", "line-color": REL_COLOR.reference, "target-arrow-shape": "none" } },
  { selector: "node:selected", style: { "border-width": 3, "border-color": GRAPH_ACCENT_COLOR } },
] as unknown as cytoscape.StylesheetJson;

function layoutOf(p: GraphPayload): cytoscape.LayoutOptions {
  if (p.mode === "knowledge") {
    // アプリの全体グラフ（配置: 標準）と同じ fcose。大きなグラフでは配置のアニメーションを切る
    return {
      name: "fcose",
      quality: "default",
      randomize: true,
      animate: p.nodes.length <= LAYOUT_ANIMATION_MAX_NODES,
      animationDuration: 700,
      packComponents: true,
    } as cytoscape.LayoutOptions;
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
  // 手順の流れ: 線の向きに沿った最長経路で段を決め、上から下へ並べる（アプリの工程グラフと同じ向き。flow-layout.ts）
  const pos = flowPositions(p.nodes, p.edges, { x: 196, y: 84 });
  return { name: "preset", positions: (node: cytoscape.NodeSingular) => pos.get(node.id()) ?? { x: 0, y: 0 }, animate: false } as cytoscape.LayoutOptions;
}

function legendItems(p: GraphPayload): [string, string, string][] {
  if (p.mode === "flow") {
    return [
      ["step", FLOW_BG.step, KIND_PALETTE.activity.main],
      ["material", FLOW_BG.material, KIND_PALETTE.material.main],
      ["tool", FLOW_BG.tool, KIND_PALETTE.tool.main],
      ["output", FLOW_BG.output, KIND_PALETTE.output.main],
    ];
  }
  if (p.mode === "lineage") {
    return [
      ["note", kindFill("note"), kindBorder("note")],
      ["knowledge", kindFill("topic"), kindBorder("topic")],
      ["source", kindFill("external"), kindBorder("external")],
    ];
  }
  return [
    ["read", READ_FILL, READ_BORDER],
    ["wrote", USED_FILL, USED_FILL],
    ["walked", "#2f6b3a", "#2f6b3a"],
  ];
}

/** 会話の中に置くときの枠の高さ。手順の流れは上から下に伸びるので、段の数に合わせて高くする */
function inlineHeight(p: GraphPayload): number {
  if (p.mode !== "flow") return 460;
  const ranks = new Set([...flowPositions(p.nodes, p.edges, { x: 196, y: 84 }).values()].map((v) => v.y)).size;
  return Math.max(320, Math.min(760, ranks * 84 + 90));
}

function displayModes(): string[] {
  return (hostCtx?.availableDisplayModes as string[] | undefined) ?? [];
}

function render(p: GraphPayload): void {
  stopPolling();
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
  fit.onclick = () => fitCapped();
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
  canvas.style.height = mode === "inline" ? `${inlineHeight(p)}px` : "calc(100vh - 120px)";
  canvas.style.background = GRAPH_BG_COLOR;
  const legend = el("div", "legend");
  for (const [key, fill, border] of legendItems(p)) {
    const item = el("span", "legend-item");
    const dot = el("span", key === "walked" ? "bar" : "dot");
    dot.style.background = fill;
    dot.style.borderColor = border;
    item.append(dot, document.createTextNode(tr(key)));
    legend.append(item);
  }
  const info = el("div", "info muted", tr("hint"));
  card.append(header, canvas, legend, info);
  root.replaceChildren(card);

  const knowledge = p.mode === "knowledge";
  cy = cytoscape({
    container: canvas,
    elements: knowledge ? knowledgeElements(p) : p.mode === "flow" ? flowElements(p) : lineageElements(p),
    style: knowledge ? (globalGraphStyle as unknown as cytoscape.StylesheetJson) : FLOW_STYLE,
    layout: layoutOf(p),
    minZoom: 0.05,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });
  fitCapped();
  if (knowledge) {
    // アプリと同じく、ズームが止まったら見た目の倍率（大きさ・文字・線の太さ）を合わせる
    const c = cy;
    let timer: ReturnType<typeof setTimeout> | null = null;
    c.on("zoom", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!c.destroyed()) applyZoomStyle(c);
      }, 120);
    });
    applyZoomStyle(c);
    applyMarks();
  }
  cy.on("tap", "node", (evt) => {
    const n = evt.target as cytoscape.NodeSingular;
    info.textContent = `${n.data("fullLabel") ?? n.id()}  —  ${n.id()}`;
  });
  if (p.live) startPolling();
}

/** 全体を表示する。ノードが少ないと拡大しすぎて文字が巨大になるので、倍率に上限を付ける */
const FIT_MAX_ZOOM = 1.2;
function fitCapped(): void {
  if (!cy) return;
  cy.fit(undefined, 24);
  if (cy.zoom() > FIT_MAX_ZOOM) {
    cy.zoom(FIT_MAX_ZOOM);
    cy.center();
  }
}

// ── 触れたものの印（アプリの applyUsageMarks と同じ決まり） ─────────

function applyMarks(): void {
  const c = cy;
  if (!c || current?.mode !== "knowledge") return;
  const isTouched = (id: string) => touched.read.has(id) || touched.wrote.has(id);
  c.batch(() => {
    c.elements(".ai-read, .ai-used, .ai-link, .ai-walked, .label-muted").removeClass("ai-read ai-used ai-link ai-walked label-muted");
    c.nodes("[act > 0]").removeData("act");
    c.nodes().forEach((n) => {
      const id = n.id();
      // 書いた（作った・書き直した）ページは、アプリの「使った」と同じ濃い緑で大きく描く
      if (touched.wrote.has(id)) {
        n.data("act", 1);
        n.addClass("ai-used");
      } else if (touched.read.has(id)) n.addClass("ai-read");
      // 触れていないページの題名は隠す（マウスを乗せる・選ぶと出る）
      else n.addClass("label-muted");
      // 触れたページは範囲の外でも薄くしない
      if (isTouched(id)) n.removeClass("scope-out");
    });
    const relays = evidenceRelays(
      c.nodes().map((n) => n.id()),
      (id) => c.getElementById(id).neighborhood("node").map((m) => m.id()),
      isTouched,
    );
    for (const id of relays) c.getElementById(id).removeClass("label-muted scope-out");
    const walkedKeys = new Set(touched.walked.map(([a, b]) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)));
    c.edges().forEach((e) => {
      const s = e.source().id();
      const t = e.target().id();
      if (isEvidenceLink(s, t, isTouched, relays)) e.addClass("ai-link");
      if (walkedKeys.has(s < t ? `${s}\u0000${t}` : `${t}\u0000${s}`)) e.addClass("ai-walked");
    });
  });
  // 大きさは画面上の最小の直径で決まる（ズームの倍率を読み直す）
  (c.nodes(".ai-read, .ai-used") as unknown as { updateStyle: () => void }).updateStyle();
}

type ActivityEvent = { kind: "read" | "seen" | "walk" | "wrote"; id: string; from?: string; at?: string };

function applyEvents(events: ActivityEvent[]): void {
  const fresh = new Map<string, number>();
  for (const e of events) {
    // 検索に出ただけ（seen）はアプリのチャットの横でも印を付けないので、ここでも付けない
    if (e.kind === "read") {
      if (!touched.read.has(e.id)) fresh.set(e.id, 1);
      touched.read.add(e.id);
    } else if (e.kind === "wrote") {
      if (!touched.wrote.has(e.id)) fresh.set(e.id, 1);
      touched.wrote.add(e.id);
    } else if (e.kind === "walk" && e.from) {
      touched.walked.push([e.from, e.id]);
    }
  }
  if (events.length === 0) return;
  applyMarks();
  // 新しく触れたページを、その瞬間に一度だけ光らせる（アプリの読んでいる途中の pulse と同じ）
  if (cy && fresh.size > 0 && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    startGraphFiring(cy, fresh, Math.random, "pulse");
  }
}

async function poll(): Promise<void> {
  try {
    const res = await app.callServerTool({ name: "graph_activity", arguments: { since: cursor, notBefore } });
    const sc = res.structuredContent as { events?: ActivityEvent[]; cursor?: number } | undefined;
    if (sc?.events?.length) applyEvents(sc.events);
    if (typeof sc?.cursor === "number") cursor = sc.cursor;
  } catch {
    // 一時的に届かなくても止めない（次の回でまた聞く）
  }
}

function startPolling(): void {
  stopPolling();
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

/** 失敗の理由を画面に出す（次に失敗したとき、どこで何が起きたかをその場で分かるように） */
function renderFailure(reason: string, detail?: string): void {
  const box = el("div", "card");
  const head = el("header");
  head.append(el("div", "title", TEXT[lang].failed), el("div", "meta", reason));
  box.append(head);
  if (detail) {
    const d = el("details", "info");
    d.append(el("summary", "muted", TEXT[lang].failDetail));
    const pre = el("pre");
    pre.textContent = detail.slice(0, 2000);
    d.append(pre);
    box.append(d);
  }
  root.replaceChildren(box);
}

/** 結果の文（content の text）をまとめる。失敗の詳しいところに出す */
function resultText(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : [];
  return content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
}

/** 結果の参照（道具と引数）から、graph_payload でデータを取りに行って描く */
async function loadFromRef(ref: Record<string, unknown>): Promise<void> {
  try {
    const res = await app.callServerTool({ name: "graph_payload", arguments: ref });
    const payload = (res.structuredContent as { payload?: unknown } | undefined)?.payload;
    if (!res.isError && isPayload(payload)) {
      current = payload;
      render(payload);
      return;
    }
    renderFailure(TEXT[lang].failFetch, resultText(res) || JSON.stringify(Object.keys(res)));
  } catch (e) {
    renderFailure(TEXT[lang].failFetch, e instanceof Error ? e.message : String(e));
  }
}

function applyContext(ctx: McpUiHostContext | undefined): void {
  if (ctx) hostCtx = { ...hostCtx, ...ctx };
  if (hostCtx?.locale) lang = hostCtx.locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

renderMessage(TEXT[lang].loading);

const app = new App({ name: "Graphium graph", version: "1.0.0" });

app.ontoolresult = (result) => {
  const sc = result.structuredContent as Record<string, unknown> | undefined;
  const ref = sc?.graphiumGraph;
  if (ref && typeof ref === "object") {
    void loadFromRef(ref as Record<string, unknown>);
    return;
  }
  // v0.134〜v0.150 のサーバーは、データそのものを _meta に載せていた
  const legacy = (result._meta as Record<string, unknown> | undefined)?.["graphium/graph"];
  if (isPayload(legacy)) {
    current = legacy;
    render(legacy);
    return;
  }
  // 参照が無い結果（ノートが見つからない・手順が無い など）は、道具の返事の文をそのまま見せる
  const keys = [
    `content: ${Array.isArray(result.content) ? result.content.length : "none"}`,
    `structuredContent: ${sc ? Object.keys(sc).join(", ") || "{}" : "none"}`,
    `_meta: ${result._meta ? Object.keys(result._meta).join(", ") || "{}" : "none"}`,
  ].join(" / ");
  renderFailure(resultText(result) || TEXT[lang].failNoRef, keys);
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
  .catch((e) => renderFailure(TEXT[lang].failConnect, e instanceof Error ? e.message : String(e)));
