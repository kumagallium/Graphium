// 過去の手順からの引き継ぎピッカー（2 段）のストーリー。
//
// 見るべきところ:
//   - 1 段目で「何が引き継げるか」が名前と一緒に読めるか（記録の無い手順も選べる）
//   - 2 段目で key だけを並べ、値は「例」として薄く添えるに留まっているか
//   - 由来（素材／装置）が、同じ「温度」の意味の違いを伝えられているか

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepHistoryPicker } from "./StepHistoryPicker";
import type { ParamKeyStat, StepNameStat } from "./process-index";
import "../../app.css";

// 実データの並び（パラメータを持つ手順が先、次にノート数）に合わせている
const STEP_NAMES: StepNameStat[] = [
  { name: "液体急冷凝固", noteCount: 3, paramCount: 6 },
  { name: "秤量", noteCount: 5, paramCount: 4 },
  { name: "アーク溶解", noteCount: 2, paramCount: 4 },
  { name: "放電プラズマ焼結", noteCount: 1, paramCount: 4 },
  { name: "前処理", noteCount: 3, paramCount: 0 },
  { name: "合成", noteCount: 3, paramCount: 0 },
  { name: "整形", noteCount: 1, paramCount: 0 },
];

const SPS_PARAMS: ParamKeyStat[] = [
  { key: "圧力", noteCount: 4, sampleValue: "100 MPa", origin: "material" },
  { key: "温度", noteCount: 4, sampleValue: "1273 K", origin: "material" },
  { key: "雰囲気", noteCount: 3, sampleValue: "Ar 気流", origin: "material" },
  { key: "保持時間", noteCount: 2, sampleValue: "5 min", origin: "material" },
  { key: "ロール回転数", noteCount: 1, sampleValue: "8000 rpm", origin: "tool" },
];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 40, background: "var(--color-background)", minHeight: 480 }}>
      <div style={{ position: "relative", width: 520 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "var(--color-card)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span style={{ color: "var(--color-primary)" }}>≔</span>
          <span>放電プラズマ焼結</span>
        </div>
        {children}
      </div>
    </div>
  );
}

const meta = {
  title: "Process/StepHistoryPicker",
  component: StepHistoryPicker,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StepHistoryPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** 名前がまだ無い step から開いた状態（1 段目） */
export const PickName: Story = {
  args: {
    stepName: "",
    stepNames: STEP_NAMES,
    stats: [],
    onPickName: noop,
    onInsert: noop,
    onClose: noop,
  },
  render: (args: React.ComponentProps<typeof StepHistoryPicker>) => (
    <Frame>
      <StepHistoryPicker {...args} />
    </Frame>
  ),
};

/** 名前が決まっていて記録もある step（2 段目から始まる） */
export const PickParams: Story = {
  args: {
    stepName: "放電プラズマ焼結",
    stepNames: STEP_NAMES,
    stats: SPS_PARAMS,
    onPickName: noop,
    onInsert: noop,
    onClose: noop,
  },
  render: (args: React.ComponentProps<typeof StepHistoryPicker>) => (
    <Frame>
      <StepHistoryPicker {...args} />
    </Frame>
  ),
};

/** 名前を選んでからパラメータへ進む一連の流れ */
export const Interactive: Story = {
  args: { ...PickName.args },
  render: (args: React.ComponentProps<typeof StepHistoryPicker>) => {
    const [name, setName] = useState("");
    const [inserted, setInserted] = useState<string[] | null>(null);
    return (
      <Frame>
        <StepHistoryPicker
          {...args}
          stepName={name}
          stats={name === "放電プラズマ焼結" ? SPS_PARAMS : []}
          onPickName={setName}
          onInsert={setInserted}
        />
        {inserted && (
          <div
            style={{
              position: "absolute",
              top: 440,
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

/** 記録のある手順名だが、引き継げるパラメータが無い場合 */
export const NamedButNoParams: Story = {
  args: {
    stepName: "前処理",
    stepNames: STEP_NAMES,
    stats: [],
    onPickName: noop,
    onInsert: noop,
    onClose: noop,
  },
  render: (args: React.ComponentProps<typeof StepHistoryPicker>) => (
    <Frame>
      <StepHistoryPicker {...args} />
    </Frame>
  ),
};

/** 手順をまだ一度も書いていない（この状態ではアイコンから開けない） */
export const NoHistory: Story = {
  args: {
    stepName: "",
    stepNames: [],
    stats: [],
    onPickName: noop,
    onInsert: noop,
    onClose: noop,
  },
  render: (args: React.ComponentProps<typeof StepHistoryPicker>) => (
    <Frame>
      <StepHistoryPicker {...args} />
    </Frame>
  ),
};
