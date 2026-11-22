// 「資料の日付」チップのカタログ。
// 議論用途: ノートの題の下（フォルダのチップの隣）に置くチップの見た目と、
// 押したときの入力欄（年だけ・年月だけ・読めない書き方）を小さく合意する。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextBadge } from "../note-context/ContextBadge";
import { SourceDateChip } from "./SourceDateChip";

const meta: Meta = {
  title: "Molecules/SourceDateChip",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/** 題の下の行を再現する（フォルダのチップ → ＋フォルダ → 資料の日付） */
function HeaderRow({ initial, defaultOpen }: { initial?: string; defaultOpen?: boolean }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div className="p-6 bg-background" style={{ minHeight: 260 }}>
      <div className="text-3xl font-bold text-foreground mb-5">Sourdough hydration and crumb structure</div>
      <div className="-mt-3 flex flex-wrap items-center gap-1.5">
        <ContextBadge value="Bread/Papers" onRemove={() => {}} />
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground"
        >
          ＋ Folder
        </button>
        <SourceDateChip value={value} onChange={setValue} defaultOpen={defaultOpen} />
      </div>
      <p className="mt-6 text-xs text-muted-foreground">sourceDate: {value ?? "(none)"}</p>
    </div>
  );
}

export const Unset: Story = {
  name: "付いていない",
  render: () => <HeaderRow />,
};

export const YearMonth: Story = {
  name: "年月まで付いている",
  render: () => <HeaderRow initial="2012-03" />,
};

export const YearOnly: Story = {
  name: "年だけ付いている",
  render: () => <HeaderRow initial="2012" />,
};

export const Editing: Story = {
  name: "入力欄を開いたところ",
  render: () => <HeaderRow initial="2012-03" defaultOpen />,
};
