// 手順フロービュー（React Flow 版ノードエディタ、F 案）のストーリー
//
// Entity（材料・道具・出力）が独立ノードになり、パラメータは各ノード内の
// 属性行で編集する。Playground は実 API（graph + コールバック）をモック
// state で駆動する使用例を兼ねる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { StepFlowView } from "./step-flow-view";
import type { FlowGraphData } from "./activity-graph-adapter";
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

// ── モックデータ（材料を 2 バッチに分けて別々の手順へ + 順序のみ依存）──

const RICH_GRAPH: FlowGraphData = {
  steps: [
    { id: "s-mix", name: "混合・分割", params: [{ label: "比率: 7:3", entityId: "ent_attribute_ratio" }] },
    { id: "s-fire", name: "焼成", params: [{ label: "温度: 900C", entityId: "ent_attribute_temp" }, { label: "時間: 2h" }] },
    { id: "s-keep", name: "対照として保存", params: [] },
    { id: "s-dry", name: "乾燥", params: [] },
    { id: "s-weigh", name: "計量", params: [] },
  ],
  entities: [
    {
      id: "inline_material_ent_cu",
      label: "Cu粉末",
      kind: "material",
      entityId: "ent_cu",
      attrs: [
        { label: "純度: 99.9%", entityId: "ent_attr_purity" },
        { label: "質量: 7g", entityId: "ent_attr_mass" },
      ],
    },
    { id: "inline_material_ent_zn", label: "Zn粉末", kind: "material", entityId: "ent_zn", attrs: [] },
    { id: "inline_tool_ent_mortar", label: "乳鉢", kind: "tool", entityId: "ent_mortar", attrs: [] },
    {
      id: "inline_output_ent_a",
      label: "バッチA",
      kind: "output",
      entityId: "ent_a",
      attrs: [{ label: "質量: 5g", entityId: "ent_attr_ma" }],
    },
    {
      id: "inline_output_ent_b",
      label: "バッチB",
      kind: "output",
      entityId: "ent_b",
      attrs: [{ label: "用途: 対照" }], // entityId 無し = 表示のみ（テーブル列由来の想定）
    },
  ],
  edges: [
    { id: "u1", kind: "used", source: "inline_material_ent_cu", target: "s-mix" },
    { id: "u2", kind: "used", source: "inline_material_ent_zn", target: "s-mix" },
    { id: "u3", kind: "used", source: "inline_tool_ent_mortar", target: "s-mix" },
    { id: "g1", kind: "generates", source: "s-mix", target: "inline_output_ent_a" },
    { id: "g2", kind: "generates", source: "s-mix", target: "inline_output_ent_b" },
    { id: "u4", kind: "used", source: "inline_output_ent_a", target: "s-fire" },
    { id: "u5", kind: "used", source: "inline_output_ent_b", target: "s-keep" },
    { id: "ord1", kind: "orderOnly", source: "s-dry", target: "s-weigh", deletable: true },
  ],
};

// ── 表示のみ（デザイン確認用） ──

export const BranchingGraph: Story = {
  name: "分岐グラフ（表示）",
  render: () => <StepFlowView graph={RICH_GRAPH} />,
};

export const EmptyState: Story = {
  name: "空状態（手順ゼロの入口）",
  render: () => (
    <StepFlowView graph={{ steps: [], entities: [], edges: [] }} onAddActivity={() => console.log("add")} />
  ),
};

// ── フル操作デモ（実 API の使用例をモック state で） ──

function Playground() {
  const [graph, setGraph] = useState<FlowGraphData>(RICH_GRAPH);
  const counter = useRef(0);

  const wouldCycle = (producer: string, consumer: string): boolean => {
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (e.kind !== "orderOnly") continue;
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    }
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
      graph={graph}
      onConnectSteps={(producer, consumer) => {
        if (wouldCycle(producer, consumer)) return { error: "cycle_detected" };
        setGraph((g) => ({
          ...g,
          edges: [
            ...g.edges,
            { id: `ord-${counter.current++}`, kind: "orderOnly", source: producer, target: consumer, deletable: true },
          ],
        }));
        return { error: null };
      }}
      onRemoveOrderEdge={(producer, consumer) =>
        setGraph((g) => ({
          ...g,
          edges: g.edges.filter(
            (e) => !(e.kind === "orderOnly" && e.source === producer && e.target === consumer),
          ),
        }))
      }
      onConnectEntityToStep={(entityNodeId, stepBlockId) =>
        setGraph((g) => ({
          ...g,
          edges: [
            ...g.edges,
            { id: `used-${counter.current++}`, kind: "used", source: entityNodeId, target: stepBlockId },
          ],
        }))
      }
      onAddActivity={() => {
        const id = `new-step-${counter.current++}`;
        setGraph((g) => ({
          ...g,
          steps: [...g.steps, { id, name: `ステップ ${g.steps.length + 1}`, params: [] }],
        }));
      }}
      onRenameActivity={(blockId, title) =>
        setGraph((g) => ({
          ...g,
          steps: g.steps.map((s) => (s.id === blockId ? { ...s, name: title } : s)),
        }))
      }
      onDeleteActivity={(blockId) =>
        setGraph((g) => ({
          ...g,
          steps: g.steps.filter((s) => s.id !== blockId),
          edges: g.edges.filter((e) => e.source !== blockId && e.target !== blockId),
        }))
      }
      onJumpToBlock={(blockId) => console.log("jump to", blockId)}
      getStepContentCount={(blockId) => (blockId === "s-mix" ? 2 : 0)}
      onAddEntity={(blockId, kind, text) => {
        if (kind === "attribute") {
          setGraph((g) => ({
            ...g,
            steps: g.steps.map((s) =>
              s.id === blockId
                ? { ...s, params: [...s.params, { label: text, entityId: `ent-${counter.current++}` }] }
                : s,
            ),
          }));
          return;
        }
        const entityId = `ent-${counter.current++}`;
        const id = `inline_${kind}_${entityId}`;
        setGraph((g) => ({
          ...g,
          entities: [...g.entities, { id, label: text, kind, entityId, attrs: [] }],
          edges: [
            ...g.edges,
            kind === "output"
              ? { id: `g-${counter.current++}`, kind: "generates", source: blockId, target: id }
              : { id: `u-${counter.current++}`, kind: "used", source: id, target: blockId },
          ],
        }));
      }}
      onRenameEntity={(entityId, text) =>
        setGraph((g) => ({
          ...g,
          steps: g.steps.map((s) => ({
            ...s,
            params: s.params.map((p) => (p.entityId === entityId ? { ...p, label: text } : p)),
          })),
          entities: g.entities.map((e) => ({
            ...e,
            label: e.entityId === entityId ? text : e.label,
            attrs: e.attrs.map((a) => (a.entityId === entityId ? { ...a, label: text } : a)),
          })),
        }))
      }
      onRemoveEntity={(entityId) =>
        setGraph((g) => {
          const target = g.entities.find((e) => e.entityId === entityId);
          return {
            ...g,
            steps: g.steps.map((s) => ({
              ...s,
              params: s.params.filter((p) => p.entityId !== entityId),
            })),
            entities: g.entities
              .filter((e) => e.entityId !== entityId)
              .map((e) => ({ ...e, attrs: e.attrs.filter((a) => a.entityId !== entityId) })),
            edges: target ? g.edges.filter((e) => e.source !== target.id && e.target !== target.id) : g.edges,
          };
        })
      }
      onAddAttrToEntity={(parentEntityId, text) =>
        setGraph((g) => ({
          ...g,
          entities: g.entities.map((e) =>
            e.entityId === parentEntityId
              ? { ...e, attrs: [...e.attrs, { label: text, entityId: `ent-${counter.current++}` }] }
              : e,
          ),
        }))
      }
    />
  );
}

export const InteractivePlayground: Story = {
  name: "Playground / 全操作",
  render: () => <Playground />,
};
