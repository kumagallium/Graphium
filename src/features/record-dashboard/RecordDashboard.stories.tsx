// 記録のダッシュボード全体の構図（3 通り）。本線は B で、A と C は見比べ用に残している。
// 絞り込みと探す欄は仮データの上で実際に動く。アプリでは RecordsView が B（find）を実データで出す。
//   B Find   … 日ごとの記録に、言葉で見つかる様子を重ねる（採用。LP の絵の組み合わせ案）
//   A Stream … 1 本の流れ
//   C Ledger … いつ・どこで・誰が・何を の 4 列の台帳

import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildRecords } from "./from-indexes";
import { RecordDashboard, type RecordDashboardLayout } from "./RecordDashboard";
import { SAMPLE_SOURCES } from "./sample-indexes";
import { busyDayRecords, folderRecords, longHistoryRecords, manyFolderRecords, SAMPLE_NOW, SAMPLE_QUERY, SAMPLE_RECORDS, SAMPLE_SHARED_RECORDS } from "./sample-records";
import { StoryFrame } from "./story-frame";
import type { SampleLocale, WhoFilter } from "./types";

type Args = {
  layout: RecordDashboardLayout;
  locale: SampleLocale;
  width?: number;
  searching: boolean;
  who: WhoFilter;
  /** true のとき、索引の形の仮データを from-indexes.ts で写したものを出す */
  fromIndexes?: boolean;
  /** true のとき、同じ種類の記録が何十件も続く日の仮データを出す */
  busy?: boolean;
  /** true のとき、3 か月にわたる仮データを出す（カレンダーで月をまたぐ） */
  long?: boolean;
  /** フォルダに入れた仮データを出す（"many" はフォルダの多い仮データ） */
  folders?: boolean | "many";
  /** true のとき、共有フォルダにほかの人が出した記録（計画の行の記録を含む）を足す */
  shared?: boolean;
  /** 初めから入れておく探す言葉（searching より優先） */
  query?: string;
};

function Screen({ layout, locale, width, searching, who, fromIndexes, busy, long, folders, shared, query }: Args) {
  const base = folders === "many" ? manyFolderRecords(locale) : folders ? folderRecords(locale) : fromIndexes ? buildRecords(SAMPLE_SOURCES) : busy ? busyDayRecords(locale) : long ? longHistoryRecords(locale) : SAMPLE_RECORDS[locale];
  return (
    <StoryFrame width={width} locale={locale}>
      <RecordDashboard
        // 言語や初めの条件を切り替えたら、中の状態ごと作り直す
        key={`${layout}-${locale}-${searching}-${who}-${fromIndexes}-${busy}-${long}-${folders}-${shared}-${query}`}
        items={shared ? [...base, ...SAMPLE_SHARED_RECORDS[locale]] : base}
        now={SAMPLE_NOW}
        layout={layout}
        initialQuery={query ?? (searching ? SAMPLE_QUERY[fromIndexes ? "ja" : locale] : "")}
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
// 記録の多い日: 同じ種類・出どころ・残した人が 6 件以上続いたところを 1 行にまとめる
export const BFindBusyDay: Story = { args: { layout: "find", busy: true } };
export const BFindBusyDaySearching: Story = { args: { layout: "find", busy: true, searching: true } };
export const BFindBusyDayNarrow: Story = { args: { layout: "find", busy: true, width: 375 } };
// 3 か月分の記録: 右上のカレンダーで日を押すと、その日からの記録に移る
export const BFindLongHistory: Story = { args: { layout: "find", long: true } };
export const BFindLongHistoryNarrow: Story = { args: { layout: "find", long: true, width: 375 } };
// フォルダで絞る: 「すべて｜自分｜AI｜共有の作者」の隣のボタンから選ぶ。一覧・件数・カレンダー・見つかった記録がそのフォルダだけになる
export const BFindFolders: Story = { args: { layout: "find", folders: true } };
export const BFindFoldersEnglish: Story = { args: { layout: "find", folders: true, locale: "en" } };
export const BFindManyFolders: Story = { args: { layout: "find", folders: "many" } };
export const BFindFoldersNarrow: Story = { args: { layout: "find", folders: true, width: 375 } };
// 共有フォルダの記録: 「共有の作者」に切り替えたときだけ並ぶ（「すべて」には混ぜない）。
// 計画の行の記録には「計画の題 › 行の名前」と、共有した時点のチェックの件数が付く
export const BFindSharedAuthors: Story = { args: { layout: "find", shared: true, who: "other" } };
export const BFindSharedAuthorsEnglish: Story = { args: { layout: "find", shared: true, who: "other", locale: "en" } };
export const BFindSharedAuthorsNarrow: Story = { args: { layout: "find", shared: true, who: "other", width: 375 } };
// 作者の名前で探す（人で絞る）。計画の題・行の名前でも当たる
export const BFindSharedAuthorsByName: Story = { args: { layout: "find", shared: true, who: "other", query: "佐藤" } };
// 「すべて」には、共有フォルダの記録は出ない
export const BFindSharedNotInAll: Story = { args: { layout: "find", shared: true, who: "all" } };

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
