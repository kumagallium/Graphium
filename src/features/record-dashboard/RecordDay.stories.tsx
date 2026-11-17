// 1 日分のまとまり（日付の見出し＋記録の行）のデザイン提案。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { groupByDay } from "./model";
import { RecordDay } from "./RecordDay";
import { SAMPLE_NOW, SAMPLE_RECORDS } from "./sample-records";
import { StoryFrame, StorySheet } from "./story-frame";
import type { RecordLocale } from "./types";

type Args = { locale: RecordLocale; variant: "rail" | "ledger"; width?: number; days: number };

function Days({ locale, variant, width, days }: Args) {
  const groups = groupByDay(SAMPLE_RECORDS[locale]).slice(0, days);
  return (
    <StoryFrame width={width}>
      <StorySheet maxWidth={variant === "ledger" ? 960 : 720}>
        {groups.map((g) => (
          <RecordDay key={g.key} dayKey={g.key} items={g.items} now={SAMPLE_NOW} locale={locale} variant={variant} />
        ))}
      </StorySheet>
    </StoryFrame>
  );
}

const meta: Meta<Args> = {
  title: "Record Dashboard/2 Record Day",
  component: Days,
  parameters: { layout: "fullscreen" },
  argTypes: {
    locale: { control: "inline-radio", options: ["ja", "en"] },
    variant: { control: "inline-radio", options: ["rail", "ledger"] },
    days: { control: { type: "range", min: 1, max: 3, step: 1 } },
  },
  args: { locale: "ja", variant: "rail", days: 1 },
};
export default meta;

type Story = StoryObj<Args>;

// 今日の 1 日分。見出しの右に、残した人ごとの件数と合計を出す
export const Today: Story = {};
export const TodayEnglish: Story = { args: { locale: "en" } };
export const TodayNarrow: Story = { args: { width: 375 } };

// 日をまたいだ並び。「今日」「昨日」のあとは日付が見出しになる
export const ThreeDays: Story = { args: { days: 3 } };

// 4 列の台帳の並び
export const TodayLedger: Story = { args: { variant: "ledger" } };
