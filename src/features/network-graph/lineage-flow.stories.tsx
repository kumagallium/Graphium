// 系譜（来歴の図）の Storybook。stack モデルと段ごとの図を手で組んで渡す（パン作り）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "../../i18n";
import "../../app.css";
import type { FlowEdge, FlowEntity, FlowGraphData, FlowGroup, FlowNoteRef, FlowStep } from "./activity-graph-adapter";
import { LineageFlowView } from "./lineage-flow-view";
import type { LevelFlow } from "./lineage-flow-builder";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";

const meta: Meta = {
  title: "Graph/LineageFlow",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ width: 420, minHeight: "100vh", padding: 16, boxSizing: "border-box" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof LineageFlowView>;

const ref = (noteId: string, tableBlockId: string, rowIndex: number): FlowNoteRef => ({ noteId, tableBlockId, rowIndex });

function node(n: Partial<StackNode> & Pick<StackNode, "id" | "title" | "kind">): StackNode {
  return { groups: [], links: [], open: { type: "note", navId: n.id }, ...n };
}

const planGraph: FlowGraphData = {
  steps: [
    { id: "note:doughA", name: "生地 A（加水 65%）", params: [], noteRef: ref("doughA", "tbl-dough", 0), group: { id: "tbl-dough", label: "生地", index: 0 } },
    { id: "note:bake1", name: "焼き 001", params: [], noteRef: ref("bake1", "tbl-bake", 0), group: { id: "tbl-bake", label: "焼成", index: 1 } },
    { id: "note:taste", name: "試食まとめ", params: [], noteRef: ref("taste", "tbl-eval", 0), group: { id: "tbl-eval", label: "評価", index: 2 } },
  ],
  entities: [],
  edges: [
    { id: "e1", kind: "used", source: "note:doughA", target: "note:bake1", plan: "asPlanned", userLabel: "生地" },
    { id: "e2", kind: "planned", source: "note:bake1", target: "note:taste", userLabel: "パン" },
  ],
};

const noteGraph: FlowGraphData = {
  steps: [
    { id: "s-weigh", name: "計量", params: [] },
    { id: "s-knead", name: "こねる", params: [] },
    { id: "s-ferment", name: "一次発酵", params: [] },
  ],
  entities: [
    { id: "m-flour", label: "強力粉", kind: "material", attrs: [] },
    { id: "o-dough", label: "生地 A", kind: "output", attrs: [] },
  ],
  edges: [
    { id: "u1", kind: "used", source: "m-flour", target: "s-weigh" },
    { id: "o1", kind: "orderOnly", source: "s-weigh", target: "s-knead" },
    { id: "o2", kind: "orderOnly", source: "s-knead", target: "s-ferment" },
    { id: "g1", kind: "generates", source: "s-ferment", target: "o-dough" },
  ],
};

const FINDINGS = [
  "加水率が高いほど気泡が大きくなる", "強力粉は吸水が遅い", "一次発酵は 28 度で 60 分が目安", "ライ麦を足すと酸味が増す",
  "オートリーズで生地が伸びやすくなる", "塩は発酵を抑える", "折り返しの回数で層が変わる", "焼成前の霧吹きでクープが開く",
  "モルトを足すと焼き色が濃くなる", "冷蔵発酵で香りが深まる", "捏ね上げ温度は 26 度前後", "天板を予熱すると底が締まる",
  "スチームの量で皮の厚みが変わる", "全粒粉は水を多めに吸う", "ホイロの湿度は 75% 前後", "ドライイーストは少量で足りる",
  "ベンチタイムを長くすると成形が楽", "クープの深さで膨らみが変わる", "砂糖は焼き色を助ける", "バターは後入れが扱いやすい",
  "粉の保管は涼しい場所", "イーストの量と発酵時間は反比例", "生地温度が高いと発酵が速い", "成形のとじ目は下にする",
  "焼成温度は 230 度から始める", "粗熱は網の上で取る", "水温で捏ね上げ温度を調整する", "ルヴァン種は継ぎ足して育てる",
  "パンチは発酵の途中で入れる", "焼き上がりは底を叩いて確かめる",
];

const flows: Record<string, LevelFlow> = {
  plan: { kind: "plan", graph: planGraph, layoutScope: "plan:story-plan" },
  doughA: { kind: "note", graph: noteGraph, layoutScope: "prov:story-doughA" },
  // 知識の段: 子を帯に並べるだけの図。配置は保存しない（layoutScope は null）
  know: {
    kind: "children",
    layoutScope: null,
    graph: {
      steps: [
        { id: "note:plan", name: "春のカンパーニュ試作", params: [], noteRef: ref("plan", "lineage", 0), group: { id: "lineage-box:notes", label: "ノート", index: 100 } },
        { id: "note:memo", name: "加水率の試食メモ", params: [], noteRef: ref("memo", "lineage", 1), group: { id: "lineage-box:notes", label: "ノート", index: 100 } },
      ],
      entities: [],
      edges: [],
    },
  },
};

/** 資料の段: 子の知見が 30 件あるが、子どうしに線が無い（図にせず札の折り返しにする） */
const assetFlow: LevelFlow = {
  kind: "children",
  layoutScope: null,
  graph: {
    steps: FINDINGS.map((title, i) => ({
      id: `note:f${i}`,
      name: title,
      params: [],
      noteRef: ref(`f${i}`, "lineage", i),
      group: { id: "lineage-box:wiki", label: "知見", index: 100 },
    })),
    entities: [],
    edges: [],
  },
};

/** 計画 → 生地 A の手順 */
const planThenNote: LineageStackModel = {
  rootId: "plan",
  initialPath: ["plan", "doughA"],
  nodes: {
    plan: node({ id: "plan", title: "春のカンパーニュ試作", kind: "plan", groups: [{ key: "notes", label: "ノート", children: ["doughA", "bake1"] }] }),
    doughA: node({ id: "doughA", title: "生地 A（加水 65%）", kind: "proc", isCurrent: true }),
    bake1: node({ id: "bake1", title: "焼き 001", kind: "text" }),
  },
};

/** 起点が知識（図にならない段）→ 計画 */
const withKnowledge: LineageStackModel = {
  rootId: "know",
  initialPath: ["know", "plan"],
  nodes: {
    know: node({
      id: "know",
      title: "加水率が高いほど気泡が大きくなる",
      kind: "knowledge",
      body: "加水 72% の生地は 65% より気泡が大きかった。",
      groups: [{ key: "notes", label: "ノート", children: ["plan"] }],
      open: { type: "note", navId: "wiki:know" },
    }),
    plan: node({ id: "plan", title: "春のカンパーニュ試作", kind: "plan", isCurrent: true }),
  },
};

export const PlanThenNote: Story = {
  name: "計画 → ノート",
  render: () => (
    <LineageFlowView stack={planThenNote} getLevelFlow={(id) => flows[id] ?? { kind: "none" }} onOpen={() => {}} />
  ),
};

export const WithNoneLevel: Story = {
  name: "知識の段も図になる（配置は保存しない）",
  render: () => (
    <LineageFlowView stack={withKnowledge} getLevelFlow={(id) => flows[id] ?? { kind: "none" }} onOpen={() => {}} />
  ),
};

/** 資料の段（知見 30 件）→ 知見 1 件 */
const assetStack: LineageStackModel = {
  rootId: "asset",
  initialPath: ["asset", "f3"],
  nodes: {
    asset: node({
      id: "asset",
      title: "パンの教科書.docx",
      kind: "asset",
      groups: [{ key: "wiki", label: "知見", children: FINDINGS.map((_, i) => `f${i}`) }],
    }),
    ...Object.fromEntries(FINDINGS.map((title, i) => [`f${i}`, node({ id: `f${i}`, title, kind: "knowledge", isCurrent: i === 3 })])),
  },
};

export const NoEdgeLevelAsCards: Story = {
  name: "線の無い段（資料から知見が 30 件）は札の折り返し",
  render: () => (
    <LineageFlowView
      stack={assetStack}
      getLevelFlow={(id) => (id === "asset" ? assetFlow : { kind: "none" })}
      onOpen={() => {}}
    />
  ),
};

// ── 計画 → 手順の全体（全工程の手順の図を帯につなげる） ──

type ProcBand = { key: string; label: string; steps: string[]; materials?: string[]; output: string };
const PROC_BANDS: ProcBand[] = [
  { key: "doughA", label: "生地 A", steps: ["計量", "こねる", "一次発酵"], materials: ["強力粉", "水"], output: "生地 A" },
  { key: "doughB", label: "生地 B", steps: ["計量", "こねる"], materials: ["強力粉", "水"], output: "生地 B" },
  { key: "bake1", label: "焼き 001", steps: ["成形", "焼く"], output: "パン 1" },
  { key: "bake2", label: "焼き 002", steps: ["成形", "焼く"], output: "パン 2" },
  { key: "taste", label: "試食まとめ", steps: ["食べ比べ"], output: "評価.csv" },
];

function procedureGraph(focusKey: string): FlowGraphData {
  const steps: FlowStep[] = [];
  const entities: FlowEntity[] = [];
  const edges: FlowEdge[] = [];
  PROC_BANDS.forEach((b, index) => {
    const group: FlowGroup = { id: b.key, label: b.label, index, ...(b.key === focusKey ? { highlight: "focus" as const } : {}) };
    b.steps.forEach((name, i) => {
      steps.push({ id: `${b.key}::s${i}`, name, params: [], group });
      if (i > 0) edges.push({ id: `${b.key}::n${i}`, kind: "orderOnly", source: `${b.key}::s${i - 1}`, target: `${b.key}::s${i}` });
    });
    (b.materials ?? []).forEach((label, i) => {
      entities.push({ id: `${b.key}::m${i}`, label, kind: "material", attrs: [], group });
      edges.push({ id: `${b.key}::u${i}`, kind: "used", source: `${b.key}::m${i}`, target: `${b.key}::s0` });
    });
    entities.push({ id: `${b.key}::out`, label: b.output, kind: "output", attrs: [], group });
    edges.push({ id: `${b.key}::g`, kind: "generates", source: `${b.key}::s${b.steps.length - 1}`, target: `${b.key}::out` });
  });
  // 実際の受け渡し（出力 → 別の工程の最初の手順）
  const handovers: [string, string][] = [["doughA", "bake1"], ["doughB", "bake2"], ["bake1", "taste"]];
  handovers.forEach(([from, to], i) => {
    edges.push({ id: `x${i}`, kind: "used", source: `${from}::out`, target: `${to}::s0` });
  });
  // 予定の線（受け渡しがまだ無い組）
  edges.push({ id: "p0", kind: "planned", source: "bake2::s1", target: "taste::s0", userLabel: "パン" });
  // 手順から派生したノート 1 つ
  const doughA = PROC_BANDS[0];
  steps.push({
    id: "doughA::note:rye",
    name: "ライ麦の生地",
    params: [],
    noteRef: ref("rye", "lineage", 0),
    group: { id: doughA.key, label: doughA.label, index: 0 },
  });
  edges.push({ id: "d0", kind: "derived", source: "doughA::s1", target: "doughA::note:rye" });
  return { steps, entities, edges };
}

const procedureStack: LineageStackModel = {
  rootId: "plan",
  initialPath: ["plan", "bake1"],
  nodes: {
    plan: node({ id: "plan", title: "春のカンパーニュ試作", kind: "plan", groups: [{ key: "notes", label: "ノート", children: ["doughA", "bake1"] }] }),
    bake1: node({ id: "bake1", title: "焼き 001", kind: "proc", isCurrent: true }),
  },
};

const procedureFlow = (focusKey: string): LevelFlow => ({
  kind: "procedure",
  graph: procedureGraph(focusKey),
  layoutScope: "procedure:story-plan",
  operationIds: PROC_BANDS.map((b) => b.key),
});

export const PlanThenProcedure: Story = {
  name: "計画 → 手順の全体（5 工程・受け渡しと予定の線・派生ノート）",
  render: () => (
    <LineageFlowView
      stack={procedureStack}
      getLevelFlow={(id, prevId) => (prevId === "plan" ? procedureFlow(id) : (flows[id] ?? { kind: "none" }))}
      onOpen={() => {}}
    />
  ),
};
