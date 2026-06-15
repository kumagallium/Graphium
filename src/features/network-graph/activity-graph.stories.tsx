// Activity グラフ（ノードエディタ的リンク）の試作ストーリー
//
// 検証ポイント:
//   - 手順 A → 手順 B のドラッグで、A に output が無ければ自動補完、
//     既にあれば【再利用】して used を足すか
//   - 1 つの output を複数手順が used できるか（fan-out）
//   - activity 同士は直接つながらず、必ず output を挟むか

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import {
  ActivityGraph,
  type ActivityNode,
  type OutputEntity,
  type UseEdge,
} from "./activity-graph";
import { LocaleProvider } from "../../i18n";

const meta: Meta = {
  title: "Organisms/ActivityGraph (prototype)",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ height: "100vh", padding: 16, boxSizing: "border-box" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

// ── モックデータ（カレー実験の手順。連番除去後の純粋な名前）──
const ACTIVITIES: ActivityNode[] = [
  { id: "h-cut", name: "具材を切る" },
  { id: "h-fry", name: "炒める" },
  { id: "h-simmer", name: "煮込む" },
  { id: "h-plate", name: "盛り付け" },
];

const NAME = new Map(ACTIVITIES.map((a) => [a.id, a.name]));

function Demo({
  initialOutputs,
  initialUses,
}: {
  initialOutputs: OutputEntity[];
  initialUses: UseEdge[];
}) {
  const [outputs, setOutputs] = useState<OutputEntity[]>(initialOutputs);
  const [uses, setUses] = useState<UseEdge[]>(initialUses);
  const oid = useRef(initialOutputs.length);
  const uid = useRef(initialUses.length);

  // 同じ output→consumer の重複を防いで used を足す
  const addUse = (outputId: string, consumer: string) => {
    setUses((prev) =>
      prev.some((u) => u.outputId === outputId && u.consumer === consumer)
        ? prev
        : [...prev, { id: `use-${(uid.current += 1)}`, outputId, consumer }],
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <ActivityGraph
        activities={ACTIVITIES}
        outputs={outputs}
        uses={uses}
        onLinkActivities={(from, to) => {
          // A の output があれば再利用、無ければ自動補完してから used を張る
          const existing = outputs.find((o) => o.owner === from);
          if (existing) {
            addUse(existing.id, to);
          } else {
            const newId = `out-${(oid.current += 1)}`;
            setOutputs((prev) => [
              ...prev,
              { id: newId, owner: from, label: `${NAME.get(from) ?? from} の結果` },
            ]);
            addUse(newId, to);
          }
        }}
        onLinkOutput={(outputId, to) => addUse(outputId, to)}
        onRemoveUse={(id) => setUses((prev) => prev.filter((u) => u.id !== id))}
      />
      <pre
        style={{
          margin: 0,
          padding: 8,
          fontSize: 11,
          background: "#f3f6f3",
          borderRadius: 6,
          color: "#445",
          maxHeight: 130,
          overflow: "auto",
        }}
      >
        {JSON.stringify({ outputs, uses }, null, 2)}
      </pre>
    </div>
  );
}

type Story = StoryObj;

// 空の状態から自分でつないでみる
export const Empty: Story = {
  render: () => <Demo initialOutputs={[]} initialUses={[]} />,
};

// 具材を切る に output があり、炒める が使っている状態。
//   → 具材を切る → 煮込む を引くと output が【再利用】される（新規作成されない）
//   → output ⬡ から 煮込む へ引いても同じ（fan-out）
export const WithExistingOutput: Story = {
  render: () => (
    <Demo
      initialOutputs={[{ id: "out-0", owner: "h-cut", label: "具材を切る の結果" }]}
      initialUses={[{ id: "use-0", outputId: "out-0", consumer: "h-fry" }]}
    />
  ),
};
