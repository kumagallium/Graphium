// 「モデルの目安」と、難しさ別に並べ替えたモデルの割り当てのストーリー。
//
// 設定 → AI の「モデルの割り当て」と同じ並び（デフォルト → 標準 → 精密 → 機能ごとに変える）を、
// 設定画面と同じ SettingSection / SettingsGroup で組んで、見た目と並びを確かめる。
// 目安の中身は model-fit.ts（2026-11-07 の測定）をそのまま使う。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import { SettingSection } from "./SettingSection";
import { SettingsGroup, SETTINGS_BLOCK_BODY_CLASS, SETTINGS_BLOCK_TITLE_CLASS } from "./SettingsGroup";
import { ModelFitHint } from "./ModelFitHint";
import type { ModelSlot } from "./model-fit";

const meta = {
  title: "Molecules/ModelFitHint",
  component: ModelFitHint,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ModelFitHint>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 部品だけ（デフォルトモデルの段） */
export const Default: Story = { args: { slot: "default" } };

type Row = { slot: ModelSlot; title: string; summary: string; empty: string };

const TIERS: Row[] = [
  { slot: "default", title: "デフォルトモデル", summary: "軽い処理（チャット・点検・出典照合・題付け）に使います。ほかの段を空欄にすれば、すべてこのモデルで動きます", empty: "サーバーデフォルト（qwen3.6-35b-a3b）" },
  { slot: "standard", title: "標準の処理のモデル", summary: "ナレッジ化・翻訳・トピックの整理に使います。空欄ならデフォルトモデル", empty: "デフォルトモデルと同じ" },
  { slot: "precise", title: "精密な処理のモデル", summary: "手順の抽出・計画・洞察・清書に使います。空欄なら標準の処理のモデル", empty: "標準の処理のモデルと同じ" },
];

const OVERRIDES: Row[] = [
  { slot: "chat", title: "チャットモデル", summary: "AI チャットだけ別のモデルにする（空欄ならデフォルトモデル）", empty: "デフォルトモデルと同じ" },
  { slot: "grounding", title: "世界モデル照合用モデル", summary: "未指定なら、デフォルトモデルをそのまま使います。", empty: "デフォルトモデルと同じ" },
];

function SlotRow({ row }: { row: Row }) {
  return (
    <SettingSection title={row.title} summary={row.summary} details={<p>（くわしく）</p>}>
      <div className="relative">
        <select
          className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
          defaultValue=""
          aria-label={row.title}
        >
          <option value="">{row.empty}</option>
          <option>claude-opus-5</option>
          <option>qwen3.6-35b-a3b</option>
          <option>qwen3.5-9b</option>
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      </div>
      <ModelFitHint slot={row.slot} />
    </SettingSection>
  );
}

/** 設定 → AI の「モデルの割り当て」と同じ並び。機能ごとの上書きは畳んだ束の中 */
export const AllSlotsInSettings: Story = {
  args: { slot: "default" },
  render: () => (
    <div className="max-w-xl">
      <h3 className={`${SETTINGS_BLOCK_TITLE_CLASS} mb-3`}>モデルの割り当て</h3>
      <div className={`space-y-4 ${SETTINGS_BLOCK_BODY_CLASS}`}>
        {TIERS.map((r) => <SlotRow key={r.slot} row={r} />)}
        <SettingsGroup
          storageKey="story-model-overrides"
          title="機能ごとに変える"
          summary="チャットと世界照合だけ、ほかと違うモデルにする（任意）"
        >
          <div className="space-y-4">
            {OVERRIDES.map((r) => <SlotRow key={r.slot} row={r} />)}
          </div>
        </SettingsGroup>
      </div>
    </div>
  ),
};

/** 音声ノートの欄（デスクトップ版。空欄なら精密な処理のモデル） */
export const MeetingSlot: Story = {
  args: { slot: "meeting" },
  render: () => (
    <div className="max-w-xl">
      <SlotRow row={{ slot: "meeting", title: "清書と要約に使う AI モデル", summary: "文字起こしは AI モデルなしで動きます。清書と要約のときだけ、ここで選んだモデルに文字を送ります", empty: "精密な処理のモデルと同じ（claude-opus-5）" }} />
    </div>
  ),
};
