// データ取り込みダイアログのストーリー
//
// 装置ファイルの典型（コメント行の前置き + フッター）と、区切りが素直でない
// ケースを並べる。開いた時点で推定が当たっていること（＝設定を開かずに
// 「取り込む」を押せること）がこの画面の合否になる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExtractSection } from "../data-extract/components/ExtractSection";
import { BREAD_HEADERS, BREAD_PROFILES, BREAD_ROWS } from "../data-extract/components/sample-data";
import { DataImportModal } from "./DataImportModal";
import { SYNC_PARSE_MAX_ROWS } from "./large-file";

const meta: Meta<typeof DataImportModal> = {
  title: "Features/DataImport/DataImportModal",
  component: DataImportModal,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof DataImportModal>;

const INSTRUMENT_CSV = [
  "# [INSTRUMENT SETTINGS & METADATA]",
  "# Device Model: ENV-MONITOR-X9",
  "# Location: Site B (地点B)",
  "# Sampling Interval: 1 Day",
  "# ------------------------------------------",
  "# [DATA START]",
  "日付,最高気温(℃),平均湿度(%),地点",
  "8月1日,35.2,75,地点B",
  "8月2日,36.5,80,地点B",
  "8月3日,34.8,85,地点B",
  "8月4日,33.2,90,地点B",
  "8月5日,37.1,65,地点B",
  "# [DATA END]",
  "# checksum: 0x2f19",
].join("\n");

const FIXED_WIDTH_DAT = [
  "! Spectrometer raw output",
  "! Operator = K. Kumagai",
  "! ----------------------",
  "WAVELENGTH   INTENSITY   NOISE",
  "400.0        1023.5      2.1",
  "401.0        1044.2      2.0",
  "402.0        1099.8      1.9",
  "403.0        1120.4      2.3",
].join("\n");

const PLAIN_TEXT = ["測定メモ", "特に区切りのないただの文章。", "表にはならない。"].join("\n");

/** 上限（2000 行）を超える長いログ。丸めた旨のバナーが出る */
const HUGE_LOG = [
  "# Long run log",
  "# Device Model: LOGGER-9000",
  "time,value",
  ...Array.from({ length: 5000 }, (_, i) => `${i},${(i % 97) / 10}`),
].join("\n");

/** 全行を同期で変換する上限（SYNC_PARSE_MAX_ROWS）を超える合成データ。story の中で作る */
const VERY_LARGE_LOG = [
  "# Long run log",
  "# Device Model: LOGGER-9000",
  "time,value,flag",
  ...Array.from({ length: SYNC_PARSE_MAX_ROWS + 5000 }, (_, i) => `${i},${(i % 97) / 10},ok`),
  "# [END]",
].join("\n");

const noop = () => {};

/** 典型的な装置 CSV。前置き 6 行・後書き 2 行が自動で外れる */
export const InstrumentCsv: Story = {
  args: {
    fileName: "2026-08_site-b.csv",
    text: INSTRUMENT_CSV,
    onCancel: noop,
    onConfirm: noop,
  },
};

/** 空白で桁を揃えた固定幅出力。space + 連続まとめが自動で当たる */
export const FixedWidthDat: Story = {
  args: {
    fileName: "spectrum.dat",
    text: FIXED_WIDTH_DAT,
    onCancel: noop,
    onConfirm: noop,
  },
};

/** 上限を超える長いログ。既定で先頭 2000 行に絞られ、その旨が出る */
export const HugeLog: Story = {
  args: {
    fileName: "run-2026-08-14.log",
    text: HUGE_LOG,
    onCancel: noop,
    onConfirm: noop,
  },
};

/** 行数が SYNC_PARSE_MAX_ROWS を超える大きなファイル。設定は先頭から推定し、プレビューも先頭だけ */
export const VeryLargeLog: Story = {
  args: {
    fileName: "run-very-large.log",
    text: VERY_LARGE_LOG,
    rowLimit: null,
    onCancel: noop,
    onConfirm: noop,
  },
};

/** 表にならないファイル。「取り込む」は押せない状態になる */
export const NotATable: Story = {
  args: {
    fileName: "memo.txt",
    text: PLAIN_TEXT,
    onCancel: noop,
    onConfirm: noop,
  },
};

// ─── 絞り込む（列と行を選んで、小さな表として取り込む）─────────────────
// データはパン作りのオーブン温度ログ（components/sample-data.ts）。

const BREAD_CSV = [BREAD_HEADERS.join(","), ...BREAD_ROWS.map((r) => r.join(","))].join("\n");

/** 列が 16 ある表。チェックの並びが横に折り返し、はみ出すぶんは中でスクロールする */
const WIDE_HEADERS = [
  ...BREAD_HEADERS,
  ...Array.from({ length: 11 }, (_, i) => `probe_${String(i + 1).padStart(2, "0")}`),
];
const WIDE_CSV = [
  WIDE_HEADERS.join(","),
  ...BREAD_ROWS.map((r, i) => [...r, ...Array.from({ length: 11 }, (_, j) => String(i + j))].join(",")),
].join("\n");

const BREAD_SPEC = {
  columns: ["time", "temp_c", "dough"],
  conditions: [
    { column: "temp_c", op: "ge" as const, value: "200" },
    { column: "dough", op: "eq" as const, value: "baguette" },
  ],
};

/** 既定。段は畳んだ 1 行で、絞らなければ今までの取り込み画面と変わらない */
export const ExtractCollapsed: Story = {
  name: "絞り込み（畳んだ状態）",
  args: { fileName: "oven-curves.csv", text: BREAD_CSV, onCancel: noop, onConfirm: noop },
};

/** 開いた状態。列を 3 つ選び、条件を 2 つ付けている。変換プレビューの上、右の列の中に段が入る。プレビューは絞った後の表 */
export const ExtractOpen: Story = {
  name: "絞り込み（開いた状態・条件 2 つ）",
  args: {
    fileName: "oven-curves.csv",
    text: BREAD_CSV,
    initialExtract: BREAD_SPEC,
    onCancel: noop,
    onConfirm: noop,
  },
};

/** 条件が入ったまま畳んだ状態。説明の代わりに条件の文と行数が出る */
export const ExtractCollapsedWithConditions: Story = {
  name: "絞り込み（条件ありで畳んだ状態）",
  args: { ...ExtractOpen.args },
  // 開いた状態で始まるので、描画後に 1 度だけ畳む
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
  },
};

/** 結果が 0 行。確定は押せず、段の中の注記が理由を言う */
export const ExtractZeroRows: Story = {
  name: "絞り込み（0 行）",
  args: {
    fileName: "oven-curves.csv",
    text: BREAD_CSV,
    initialExtract: { columns: [], conditions: [{ column: "temp_c", op: "ge", value: "999" }] },
    onCancel: noop,
    onConfirm: noop,
  },
};

/** 列が 16。チェックの並びが縦に伸びず、横に折り返す */
export const ExtractManyColumns: Story = {
  name: "絞り込み（列が 16）",
  args: {
    fileName: "oven-probes.csv",
    text: WIDE_CSV,
    initialExtract: { columns: ["time", "temp_c", "probe_01", "probe_02"], conditions: [] },
    onCancel: noop,
    onConfirm: noop,
  },
};

/**
 * 大きなファイル（2 万行超）で段を開いた直後。全体を小分けで読んでいる間は、
 * 段の中に「全体を読んでいます…」だけが出て、確定ボタンは押せない。
 * 実物は数秒で読み終わるので、状態を固定して見せるために段の部品だけを枠に入れている
 */
export const ExtractLoadingLargeFile: Story = {
  name: "大きなファイルで段を開いた直後（読んでいる間）",
  render: () => (
    <div className="bg-background border border-border rounded-lg w-[450px] max-w-full overflow-hidden">
      <ExtractSection
        open
        onToggle={noop}
        collapsedSummary={null}
        loading
        columns={BREAD_PROFILES}
        selectedColumns={BREAD_PROFILES.map((c) => c.name)}
        onColumnsChange={noop}
        conditions={[]}
        onConditionsChange={noop}
      />
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        <button
          type="button"
          disabled
          className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground opacity-40 cursor-not-allowed"
        >
          取り込む
        </button>
      </div>
    </div>
  ),
  parameters: { layout: "padded" },
};
