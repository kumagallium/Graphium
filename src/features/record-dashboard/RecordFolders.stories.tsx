// 記録の画面の「フォルダごとの動き」のデザイン提案。
// フォルダごとに、いちばん新しい記録の日・直近 14 日の日ごとの件数・残した人・まだチェックの付いていない項目の数を見せる。
// どれも記録から数えるだけで、進み具合として保存している状態は無い。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { useLocale } from "../../i18n";
import { useRecordCopy } from "./copy";
import { countByDay, dayKeyOf, matchesFolder, monthKeyOf, summarizeFolders } from "./model";
import { RecordCalendar } from "./RecordCalendar";
import { RecordFolders } from "./RecordFolders";
import { folderRecords, manyFolderRecords, SAMPLE_FOLDERS, SAMPLE_NOW } from "./sample-records";
import { StoryCaption, StoryFrame } from "./story-frame";
import type { SampleLocale } from "./types";

type Args = { locale: SampleLocale; width?: number; selected?: "loaf" | "none"; many?: boolean; withCalendar?: boolean };

function Folders({ locale, selected: initial, many, withCalendar }: Args) {
  const { locale: appLocale } = useLocale();
  const copy = useRecordCopy();
  const items = many ? manyFolderRecords(locale) : folderRecords(locale);
  const [selected, setSelected] = useState<string | null | undefined>(
    initial === "loaf" ? SAMPLE_FOLDERS[locale].loaf : initial === "none" ? null : undefined,
  );
  const [month, setMonth] = useState("2026-11");
  // フォルダを選んだら、カレンダーの件数もそのフォルダの記録で数える
  const inFolder = selected === undefined ? items : items.filter((it) => matchesFolder(it, selected));
  const counts = countByDay(inFolder);
  const oldest = [...countByDay(items).keys()].sort()[0];
  return (
    <div className="rd-root" style={{ maxWidth: 340, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      {withCalendar && (
        <RecordCalendar
          counts={counts}
          maxCount={Math.max(0, ...counts.values())}
          month={month}
          onMonthChange={setMonth}
          selectedDay={null}
          onSelectDay={() => {}}
          today={dayKeyOf(SAMPLE_NOW)}
          minMonth={monthKeyOf(oldest)}
          maxMonth={monthKeyOf(dayKeyOf(SAMPLE_NOW))}
          locale={appLocale}
          copy={copy}
        />
      )}
      <RecordFolders
        folders={summarizeFolders(items, SAMPLE_NOW)}
        selected={selected}
        onSelect={(name) => setSelected((prev) => (prev === name ? undefined : name))}
        now={SAMPLE_NOW}
        locale={appLocale}
        copy={copy}
      />
    </div>
  );
}

const meta: Meta<Args> = {
  title: "Record Dashboard/5 Folders",
  parameters: { layout: "fullscreen" },
  argTypes: { locale: { control: "inline-radio", options: ["ja", "en"] } },
  args: { locale: "ja" },
  render: (args) => (
    <StoryFrame width={args.width} locale={args.locale}>
      <StoryCaption>
        {args.locale === "ja"
          ? "フォルダごとに、いちばん新しい記録の日、直近 14 日の日ごとの件数（右端が今日）、残した人、まだチェックの付いていない項目の数を出します。どれも記録から数えるだけで、期限・担当・完了の印は持ちません。フォルダを押すと、そのフォルダの記録だけに絞ります。"
          : "Each folder shows the day of its newest record, records per day over the last 14 days (today on the right), who kept them, and how many checklist items are still unchecked. All of it is counted from the records; there are no due dates, owners or done marks. Press a folder to see only its records."}
      </StoryCaption>
      <Folders key={`${args.locale}-${args.selected}-${args.many}-${args.withCalendar}`} {...args} />
    </StoryFrame>
  ),
};
export default meta;

type Story = StoryObj<Args>;

// 新しく動いたフォルダが上。どのフォルダにも入っていない記録は最後
export const Default: Story = {};
// フォルダを選んだところ
export const FolderSelected: Story = { args: { selected: "loaf" } };
// フォルダが多いとき。初めの 5 つだけ出し、残りはたたむ
export const ManyFolders: Story = { args: { many: true } };
// 右の欄に置いたときの並び（カレンダーの下）。フォルダを選ぶと、カレンダーの濃淡もそのフォルダの記録になる
export const UnderCalendar: Story = { args: { withCalendar: true, selected: "loaf" } };
export const Narrow: Story = { args: { width: 375 } };
export const English: Story = { args: { locale: "en" } };
