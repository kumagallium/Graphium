// Shared Library ビューの Storybook ストーリー（表形式版・#カードグリッドからの置き換え）
//
// 研究室の「先生と学生」の場面を想定したモックデータ:
// - currentIdentity は先生（山田先生）
// - ノート 4 件（学生 2 人 + 先生 1 人、うち 1 件は version 2）。3 件は共有時点のフォルダ付き、1 件は無し
// - ナレッジ 2 件（wikiKind "summary" / "atom"）
// - reference 2 件（URL ブックマーク）
// - data-manifest 3 件（image / pdf / data）
//
// 詳細パネルは Tauri の invoke（provider.read）に依存するため、Storybook 上では
// 本文を読み込めない（読み込み中のまま止まる）。行クリックでの選択表示自体は確認できる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import { SharedLibraryView } from "./SharedLibraryView";
import "../../app.css";

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT_A = { name: "佐藤 学生", email: "sato@example.ac.jp" };
const STUDENT_B = { name: "鈴木 学生", email: "suzuki@example.ac.jp" };

function makeEntry(partial: Partial<SharedEntry> & Pick<SharedEntry, "id" | "type" | "author">): SharedEntry {
  return {
    created_at: daysAgo(10),
    updated_at: daysAgo(1),
    hash: `sha256:${"a".repeat(56)}${partial.id}`.slice(0, 71),
    prov: { derived_from: [] },
    version: 1,
    ...partial,
  };
}

const NOTES: SharedEntry[] = [
  makeEntry({
    id: "note-1",
    type: "note",
    author: STUDENT_A,
    updated_at: daysAgo(0.2),
    extra: { title: "Cu粉末の焼結実験（第1回）", noteContexts: ["卒論/焼結"] },
  }),
  makeEntry({
    id: "note-2",
    type: "note",
    author: STUDENT_A,
    updated_at: daysAgo(1),
    version: 2,
    extra: { title: "シリカ管の前処理手順", noteContexts: ["共通/装置"] },
  }),
  makeEntry({
    id: "note-3",
    type: "note",
    author: STUDENT_B,
    updated_at: daysAgo(3),
    extra: { title: "XRD 分析結果まとめ", noteContexts: ["卒論/焼結", "共通/装置"] },
  }),
  makeEntry({
    id: "note-4",
    type: "note",
    author: TEACHER,
    updated_at: daysAgo(5),
    extra: { title: "実験ノートの書き方（テンプレート）" },
  }),
];

const KNOWLEDGE: SharedEntry[] = [
  makeEntry({
    id: "knowledge-1",
    type: "knowledge",
    author: STUDENT_B,
    updated_at: daysAgo(2),
    extra: { title: "焼結温度と密度の関係", wikiKind: "summary" },
  }),
  makeEntry({
    id: "knowledge-2",
    type: "knowledge",
    author: TEACHER,
    updated_at: daysAgo(6),
    extra: { title: "Cu2O 相の生成条件", wikiKind: "atom" },
  }),
];

const REFERENCES: SharedEntry[] = [
  makeEntry({
    id: "ref-1",
    type: "reference",
    author: STUDENT_A,
    updated_at: daysAgo(4),
    extra: {
      title: "Sintering Behavior of Copper Powders",
      url: "https://example.org/papers/cu-sintering",
      domain: "example.org",
      description: "焼結条件の先行研究レビュー",
    },
  }),
  makeEntry({
    id: "ref-2",
    type: "reference",
    author: TEACHER,
    updated_at: daysAgo(8),
    extra: {
      title: "XRD 解析ソフトの使い方",
      url: "https://example.org/xrd-manual",
      domain: "example.org",
    },
  }),
];

const DATA_MANIFESTS: SharedEntry[] = [
  makeEntry({
    id: "data-1",
    type: "data-manifest",
    author: STUDENT_B,
    updated_at: daysAgo(0.5),
    extra: {
      title: "焼結体断面 SEM 画像",
      media_type: "image",
      mime_type: "image/png",
      original_filename: "sem_cross_section.png",
    },
  }),
  makeEntry({
    id: "data-2",
    type: "data-manifest",
    author: STUDENT_A,
    updated_at: daysAgo(2),
    extra: {
      title: "実験データシート（第1回〜第3回）",
      media_type: "pdf",
      mime_type: "application/pdf",
      original_filename: "experiment_data.pdf",
    },
  }),
  makeEntry({
    id: "data-3",
    type: "data-manifest",
    author: TEACHER,
    updated_at: daysAgo(9),
    extra: {
      title: "XRD 測定生データ（CSV）",
      media_type: "data",
      mime_type: "text/csv",
      original_filename: "xrd_raw.csv",
    },
  }),
];

const ALL_ENTRIES = {
  entries: {
    note: NOTES,
    knowledge: KNOWLEDGE,
    reference: REFERENCES,
    "data-manifest": DATA_MANIFESTS,
    template: [],
    report: [],
  },
  errors: {},
};

const EMPTY_ENTRIES = {
  entries: {
    note: [],
    knowledge: [],
    reference: [],
    "data-manifest": [],
    template: [],
    report: [],
  },
  errors: {},
};

const NOOP_ASYNC = async () => {};

const meta: Meta<typeof SharedLibraryView> = {
  title: "Sharing/SharedLibraryView",
  component: SharedLibraryView,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "共有ライブラリの表形式ビュー（カードグリッドからの置き換え）。ノートタブには共有した時点のフォルダ列が並ぶ（1 件はフォルダ無し ＝ 空欄）。詳細パネルは Tauri の invoke に依存するため、Storybook 上では本文を読み込めない（読み込み中のまま止まる）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SharedLibraryView>;

const baseArgs = {
  sharedRoot: "/Users/yamada/shared-lab",
  currentIdentity: TEACHER,
  onForkNote: NOOP_ASYNC,
  onForkKnowledge: NOOP_ASYNC,
  onUnshare: NOOP_ASYNC,
  onBack: () => console.log("back"),
  loadEntries: async () => ALL_ENTRIES,
};

export const Proposed: Story = {
  name: "提案（表・ノート）",
  args: baseArgs,
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};

export const ProposedAssets: Story = {
  name: "提案（素材タブ）",
  args: { ...baseArgs, initialTab: "asset" },
  decorators: Proposed.decorators,
};

export const ProposedEmpty: Story = {
  name: "空",
  args: { ...baseArgs, loadEntries: async () => EMPTY_ENTRIES },
  decorators: Proposed.decorators,
};

export const ProposedEnglish: Story = {
  name: "English",
  args: baseArgs,
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
