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
    entry("memo", "作業メモ.log", "2026-10-10T09:00:00Z"),
  ],
};

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
    entry("en-memo", "bake-day.log", "2026-10-10T09:00:00Z"),
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
