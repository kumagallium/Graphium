// 来歴スタックビューの Storybook。データは builder を通さず LineageStackModel を
// 直接組み立てて渡す（アプリへの組み込みは合意後）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "../../i18n";
import "../../app.css";
import { LineageStackView } from "./lineage-stack-view";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";

const meta: Meta = {
  title: "Graph/LineageStack",
  parameters: { layout: "fullscreen" },
};
meta.decorators = [
  (Story) => (
    <LocaleProvider>
      <div style={{ height: "100vh", padding: 16, overflow: "auto" }}>
        <Story />
      </div>
    </LocaleProvider>
  ),
];
export default meta;

type Story = StoryObj<typeof LineageStackView>;

/** 省略可能なフィールドを埋めてノードを作る */
function node(n: Partial<StackNode> & Pick<StackNode, "id" | "title" | "kind">): StackNode {
  return { groups: [], links: [], ...n };
}

function toNodes(list: StackNode[]): Record<string, StackNode> {
  return Object.fromEntries(list.map((n) => [n.id, n]));
}

// ── 1. 手順ノート（PROV あり） ──

const PROC_MODEL: LineageStackModel = {
  rootId: "plan",
  initialPath: ["plan", "bake1"],
  nodes: toNodes([
    node({
      id: "plan",
      title: "春のカンパーニュ試作",
      kind: "proc",
      steps: [{ name: "配合を決める" }, { name: "材料手配" }],
      groups: [
        { key: "dough", label: "#生地", children: ["doughA", "doughB"] },
        { key: "bake", label: "#焼成", children: ["bake1", "bake2"] },
        { key: "taste", label: "#試食", children: ["taste"] },
      ],
      links: [
        { from: "doughA", to: "bake1" },
        { from: "doughA", to: "bake2" },
        { from: "doughB", to: "bake1" },
        { from: "doughB", to: "bake2" },
        { from: "bake1", to: "taste" },
        { from: "bake2", to: "taste" },
      ],
    }),
    node({
      id: "doughA",
      title: "仕込み A（加水 65%）",
      kind: "proc",
      steps: [{ name: "こねる" }, { name: "一次発酵" }, { name: "分割" }],
      outputs: ["生地 A", "発酵ログ.csv"],
      groups: [{ key: "repro", label: "#再現", children: ["doughA2"] }],
    }),
    node({
      id: "doughA2",
      title: "仕込み A（再現）",
      kind: "proc",
      steps: [{ name: "こねる" }, { name: "分割" }, { name: "二次発酵" }],
      outputs: ["生地 A'"],
    }),
    node({
      id: "doughB",
      title: "仕込み B（加水 72%）",
      kind: "proc",
      steps: [{ name: "こねる" }, { name: "一次発酵" }],
      outputs: ["生地 B"],
    }),
    node({
      id: "bake1",
      title: "焼成 1 回目",
      kind: "proc",
      isCurrent: true,
      steps: [
        { name: "成形", inputFrom: "仕込み A の生地 A" },
        { name: "二次発酵" },
        { name: "焼く", inputFrom: "仕込み B の生地 B" },
      ],
      outputs: ["パン 1"],
    }),
    node({
      id: "bake2",
      title: "焼成 2 回目",
      kind: "proc",
      steps: [
        { name: "成形", inputFrom: "仕込み A の生地 A" },
        { name: "二次発酵" },
        { name: "焼く", inputFrom: "仕込み B の生地 B" },
      ],
      outputs: ["パン 2"],
    }),
    node({
      id: "taste",
      title: "試食",
      kind: "proc",
      steps: [{ name: "食べ比べ", inputFrom: "パン 1 / パン 2" }],
      outputs: ["評価.csv"],
    }),
  ]),
};

export const ProcNotes: Story = {
  name: "手順ノート（PROV あり）",
  render: () => <LineageStackView model={PROC_MODEL} onOpenNote={(id) => console.log("open", id)} />,
};

// ── 2. 知識ノート（出典が複数） ──

const KNOWLEDGE_MODEL: LineageStackModel = {
  rootId: "src",
  initialPath: ["src", "k1", "t1"],
  nodes: toNodes([
    node({
      id: "src",
      title: "出典（起点・複数）",
      kind: "root",
      groups: [
        { key: "asset", label: "資料", children: ["pdf", "url"] },
        { key: "note", label: "ノート", children: ["bake1"] },
      ],
    }),
    node({
      id: "pdf",
      title: "製パン教本.pdf",
      kind: "asset",
      body: "開ける素材。ここより上流はない。",
      groups: [{ key: "claims", label: "知見", children: ["k1", "k2"] }],
    }),
    node({
      id: "url",
      title: "発酵のウェブ記事",
      kind: "asset",
      body: "開ける素材。ここより上流はない。",
      groups: [{ key: "claims", label: "知見", children: ["k2"] }],
    }),
    node({
      id: "bake1",
      title: "焼成 1 回目",
      kind: "proc",
      steps: [{ name: "成形" }, { name: "焼く" }],
      outputs: ["パン 1"],
      groups: [{ key: "claims", label: "知見", children: ["k3"] }],
    }),
    node({
      id: "k1",
      title: "二次発酵は 28℃ 前後",
      kind: "knowledge",
      body: "二次発酵は 28℃ 前後で安定して膨らむ。低すぎると時間がかかり、高すぎると生地がだれる。",
      sources: ["製パン教本.pdf"],
      groups: [{ key: "topic", label: "話題", children: ["t1"] }],
    }),
    node({
      id: "k2",
      title: "加水 70% 以上は成形が難しい",
      kind: "knowledge",
      body: "加水が 70% を超えると生地がべたつき、成形で形を保ちにくい。",
      sources: ["製パン教本.pdf", "発酵のウェブ記事"],
      groups: [{ key: "topic", label: "話題", children: ["t1"] }],
    }),
    node({
      id: "k3",
      title: "焼成 1 回目は底が焦げた",
      kind: "knowledge",
      body: "天板の位置が低く、底面だけ先に色づいた。",
      sources: ["焼成 1 回目"],
      groups: [{ key: "topic", label: "話題", children: ["t1"] }],
    }),
    node({
      id: "t1",
      title: "焼成前の生地の状態",
      kind: "knowledge",
      isCurrent: true,
      body: "焼成前の生地は、発酵の温度と加水で扱いやすさが変わる。底の焦げ方にも天板の位置が効く。",
      sources: ["二次発酵は 28℃ 前後", "加水 70% 以上は成形が難しい", "焼成 1 回目は底が焦げた"],
    }),
  ]),
};

export const KnowledgeNotes: Story = {
  name: "知識ノート（出典が複数）",
  render: () => <LineageStackView model={KNOWLEDGE_MODEL} onOpenNote={(id) => console.log("open", id)} />,
};

// ── 3. 本文だけ・計画なし ──

const TEXT_MODEL: LineageStackModel = {
  rootId: "memo",
  initialPath: ["memo", "n1"],
  nodes: toNodes([
    node({
      id: "memo",
      title: "打合せメモ 10/20",
      kind: "text",
      body: "焼成のやり直しを決めた。次回は天板の位置を変えて、底の焦げを確かめる。",
      groups: [
        { key: "decided", label: "#決めたこと", children: ["n1"] },
        { key: "whole", label: "ノート全体から", children: ["n2"] },
      ],
    }),
    node({
      id: "n1",
      title: "焼成やり直し計画",
      kind: "text",
      isCurrent: true,
      body: "手順はまだ書いていない。箇条書きのメモだけ。",
    }),
    node({
      id: "n2",
      title: "打合せメモ 10/20 のコピー",
      kind: "text",
      body: "ノート全体から複製したので、派生元の見出しが無い。",
    }),
  ]),
};

export const TextOnly: Story = {
  name: "本文だけ・計画なし",
  render: () => <LineageStackView model={TEXT_MODEL} onOpenNote={(id) => console.log("open", id)} />,
};
