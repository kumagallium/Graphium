// 手順フロービュー（React Flow 版ノードエディタ）のストーリー
//
// デザイン合意はカード単体（Card* ストーリー）で行い、操作の確認は
// Playground で行う（接続・追加・リネーム・削除・循環拒否まで動く）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { StepFlowView } from "./step-flow-view";
import type { ActivityNode, StepEdge } from "./activity-graph-adapter";
import { LocaleProvider } from "../../i18n";

const meta: Meta = {
  title: "Organisms/StepFlow",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ height: "100vh", padding: 16, boxSizing: "border-box", background: "#f5f8f5" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

// ── モックデータ（材料合成の手順）──

const RICH_ACTIVITIES: ActivityNode[] = [
  {
    id: "s-mix",
    name: "混合",
    inputs: [
      { label: "Cu粉末", kind: "material" },
      { label: "Zn粉末", kind: "material" },
      { label: "乳鉢", kind: "tool" },
    ],
    outputs: [{ label: "混合粉", kind: "output" }],
    params: ["比率: 7:3"],
  },
  {
    id: "s-press",
    name: "成形",
    inputs: [{ label: "プレス機", kind: "tool" }],
    outputs: [],
    params: ["圧力: 20MPa"],
  },
  {
    id: "s-fire",
    name: "焼成",
    inputs: [],
    outputs: [{ label: "焼結体", kind: "output" }],
    params: ["温度: 900C", "時間: 2h", "雰囲気: Ar"],
  },
  { id: "s-eval", name: "評価", inputs: [{ label: "XRD", kind: "tool" }], outputs: [], params: [] },
];

const RICH_STEPS: StepEdge[] = [
  { id: "step-s-mix->s-press", from: "s-mix", to: "s-press", deletable: true },
  { id: "step-s-press->s-fire", from: "s-press", to: "s-fire", deletable: true },
];

// ── カード単体（デザイン確認用）──

export const CardMinimal: Story = {
  name: "Card / 空の手順",
  render: () => (
    <StepFlowView
      activities={[{ id: "c1", name: "焼成", inputs: [], outputs: [], params: [] }]}
      steps={[]}
    />
  ),
};

export const CardFull: Story = {
  name: "Card / 入出力・パラメータ入り",
  render: () => (
    <StepFlowView
      activities={[RICH_ACTIVITIES[0]]}
      steps={[]}
      onRenameActivity={() => {}}
      onDeleteActivity={() => {}}
      onJumpToBlock={() => {}}
      getStepContentCount={() => 3}
    />
  ),
};

// ── フル操作デモ ──

function Playground() {
  const [activities, setActivities] = useState<ActivityNode[]>(RICH_ACTIVITIES);
  const [steps, setSteps] = useState<StepEdge[]>(RICH_STEPS);
  const counter = useRef(0);

  // 簡易循環判定（producer → consumer を足すと consumer から producer へ辿れるか）
  const wouldCycle = (producer: string, consumer: string): boolean => {
    const adj = new Map<string, string[]>();
    for (const s of steps) adj.set(s.from, [...(adj.get(s.from) ?? []), s.to]);
    const stack = [consumer];
    const visited = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === producer) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      stack.push(...(adj.get(cur) ?? []));
    }
    return false;
  };

  return (
    <StepFlowView
      activities={activities}
      steps={steps}
      onConnectSteps={(producer, consumer) => {
        if (wouldCycle(producer, consumer)) return { error: "cycle_detected" };
        setSteps((prev) =>
          prev.some((s) => s.from === producer && s.to === consumer)
            ? prev
            : [...prev, { id: `step-${producer}->${consumer}`, from: producer, to: consumer, deletable: true }],
        );
        return { error: null };
      }}
      onRemoveStep={(id) => setSteps((prev) => prev.filter((s) => s.id !== id))}
      onAddActivity={() => {
        counter.current += 1;
        const id = `new-${counter.current}`;
        setActivities((prev) => [
          ...prev,
          { id, name: `ステップ ${prev.length + 1}`, inputs: [], outputs: [], params: [] },
        ]);
      }}
      onRenameActivity={(blockId, title) =>
        setActivities((prev) => prev.map((a) => (a.id === blockId ? { ...a, name: title } : a)))
      }
      onDeleteActivity={(blockId) => {
        setActivities((prev) => prev.filter((a) => a.id !== blockId));
        setSteps((prev) => prev.filter((s) => s.from !== blockId && s.to !== blockId));
      }}
      onJumpToBlock={(blockId) => console.log("jump to", blockId)}
      getStepContentCount={(blockId) => (blockId === "s-mix" ? 2 : 0)}
    />
  );
}

export const InteractivePlayground: Story = {
  name: "Playground / 全操作",
  render: () => <Playground />,
};

export const EmptyState: Story = {
  name: "空状態（手順ゼロの入口）",
  render: () => (
    <StepFlowView activities={[]} steps={[]} onAddActivity={() => console.log("add")} />
  ),
};
