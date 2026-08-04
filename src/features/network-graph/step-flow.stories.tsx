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
      { label: "Cu粉末", kind: "material", entityId: "ent_material_cu" },
      { label: "Zn粉末", kind: "material", entityId: "ent_material_zn" },
      { label: "乳鉢", kind: "tool", entityId: "ent_tool_mortar" },
    ],
    outputs: [{ label: "混合粉", kind: "output", entityId: "ent_output_mix" }],
    params: [{ label: "比率: 7:3", entityId: "ent_attribute_ratio" }],
  },
  {
    id: "s-press",
    name: "成形",
    inputs: [{ label: "プレス機", kind: "tool", entityId: "ent_tool_press" }],
    outputs: [],
    params: [{ label: "圧力: 20MPa", entityId: "ent_attribute_pressure" }],
  },
  {
    id: "s-fire",
    name: "焼成",
    inputs: [],
    outputs: [{ label: "焼結体", kind: "output", entityId: "ent_output_sintered" }],
    params: [
      { label: "温度: 900C", entityId: "ent_attribute_temp" },
      { label: "時間: 2h", entityId: "ent_attribute_time" },
      { label: "雰囲気: Ar" }, // entityId 無し = 表示のみ（テーブル由来などの想定）
    ],
  },
  {
    id: "s-eval",
    name: "評価",
    inputs: [{ label: "XRD", kind: "tool", entityId: "ent_tool_xrd" }],
    outputs: [],
    params: [],
  },
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
      onAddEntity={(id, kind, text) => console.log("add", id, kind, text)}
      onRenameEntity={(entityId, text) => console.log("rename entity", entityId, text)}
      onRemoveEntity={(entityId) => console.log("remove entity", entityId)}
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
      onAddEntity={(blockId, kind, text) => {
        const entityId = `ent_${kind}_${Math.random().toString(36).slice(2, 8)}`;
        setActivities((prev) =>
          prev.map((a) => {
            if (a.id !== blockId) return a;
            if (kind === "attribute") {
              return { ...a, params: [...a.params, { label: text, entityId }] };
            }
            const io = { label: text, kind: kind as "material" | "tool" | "output", entityId };
            return kind === "output"
              ? { ...a, outputs: [...a.outputs, io] }
              : { ...a, inputs: [...a.inputs, io] };
          }),
        );
      }}
      onRenameEntity={(entityId, text) =>
        setActivities((prev) =>
          prev.map((a) => ({
            ...a,
            inputs: a.inputs.map((io) => (io.entityId === entityId ? { ...io, label: text } : io)),
            outputs: a.outputs.map((io) => (io.entityId === entityId ? { ...io, label: text } : io)),
            params: a.params.map((p) => (p.entityId === entityId ? { ...p, label: text } : p)),
          })),
        )
      }
      onRemoveEntity={(entityId) =>
        setActivities((prev) =>
          prev.map((a) => ({
            ...a,
            inputs: a.inputs.filter((io) => io.entityId !== entityId),
            outputs: a.outputs.filter((io) => io.entityId !== entityId),
            params: a.params.filter((p) => p.entityId !== entityId),
          })),
        )
      }
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
