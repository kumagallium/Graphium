// データ素材のプレビュー（素材の右パネル）のストーリー
//
// 「表」と「元のテキスト」のタブ。表に起こせたら表、起こせなかったら元のテキストで開く。
// 本文は data: URL で渡す（ストレージプロバイダ無しで描ける）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { DataPreview } from "./DataPreview";
import type { MediaIndexEntry } from "./media-index";
import "../../app.css";

function entryOf(name: string, text: string): MediaIndexEntry {
  return {
    fileId: name,
    name,
    type: "data",
    mimeType: "text/plain",
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
    thumbnailUrl: "",
    uploadedAt: "2026-10-29T00:00:00Z",
    usedIn: [],
  };
}

const PROOFING = [
  "# Probe: dough thermometer B",
  "# Room: proofing cabinet",
  "hour,dough_temp,room_temp",
  ...Array.from({ length: 48 }, (_, i) => {
    const h = i / 4;
    return `${h},${(24 + 3 * (1 - Math.exp(-h / 3))).toFixed(2)},${(22 + Math.sin(h / 2)).toFixed(2)}`;
  }),
].join("\n");

// 文章のログ。自動判定は空白で区切って表にしてしまう（読み方の判定を外した例）
const BAKE_LOG = [
  "Bake log - Saturday",
  "Preheated deck oven to 250C",
  "Loaded two boules at 09:40",
  "Steam released at 09:55",
  "Pulled at 10:20, internal 97C",
].join("\n");

// 先頭 500 行を超える長いファイル
const LONG = ["min\ttemp_c", ...Array.from({ length: 1200 }, (_, m) => `${m}\t${Math.round(25 + 225 * (1 - Math.exp(-m / 80)))}`)].join("\n");

const meta = {
  title: "AssetBrowser/DataPreview",
  component: DataPreview,
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          {/* 右パネル（サイドピーク）の幅 */}
          <div style={{ width: 420, padding: 16, display: "flex" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
} satisfies Meta<typeof DataPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 表に起こせる。表のタブで開き、前置きの測定条件が上に出る */
export const Table: Story = {
  args: { entry: entryOf("proofing-temperature.csv", PROOFING) },
};

/** 表にはなるが読み方が外れている。元のテキストのタブで中身を確かめる */
export const MisreadText: Story = {
  args: { entry: entryOf("bake-log.txt", BAKE_LOG) },
};

/** 長いファイル。元のテキストは先頭 500 行まで */
export const LongFile: Story = {
  args: { entry: entryOf("oven-preheat.txt", LONG) },
};
