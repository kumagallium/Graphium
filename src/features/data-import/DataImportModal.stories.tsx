// データ取り込みダイアログのストーリー
//
// 装置ファイルの典型（コメント行の前置き + フッター）と、区切りが素直でない
// ケースを並べる。開いた時点で推定が当たっていること（＝設定を開かずに
// 「取り込む」を押せること）がこの画面の合否になる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataImportModal } from "./DataImportModal";

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

/** 表にならないファイル。「取り込む」は押せない状態になる */
export const NotATable: Story = {
  args: {
    fileName: "memo.txt",
    text: PLAIN_TEXT,
    onCancel: noop,
    onConfirm: noop,
  },
};
