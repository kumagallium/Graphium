// 共通ツールチップ（src/ui/tooltip.ts）のカタログ。マウスを乗せて確かめる

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings, X, Trash2 } from "lucide-react";
import { IconButton } from "./icon-button";

const meta: Meta = {
  title: "Atoms/Tooltip",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

export const Kinds: Story = {
  name: "ヒントの種類",
  render: () => (
    <div className="flex flex-col gap-6">
      <section className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-40">名前（IconButton は自動）</span>
        <IconButton aria-label="設定"><Settings /></IconButton>
        <IconButton aria-label="閉じる"><X /></IconButton>
      </section>
      <section className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-40">名前＋使い方</span>
        <IconButton aria-label="ゴミ箱へ移動" tooltipUsage="30 日たつと完全に削除されます"><Trash2 /></IconButton>
      </section>
      <section className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-40">長い説明（改行）</span>
        <span
          className="rounded border border-border px-2 py-0.5 text-xs"
          data-tooltip={"出典照合: 一致\n本文の主張が引用元の文章で確かめられました"}
        >
          一致
        </span>
      </section>
      <section className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-40">文字のあるボタン（付けない）</span>
        <button className="rounded border border-border px-3 py-1 text-sm">保存</button>
      </section>
    </div>
  ),
};
