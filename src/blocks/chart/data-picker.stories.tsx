// チャート用データピッカーのストーリー
// 中身（列名・行数・線の形）が見えること、数値の無いログが畳まれることを目視確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import "../../app.css";
import type { MediaIndex, MediaIndexEntry } from "../../features/asset-browser/media-index";
import { primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
import { ChartDataPickerModal, clearDataPreviewCache } from "./data-picker";

const entry = (fileId: string, name: string, uploadedAt: string): MediaIndexEntry => ({
  fileId,
  name,
  type: "data",
  mimeType: "text/plain",
  url: "",
  thumbnailUrl: "",
  uploadedAt,
  usedIn: [],
});

const mediaIndex: MediaIndex = {
  version: 10,
  updatedAt: "2026-10-20T00:00:00Z",
  media: [
    entry("fermentation", "発酵温度ログ.csv", "2026-10-20T09:00:00Z"),
    entry("dough", "生地の重さ.csv", "2026-10-18T09:00:00Z"),
    entry("oven", "オーブン予熱.txt", "2026-10-15T09:00:00Z"),
    entry("xrd", "XRD_測定.txt", "2026-10-19T09:00:00Z"),
    entry("uneven", "予熱の不揃いログ.csv", "2026-10-12T09:00:00Z"),
    entry("memo", "作業メモ.log", "2026-10-10T09:00:00Z"),
    entry("spectrum", "多列スペクトル.csv", "2026-10-17T09:00:00Z"),
  ],
};

/** XRD 風のスキャン（2θ 10〜80 を 0.02 刻み 3,500 点、背景 + 鋭いピーク）。空白区切り */
function xrdScan(header: string): string {
  const peaks: Array<[number, number]> = [[26.6, 900], [38.2, 520], [44.4, 700], [64.6, 380]];
  const rows = Array.from({ length: 3500 }, (_, i) => {
    const tt = 10 + i * 0.02;
    const bg = 60 + 40 * Math.exp(-(tt - 10) / 25);
    const peak = peaks.reduce((a, [c, h]) => a + h * Math.exp(-(((tt - c) / 0.05) ** 2)), 0);
    return `${tt.toFixed(2)} ${Math.round(bg + peak)}`;
  });
  return [header, ...rows].join("\n");
}

/** 列が 20 列あるスペクトル（wl, s1..s19）。線は先頭の 4 列だけ重ねる */
function multiSpectrum(): string {
  const header = ["wl", ...Array.from({ length: 19 }, (_, k) => `s${k + 1}`)].join(",");
  const rows = Array.from({ length: 120 }, (_, i) => {
    const wl = 400 + i * 4;
    const vals = Array.from({ length: 19 }, (_, k) => {
      const c = 480 + k * 12;
      return Math.round(100 * Math.exp(-(((wl - c) / 40) ** 2)) + 5 * (k % 3));
    });
    return [wl, ...vals].join(",");
  });
  return [header, ...rows].join("\n");
}

/** 測定間隔が不揃いな温度ログ（序盤は細かく、後半は粗い） */
function unevenLog(header: string): string {
  const times = [0, 1, 2, 3, 4, 6, 9, 14, 22, 35, 55, 85, 130];
  return [header, ...times.map((t) => `${t},${Math.round(20 + 60 * (1 - Math.exp(-t / 30)))}`)].join("\n");
}

function seed() {
  clearAssetTextCache();
  clearDataPreviewCache();
  const hours = Array.from({ length: 30 }, (_, i) => i);
  primeAssetText(
    "fermentation",
    ["時刻,温度,湿度", ...hours.map((h) => `${h}:00,${(26 + Math.sin(h / 4) * 3).toFixed(1)},${60 + (h % 7)}`)].join("\n")
  );
  primeAssetText(
    "dough",
    ["回,重さ(g)", "1,498", "2,502", "3,495", "4,510", "5,500", "6,489"].join("\n")
  );
  primeAssetText(
    "oven",
    [
      "# 装置: オーブンA",
      "# 日付: 2026-10-15",
      "時間 温度",
      ...Array.from({ length: 12 }, (_, i) => `${i * 30} ${Math.round(20 + i * 18)}`),
    ].join("\n")
  );
  primeAssetText("xrd", xrdScan("2theta 強度"));
  primeAssetText("uneven", unevenLog("経過(分),温度"));
  primeAssetText("spectrum", multiSpectrum());
  primeAssetText("memo", "生地をこねた\n一次発酵を始めた\n成形した\n焼き上がり\n");
}

function Demo({ withUpload }: { withUpload?: boolean }) {
  const [picked, setPicked] = useState<string>("");
  seed();
  return (
    <div>
      <p className="text-xs">選択: {picked || "（なし）"}</p>
      <ChartDataPickerModal
        mediaIndex={mediaIndex}
        onSelect={(e) => setPicked(e.name)}
        onPickLocalFile={withUpload ? (f) => setPicked(f.name) : undefined}
        onClose={() => {}}
      />
    </div>
  );
}

const meta: Meta = {
  title: "Blocks/ChartBlock/DataPicker",
  parameters: { layout: "fullscreen" },
};
export default meta;

export const Default: StoryObj = {
  name: "既定（数値の無いログは畳む）",
  render: () => <Demo withUpload />,
};

export const Empty: StoryObj = {
  name: "素材なし",
  render: () => (
    <ChartDataPickerModal
      mediaIndex={{ ...mediaIndex, media: [] }}
      onSelect={() => {}}
      onClose={() => {}}
    />
  ),
};

// マニュアル用（英語 UI・パン作りの世界観）。localStorage の言語を en にして撮る
const mediaIndexEn: MediaIndex = {
  ...mediaIndex,
  media: [
    entry("en-proof", "proofing-temp.csv", "2026-10-20T09:00:00Z"),
    entry("en-dough", "dough-weight.csv", "2026-10-18T09:00:00Z"),
    entry("en-oven", "oven-preheat.txt", "2026-10-15T09:00:00Z"),
    entry("en-xrd", "xrd-scan.txt", "2026-10-19T09:00:00Z"),
    entry("en-uneven", "uneven-preheat.csv", "2026-10-12T09:00:00Z"),
    entry("en-memo", "bake-day.log", "2026-10-10T09:00:00Z"),
    entry("en-spectrum", "multi-column-spectrum.csv", "2026-10-17T09:00:00Z"),
  ],
};

function seedEnglish() {
  clearAssetTextCache();
  clearDataPreviewCache();
  const hours = Array.from({ length: 30 }, (_, i) => i);
  primeAssetText(
    "en-proof",
    ["Time,Dough temp (°C),Humidity (%)", ...hours.map((h) => `${h}:00,${(26 + Math.sin(h / 4) * 3).toFixed(1)},${60 + (h % 7)}`)].join("\n")
  );
  primeAssetText("en-dough", ["Batch,Weight (g)", "1,498", "2,502", "3,495", "4,510", "5,500", "6,489"].join("\n"));
  primeAssetText(
    "en-oven",
    [
      "# Instrument: Oven A",
      "# Date: 2026-10-15",
      "Seconds Temp",
      ...Array.from({ length: 12 }, (_, i) => `${i * 30} ${Math.round(20 + i * 18)}`),
    ].join("\n")
  );
  primeAssetText("en-xrd", xrdScan("2theta Intensity"));
  primeAssetText("en-uneven", unevenLog("Minutes,Temp"));
  primeAssetText("en-spectrum", multiSpectrum());
  primeAssetText("en-memo", "kneaded the dough\nstarted the first proof\nshaped\nout of the oven\n");
}

export const Manual: StoryObj = {
  name: "Manual (English, bread world)",
  render: () => {
    seedEnglish();
    return (
      <ChartDataPickerModal
        mediaIndex={mediaIndexEn}
        onSelect={() => {}}
        onPickLocalFile={() => {}}
        onClose={() => {}}
      />
    );
  },
};
