// LinkedOriginSection — 素材の詳細の「元データ」。リンクした素材（データの置き場のファイル）を、
// 解析で作った小さな素材の元データとして指定する。Graphium は元データの中身を読まない。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LinkedOriginSection } from "./LinkedOriginSection";
import { buildPlaceUrl } from "./link-url";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import "../../app.css";

const NOW = "2026-11-10T09:00:00.000Z";

function linked(fileId: string, name: string, relPath: string): MediaIndexEntry {
  return {
    fileId,
    name,
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl("org", relPath),
    thumbnailUrl: "",
    uploadedAt: NOW,
    usedIn: [],
    urlMeta: { domain: "Whole bakery", description: relPath },
    link: { placeId: "org", relPath, size: 40_000_000_000, mtimeMs: Date.UTC(2026, 10, 9), recordedAt: NOW },
  };
}

const RAW = linked("raw1", "oven-log-2026.csv", "Logs/oven-log-2026.csv");
const RAW2 = linked("raw2", "proofing-log-2026.csv", "Logs/proofing-log-2026.csv");

const SUMMARY: MediaIndexEntry = {
  fileId: "sum1",
  name: "oven-summary.csv",
  type: "data",
  mimeType: "text/csv",
  url: "/media/sum1",
  thumbnailUrl: "",
  uploadedAt: NOW,
  usedIn: [],
};

const index = (...media: MediaIndexEntry[]): MediaIndex => ({ version: 5, updatedAt: NOW, media }) as MediaIndex;

const meta: Meta<typeof LinkedOriginSection> = {
  title: "AssetBrowser/LinkedOriginSection",
  component: LinkedOriginSection,
  args: { __test: { persist: async () => true }, onSwitchAsset: () => {} },
  decorators: [
    (Story) => (
      <div className="p-6 bg-background" style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof LinkedOriginSection>;

/** まだ指定していない。「元データを指定」から、リンクした素材を名前で絞り込んで選ぶ */
export const NotSet: Story = { args: { entry: SUMMARY, mediaIndex: index(SUMMARY, RAW, RAW2) } };

/** 指定済み。名前を押すとその素材へ移り、× で 1 件ずつ外せる */
export const Specified: Story = {
  args: {
    entry: { ...SUMMARY, derivedFromAssets: ["raw1"] },
    mediaIndex: index({ ...SUMMARY, derivedFromAssets: ["raw1"] }, RAW, RAW2),
  },
};

/** 2 件指定（元データが複数あるとき） */
export const Several: Story = {
  args: {
    entry: { ...SUMMARY, derivedFromAssets: ["raw1", "raw2"] },
    mediaIndex: index({ ...SUMMARY, derivedFromAssets: ["raw1", "raw2"] }, RAW, RAW2),
  },
};
