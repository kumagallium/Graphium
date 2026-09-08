// SharedNotePreview — Library 詳細パネルのノート read-only ビューア。
// body（GraphiumDocument JSON 文字列）を渡すだけで描画されるため、
// blob 解決が不要なサンプル（shared-blob: 参照なし）で見た目を確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharedNotePreview } from "./SharedEntryBody";

const meta: Meta<typeof SharedNotePreview> = {
  title: "Sharing/SharedNotePreview",
  component: SharedNotePreview,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof SharedNotePreview>;

const sampleDoc = {
  version: 6,
  title: "焼結条件の検討メモ",
  pages: [
    {
      id: "p1",
      title: "焼結条件の検討メモ",
      blocks: [
        {
          id: "b1",
          type: "heading",
          props: { level: 2 },
          content: [{ type: "text", text: "背景", styles: {} }],
          children: [],
        },
        {
          id: "b2",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "前回の焼結では 800°C / 2h で相対密度 92% だった。", styles: {} },
          ],
          children: [],
        },
        {
          id: "b3",
          type: "bulletListItem",
          props: {},
          content: [{ type: "text", text: "昇温速度を 5°C/min に下げる", styles: {} }],
          children: [],
        },
        {
          id: "b4",
          type: "bulletListItem",
          props: {},
          content: [{ type: "text", text: "保持時間を 4h に延ばす", styles: {} }],
          children: [],
        },
        {
          id: "b4b",
          type: "image",
          props: {
            url: "file-media://761c9aee-53c4-4e34-854c-95c3153dec05",
            name: "20150423-965906d5.gif",
          },
          children: [],
        },
        {
          id: "b5",
          type: "sharedCitation",
          props: {
            sharedId: "0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000",
            citedHash: "sha256:abc",
            entryType: "data-manifest",
            citedAt: "2026-08-11T10:00:00+09:00",
            cachedTitle: "NaCl 単結晶 XRD（2026-05-12 測定）",
            cachedAuthor: "田中",
            cachedUpdatedAt: "2026-05-12T10:30:00+09:00",
            citedVersion: 1,
            fileName: "nacl_xrd_scan.csv",
            fileSizeLabel: "2.3 MB",
          },
          children: [],
        },
      ],
      labels: {},
    },
    {
      id: "p2",
      title: "2 ページ目（結果）",
      blocks: [
        {
          id: "b6",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "複数ページのノートはタイトル見出しで区切って連結表示される。", styles: {} },
          ],
          children: [],
        },
      ],
      labels: {},
    },
  ],
};

export const Default: Story = {
  name: "ノート本文（引用カード・複数ページ込み）",
  render: () => (
    <div className="max-w-xl border border-border rounded-lg p-3">
      <SharedNotePreview body={JSON.stringify(sampleDoc)} />
    </div>
  ),
};

export const BrokenBody: Story = {
  name: "壊れた body（raw フォールバック）",
  render: () => (
    <div className="max-w-xl border border-border rounded-lg p-3">
      <SharedNotePreview body={'{"broken": true'} />
    </div>
  ),
};
