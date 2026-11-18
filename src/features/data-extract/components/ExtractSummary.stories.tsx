// 結果の要約のストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExtractSummary } from "./ExtractSummary";

const meta: Meta<typeof ExtractSummary> = {
  title: "Features/DataExtract/ExtractSummary",
  component: ExtractSummary,
  decorators: [(Story) => <div className="p-4"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof ExtractSummary>;

export const Normal: Story = {
  args: { sourceRows: 233000, resultRows: 1204, columnCount: 4, sameAsSource: false },
};

/** 0 行。条件を見直す手がかりを控えめに添える */
export const ZeroRows: Story = {
  args: { sourceRows: 233000, resultRows: 0, columnCount: 4, sameAsSource: false },
};

/** 条件なし・全列。元と同じ内容になる */
export const SameAsSource: Story = {
  args: { sourceRows: 120, resultRows: 120, columnCount: 5, sameAsSource: true },
};

/** 「なし」を押した直後。確定できない理由を添える */
export const ZeroColumns: Story = {
  args: { sourceRows: 120, resultRows: 120, columnCount: 0, sameAsSource: false },
};
