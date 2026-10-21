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

const withSummary: MeetingTranscriptCardProps = {
  ...common,
  expanded: true,
  summaryEnabled: true,
  onSummarize: () => {},
};

export const SummaryDone: Story = {
  name: "要約あり（もう一度要約）",
  args: { ...withSummary, summarized: true },
};

export const Summarizing: Story = {
  name: "要約中",
  args: { ...withSummary, summarizing: true },
};

export const SummaryFailed: Story = {
  name: "要約の失敗",
  args: { ...withSummary, summaryError: "AI に接続できませんでした" },
};

// ── 録音を終えたブロック: 文字起こし / 清書 / 要約 のタブと「ノートに書き出す」 ──

const cleanupDoc = {
  version: 1 as const,
  createdAt: "2026-10-20T15:05:00+09:00",
  model: "demo",
  paragraphs: [
    { id: "c1", track: "system" as const, startMs: 843_000, text: "来週までに、試料の焼成条件を揃えられそうです。温度は 850 °C で固定します。", sources: [] },
    { id: "c2", track: "mic" as const, startMs: 867_000, text: "なるほど。その方向で進めましょう。", sources: [] },
    { id: "c3", track: "system" as const, startMs: 891_000, text: "XRD は金曜に測ります。結果は共有フォルダに置きます。", sources: [] },
  ],
};

const summary = {
  version: 1 as const,
  createdAt: "2026-10-20T15:06:00+09:00",
  model: "demo",
  basedOn: "cleanup" as const,
  decisions: [{ text: "焼成温度は 850 °C で固定する", sources: [{ track: "system" as const, startMs: 843_000 }] }],
  todos: [{ text: "XRD を測って共有フォルダに置く", owner: "相手", due: "金曜", sources: [{ track: "system" as const, startMs: 891_000 }] }],
  issues: [{ text: "保持時間はまだ決まっていない", sources: [{ track: "mic" as const, startMs: 867_000 }, { track: "system" as const, startMs: 891_000 }] }],
};

const tabbed: MeetingTranscriptCardProps = {
  ...common,
  summaryEnabled: true,
  onSummarize: () => {},
  onCleanup: () => {},
  onWriteOut: () => {},
};

export const TabsTranscript: Story = {
  name: "完了: 文字起こし（清書・要約はまだ）",
  args: tabbed,
};

export const TabsCleanupIntro: Story = {
  name: "完了: 清書タブ（まだ清書していない）",
  args: { ...tabbed, initialTab: "cleanup" },
};

export const TabsCleanupRunning: Story = {
  name: "完了: 清書中",
  args: { ...tabbed, initialTab: "cleanup", cleaning: { done: 2, total: 5, etaMs: 27 * 60_000 } },
};

export const TabsCleanup: Story = {
  name: "完了: 清書あり",
  args: { ...tabbed, cleanup: cleanupDoc },
};

export const TabsSummary: Story = {
  name: "完了: 要約あり（清書から）",
  args: { ...tabbed, cleanup: cleanupDoc, summaryDoc: summary },
};

export const TabsNoAi: Story = {
  name: "完了: AI を使わない（文字起こしと書き出しだけ）",
  args: { ...tabbed, summaryEnabled: false },
};

export const TabsNoAiWithOldCleanup: Story = {
  name: "完了: AI を使わない・以前の清書あり（読めるが作り直せない）",
  args: { ...tabbed, summaryEnabled: false, cleanup: cleanupDoc, initialTab: "summary" },
};

export const TabsCleanupFailed: Story = {
  name: "完了: 清書の失敗",
  args: { ...tabbed, initialTab: "cleanup", cleanupError: "清書できませんでした（AI に接続できませんでした）。もう一度お試しください" },
};

// ── 名前や連絡先を伏せる ──

const maskedCleanup = {
  ...cleanupDoc,
  masked: true,
  paragraphs: [
    { id: "c1", track: "system" as const, startMs: 843_000, text: "［人名］さんと相談して、来週までに試料の焼成条件を揃えます。温度は 850 °C で固定します。", sources: [] },
    { id: "c2", track: "mic" as const, startMs: 867_000, text: "なるほど。［組織名］にもその方向で伝えましょう。", sources: [] },
    { id: "c3", track: "system" as const, startMs: 891_000, text: "XRD は金曜に測ります。結果は ［連絡先］ に送ります。", sources: [] },
  ],
};

export const TabsMaskOnOldCleanup: Story = {
  name: "伏せる: 伏せる前の清書（書き出せない）",
  args: { ...tabbed, maskSensitive: true, onToggleMask: () => {}, cleanup: cleanupDoc, initialTab: "cleanup" },
};

export const TabsMaskOnMasked: Story = {
  name: "伏せる: 伏せた清書",
  args: { ...tabbed, maskSensitive: true, onToggleMask: () => {}, cleanup: maskedCleanup, initialTab: "cleanup" },
};

// マニュアルの図（英語 UI・パン作りの世界観）。scripts/manual-screenshots-voice-note.mjs で撮る
const breadLines: TranscriptSegment[] = [
  { track: "system", startMs: 4_000, text: "So, um, the second batch came out of the oven at two fifteen." },
  { track: "mic", startMs: 11_000, text: "OK, and the crumb?" },
  { track: "system", startMs: 15_000, text: "Tighter than last week. I think the, uh, proof was too short." },
  { track: "mic", startMs: 24_000, text: "Let's give it ninety minutes next time." },
  { track: "system", startMs: 31_000, text: "Sure. I'll write down the room temperature too." },
];

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  args: {
    ...tabbed,
    segments: breadLines,
    startedAt: "2026-10-20T10:00:00+09:00",
    durationMs: 1_845_000,
    canPlay: true,
    loadAudio: () => Promise.resolve(null),
    cleanup: {
      version: 1,
      createdAt: "",
      model: "demo",
      paragraphs: [
        { id: "c1", track: "system", startMs: 4_000, text: "The second batch came out of the oven at 2:15.", sources: [] },
        { id: "c2", track: "mic", startMs: 11_000, text: "And the crumb?", sources: [] },
        { id: "c3", track: "system", startMs: 15_000, text: "Tighter than last week. I think the proof was too short.", sources: [] },
        { id: "c4", track: "mic", startMs: 24_000, text: "Let's give it ninety minutes next time.", sources: [] },
        { id: "c5", track: "system", startMs: 31_000, text: "I'll write down the room temperature too.", sources: [] },
      ],
    },
    summaryDoc: {
      version: 1,
      createdAt: "",
      model: "demo",
      basedOn: "cleanup",
      decisions: [{ text: "Proof the next batch for 90 minutes", sources: [{ track: "mic", startMs: 24_000 }] }],
      todos: [{ text: "Record the room temperature with each batch", owner: "Others", sources: [{ track: "system", startMs: 31_000 }] }],
      issues: [{ text: "Why the crumb was tighter than last week", sources: [{ track: "system", startMs: 15_000 }] }],
    },
  },
};
