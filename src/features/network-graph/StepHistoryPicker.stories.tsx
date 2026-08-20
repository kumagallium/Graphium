// 過去の手順からの引き継ぎピッカー（2 段）のストーリー。
//
// 見るべきところ:
//   - 1 段目で「何が引き継げるか」が名前と一緒に読めるか（記録の無い手順も選べる）
//   - 2 段目で key だけを並べ、値は「例」として薄く添えるに留まっているか
//   - 由来（素材／装置）が、同じ「温度」の意味の違いを伝えられているか

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepHistoryPicker } from "./StepHistoryPicker";
import type { StepInheritance, StepNameStat } from "./process-index";
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

// 実データの形（放電プラズマ焼結）に合わせている: 手順直結のパラメータは無く、
// 条件は投入する素材に、装置は名前だけが記録されている
const SPS: StepInheritance = {
  stepParams: [],
  entities: [
    {
      label: "粉砕粉末",
      kind: "material",
      noteCount: 1,
      attrs: [
        { key: "圧力", noteCount: 1, sampleValue: "100 MPa", origin: "material" },
        { key: "温度", noteCount: 1, sampleValue: "1273 K", origin: "material" },
        { key: "雰囲気", noteCount: 1, sampleValue: "Ar 気流", origin: "material" },
        { key: "保持時間", noteCount: 1, sampleValue: "5 min", origin: "material" },
      ],
    },
    { label: "SPS-515A", kind: "tool", noteCount: 1, attrs: [] },
  ],
};

/** 手順にも条件が書かれているノートがある場合（両方のセクションが出る） */
const MIXED: StepInheritance = {
  stepParams: [{ key: "保持時間", noteCount: 2, sampleValue: "5 min", origin: "step" }],
  entities: SPS.entities,
};

const EMPTY: StepInheritance = { stepParams: [], entities: [] };

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
    inheritance: EMPTY,
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
    inheritance: SPS,
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
          inheritance={name === "放電プラズマ焼結" ? SPS : EMPTY}
          onPickName={setName}
          onInsert={(picked) =>
            setInserted([...picked.paramKeys, ...picked.entities.map((e) => e.label)])
          }
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

/** 手順にも素材にも記録がある場合（2 つのセクションが並ぶ） */
export const BothSections: Story = {
  args: {
    stepName: "放電プラズマ焼結",
    stepNames: STEP_NAMES,
    inheritance: MIXED,
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

/** 記録のある手順名だが、引き継げるパラメータが無い場合 */
export const NamedButNoParams: Story = {
  args: {
    stepName: "前処理",
    stepNames: STEP_NAMES,
    inheritance: EMPTY,
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
    inheritance: EMPTY,
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
