// 【提案モック】フロービューのゼロベース再構築案
//
// 「ステップのみ」（Entity を隠して step 間エッジに畳む）は出力の分岐で
// 破綻するため、「出力だけをノード展開する」中間抽象度に作り直す提案。
// このファイルは合意形成用のモックで、本実装が決まったら置き換える。
//
// 見どころ:
//   A. 分岐の見え方 — 出力ノードが結節点になり、どの出力がどの手順へ
//      流れたかがそのまま見える。物質を特定しない依存は点線（順序のみ）
//   B. 出力からステップを生む — 出力ノードの下ポートをドラッグして
//      空白に落とすと、新しい手順がその出力を入力として生まれる
//   C. 現行ビュー比較 — 同じ分岐を現行「ステップのみ」で見ると
//      区別できない 2 本線になる（破綻の確認用）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useRef, useState, type CSSProperties } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StepFlowView } from "./step-flow-view";
import { StepNodeCard } from "./step-node-card";
import type { ActivityNode } from "./activity-graph-adapter";
import { LocaleProvider } from "../../i18n";

const meta: Meta = {
  title: "Proposal/新フロービュー（出力ノード展開）",
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

// ── 出力ノード（新設・モック）──
// step カードより明確に小さいピル型。上=生成の受け（テラコッタ）、
// 下=このアウトプットを使う手順へのドラッグ元（緑 = 材料になる）。

type OutputNodeType = Node<{ label: string }, "outputEntity">;

function OutputNodeMock({ data }: NodeProps<OutputNodeType>) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        background: "#fdf3f1",
        border: "1.5px solid #c26356",
        borderRadius: 14,
        fontSize: 11,
        fontWeight: 700,
        color: "#a8513f",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#c26356", flexShrink: 0 }} />
      {data.label}
      <Handle
        type="target"
        position={Position.Top}
        style={{ width: 8, height: 8, background: "#ffffff", border: "2px solid #c26356" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: 10, height: 10, background: "#4B7A52", border: "2px solid #4B7A52" }}
      />
    </div>
  );
}

const nodeTypes = { step: StepNodeCard, outputEntity: OutputNodeMock };

// ── エッジスタイル 3 種 ──

/** step → 出力（この手順が生成した） */
const generatesEdge = {
  style: { stroke: "#c26356", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#c26356", width: 16, height: 16 },
};
/** 出力 → step（次の手順が材料として使う = 本文の入力に同名 span が合成される） */
const usedEdge = {
  style: { stroke: "#4B7A52", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#4B7A52", width: 16, height: 16 },
};
/** step → step（順序のみ。物質を特定しない informed_by）。点線で区別 */
const orderOnlyEdge = {
  style: { stroke: "#5b8fb9", strokeWidth: 1.5, strokeDasharray: "6 4" },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#5b8fb9", width: 16, height: 16 },
  label: "順序のみ",
  labelStyle: { fontSize: 9, fill: "#5b8fb9", fontWeight: 700 },
  labelBgStyle: { fill: "#fafdf7", fillOpacity: 0.9 },
};

// ── モックデータ（材料を 2 バッチに分けて別々の手順へ）──

const act = (id: string, name: string, over: Partial<ActivityNode> = {}): ActivityNode => ({
  id,
  name,
  inputs: [],
  outputs: [],
  params: [],
  ...over,
});

const stepNode = (id: string, x: number, y: number, a: ActivityNode): Node => ({
  id,
  type: "step",
  position: { x, y },
  data: { activity: a },
  draggable: true, // モックでは自由に動かして眺められるように
});

const outputNode = (id: string, x: number, y: number, label: string): Node => ({
  id,
  type: "outputEntity",
  position: { x, y },
  data: { label },
  draggable: true,
});

const PROPOSAL_NODES: Node[] = [
  stepNode("s-mix", 140, 0, act("s-mix", "混合・分割", {
    inputs: [
      { label: "Cu粉末", kind: "material", entityId: "e1" },
      { label: "Zn粉末", kind: "material", entityId: "e2" },
    ],
    params: [{ label: "比率: 7:3", entityId: "e3" }],
  })),
  outputNode("o-a", 80, 150, "バッチA"),
  outputNode("o-b", 300, 150, "バッチB"),
  stepNode("s-fire", 20, 260, act("s-fire", "焼成", {
    inputs: [{ label: "バッチA", kind: "material", entityId: "e4" }],
    params: [{ label: "温度: 900C", entityId: "e5" }],
  })),
  stepNode("s-keep", 280, 260, act("s-keep", "対照として保存", {
    inputs: [{ label: "バッチB", kind: "material", entityId: "e6" }],
  })),
  // 順序のみの依存（物質の受け渡しを特定しない）
  stepNode("s-dry", 560, 40, act("s-dry", "乾燥")),
  stepNode("s-weigh", 560, 180, act("s-weigh", "計量")),
];

const PROPOSAL_EDGES: Edge[] = [
  { id: "g1", source: "s-mix", target: "o-a", ...generatesEdge },
  { id: "g2", source: "s-mix", target: "o-b", ...generatesEdge },
  { id: "u1", source: "o-a", target: "s-fire", ...usedEdge },
  { id: "u2", source: "o-b", target: "s-keep", ...usedEdge },
  { id: "ord1", source: "s-dry", target: "s-weigh", ...orderOnlyEdge },
];

// ── A. 分岐の見え方（静的） ──

export const BranchingLayout: Story = {
  name: "A. 分岐の見え方",
  render: () => (
    <ReactFlowProvider>
      <div style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          defaultNodes={PROPOSAL_NODES}
          defaultEdges={PROPOSAL_EDGES}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          style={{ background: "#fafdf7", borderRadius: 8 }}
        >
          <Background color="#d5e0d7" gap={22} size={1.5} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  ),
};

// ── B. 出力からステップを生む（触れるモック） ──
//
// - 出力ノードの下ポート（緑）を空白へドラッグ → その出力を入力に持つ
//   新しい手順が生まれる（本実装では本文に同名 span が合成される部分）
// - 出力ノードの下ポートを既存 step へドラッグ → used エッジ（緑）
// - step の下ポートを別 step へドラッグ → 順序のみ（点線）

let mockId = 0;

function ProposalPlayground() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(PROPOSAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(PROPOSAL_EDGES);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (conn: { source: string | null; target: string | null }) => {
      if (!conn.source || !conn.target) return;
      const sourceNode = nodesRef.current.find((n) => n.id === conn.source);
      const targetNode = nodesRef.current.find((n) => n.id === conn.target);
      // 出力 → step: used（本実装では対象 step の入力に同名 span 合成）
      // step → step: 順序のみ（informed_by）
      // step → 出力: 生成（本実装ではその step に output span を移す…は将来検討。モックでは線だけ）
      const style =
        sourceNode?.type === "outputEntity"
          ? usedEdge
          : targetNode?.type === "outputEntity"
            ? generatesEdge
            : orderOnlyEdge;
      setEdges((eds) => addEdge({ ...conn, id: `mock-${mockId++}`, ...style } as Edge, eds));
      // used を張ったら対象 step カードの入力チップにも反映（本実装の挙動を模す）
      if (sourceNode?.type === "outputEntity" && targetNode?.type === "step") {
        const label = (sourceNode.data as { label: string }).label;
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== conn.target || n.type !== "step") return n;
            const a = (n.data as { activity: ActivityNode }).activity;
            if (a.inputs.some((i) => i.label === label)) return n;
            return {
              ...n,
              data: {
                activity: {
                  ...a,
                  inputs: [...a.inputs, { label, kind: "material" as const, entityId: `mock-${mockId++}` }],
                },
              },
            };
          }),
        );
      }
    },
    [setEdges, setNodes],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: any) => {
      // 空白へのドロップ & 出力ノード発 → 新しい手順を作って used で繋ぐ
      if (connectionState.isValid) return;
      const fromNode = connectionState.fromNode;
      if (!fromNode || fromNode.type !== "outputEntity") return;
      const { clientX, clientY } = "changedTouches" in event ? event.changedTouches[0] : event;
      const pos = screenToFlowPosition({ x: clientX, y: clientY });
      const label = (fromNode.data as { label: string }).label;
      const newId = `new-step-${mockId++}`;
      setNodes((nds) => [
        ...nds,
        stepNode(newId, pos.x - 90, pos.y, act(newId, `新しい手順`, {
          inputs: [{ label, kind: "material", entityId: `mock-${mockId++}` }],
        })),
      ]);
      setEdges((eds) => [...eds, { id: `mock-${mockId++}`, source: fromNode.id, target: newId, ...usedEdge } as Edge]);
    },
    [screenToFlowPosition, setNodes, setEdges],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ fontSize: 12, color: "#4a6350", lineHeight: 1.6 }}>
        <b>出力ノード（赤ピル）の下の緑ポート</b>を空白へドラッグ → その出力を入力に持つ新しい手順が生まれます。
        既存の手順カードに落とせば used（緑実線）で繋がり、カードの入力チップにも足されます。
        <b>手順カードの下ポート</b>同士を繋ぐと「順序のみ」（青点線）になります。
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          style={{ background: "#fafdf7", borderRadius: 8 }}
        >
          <Background color="#d5e0d7" gap={22} size={1.5} />
        </ReactFlow>
      </div>
    </div>
  );
}

export const OutputDrivenAuthoring: Story = {
  name: "B. 出力からステップを生む（触れる）",
  render: () => (
    <ReactFlowProvider>
      <ProposalPlayground />
    </ReactFlowProvider>
  ),
};

// ── C. 現行ビュー比較（破綻の確認） ──
//
// 同じ「2 バッチへの分岐」を現行「ステップのみ」で見ると、
// 区別のつかない 2 本のエッジになる（どの出力がどちらへ行ったか消える）。

export const CurrentViewComparison: Story = {
  name: "C. 現行ビューだと（比較用）",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ fontSize: 12, color: "#4a6350" }}>
        現行の「ステップのみ」で同じ分岐を見た場合 — バッチA / バッチB はカード内チップに
        埋まり、<b>2 本のエッジはどちらの出力経由か区別できません</b>。
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <StepFlowView
          activities={[
            act("s-mix", "混合・分割", {
              inputs: [
                { label: "Cu粉末", kind: "material", entityId: "e1" },
                { label: "Zn粉末", kind: "material", entityId: "e2" },
              ],
              outputs: [
                { label: "バッチA", kind: "output", entityId: "o1" },
                { label: "バッチB", kind: "output", entityId: "o2" },
              ],
            }),
            act("s-fire", "焼成", { inputs: [{ label: "バッチA", kind: "material", entityId: "e4" }] }),
            act("s-keep", "対照として保存", { inputs: [{ label: "バッチB", kind: "material", entityId: "e6" }] }),
          ]}
          steps={[
            { id: "step-s-mix->s-fire", from: "s-mix", to: "s-fire" },
            { id: "step-s-mix->s-keep", from: "s-mix", to: "s-keep" },
          ]}
        />
      </div>
    </div>
  ),
};

// ══════════════════════════════════════════════
// D / E. テーブルが受け渡し役になる案
//
// グラフから出力を作ると「単語だけの行」が本文に散らばるのは体験が悪い。
// 代わりに step 内の「出力テーブル」（output ラベル付き標準 table、
// ヘッダ=属性キー・各行=1 Entity として PROV 展開される既存機構）へ
// 行を append する。ノート側には試料表が育ち、グラフはその投影になる。
// ══════════════════════════════════════════════

// ── ノート側の見え方（対応イメージ用の静的モック） ──

function NoteSideMock() {
  const cell: CSSProperties = {
    border: "1px solid #d5e0d7",
    padding: "4px 10px",
    fontSize: 12,
    textAlign: "left",
  };
  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        background: "#ffffff",
        border: "1px solid #d5e0d7",
        borderRadius: 8,
        padding: 14,
        overflow: "auto",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8fa394", marginBottom: 10 }}>
        ノート側の見え方（同じデータ）
      </div>
      <div style={{ borderLeft: "3px solid #4B7A52", background: "#f8faf8", borderRadius: 6, padding: "8px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>☰ 混合・分割</div>
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          <mark style={{ background: "#e8f0e8", padding: "0 2px" }}>Cu粉末</mark>と
          <mark style={{ background: "#e8f0e8", padding: "0 2px" }}>Zn粉末</mark>を
          <mark style={{ background: "#faf3e8", padding: "0 2px" }}>7:3</mark>
          で混合し、2 バッチに分けた。
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#c26356", marginBottom: 2 }}>
          [アウトプット] ラベル付きテーブル
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...cell, background: "#f0f5ef", fontWeight: 700 }}>名前</th>
              <th style={{ ...cell, background: "#f0f5ef", fontWeight: 700 }}>質量</th>
              <th style={{ ...cell, background: "#f0f5ef", fontWeight: 700 }}>メモ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>バッチA</td>
              <td style={cell}>5g</td>
              <td style={cell}>焼成用</td>
            </tr>
            <tr>
              <td style={cell}>バッチB</td>
              <td style={cell}>5g</td>
              <td style={cell}>対照</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: "#8fa394", marginTop: 8 }}>
          グラフから「出力を追加」すると、この表に行が増える（単語が
          ばらまかれるのではなく、試料表が育つ）。行の属性列は自由に足せる。
        </div>
      </div>
    </div>
  );
}

// ── D 案: step カード内に出力テーブル（行ごとに接続ポート） ──

type TableStepData = {
  title: string;
  inputs?: { label: string; kind: "material" | "tool" }[];
  params?: string[];
  outputRows?: { name: string; attr: string }[];
};
type TableStepNodeType = Node<TableStepData, "tableStep">;

function TableStepCardMock({ data }: NodeProps<TableStepNodeType>) {
  const { title, inputs = [], params = [], outputRows = [] } = data;
  return (
    <div
      style={{
        minWidth: 190,
        maxWidth: 250,
        borderRadius: 8,
        background: "#ffffff",
        border: "1px solid #d5e0d7",
        borderLeft: "3px solid #5b8fb9",
        boxShadow: "0 1px 3px rgba(30,20,10,0.08)",
      }}
    >
      <div style={{ padding: "7px 10px 4px", fontSize: 13, fontWeight: 700, color: "#1a2e1d" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 10px 8px" }}>
        {inputs.map((io, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#2d4a32" }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: io.kind === "tool" ? 1 : "50%",
                transform: io.kind === "tool" ? "rotate(45deg)" : undefined,
                background: io.kind === "tool" ? "#c08b3e" : "#4B7A52",
              }}
            />
            {io.label}
          </span>
        ))}
        {params.map((p, i) => (
          <span key={`p-${i}`} style={{ fontSize: 11, color: "#8fa394" }}>⚙ {p}</span>
        ))}
        {outputRows.length > 0 && (
          <div style={{ border: "1px solid #eadfdc", borderRadius: 6, marginTop: 2 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#a8513f",
                background: "#fdf3f1",
                padding: "2px 8px",
                borderBottom: "1px solid #eadfdc",
              }}
            >
              出力
            </div>
            {outputRows.map((row, i) => (
              <div
                key={i}
                style={{
                  position: "relative",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "3px 10px 3px 8px",
                  fontSize: 11,
                  borderBottom: i < outputRows.length - 1 ? "1px solid #f3ebe9" : "none",
                }}
              >
                <span style={{ fontWeight: 600, color: "#a8513f" }}>{row.name}</span>
                <span style={{ color: "#8fa394" }}>{row.attr}</span>
                <Handle
                  type="source"
                  id={`row-${i}`}
                  position={Position.Right}
                  style={{
                    right: -6,
                    top: "50%",
                    width: 10,
                    height: 10,
                    background: "#4B7A52",
                    border: "2px solid #4B7A52",
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Top} style={{ width: 9, height: 9, background: "#fff", border: "2px solid #5b8fb9" }} />
      <Handle type="source" position={Position.Bottom} style={{ width: 11, height: 11, background: "#5b8fb9", border: "2px solid #5b8fb9" }} />
    </div>
  );
}

const tableNodeTypes = { step: StepNodeCard, tableStep: TableStepCardMock };

const TABLE_NODES: Node[] = [
  {
    id: "t-mix",
    type: "tableStep",
    position: { x: 120, y: 0 },
    draggable: true,
    data: {
      title: "混合・分割",
      inputs: [
        { label: "Cu粉末", kind: "material" },
        { label: "Zn粉末", kind: "material" },
      ],
      params: ["比率: 7:3"],
      outputRows: [
        { name: "バッチA", attr: "5g・焼成用" },
        { name: "バッチB", attr: "5g・対照" },
      ],
    },
  } as Node,
  stepNode("t-fire", 480, 40, act("t-fire", "焼成", {
    inputs: [{ label: "バッチA", kind: "material", entityId: "te1" }],
    params: [{ label: "温度: 900C", entityId: "te2" }],
  })),
  stepNode("t-keep", 480, 210, act("t-keep", "対照として保存", {
    inputs: [{ label: "バッチB", kind: "material", entityId: "te3" }],
  })),
];

const TABLE_EDGES: Edge[] = [
  { id: "tu1", source: "t-mix", sourceHandle: "row-0", target: "t-fire", ...usedEdge },
  { id: "tu2", source: "t-mix", sourceHandle: "row-1", target: "t-keep", ...usedEdge },
];

export const TableHandoff: Story = {
  name: "D. テーブルが受け渡し役（カード内テーブル案）",
  render: () => (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      <NoteSideMock />
      <div style={{ flex: 1, minWidth: 0 }}>
        <ReactFlowProvider>
          <ReactFlow
            defaultNodes={TABLE_NODES}
            defaultEdges={TABLE_EDGES}
            nodeTypes={tableNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            style={{ background: "#fafdf7", borderRadius: 8 }}
          >
            <Background color="#d5e0d7" gap={22} size={1.5} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  ),
};

// ── E 案: 出力はピルのまま、クリックで行の属性を見る ──

function OutputPillWithAttrs({ data }: NodeProps<Node<{ label: string; attrs: string[] }, "outputPill">>) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <div
        className="nodrag"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          background: "#fdf3f1",
          border: "1.5px solid #c26356",
          borderRadius: 14,
          fontSize: 11,
          fontWeight: 700,
          color: "#a8513f",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#c26356" }} />
        {data.label}
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#ffffff",
            border: "1px solid #d5e0d7",
            borderRadius: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            padding: "6px 10px",
            fontSize: 11,
            whiteSpace: "nowrap",
            zIndex: 20,
          }}
        >
          {data.attrs.map((a, i) => (
            <div key={i} style={{ color: "#4a6350", padding: "1px 0" }}>{a}</div>
          ))}
          <div style={{ color: "#8fa394", fontSize: 9, marginTop: 3 }}>= 出力テーブルの行の属性</div>
        </div>
      )}
      <Handle type="target" position={Position.Top} style={{ width: 8, height: 8, background: "#fff", border: "2px solid #c26356" }} />
      <Handle type="source" position={Position.Bottom} style={{ width: 10, height: 10, background: "#4B7A52", border: "2px solid #4B7A52" }} />
    </div>
  );
}

const pillNodeTypes = { step: StepNodeCard, outputPill: OutputPillWithAttrs };

const PILL_NODES: Node[] = [
  stepNode("p-mix", 140, 0, act("p-mix", "混合・分割", {
    inputs: [
      { label: "Cu粉末", kind: "material", entityId: "pe1" },
      { label: "Zn粉末", kind: "material", entityId: "pe2" },
    ],
    params: [{ label: "比率: 7:3", entityId: "pe3" }],
  })),
  { id: "p-a", type: "outputPill", position: { x: 90, y: 170 }, draggable: true, data: { label: "バッチA", attrs: ["質量: 5g", "メモ: 焼成用"] } } as Node,
  { id: "p-b", type: "outputPill", position: { x: 300, y: 170 }, draggable: true, data: { label: "バッチB", attrs: ["質量: 5g", "メモ: 対照"] } } as Node,
  stepNode("p-fire", 30, 290, act("p-fire", "焼成", {
    inputs: [{ label: "バッチA", kind: "material", entityId: "pe4" }],
  })),
  stepNode("p-keep", 290, 290, act("p-keep", "対照として保存", {
    inputs: [{ label: "バッチB", kind: "material", entityId: "pe5" }],
  })),
];

const PILL_EDGES: Edge[] = [
  { id: "pg1", source: "p-mix", target: "p-a", ...generatesEdge },
  { id: "pg2", source: "p-mix", target: "p-b", ...generatesEdge },
  { id: "pu1", source: "p-a", target: "p-fire", ...usedEdge },
  { id: "pu2", source: "p-b", target: "p-keep", ...usedEdge },
];

export const PillWithAttrs: Story = {
  name: "E. 別案: 出力ピル + クリックで属性",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ fontSize: 12, color: "#4a6350" }}>
        出力はピルのまま独立ノードにし、<b>クリックすると出力テーブルの行属性</b>が見える案。
        データの置き場は D と同じ（step 内の出力テーブル）で、グラフの見せ方だけの違い。
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <ReactFlow
            defaultNodes={PILL_NODES}
            defaultEdges={PILL_EDGES}
            nodeTypes={pillNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            style={{ background: "#fafdf7", borderRadius: 8 }}
          >
            <Background color="#d5e0d7" gap={22} size={1.5} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  ),
};

// ══════════════════════════════════════════════
// F 案. 入力・出力それぞれが独立ノード + パラメータはノード内の表
//
// MatPROV のようにパラメータを個別ノードにはせず（ノード数爆発の元）、
// Entity ノードの中に key-value 表として畳む。ノート側の実体は
// 構造化テーブル（1 行 = 1 Entity、列 = 属性）で、グラフの Entity
// ノード = 表の 1 行の転置表示、という対応になる。
// ══════════════════════════════════════════════

type EntityAttr = { key: string; value: string };
type AttrEntityData = { name: string; kind: "material" | "tool" | "output"; attrs: EntityAttr[] };

const ENTITY_KIND_COLORS: Record<AttrEntityData["kind"], { main: string; bg: string; text: string }> = {
  material: { main: "#4B7A52", bg: "#f0f5ef", text: "#2d4a32" },
  tool: { main: "#c08b3e", bg: "#faf3e8", text: "#7a5a22" },
  output: { main: "#c26356", bg: "#fdf3f1", text: "#a8513f" },
};

function AttrTableEntityNodeMock({ data }: NodeProps<Node<AttrEntityData, "attrEntity">>) {
  const [attrs, setAttrs] = useState<EntityAttr[]>(data.attrs);
  const c = ENTITY_KIND_COLORS[data.kind];
  return (
    <div
      style={{
        minWidth: 150,
        maxWidth: 200,
        borderRadius: 8,
        background: "#ffffff",
        border: `1.5px solid ${c.main}`,
        boxShadow: "0 1px 3px rgba(30,20,10,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          background: c.bg,
          fontSize: 12,
          fontWeight: 700,
          color: c.text,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: data.kind === "tool" ? 1 : "50%",
            transform: data.kind === "tool" ? "rotate(45deg)" : undefined,
            background: c.main,
            flexShrink: 0,
          }}
        />
        {data.name}
      </div>
      {/* パラメータ表（value は編集できるモック） */}
      <div style={{ padding: "4px 6px 6px" }}>
        {attrs.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
            <span style={{ fontSize: 10, color: "#8fa394", width: 46, flexShrink: 0, textAlign: "right" }}>
              {a.key}
            </span>
            <input
              className="nodrag"
              value={a.value}
              onChange={(e) =>
                setAttrs((prev) => prev.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))
              }
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11,
                padding: "1px 6px",
                border: "1px solid #e5ece6",
                borderRadius: 4,
                outline: "none",
                color: "#1a2e1d",
              }}
            />
          </div>
        ))}
        <button
          className="nodrag"
          onClick={() => setAttrs((prev) => [...prev, { key: "属性", value: "" }])}
          style={{
            marginTop: 3,
            fontSize: 9,
            fontWeight: 600,
            color: "#8fa394",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "1px 4px",
          }}
        >
          + 属性
        </button>
      </div>
      <Handle type="target" position={Position.Top} style={{ width: 8, height: 8, background: "#fff", border: `2px solid ${c.main}` }} />
      <Handle type="source" position={Position.Bottom} style={{ width: 10, height: 10, background: c.main, border: `2px solid ${c.main}` }} />
    </div>
  );
}

/** step ノード（Activity のパラメータも同じく表で） */
function StepWithParamTableMock({ data }: NodeProps<Node<{ title: string; params: EntityAttr[] }, "stepTable">>) {
  const [params, setParams] = useState<EntityAttr[]>(data.params);
  return (
    <div
      style={{
        minWidth: 170,
        maxWidth: 220,
        borderRadius: 8,
        background: "#ffffff",
        border: "1px solid #d5e0d7",
        borderLeft: "3px solid #5b8fb9",
        boxShadow: "0 1px 3px rgba(30,20,10,0.08)",
      }}
    >
      <div style={{ padding: "6px 10px 4px", fontSize: 13, fontWeight: 700, color: "#1a2e1d" }}>{data.title}</div>
      {params.length > 0 && (
        <div style={{ padding: "0 6px 6px" }}>
          {params.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
              <span style={{ fontSize: 10, color: "#8fa394", width: 46, flexShrink: 0, textAlign: "right" }}>{a.key}</span>
              <input
                className="nodrag"
                value={a.value}
                onChange={(e) =>
                  setParams((prev) => prev.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))
                }
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  padding: "1px 6px",
                  border: "1px solid #e5ece6",
                  borderRadius: 4,
                  outline: "none",
                  color: "#1a2e1d",
                }}
              />
            </div>
          ))}
        </div>
      )}
      <Handle type="target" position={Position.Top} style={{ width: 9, height: 9, background: "#fff", border: "2px solid #5b8fb9" }} />
      <Handle type="source" position={Position.Bottom} style={{ width: 11, height: 11, background: "#5b8fb9", border: "2px solid #5b8fb9" }} />
    </div>
  );
}

const attrNodeTypes = { attrEntity: AttrTableEntityNodeMock, stepTable: StepWithParamTableMock };

const attrEntity = (id: string, x: number, y: number, d: AttrEntityData): Node =>
  ({ id, type: "attrEntity", position: { x, y }, draggable: true, data: d }) as Node;

const F_NODES: Node[] = [
  attrEntity("f-cu", 0, 0, { name: "Cu粉末", kind: "material", attrs: [{ key: "純度", value: "99.9%" }, { key: "質量", value: "7g" }] }),
  attrEntity("f-zn", 230, 0, { name: "Zn粉末", kind: "material", attrs: [{ key: "純度", value: "99%" }, { key: "質量", value: "3g" }] }),
  { id: "f-mix", type: "stepTable", position: { x: 115, y: 210 }, draggable: true, data: { title: "混合・分割", params: [{ key: "比率", value: "7:3" }] } } as Node,
  attrEntity("f-a", 0, 360, { name: "バッチA", kind: "output", attrs: [{ key: "質量", value: "5g" }, { key: "用途", value: "焼成" }] }),
  attrEntity("f-b", 260, 360, { name: "バッチB", kind: "output", attrs: [{ key: "質量", value: "5g" }, { key: "用途", value: "対照" }] }),
  { id: "f-fire", type: "stepTable", position: { x: 0, y: 560 }, draggable: true, data: { title: "焼成", params: [{ key: "温度", value: "900C" }, { key: "時間", value: "2h" }] } } as Node,
  { id: "f-keep", type: "stepTable", position: { x: 260, y: 560 }, draggable: true, data: { title: "対照として保存", params: [] } } as Node,
];

const F_EDGES: Edge[] = [
  { id: "fu1", source: "f-cu", target: "f-mix", ...usedEdge },
  { id: "fu2", source: "f-zn", target: "f-mix", ...usedEdge },
  { id: "fg1", source: "f-mix", target: "f-a", ...generatesEdge },
  { id: "fg2", source: "f-mix", target: "f-b", ...generatesEdge },
  { id: "fu3", source: "f-a", target: "f-fire", ...usedEdge },
  { id: "fu4", source: "f-b", target: "f-keep", ...usedEdge },
];

function NoteSideMockF() {
  const cell: CSSProperties = {
    border: "1px solid #d5e0d7",
    padding: "3px 8px",
    fontSize: 11,
    textAlign: "left",
  };
  const th: CSSProperties = { ...cell, background: "#f0f5ef", fontWeight: 700 };
  return (
    <div
      style={{
        width: 330,
        flexShrink: 0,
        background: "#ffffff",
        border: "1px solid #d5e0d7",
        borderRadius: 8,
        padding: 14,
        overflow: "auto",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8fa394", marginBottom: 10 }}>
        ノート側の見え方（同じデータ）
      </div>
      <div style={{ borderLeft: "3px solid #4B7A52", background: "#f8faf8", borderRadius: 6, padding: "8px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>☰ 混合・分割 <span style={{ fontSize: 10, color: "#8fa394", fontWeight: 400 }}>（比率: 7:3）</span></div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#4B7A52", marginBottom: 2 }}>[インプット] テーブル</div>
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 8 }}>
          <thead><tr><th style={th}>名前</th><th style={th}>純度</th><th style={th}>質量</th></tr></thead>
          <tbody>
            <tr><td style={cell}>Cu粉末</td><td style={cell}>99.9%</td><td style={cell}>7g</td></tr>
            <tr><td style={cell}>Zn粉末</td><td style={cell}>99%</td><td style={cell}>3g</td></tr>
          </tbody>
        </table>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#c26356", marginBottom: 2 }}>[アウトプット] テーブル</div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>名前</th><th style={th}>質量</th><th style={th}>用途</th></tr></thead>
          <tbody>
            <tr><td style={cell}>バッチA</td><td style={cell}>5g</td><td style={cell}>焼成</td></tr>
            <tr><td style={cell}>バッチB</td><td style={cell}>5g</td><td style={cell}>対照</td></tr>
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: "#8fa394", marginTop: 8 }}>
          グラフの Entity ノード = この表の 1 行（縦に転置して表示）。
          ノードの属性表を編集する = 表のセルを編集する。行の追加 =
          ノードの追加。どちらから触っても同じデータ。
        </div>
      </div>
    </div>
  );
}

export const EntityNodesWithAttrTables: Story = {
  name: "F. 入出力もノード + パラメータは表",
  render: () => (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      <NoteSideMockF />
      <div style={{ flex: 1, minWidth: 0 }}>
        <ReactFlowProvider>
          <ReactFlow
            defaultNodes={F_NODES}
            defaultEdges={F_EDGES}
            nodeTypes={attrNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            style={{ background: "#fafdf7", borderRadius: 8 }}
          >
            <Background color="#d5e0d7" gap={22} size={1.5} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  ),
};
