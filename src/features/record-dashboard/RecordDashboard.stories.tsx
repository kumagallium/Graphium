// 記録のダッシュボード全体の構図（3 通り）。本線は B で、A と C は見比べ用に残している。
// 絞り込みと探す欄は仮データの上で実際に動く。アプリの画面にはまだ組み込んでいない。
//   B Find   … 日ごとの記録に、言葉で見つかる様子を重ねる（採用。LP の絵の組み合わせ案）
//   A Stream … 1 本の流れ
//   C Ledger … いつ・どこで・誰が・何を の 4 列の台帳

import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildRecords } from "./from-indexes";
import { RecordDashboard, type RecordDashboardLayout } from "./RecordDashboard";
import { SAMPLE_SOURCES } from "./sample-indexes";
import { SAMPLE_NOW, SAMPLE_QUERY, SAMPLE_RECORDS } from "./sample-records";
import { StoryFrame } from "./story-frame";
import type { RecordLocale, WhoFilter } from "./types";

type Args = {
  layout: RecordDashboardLayout;
  locale: RecordLocale;
  width?: number;
  searching: boolean;
  who: WhoFilter;
  /** true のとき、索引の形の仮データを from-indexes.ts で写したものを出す */
  fromIndexes?: boolean;
};

function Screen({ layout, locale, width, searching, who, fromIndexes }: Args) {
  return (
    <StoryFrame width={width}>
      <RecordDashboard
        // 言語や初めの条件を切り替えたら、中の状態ごと作り直す
        key={`${layout}-${locale}-${searching}-${who}-${fromIndexes}`}
        items={fromIndexes ? buildRecords(SAMPLE_SOURCES) : SAMPLE_RECORDS[locale]}
        now={SAMPLE_NOW}
        layout={layout}
        locale={locale}
        initialQuery={searching ? SAMPLE_QUERY[fromIndexes ? "ja" : locale] : ""}
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
    layout: { control: "inline-radio", options: ["find", "stream", "ledger"] },
    locale: { control: "inline-radio", options: ["ja", "en"] },
    who: { control: "inline-radio", options: ["all", "self", "ai", "other"] },
  },
  args: { locale: "ja", searching: false, who: "all" },
};
export default meta;

type Story = StoryObj<Args>;

// B（採用）: 日ごとの記録（左）に、言葉で見つかる様子（右）を重ねる
export const BFind: Story = { args: { layout: "find", searching: true } };
export const BFindIdle: Story = { args: { layout: "find" } };
export const BFindEnglish: Story = { args: { layout: "find", searching: true, locale: "en" } };
// スマホ幅: 探す欄を上に出し、見つかった記録は 3 件に畳む
export const BFindNarrow: Story = { args: { layout: "find", searching: true, width: 375 } };
export const BFindNarrowIdle: Story = { args: { layout: "find", width: 375 } };
// 索引の形の仮データを、読み取りの層（from-indexes.ts）で写して出したもの
export const BFindFromIndexes: Story = { args: { layout: "find", searching: true, fromIndexes: true } };

// A（比較用）: 1 本の流れ。上で絞って、下を読む
export const AStream: Story = { args: { layout: "stream" } };
export const AStreamSearching: Story = { args: { layout: "stream", searching: true } };
export const AStreamEnglish: Story = { args: { layout: "stream", locale: "en" } };
export const AStreamNarrow: Story = { args: { layout: "stream", width: 375 } };

// C（比較用）: 4 列の台帳。左で絞る
export const CLedger: Story = { args: { layout: "ledger" } };
export const CLedgerAiOnly: Story = { args: { layout: "ledger", who: "ai" } };
export const CLedgerEnglish: Story = { args: { layout: "ledger", locale: "en" } };
export const CLedgerNarrow: Story = { args: { layout: "ledger", width: 375 } };
