// 題の下の「日付の静かな 1 行」のカタログ。
// 議論用途: フォルダのチップの隣に、資料の日付と作成日を同じ重さの文字で並べる見た目と、
// 押したときの入力欄（年だけ・年月だけ・読めない書き方）を小さく合意する。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextBadge } from "../note-context/ContextBadge";
import { SourceDateLine } from "./SourceDateLine";

const meta: Meta = {
  title: "Molecules/SourceDateLine",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

const CREATED = "2026-11-22T09:30:00+09:00";

/** 題の下の行を再現する（フォルダのチップ → ＋フォルダ → 日付の 1 行） */
function HeaderRow({
  initial,
  defaultOpen,
  editable = true,
}: {
  initial?: string;
  defaultOpen?: boolean;
  editable?: boolean;
}) {
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
        <SourceDateLine
          value={value}
          createdAt={CREATED}
          editable={editable}
          onChange={setValue}
          defaultOpen={defaultOpen}
        />
      </div>
      <p className="mt-6 text-xs text-muted-foreground">sourceDate: {value ?? "(none)"}</p>
    </div>
  );
}

export const Unset: Story = {
  name: "資料の日付が無い（作成日だけ）",
  render: () => <HeaderRow />,
};

export const YearOnly: Story = {
  name: "年だけ付いている",
  render: () => <HeaderRow initial="2016" />,
};

export const YearMonth: Story = {
  name: "年月まで付いている",
  render: () => <HeaderRow initial="2012-03" />,
};

export const ReadOnly: Story = {
  name: "アーカイブ中（直せない）",
  render: () => <HeaderRow initial="2016" editable={false} />,
};

export const Editing: Story = {
  name: "入力欄を開いたところ",
  render: () => <HeaderRow initial="2012-03" defaultOpen />,
};
