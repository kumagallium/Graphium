// ラベルギャラリービューのストーリー
// グループ化テーブル + ネットワークモーダルの各状態を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LabelGalleryView } from "./LabelGalleryView";
import { LocaleProvider } from "../../i18n";
import type { GraphiumIndex } from "../navigation/index-file";

const meta: Meta<typeof LabelGalleryView> = {
  title: "Organisms/LabelGalleryView",
  component: LabelGalleryView,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <Story />
      </LocaleProvider>
    ),
  ],
};
export default meta;

// ── モックデータ ──

const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86400000).toISOString();
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
const weekAgo = new Date(Date.now() - 604800000).toISOString();

const mockIndex: GraphiumIndex = {
  version: 1,
  updatedAt: now,
  notes: [
    {
      noteId: "note-1",
      title: "カレーの実験記録",
      modifiedAt: now,
      createdAt: weekAgo,
      headings: [],
      labels: [
        { blockId: "b1", label: "material", preview: "玉ねぎ" },
        { blockId: "b2", label: "material", preview: "にんじん" },
        { blockId: "b3", label: "material", preview: "カレー粉" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "note-2",
      title: "肉じゃがの実験記録",
      modifiedAt: yesterday,
      createdAt: weekAgo,
      headings: [],
      labels: [
        { blockId: "b4", label: "material", preview: "玉ねぎ" },
        { blockId: "b5", label: "material", preview: "にんじん" },
        { blockId: "b6", label: "material", preview: "じゃがいも" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "note-3",
      title: "オニオンスープの実験記録",
      modifiedAt: twoDaysAgo,
      createdAt: weekAgo,
      headings: [],
      labels: [
        { blockId: "b7", label: "material", preview: "玉ねぎ" },
        { blockId: "b8", label: "material", preview: "バター" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "note-4",
      title: "野菜サラダの実験記録",
      modifiedAt: weekAgo,
      createdAt: weekAgo,
      headings: [],
      labels: [
        { blockId: "b9", label: "material", preview: "にんじん" },
        { blockId: "b10", label: "material", preview: "トマト" },
      ],
      outgoingLinks: [],
    },
  ],
};

// 1件のみのデータ
const singleIndex: GraphiumIndex = {
  version: 1,
  updatedAt: now,
  notes: [
    {
      noteId: "note-1",
      title: "テスト実験",
      modifiedAt: now,
      createdAt: now,
      headings: [],
      labels: [
        { blockId: "b1", label: "material", preview: "サンプル" },
      ],
      outgoingLinks: [],
    },
  ],
};

// 空データ
const emptyIndex: GraphiumIndex = {
  version: 1,
  updatedAt: now,
  notes: [],
};

const noop = () => {};

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 700, height: 500, border: "1px solid #d5e0d7", borderRadius: 8, overflow: "hidden", display: "flex" }}>
      {children}
    </div>
  );
}

// ── ストーリー ──

export const Default: StoryObj<typeof LabelGalleryView> = {
  name: "グループ化テーブル（複数ノート共有）",
  render: () => (
    <Container>
      <LabelGalleryView
        noteIndex={mockIndex}
        label="material"
        onBack={noop}
        onNavigateNote={(id) => console.log("navigate:", id)}
      />
    </Container>
  ),
};

export const SingleEntry: StoryObj<typeof LabelGalleryView> = {
  name: "1件のみ",
  render: () => (
    <Container>
      <LabelGalleryView
        noteIndex={singleIndex}
        label="material"
        onBack={noop}
        onNavigateNote={(id) => console.log("navigate:", id)}
      />
    </Container>
  ),
};

export const Empty: StoryObj<typeof LabelGalleryView> = {
  name: "空状態",
  render: () => (
    <Container>
      <LabelGalleryView
        noteIndex={emptyIndex}
        label="material"
        onBack={noop}
        onNavigateNote={noop}
      />
    </Container>
  ),
};

export const Loading: StoryObj<typeof LabelGalleryView> = {
  name: "読み込み中",
  render: () => (
    <Container>
      <LabelGalleryView
        noteIndex={null}
        label="material"
        onBack={noop}
        onNavigateNote={noop}
      />
    </Container>
  ),
};
