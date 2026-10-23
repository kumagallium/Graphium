// 試作: 来歴の「段」を工程グラフと同じ見た目（StepFlowView）で描く
//
// 段の表示（札のリスト）が要望者のイメージと違った（v0.95.1 でツリーに戻した）ことを受けた案。
// 要望の 1 枚目の絵（起点の中に見出しの箱、箱の中にノート、ノート同士の線）は、計画ノートの
// 工程グラフ（表ごとの帯・予定の線・線の名前）とほぼ同じ形なので、段の各段を同じ部品で描く。
// 2 枚目の絵（ノートを開くと中身が手順の図）は、そのノートの手順フロー（ステップタブと同じ）。
//
// データは builder を通さず手で組む（パン作りの世界観）。合意が取れたら builder から
// FlowGraphData を作るようにする。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { GitBranch, Maximize2, Minimize2 } from "lucide-react";
import { StepFlowView } from "./step-flow-view";
import type { FlowGraphData, FlowNoteRef } from "./activity-graph-adapter";
import { LocaleProvider } from "../../i18n";

const meta: Meta = {
  title: "Proposal/来歴をフロー図で",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ minHeight: "100vh", padding: 16, boxSizing: "border-box", background: "#f5f8f5" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj;

// ── デモデータ ──

type DemoNode = {
  title: string;
  /** plan: 子ノートの工程グラフ / note: そのノートの手順フロー */
  kind: "plan" | "note";
  graph: FlowGraphData;
};

const ref = (noteId: string, tableBlockId: string, rowIndex: number): FlowNoteRef => ({ noteId, tableBlockId, rowIndex });

const NODES: Record<string, DemoNode> = {
  // 1 枚目の絵: 起点の計画。見出し（表）ごとの帯の中にノート、ノート同士に予定・実績の線
  plan: {
    title: "春のカンパーニュ試作",
    kind: "plan",
    graph: {
      steps: [
        { id: "note:doughA", name: "生地 A（加水 65%）", params: [], noteRef: ref("doughA", "tbl-dough", 0), group: { id: "tbl-dough", label: "生地", index: 0 } },
        { id: "note:doughB", name: "生地 B（加水 72%）", params: [], noteRef: ref("doughB", "tbl-dough", 1), group: { id: "tbl-dough", label: "生地", index: 0 } },
        { id: "note:bake1", name: "焼き 001", params: [], noteRef: ref("bake1", "tbl-bake", 0), group: { id: "tbl-bake", label: "焼成", index: 1 } },
        { id: "note:bake2", name: "焼き 002", params: [], noteRef: ref("bake2", "tbl-bake", 1), group: { id: "tbl-bake", label: "焼成", index: 1 } },
        { id: "note:taste", name: "試食まとめ", params: [], noteRef: ref("taste", "tbl-eval", 0), group: { id: "tbl-eval", label: "評価", index: 2 } },
      ],
      entities: [],
      edges: [
        { id: "e1", kind: "used", source: "note:doughA", target: "note:bake1", plan: "asPlanned", userLabel: "生地" },
        { id: "e2", kind: "used", source: "note:doughB", target: "note:bake2", plan: "asPlanned", userLabel: "生地" },
        { id: "e3", kind: "used", source: "note:doughA", target: "note:bake2", plan: "unplanned" },
        { id: "e4", kind: "used", source: "note:bake1", target: "note:taste", plan: "asPlanned", userLabel: "パン" },
        { id: "e5", kind: "planned", source: "note:bake2", target: "note:taste", userLabel: "パン" },
      ],
    },
  },
  // 2 枚目の絵: ノートを開くと、そのノートの手順の図。派生したノートは、派生元の手順から線で出る
  doughA: {
    title: "生地 A（加水 65%）",
    kind: "note",
    graph: {
      steps: [
        { id: "s-weigh", name: "計量", params: [] },
        { id: "s-knead", name: "こねる", params: [] },
        { id: "s-ferment", name: "一次発酵", params: [] },
        { id: "note:doughA2", name: "生地 A（再現）", params: [], noteRef: ref("doughA2", "derived", 0) },
      ],
      entities: [
        { id: "m-flour", label: "強力粉", kind: "material", attrs: [] },
        { id: "m-water", label: "水", kind: "material", attrs: [] },
        { id: "m-levain", label: "ルヴァン", kind: "material", attrs: [] },
        { id: "o-photo", label: "断面.jpg", kind: "output", attrs: [] },
        { id: "o-dough", label: "生地 A", kind: "output", attrs: [] },
      ],
      edges: [
        { id: "u1", kind: "used", source: "m-flour", target: "s-weigh" },
        { id: "u2", kind: "used", source: "m-water", target: "s-weigh" },
        { id: "o1", kind: "orderOnly", source: "s-weigh", target: "s-knead" },
        { id: "u3", kind: "used", source: "m-levain", target: "s-knead" },
        { id: "o2", kind: "orderOnly", source: "s-knead", target: "s-ferment" },
        { id: "g1", kind: "generates", source: "s-knead", target: "o-photo" },
        { id: "g2", kind: "generates", source: "s-ferment", target: "o-dough" },
        { id: "d1", kind: "derived", source: "s-ferment", target: "note:doughA2" },
      ],
    },
  },
  doughA2: {
    title: "生地 A（再現）",
    kind: "note",
    graph: {
      steps: [
        { id: "r-weigh", name: "計量", params: [] },
        { id: "r-knead", name: "こねる", params: [] },
        { id: "r-measure", name: "生地温度を測る", params: [] },
      ],
      entities: [
        { id: "rm-flour", label: "強力粉", kind: "material", attrs: [] },
        { id: "ro-temp", label: "温度.csv", kind: "output", attrs: [] },
      ],
      edges: [
        { id: "ru1", kind: "used", source: "rm-flour", target: "r-weigh" },
        { id: "ro1", kind: "orderOnly", source: "r-weigh", target: "r-knead" },
        { id: "ro2", kind: "orderOnly", source: "r-knead", target: "r-measure" },
        { id: "rg1", kind: "generates", source: "r-measure", target: "ro-temp" },
      ],
    },
  },
  bake1: {
    title: "焼き 001",
    kind: "note",
    graph: {
      steps: [
        { id: "b-shape", name: "成形", params: [] },
        { id: "b-bake", name: "焼く", params: [{ label: "温度: 240 ℃" }] },
      ],
      entities: [
        { id: "b-in", label: "生地 A", kind: "material", attrs: [] },
        { id: "b-out", label: "パン 1", kind: "output", attrs: [] },
      ],
      edges: [
        { id: "bu1", kind: "used", source: "b-in", target: "b-shape" },
        { id: "bo1", kind: "orderOnly", source: "b-shape", target: "b-bake" },
        { id: "bg1", kind: "generates", source: "b-bake", target: "b-out" },
      ],
    },
  },
};

// ── 試作の部品 ──

/** 工程グラフの凡例と同じ 3 種（preview は凡例を出さないので、ここで足す） */
function Legend() {
  const item = (color: string, dashed: boolean, label: string) => (
    <span className="inline-flex items-center gap-1">
      <svg width="22" height="6" aria-hidden="true">
        <line x1="1" y1="3" x2="21" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {item("#9aa0a6", true, "予定")}
      {item("#4B7A52", false, "計画どおり")}
      {item("#c98a2b", false, "計画外")}
    </div>
  );
}

function LineageFlowPrototype({ initialPath, defaultWide = false }: { initialPath: string[]; defaultWide?: boolean }) {
  const [path, setPath] = useState<string[]>(initialPath);
  const [wide, setWide] = useState(defaultWide);
  const width = wide ? 960 : 380;
  const levelHeight = wide ? 380 : 300;

  return (
    <div style={{ width }} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 transition-[width]">
      <div className="flex items-center gap-2 text-xs">
        <GitBranch size={14} className="shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {path.map((id, i) => (
            <span key={id} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="shrink-0 text-muted-foreground">›</span>}
              <button
                type="button"
                onClick={() => setPath(path.slice(0, i + 1))}
                className={`min-w-0 truncate ${i === path.length - 1 ? "text-foreground" : "text-muted-foreground hover:underline"}`}
              >
                {NODES[id].title}
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWide((w) => !w)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
        >
          {wide ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          {wide ? "右パネルの幅" : "全画面"}
        </button>
      </div>
      <Legend />

      {path.map((id, i) => {
        const node = NODES[id];
        const last = i === path.length - 1;
        const next = path[i + 1];
        return (
          <section key={id} className={`rounded-xl border border-border ${last ? "" : "opacity-60"}`}>
            <header className="flex items-start gap-2 border-b border-border px-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-medium line-clamp-2">{node.title}</span>
              {node.kind === "note" && last && (
                <span className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]" style={{ background: "#FAEEDA", color: "#633806" }}>
                  現在地
                </span>
              )}
            </header>
            <div style={{ height: levelHeight }}>
              <StepFlowView
                graph={node.graph}
                variant="preview"
                onOpenNoteRef={(r) => {
                  // 下に段を積む（ページ遷移しない）。中身の無いデモノートは何もしない
                  const target = r.noteId;
                  if (!target || !NODES[target]) return;
                  setPath([...path.slice(0, i + 1), target]);
                }}
              />
            </div>
            {next && (
              <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                ↓ {NODES[next].title} を開いています
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export const PlanThenNote: Story = {
  name: "計画 → ノートを開く（右パネルの幅）",
  render: () => <LineageFlowPrototype initialPath={["plan"]} />,
};

export const Opened: Story = {
  name: "生地 A まで開いた状態（全画面）",
  render: () => <LineageFlowPrototype initialPath={["plan", "doughA"]} defaultWide />,
};
