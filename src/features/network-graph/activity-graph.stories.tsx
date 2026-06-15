// Activity グラフ（ノードエディタ的リンク）の試作ストーリー
//
// 検証ポイント:
//   - 手順ノードの出力ポート → 別手順の入力ポートへドラッグするだけで、
//     間に output entity が自動補完され generated / used が張られるか
//   - activity 同士は直接つながらず、必ず entity を挟むか
//   - entity / エッジをクリックして操作ごと削除できるか

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { ActivityGraph, type Operation, type ActivityNode } from "./activity-graph";
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

function Demo({ initial }: { initial: Operation[] }) {
  const [ops, setOps] = useState<Operation[]>(initial);
  const counter = useRef(initial.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <ActivityGraph
        activities={ACTIVITIES}
        operations={ops}
        onCreateOperation={(from, to) => {
          counter.current += 1;
          setOps((prev) => [
            ...prev,
            {
              id: `op-${counter.current}`,
              from,
              to,
              // ドキュメントに output が無いケースの仮ラベル（既存生成側の規約に合わせる）
              outputLabel: `${NAME.get(from) ?? from} の結果`,
            },
          ]);
        }}
        onRemoveOperation={(id) => setOps((prev) => prev.filter((o) => o.id !== id))}
      />
      <pre
        style={{
          margin: 0,
          padding: 8,
          fontSize: 11,
          background: "#f3f6f3",
          borderRadius: 6,
          color: "#445",
          maxHeight: 120,
          overflow: "auto",
        }}
      >
        {JSON.stringify(ops, null, 2)}
      </pre>
    </div>
  );
}

type Story = StoryObj;

// 空の状態から自分でつないでみる
export const Empty: Story = {
  render: () => <Demo initial={[]} />,
};

// 既存の操作が 1 本ある状態（具材を切る → [具材を切る の結果] → 炒める）
export const WithExistingOperation: Story = {
  render: () => (
    <Demo
      initial={[
        { id: "op-0", from: "h-cut", to: "h-fry", outputLabel: "具材を切る の結果" },
      ]}
    />
  ),
};
