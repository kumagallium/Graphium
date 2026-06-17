// 手順フローグラフ（ノードエディタ的リンク）の試作ストーリー
//
// 検証ポイント:
//   - 手順 A → 手順 B のドラッグで手順依存（A → B）が引けるか
//   - 手順ノードだけのシンプルなフロー図になっているか（output は描かない）
//   - エッジをクリックして削除できるか

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { ActivityGraph, type ActivityNode, type StepEdge } from "./activity-graph";
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

function Demo({ initial }: { initial: StepEdge[] }) {
  const [steps, setSteps] = useState<StepEdge[]>(initial);
  const counter = useRef(initial.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <ActivityGraph
        activities={ACTIVITIES}
        steps={steps}
        onConnectSteps={(producer, consumer) => {
          counter.current += 1;
          setSteps((prev) =>
            prev.some((s) => s.from === producer && s.to === consumer)
              ? prev
              : [
                  ...prev,
                  { id: `step-${counter.current}`, from: producer, to: consumer, deletable: true },
                ],
          );
        }}
        onRemoveStep={(id) => setSteps((prev) => prev.filter((s) => s.id !== id))}
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
        {JSON.stringify(steps, null, 2)}
      </pre>
    </div>
  );
}

type Story = StoryObj;

// 空の状態から自分でつないでみる
export const Empty: Story = {
  render: () => <Demo initial={[]} />,
};

// 既存の手順依存が 1 本ある状態（具材を切る → 炒める）
export const WithExistingStep: Story = {
  render: () => <Demo initial={[{ id: "step-0", from: "h-cut", to: "h-fry", deletable: true }]} />,
};
