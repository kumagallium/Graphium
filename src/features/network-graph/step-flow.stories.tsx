// 手順フロービュー（React Flow 版ノードエディタ、F 案）のストーリー
//
// Entity（材料・道具・出力）が独立ノードになり、ノードは名前だけを見せる。
// 属性とパラメータはグラフ下（全画面では右横）のテーブルパネルで編集する
// ＝ ノート側の表そのもの。Playground は実 API（graph + テーブル + コール
// バック）をモック state で駆動する使用例を兼ねる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { StepFlowView } from "./step-flow-view";
import type { FlowSelection } from "./flow-attribute-table";
import type { TableData } from "./table-row-edit";
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
      attrs: [{ label: "用途: 対照" }], // entityId 無し = 表示のみ
    },
    {
      // 構造化テーブルの行由来: セル編集はノート側テーブルに書き戻る（tableRef）
      id: "entity_material-s-mix_試料C",
      label: "試料C",
      kind: "material",
      tableRef: { blockId: "material-s-mix", rowName: "試料C" },
      attrs: [
        { label: "純度: 99%" },
        { label: "質量: 2g" },
      ],
    },
  ],
  edges: [
    { id: "u1", kind: "used", source: "inline_material_ent_cu", target: "s-mix" },
    { id: "u2", kind: "used", source: "inline_material_ent_zn", target: "s-mix" },
    { id: "u3", kind: "used", source: "inline_tool_ent_mortar", target: "s-mix" },
    { id: "g1", kind: "generates", source: "s-mix", target: "inline_output_ent_a" },
    { id: "g2", kind: "generates", source: "s-mix", target: "inline_output_ent_b" },
    { id: "u6", kind: "used", source: "entity_material-s-mix_試料C", target: "s-mix" },
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

// ── 複数試料（同じ操作を条件違いで 3 回）──
//
// 手順の見出しは操作名だけを持つので、条件違いの並列ランは同じ名前のノードが
// 並ぶ。見分けは「兄弟の間で値が割れているパラメータ」がカードに小さく付く
// （全員同じ rpm: 300 は区別に効かないので出ない）。分岐は測定で合流する。

const PARALLEL_RUNS_GRAPH: FlowGraphData = {
  steps: [
    { id: "s-crush", name: "粉砕", params: [] },
    {
      id: "s-mill-0h",
      name: "ボールミリング",
      params: [{ label: "rpm: 300" }, { label: "time: 0 h" }],
    },
    {
      id: "s-mill-1h",
      name: "ボールミリング",
      params: [{ label: "rpm: 300" }, { label: "time: 1 h" }],
    },
    {
      id: "s-mill-3h",
      name: "ボールミリング",
      params: [{ label: "rpm: 300" }, { label: "time: 3 h" }],
    },
    { id: "s-measure", name: "測定", params: [] },
  ],
  entities: [
    { id: "e-powder", label: "粉末", kind: "output", entityId: "ent_powder", attrs: [] },
    { id: "e-0h", label: "0h ボールミルド粉末", kind: "output", entityId: "ent_0h", attrs: [] },
    { id: "e-1h", label: "1h ボールミルド粉末", kind: "output", entityId: "ent_1h", attrs: [] },
    { id: "e-3h", label: "3h ボールミルド粉末", kind: "output", entityId: "ent_3h", attrs: [] },
    { id: "e-data", label: "熱電特性データ", kind: "output", entityId: "ent_data", attrs: [] },
  ],
  edges: [
    { id: "g0", kind: "generates", source: "s-crush", target: "e-powder" },
    { id: "u0", kind: "used", source: "e-powder", target: "s-mill-0h" },
    { id: "u1", kind: "used", source: "e-powder", target: "s-mill-1h" },
    { id: "u3", kind: "used", source: "e-powder", target: "s-mill-3h" },
    { id: "g1", kind: "generates", source: "s-mill-0h", target: "e-0h" },
    { id: "g2", kind: "generates", source: "s-mill-1h", target: "e-1h" },
    { id: "g3", kind: "generates", source: "s-mill-3h", target: "e-3h" },
    { id: "m0", kind: "used", source: "e-0h", target: "s-measure" },
    { id: "m1", kind: "used", source: "e-1h", target: "s-measure" },
    { id: "m3", kind: "used", source: "e-3h", target: "s-measure" },
    { id: "gd", kind: "generates", source: "s-measure", target: "e-data" },
  ],
};

export const ParallelRuns: Story = {
  name: "複数試料の分岐・合流（同名ステップ）",
  render: () => <StepFlowView graph={PARALLEL_RUNS_GRAPH} />,
};

export const EmptyState: Story = {
  name: "空状態（手順ゼロの入口）",
  render: () => (
    <StepFlowView graph={{ steps: [], entities: [], edges: [] }} onAddActivity={() => console.log("add")} />
  ),
};

// ── フル操作デモ（実 API の使用例をモック state で） ──

/** ノート側の表のモック。パネルの編集はここに書き戻る（実アプリでは BlockNote の table ブロック） */
const INITIAL_TABLES: Record<string, TableData> = {
  "material-s-mix": {
    blockId: "material-s-mix",
    headers: ["名前", "純度", "質量"],
    rows: [["試料C", "99%", "2g"]],
  },
};

function Playground() {
  const [graph, setGraph] = useState<FlowGraphData>(RICH_GRAPH);
  const [tables, setTables] = useState<Record<string, TableData>>(INITIAL_TABLES);
  const counter = useRef(0);

  const patchTable = (blockId: string, fn: (t: TableData) => TableData) =>
    setTables((all) => (all[blockId] ? { ...all, [blockId]: fn(all[blockId]) } : all));

  /** Entity が属する step（出力なら generates の元、入力なら used の先） */
  const owningStepOf = (entityNodeId: string): string | null => {
    const gen = graph.edges.find((e) => e.kind === "generates" && e.target === entityNodeId);
    if (gen) return gen.source;
    return graph.edges.find((e) => e.kind === "used" && e.source === entityNodeId)?.target ?? null;
  };

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
      onCreateSectionTable={(
        stepId: string,
        kind: "attribute" | "material" | "tool" | "output",
        name: string,
      ) => {
        // 空の 1 マスに打ち込まれた内容で表を作る。パラメータは name がキー、
        // 入出力・ツールは name が 1 行目の名前になる
        const blockId = kind === "attribute" ? `param-${stepId}` : `${kind}-${stepId}`;
        setTables((all) =>
          all[blockId]
            ? all
            : {
                ...all,
                [blockId]:
                  kind === "attribute"
                    ? { blockId, headers: [name], rows: [[""]] }
                    : { blockId, headers: ["名前"], rows: [[name]] },
              },
        );
        if (kind === "attribute") return;
        const id = `entity_${blockId}_${name}`;
        setGraph((g) => ({
          ...g,
          entities: [...g.entities, { id, label: name, kind, tableRef: { blockId, rowName: name }, attrs: [] }],
          edges: [
            ...g.edges,
            kind === "output"
              ? { id: `g-${counter.current++}`, kind: "generates", source: stepId, target: id }
              : { id: `u-${counter.current++}`, kind: "used", source: id, target: stepId },
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
      onCreateStepFromEntity={(entityNodeId) => {
        const id = `new-step-${counter.current++}`;
        setGraph((g) => {
          const entity = g.entities.find((e) => e.id === entityNodeId);
          if (!entity) return g;
          return {
            ...g,
            steps: [...g.steps, { id, name: `ステップ ${g.steps.length + 1}`, params: [] }],
            edges: [...g.edges, { id: `u-${counter.current++}`, kind: "used", source: entityNodeId, target: id }],
          };
        });
      }}
      onRenameTableRow={(blockId, rowName, newName) => {
        patchTable(blockId, (t) => ({
          ...t,
          rows: t.rows.map((r) => (r[0] === rowName ? [newName, ...r.slice(1)] : r)),
        }));
        setGraph((g) => ({
          ...g,
          entities: g.entities.map((e) =>
            e.tableRef?.blockId === blockId && e.tableRef.rowName === rowName
              ? { ...e, label: newName, tableRef: { blockId, rowName: newName } }
              : e,
          ),
        }));
      }}
      onRemoveTableRow={(blockId, rowName) => {
        patchTable(blockId, (t) => ({ ...t, rows: t.rows.filter((r) => r[0] !== rowName) }));
        setGraph((g) => {
          const target = g.entities.find(
            (e) => e.tableRef?.blockId === blockId && e.tableRef.rowName === rowName,
          );
          return {
            ...g,
            entities: g.entities.filter((e) => e !== target),
            edges: target ? g.edges.filter((e) => e.source !== target.id && e.target !== target.id) : g.edges,
          };
        });
      }}
      // ── パネル（選択の裏にある step の中身ぜんぶ） ──
      getPanelFor={(selection: FlowSelection) => {
        if (!selection) return null;
        const stepId =
          selection.kind === "step" ? selection.step.id : owningStepOf(selection.entity.id);
        const step = graph.steps.find((st) => st.id === stepId);
        if (!stepId || !step) return null;
        const ref = selection.kind === "entity" ? selection.entity.tableRef : undefined;
        return {
          stepId,
          stepName: step.name,
          tables: {
            attribute: tables[`param-${stepId}`] ?? null,
            material: tables[`material-${stepId}`] ?? null,
            tool: tables[`tool-${stepId}`] ?? null,
            output: tables[`output-${stepId}`] ?? null,
          },
          highlight: ref ? { blockId: ref.blockId, rowName: ref.rowName } : undefined,
          proseHighlight:
            selection.kind === "entity" && !ref ? (selection.entity.entityId ?? undefined) : undefined,
          prose: [
            ...step.params
              .filter((pp) => !!pp.entityId)
              .map((pp) => ({ entityId: pp.entityId!, kind: "attribute" as const, label: pp.label })),
            ...graph.entities
              .filter((e) => !e.tableRef && !!e.entityId && owningStepOf(e.id) === stepId)
              .map((e) => ({ entityId: e.entityId!, nodeId: e.id, kind: e.kind, label: e.label, attrs: e.attrs })),
          ],
        };
      }}
      onSetCell={(blockId, rowIndex, colIndex, value) =>
        patchTable(blockId, (t) => ({
          ...t,
          rows: t.rows.map((r, i) =>
            i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r,
          ),
        }))
      }
      onRenameColumn={(blockId, colIndex, name) =>
        patchTable(blockId, (t) => ({
          ...t,
          headers: t.headers.map((h, i) => (i === colIndex ? name : h)),
        }))
      }
      onAddColumn={(blockId, name) =>
        patchTable(blockId, (t) => ({
          ...t,
          headers: [...t.headers, name],
          rows: t.rows.map((r) => [...r, ""]),
        }))
      }
      onRemoveColumn={(blockId, colIndex) =>
        patchTable(blockId, (t) => ({
          ...t,
          headers: t.headers.filter((_, i) => i !== colIndex),
          rows: t.rows.map((r) => r.filter((_, i) => i !== colIndex)),
        }))
      }
      onAddRow={(blockId, name) => {
        patchTable(blockId, (t) => ({
          ...t,
          rows: [...t.rows, [name, ...t.headers.slice(1).map(() => "")]],
        }));
        // 表の 1 行 = 1 Entity なので、行を足すとノードも増える
        // （blockId は `<kind>-<stepId>` 規約 — パネルのモック用）
        const m = blockId.match(/^(material|tool|output)-(.+)$/);
        if (!m) return;
        const [, kind, step] = m as [string, "material" | "tool" | "output", string];
        const id = `entity_${blockId}_${name}`;
        setGraph((g) => ({
          ...g,
          entities: [
            ...g.entities,
            { id, label: name, kind, tableRef: { blockId, rowName: name }, attrs: [] },
          ],
          edges: [
            ...g.edges,
            kind === "output"
              ? { id: `g-${counter.current++}`, kind: "generates", source: step, target: id }
              : { id: `u-${counter.current++}`, kind: "used", source: id, target: step },
          ],
        }));
      }}
      onMoveEntityToTable={(entityNodeId) => {
        const entity = graph.entities.find((e) => e.id === entityNodeId);
        const step = owningStepOf(entityNodeId);
        if (!entity || entity.tableRef || !step) return;
        const blockId = `${entity.kind}-${step}`;
        setTables((all) => {
          const existing = all[blockId] ?? { blockId, headers: ["名前"], rows: [] };
          // ハイライトで紐付いた属性（key: value）は列として一緒に運ぶ（実アプリと同じ）
          const attrPairs = (entity.attrs ?? [])
            .filter((a) => a.entityId && a.label.includes(":"))
            .map((a) => {
              const i = a.label.indexOf(":");
              return [a.label.slice(0, i).trim(), a.label.slice(i + 1).trim()] as [string, string];
            });
          const headers = [...existing.headers];
          for (const [k] of attrPairs) if (!headers.includes(k)) headers.push(k);
          const paddedRows = existing.rows.map((r) => [...r, ...headers.slice(r.length).map(() => "")]);
          const newRow = headers.map((h, i) =>
            i === 0 ? entity.label : (attrPairs.find(([k]) => k === h)?.[1] ?? ""),
          );
          return { ...all, [blockId]: { ...existing, headers, rows: [...paddedRows, newRow] } };
        });
        // 本文 span は外れ、行由来の Entity になる（id も変わる）
        setGraph((g) => {
          const id = `entity_${blockId}_${entity.label}`;
          return {
            ...g,
            entities: g.entities.map((e) =>
              e.id === entityNodeId
                ? { ...e, id, entityId: undefined, tableRef: { blockId, rowName: e.label } }
                : e,
            ),
            edges: g.edges.map((e) => ({
              ...e,
              source: e.source === entityNodeId ? id : e.source,
              target: e.target === entityNodeId ? id : e.target,
            })),
          };
        });
      }}
      onMoveParamToTable={(stepId, entityId, key, value) => {
        const blockId = `param-${stepId}`;
        setTables((all) => {
          const existing = all[blockId] ?? { blockId, headers: [], rows: [[]] };
          return {
            ...all,
            [blockId]: {
              ...existing,
              headers: [...existing.headers, key],
              rows: existing.rows.map((r, i) => (i === 0 ? [...r, value] : [...r, ""])),
            },
          };
        });
        // span は外れる = step.params から消える
        setGraph((g) => ({
          ...g,
          steps: g.steps.map((s) =>
            s.id === stepId ? { ...s, params: s.params.filter((p) => p.entityId !== entityId) } : s,
          ),
        }));
      }}
    />
  );
}

export const InteractivePlayground: Story = {
  name: "Playground / 全操作",
  render: () => <Playground />,
};
