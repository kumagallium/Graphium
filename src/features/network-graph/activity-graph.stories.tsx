// Activity グラフ（ノードエディタ的リンク）の試作ストーリー
//
// 検証ポイント:
//   - ノードからドラッグして手順どうしをつなげるか（余白ラベル → モーダルの代替）
//   - ドロップ時に関係種（前の手順 / 再現）を選べるか
//   - エッジをクリックして削除できるか

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { ActivityGraph, type ActivityEdge, type ActivityNode } from "./activity-graph";
import type { ProvLinkType } from "../block-link/link-types";
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

// ── モックデータ（カレー実験の手順。Q2 の連番除去後の純粋な名前）──
const ACTIVITIES: ActivityNode[] = [
  { id: "h-cut", name: "具材を切る" },
  { id: "h-fry", name: "炒める" },
  { id: "h-simmer", name: "煮込む" },
  { id: "h-plate", name: "盛り付け" },
];

function Demo({ initial }: { initial: ActivityEdge[] }) {
  const [edges, setEdges] = useState<ActivityEdge[]>(initial);
  const counter = useRef(initial.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <ActivityGraph
        activities={ACTIVITIES}
        edges={edges}
        onCreateEdge={(source, target, type: ProvLinkType) => {
          counter.current += 1;
          setEdges((prev) => [
            ...prev,
            { id: `e-${counter.current}`, source, target, type },
          ]);
        }}
        onRemoveEdge={(id) => setEdges((prev) => prev.filter((e) => e.id !== id))}
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
        {JSON.stringify(edges, null, 2)}
      </pre>
    </div>
  );
}

type Story = StoryObj;

// 空の状態から自分でつないでみる
export const Empty: Story = {
  render: () => <Demo initial={[]} />,
};

// 既存リンクが 1 本ある状態（炒める は 具材を切る を前手順とする）
export const WithExistingLink: Story = {
  render: () => (
    <Demo
      initial={[{ id: "e-0", source: "h-fry", target: "h-cut", type: "informed_by" }]}
    />
  ),
};
