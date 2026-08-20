// 手順パラメータ引き継ぎピッカーのストーリー。
//
// 見るべきところ:
//   - key だけを並べ、値は「例」として薄く添えるに留まっているか
//   - 件数の帯で「よく使う欄」と「たまに使う欄」の差が一目で分かるか
//   - 手順名が空のとき、空振りではなく次の一手が示されているか

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepParamPicker } from "./StepParamPicker";
import type { ParamKeyStat } from "./process-index";
import "../../app.css";

const FIRING: ParamKeyStat[] = [
  { key: "温度", noteCount: 12, sampleValue: "500℃", origin: "material" },
  { key: "保持時間", noteCount: 11, sampleValue: "2h", origin: "material" },
  { key: "雰囲気", noteCount: 7, sampleValue: "Ar", origin: "tool" },
  { key: "昇温速度", noteCount: 4, sampleValue: "5℃/min", origin: "tool" },
  { key: "焼成温度", noteCount: 2, sampleValue: "600℃", origin: "step" },
];

// ピッカーは step ヘッダーのボタンから開く想定なので、
// 位置決めが効いているかを見るために相対配置の器に載せる
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 40, background: "var(--color-background)", minHeight: 460 }}>
      <div style={{ position: "relative", width: 520 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "var(--color-card)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>焼成</span>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>過去の手順から ▾</span>
        </div>
        {children}
      </div>
    </div>
  );
}

const meta = {
  title: "Process/StepParamPicker",
  component: StepParamPicker,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StepParamPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 過去の記録が十分にある、いちばん普通の状態 */
export const Default: Story = {
  args: {
    stepName: "焼成",
    stats: FIRING,
    noteCount: 12,
    onInsert: () => {},
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <StepParamPicker {...args} />
    </Frame>
  ),
};

/** 選択の見え方（チェック・帯の濃さ・ボタンの活性）を確かめる */
export const Interactive: Story = {
  args: { ...Default.args },
  render: (args) => {
    const [inserted, setInserted] = useState<string[] | null>(null);
    return (
      <Frame>
        <StepParamPicker {...args} onInsert={setInserted} onClose={() => {}} />
        {inserted && (
          <div
            style={{
              position: "absolute",
              top: 400,
              left: 0,
              fontSize: 12,
              color: "var(--color-muted-foreground)",
            }}
          >
            追加された欄: {inserted.join(" / ")}
          </div>
        )}
      </Frame>
    );
  },
};

/** 表記ゆれを統合しない方針が、実際どう見えるか（「温度」と「焼成温度」が並ぶ） */
export const SpellingVariants: Story = {
  args: {
    stepName: "焼成",
    stats: [
      { key: "温度", noteCount: 8, sampleValue: "500℃" },
      { key: "焼成温度", noteCount: 5, sampleValue: "600℃" },
      { key: "Temperature", noteCount: 3, sampleValue: "550 C" },
    ],
    noteCount: 14,
    onInsert: () => {},
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <StepParamPicker {...args} />
    </Frame>
  ),
};

/** 初めての手順名。責めずに、次に何をすればいいかだけ伝える */
export const NoHistory: Story = {
  args: {
    stepName: "スパークプラズマ焼結",
    stats: [],
    onInsert: () => {},
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <StepParamPicker {...args} />
    </Frame>
  ),
};

/** 手順名を入れる前に開いた状態 */
export const Unnamed: Story = {
  args: {
    stepName: "",
    stats: [],
    onInsert: () => {},
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <StepParamPicker {...args} />
    </Frame>
  ),
};

/** 記録が 1 件だけ（帯が満杯に見えて誤解を生まないか） */
export const SingleEntry: Story = {
  args: {
    stepName: "粉砕",
    stats: [{ key: "回転数", noteCount: 1, sampleValue: "300rpm" }],
    noteCount: 1,
    onInsert: () => {},
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <StepParamPicker {...args} />
    </Frame>
  ),
};
