// ノート一覧ビューの Storybook ストーリー
// NoteListView / NoteListToolbar / RecentNotes を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoteListView } from "./NoteListView";
import { RecentNotes } from "./RecentNotes";
import type { ProvNoteIndex } from "./index-file";
import "../../app.css";

// ── モックデータ ──

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const MOCK_INDEX: ProvNoteIndex = {
  version: 1,
  updatedAt: now.toISOString(),
  notes: [
    {
      noteId: "note-1",
      title: "Cu粉末の焼結実験（第1回）",
      modifiedAt: hoursAgo(2),
      createdAt: daysAgo(14),
      headings: [{ blockId: "h1", text: "焼結条件の検討", level: 2 }],
      labels: [
        { blockId: "b1", label: "[手順]", preview: "焼結条件の検討" },
        { blockId: "b2", label: "[使用したもの]", preview: "Cu粉末 1g" },
        { blockId: "b3", label: "[結果]", preview: "焼結体（密度 85%）" },
        { blockId: "b4", label: "[属性]", preview: "温度: 800℃" },
      ],
      outgoingLinks: [
        { targetNoteId: "note-2", layer: "prov" },
        { targetNoteId: "note-3", layer: "prov" },
        { targetNoteId: "note-5", layer: "prov" },
      ],
    },
    {
      noteId: "note-2",
      title: "シリカ管の前処理手順",
      modifiedAt: hoursAgo(5),
      createdAt: daysAgo(21),
      headings: [{ blockId: "h2", text: "洗浄工程", level: 2 }],
      labels: [
        { blockId: "b5", label: "[手順]", preview: "洗浄工程" },
        { blockId: "b6", label: "[使用したもの]", preview: "シリカ管" },
      ],
      outgoingLinks: [{ targetNoteId: "note-4", layer: "prov" }],
    },
    {
      noteId: "note-3",
      title: "XRD 分析結果",
      modifiedAt: daysAgo(1),
      createdAt: daysAgo(7),
      headings: [],
      labels: [
        { blockId: "b7", label: "[結果]", preview: "Cu2O ピーク確認" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "note-4",
      title: "実験器具の仕様一覧",
      modifiedAt: daysAgo(3),
      createdAt: daysAgo(30),
      headings: [],
      labels: [
        { blockId: "b8", label: "[使用したもの]", preview: "管状炉 KTF-040N" },
        { blockId: "b9", label: "[属性]", preview: "最高温度: 1100℃" },
      ],
      outgoingLinks: [],
    },
    {
      noteId: "note-5",
      title: "焼結パラメータ最適化メモ",
      modifiedAt: daysAgo(5),
      createdAt: daysAgo(10),
      headings: [{ blockId: "h3", text: "温度プロファイル", level: 2 }],
      labels: [
        { blockId: "b10", label: "[属性]", preview: "昇温速度: 5℃/min" },
      ],
      outgoingLinks: [
        { targetNoteId: "note-1", layer: "prov" },
        { targetNoteId: "note-4", layer: "prov" },
        { targetNoteId: "note-6", layer: "knowledge" },
      ],
    },
    {
      noteId: "note-6",
      title: "文献レビュー: Cu焼結の最適条件",
      modifiedAt: daysAgo(12),
      createdAt: daysAgo(20),
      headings: [],
      labels: [],
      outgoingLinks: [{ targetNoteId: "note-1", layer: "knowledge" }],
    },
    {
      noteId: "note-7",
      title: "第2回焼結実験の計画",
      modifiedAt: hoursAgo(1),
      createdAt: daysAgo(2),
      headings: [{ blockId: "h4", text: "実験計画", level: 2 }],
      labels: [
        { blockId: "b11", label: "[手順]", preview: "実験計画" },
        { blockId: "b12", label: "[使用したもの]", preview: "Cu粉末 2g" },
        { blockId: "b13", label: "[使用したもの]", preview: "Ni粉末 0.5g" },
        { blockId: "b14", label: "[属性]", preview: "温度: 900℃" },
        { blockId: "b15", label: "[結果]", preview: "（予定）" },
      ],
      outgoingLinks: [
        { targetNoteId: "note-1", layer: "prov" },
        { targetNoteId: "note-4", layer: "prov" },
        { targetNoteId: "note-5", layer: "prov" },
        { targetNoteId: "note-3", layer: "prov" },
      ],
    },
  ],
};

// ── NoteListView ストーリー ──

const meta: Meta<typeof NoteListView> = {
  title: "Navigation/NoteListView",
  component: NoteListView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof NoteListView>;

export const Default: Story = {
  name: "デフォルト表示",
  args: {
    noteIndex: MOCK_INDEX,
    onOpenNote: (id: string) => console.log("open:", id),
    onBack: () => console.log("back"),
  },
};

export const Empty: Story = {
  name: "ノートなし",
  args: {
    noteIndex: { version: 1, updatedAt: now.toISOString(), notes: [] },
    onOpenNote: () => {},
    onBack: () => console.log("back"),
  },
};

export const Loading: Story = {
  name: "読み込み中",
  args: {
    noteIndex: null,
    onOpenNote: () => {},
    onBack: () => console.log("back"),
  },
};

// ── RecentNotes ストーリー ──

export const RecentNotesDefault: StoryObj<typeof RecentNotes> = {
  name: "最近のノート",
  render: () => (
    <div style={{
      width: 240,
      backgroundColor: "var(--color-sidebar-background)",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <RecentNotes
        notes={[
          { noteId: "note-7", title: "第2回焼結実験の計画", lastAccessedAt: hoursAgo(0.5) },
          { noteId: "note-1", title: "Cu粉末の焼結実験（第1回）", lastAccessedAt: hoursAgo(2) },
          { noteId: "note-2", title: "シリカ管の前処理手順", lastAccessedAt: hoursAgo(5) },
          { noteId: "note-3", title: "XRD 分析結果", lastAccessedAt: daysAgo(1) },
        ]}
        activeFileId="note-7"
        onSelect={(id) => console.log("select:", id)}
        onShowNoteList={() => console.log("show list")}
      />
    </div>
  ),
};

export const RecentNotesEmpty: StoryObj<typeof RecentNotes> = {
  name: "最近のノート（空）",
  render: () => (
    <div style={{
      width: 240,
      backgroundColor: "var(--color-sidebar-background)",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <RecentNotes
        notes={[]}
        activeFileId={null}
        onSelect={() => {}}
        onShowNoteList={() => console.log("show list")}
      />
    </div>
  ),
};
