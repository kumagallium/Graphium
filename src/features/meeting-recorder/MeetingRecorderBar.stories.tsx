// MeetingRecorderBar — 録音中の固定バー
// 画面下中央に fixed 表示。経過時間・相手 / 自分のレベル・止めるボタン。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetingRecorderBar } from "./MeetingRecorderBar";

const meta: Meta<typeof MeetingRecorderBar> = {
  title: "Molecules/MeetingRecorderBar",
  component: MeetingRecorderBar,
  parameters: { layout: "fullscreen" },
  args: { onStop: () => {} },
  decorators: [(Story) => <div className="min-h-[200px]"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof MeetingRecorderBar>;

export const Talking: Story = {
  args: { elapsedMs: 754_000, level: { system: 0.12, mic: 0.03 } },
};

export const Silent: Story = {
  args: { elapsedMs: 5_000, level: { system: 0, mic: 0 } },
};

export const Stopping: Story = {
  args: { elapsedMs: 3_725_000, level: { system: 0, mic: 0 }, stopping: true },
};

export const WithWarning: Story = {
  args: {
    elapsedMs: 312_000,
    level: { system: 0, mic: 0.08 },
    warning: "システム音声の取得に失敗しました",
  },
};

export const Transcribing: Story = {
  args: { elapsedMs: 612_000, level: { system: 0.1, mic: 0.02 }, transcribeCount: 12 },
};
