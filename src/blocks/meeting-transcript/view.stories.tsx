// 会議の文字起こしブロックのストーリー（見た目だけを確認する。ストア・エディタは使わない）
// 話者は色分けせず、行頭ラベルで区別する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetingTranscriptCard, type MeetingTranscriptCardProps } from "./card";
import type { TranscriptSegment } from "../../features/meeting-recorder/transcript-format";

const meta: Meta<typeof MeetingTranscriptCard> = {
  title: "Blocks/MeetingTranscriptBlock",
  component: MeetingTranscriptCard,
  parameters: { layout: "padded" },
  decorators: [(Story) => <div style={{ maxWidth: 800 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof MeetingTranscriptCard>;

const lines: TranscriptSegment[] = Array.from({ length: 24 }, (_, i) => ({
  track: i % 3 === 2 ? "mic" : "system",
  startMs: 843_000 + i * 12_000,
  text: i % 3 === 2 ? "なるほど、その方向で進めましょう。" : "来週までに試料の条件を揃えられそうです。",
}));

const common: MeetingTranscriptCardProps = {
  status: "done",
  segments: lines,
  startedAt: "2026-10-20T14:00:00+09:00",
  durationMs: 3_725_000,
  collapsed: false,
  expanded: false,
  showAll: false,
  editable: true,
  onToggleCollapsed: () => {},
  onToggleShowAll: () => {},
  onExpand: () => {},
};

export const Recording: Story = {
  name: "録音中",
  args: { ...common, status: "recording", segments: lines.slice(0, 4), durationMs: 754_000 },
};

export const Done: Story = {
  name: "完了（直近 20 発言）",
  args: common,
};

export const Expanded: Story = {
  name: "展開済み",
  args: { ...common, expanded: true },
};

export const Unreadable: Story = {
  name: "読めない（このデバイス）",
  args: { ...common, status: "unavailable", segments: [] },
};

export const Ready: Story = {
  name: "録音前（録音を始める）",
  args: { ...common, status: "ready", segments: [], captureSystem: true, onCaptureSystemChange: () => {}, onStartRecording: () => {} },
};

export const ReadyNotDesktop: Story = {
  name: "録音前（このデバイスでは録音できない）",
  args: { ...common, status: "readyUnavailable", segments: [] },
};
