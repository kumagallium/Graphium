// Excel / PowerPoint 素材のプレビュー（素材の右パネル）のストーリー
//
// 読み込み済みのデータを渡して表示だけを確かめる（ストレージプロバイダ無しで描ける）。
// 中身はパン作りの記録。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { PptxSlidesView, XlsxSheetsView } from "./OfficePreview";
import type { XlsxSheet } from "../office-import/xlsx";
import "../../app.css";

function sheetOf(name: string, cells: string[][]): XlsxSheet {
  return { name, cells, rows: cells.length, csv: "" };
}

const PROOFING = sheetOf("Proofing", [
  ["hour", "dough_temp", "room_temp", "note"],
  ...Array.from({ length: 24 }, (_, i) => {
    const h = i / 2;
    return [
      String(h),
      (24 + 3 * (1 - Math.exp(-h / 3))).toFixed(1),
      (22 + Math.sin(h / 2)).toFixed(1),
      i === 6 ? "folded" : "",
    ];
  }),
]);

const FLOURS = sheetOf("Flours", [
  ["flour", "protein_%", "water_%"],
  ["Bread flour", "12.5", "70"],
  ["Whole wheat", "13.0", "78"],
  ["Rye", "9.0", "82"],
]);

const LONG = sheetOf("Oven log", Array.from({ length: 1500 }, (_, m) => [String(m), String(Math.round(25 + 225 * (1 - Math.exp(-m / 80))))]));

// 画像の代わりに色の付いた SVG を data URL で渡す
function swatch(color: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${color}"/></svg>`,
  )}`;
}

const meta = {
  title: "AssetBrowser/OfficePreview",
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          {/* 右パネル（サイドピーク）の幅 */}
          <div style={{ width: 460, display: "flex", flexDirection: "column" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Excel: シートが複数あればタブで切り替える。列名は Excel と同じ A, B, C… */
export const Workbook: Story = {
  render: () => <XlsxSheetsView sheets={[PROOFING, FLOURS]} />,
};

/** Excel: 1000 行を超えるシートは先頭だけ見せて、続きはアプリで開くよう案内する */
export const LongSheet: Story = {
  render: () => <XlsxSheetsView sheets={[LONG]} />,
};

/** PowerPoint: スライドごとの文字と、ファイルに入っている画像 */
export const Slides: Story = {
  render: () => (
    <PptxSlidesView
      slides={[
        { index: 1, text: "Weekend sourdough: what changed" },
        { index: 2, text: "Hydration 72% → 75%. Bulk ferment 5 h at 24 °C. Crumb opened up, but shaping got harder." },
        { index: 3, text: "" },
        { index: 4, text: "Next: try a 30 min autolyse before adding the levain." },
      ]}
      imageUrls={[swatch("#d9b38c"), swatch("#a67c52"), swatch("#f2e2c4")]}
    />
  ),
};
