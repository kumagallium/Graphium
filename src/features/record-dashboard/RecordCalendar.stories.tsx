// 記録の画面のカレンダー（月の表示）のデザイン提案。
// 日ごとの件数を 4 段の濃淡で見せ、日を押すとその日からの記録へ移る。記録の無い日は押せない。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { useLocale } from "../../i18n";
import { useRecordCopy } from "./copy";
import { countByDay, dayKeyOf, monthKeyOf } from "./model";
import { RecordCalendar } from "./RecordCalendar";
import { longHistoryRecords, SAMPLE_NOW } from "./sample-records";
import { StoryCaption, StoryFrame } from "./story-frame";
import type { SampleLocale } from "./types";

type Args = { locale: SampleLocale; width?: number; month: string; selected?: string };

function Calendar({ locale, month: initialMonth, selected }: Args) {
  const { locale: appLocale } = useLocale();
  const copy = useRecordCopy();
  const items = longHistoryRecords(locale);
  const counts = countByDay(items);
  const [month, setMonth] = useState(initialMonth);
  const [day, setDay] = useState<string | null>(selected ?? null);
  const oldest = [...counts.keys()].sort()[0];
  return (
    <div className="rd-root" style={{ maxWidth: 340, margin: "0 auto" }}>
      <RecordCalendar
        counts={counts}
        maxCount={Math.max(0, ...counts.values())}
        month={month}
        onMonthChange={setMonth}
        selectedDay={day}
        onSelectDay={(k) => setDay((prev) => (prev === k ? null : k))}
        today={dayKeyOf(SAMPLE_NOW)}
        minMonth={monthKeyOf(oldest)}
        maxMonth={monthKeyOf(dayKeyOf(SAMPLE_NOW))}
        locale={appLocale}
        copy={copy}
      />
    </div>
  );
}

const meta: Meta<Args> = {
  title: "Record Dashboard/4 Calendar",
  parameters: { layout: "fullscreen" },
  argTypes: { locale: { control: "inline-radio", options: ["ja", "en"] } },
  args: { locale: "ja", month: "2026-11" },
  render: (args) => (
    <StoryFrame width={args.width} locale={args.locale}>
      <StoryCaption>
        {args.locale === "ja"
          ? "件数の多い日ほど濃くなります。今日は下線、選んだ日は外側の輪で示します（濃淡の色とは別の手がかり）。記録の無い日は押せません。"
          : "Days with more records are darker. Today is underlined and the selected day gets an outer ring. Days with no records cannot be pressed."}
      </StoryCaption>
      <Calendar key={`${args.locale}-${args.month}-${args.selected}`} {...args} />
    </StoryFrame>
  ),
};
export default meta;

type Story = StoryObj<Args>;

// 今月。今日（17 日）に下線が付く
export const ThisMonth: Story = {};
// 日を選んだところ
export const DaySelected: Story = { args: { selected: "2026-11-14" } };
// 1 日だけ飛び抜けて多い月（一括の取り込み）。ほかの日の濃淡がつぶれないことを見る
export const MonthWithSpike: Story = { args: { month: "2026-10" } };
// 記録のある最初の月。前の月へは動かせない
export const OldestMonth: Story = { args: { month: "2026-09" } };
export const English: Story = { args: { locale: "en" } };
