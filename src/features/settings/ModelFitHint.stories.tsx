// 「モデルの目安」のストーリー。
//
// 5 つの割り当て枠を縦に並べ、設定画面と同じ SettingSection の中でどう見えるかを確かめる。
// 目安の中身は model-fit.ts（2026-11-07 の測定）をそのまま使う。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import { SettingSection } from "./SettingSection";
import { ModelFitHint } from "./ModelFitHint";
import type { ModelSlot } from "./model-fit";

const meta = {
  title: "Molecules/ModelFitHint",
  component: ModelFitHint,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ModelFitHint>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 部品だけ（デフォルトモデルの枠） */
export const Default: Story = { args: { slot: "default" } };

const SLOTS: { slot: ModelSlot; title: string; summary: string; empty: string }[] = [
  { slot: "default", title: "デフォルトモデル", summary: "ほかを空欄にしておけば、AI の機能はすべてこのモデルを使います", empty: "デフォルト（claude-opus-5）" },
  { slot: "chat", title: "チャットモデル", summary: "AI チャット・点検・トピックの統合に使うモデル", empty: "デフォルトモデルと同じ" },
  { slot: "insight", title: "洞察モデル", summary: "未指定なら、デフォルトモデルをそのまま使います。", empty: "デフォルトモデルと同じ" },
  { slot: "grounding", title: "世界モデル照合用モデル", summary: "未指定なら、デフォルトモデルをそのまま使います。", empty: "デフォルトモデルと同じ" },
  { slot: "meeting", title: "清書と要約に使う AI モデル", summary: "文字起こしは AI モデルなしで動きます。清書と要約のときだけ、ここで選んだモデルに文字を送ります", empty: "デフォルトモデルと同じ（claude-opus-5）" },
];

/** 設定画面の割り当ての並び（5 つの枠）に置いたところ */
export const AllSlotsInSettings: Story = {
  args: { slot: "default" },
  render: () => (
    <div className="max-w-xl space-y-4">
      {SLOTS.map((s) => (
        <SettingSection key={s.slot} title={s.title} summary={s.summary} details={<p>（くわしく）</p>}>
          <div className="relative">
            <select
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground"
              defaultValue=""
              aria-label={s.title}
            >
              <option value="">{s.empty}</option>
              <option>claude-opus-5</option>
              <option>qwen3.5-9b</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
          <ModelFitHint slot={s.slot} />
        </SettingSection>
      ))}
    </div>
  ),
};
