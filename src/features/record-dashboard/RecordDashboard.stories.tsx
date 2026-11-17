// 記録のダッシュボード全体の構図を見比べるストーリー（3 通り）。
// 絞り込みと探す欄は仮データの上で実際に動く。アプリの実データにはつないでいない。
//   A Stream … 1 本の流れ
//   B Find   … 日ごとの記録に、言葉で見つかる様子を重ねる（LP の絵の組み合わせ案）
//   C Ledger … いつ・どこで・誰が・何を の 4 列の台帳

import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecordDashboard, type RecordDashboardLayout } from "./RecordDashboard";
import { SAMPLE_NOW, SAMPLE_QUERY, SAMPLE_RECORDS } from "./sample-records";
import { StoryFrame } from "./story-frame";
import type { RecordLocale, WhoFilter } from "./types";

type Args = { layout: RecordDashboardLayout; locale: RecordLocale; width?: number; searching: boolean; who: WhoFilter };

function Screen({ layout, locale, width, searching, who }: Args) {
  return (
    <StoryFrame width={width}>
      <RecordDashboard
        // 言語や初めの条件を切り替えたら、中の状態ごと作り直す
        key={`${layout}-${locale}-${searching}-${who}`}
        items={SAMPLE_RECORDS[locale]}
        now={SAMPLE_NOW}
        layout={layout}
        locale={locale}
        initialQuery={searching ? SAMPLE_QUERY[locale] : ""}
        initialWho={who}
      />
    </StoryFrame>
  );
}

const meta: Meta<Args> = {
  title: "Record Dashboard/3 Dashboard",
  component: Screen,
  parameters: { layout: "fullscreen" },
  argTypes: {
    layout: { control: "inline-radio", options: ["stream", "find", "ledger"] },
    locale: { control: "inline-radio", options: ["ja", "en"] },
    who: { control: "inline-radio", options: ["all", "self", "ai", "other"] },
  },
  args: { locale: "ja", searching: false, who: "all" },
};
export default meta;

type Story = StoryObj<Args>;

// A: 1 本の流れ。上で絞って、下を読む
export const AStream: Story = { args: { layout: "stream" } };
export const AStreamSearching: Story = { args: { layout: "stream", searching: true } };
export const AStreamEnglish: Story = { args: { layout: "stream", locale: "en" } };
export const AStreamNarrow: Story = { args: { layout: "stream", width: 375 } };

// B: 日ごとの記録（左）に、言葉で見つかる様子（右）を重ねる
export const BFind: Story = { args: { layout: "find", searching: true } };
export const BFindIdle: Story = { args: { layout: "find" } };
export const BFindEnglish: Story = { args: { layout: "find", searching: true, locale: "en" } };
export const BFindNarrow: Story = { args: { layout: "find", searching: true, width: 375 } };

// C: 4 列の台帳。左で絞る
export const CLedger: Story = { args: { layout: "ledger" } };
export const CLedgerAiOnly: Story = { args: { layout: "ledger", who: "ai" } };
export const CLedgerEnglish: Story = { args: { layout: "ledger", locale: "en" } };
export const CLedgerNarrow: Story = { args: { layout: "ledger", width: 375 } };
