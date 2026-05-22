// 素材リスト行の Storybook ストーリー
// Note 行と並べて視覚言語が揃っているかを確認するための比較も含む

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MaterialListItem, MaterialListHeader } from "./MaterialListItem";
import { NoteListView } from "../navigation/NoteListView";
import type { MediaIndexEntry } from "./media-index";
import type { GraphiumIndex } from "../navigation/index-file";
import "../../app.css";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

// ── モック素材データ（全 type を網羅） ──
const MOCK_MATERIALS: MediaIndexEntry[] = [
  {
    fileId: "mat-1",
    name: "Cu粉末焼結実験のSEM画像.png",
    type: "image",
    mimeType: "image/png",
    url: "",
    thumbnailUrl: "",
    uploadedAt: hoursAgo(3),
    usedIn: [
      { noteId: "note-1", noteTitle: "Cu粉末の焼結実験（第1回）", blockId: "b1" },
      { noteId: "note-7", noteTitle: "第2回焼結実験の計画", blockId: "b2" },
    ],
  },
  {
    fileId: "mat-2",
    name: "Theory of Sintering by Kingery (1958).pdf",
    type: "pdf",
    mimeType: "application/pdf",
    url: "",
    thumbnailUrl: "",
    uploadedAt: daysAgo(2),
    usedIn: [
      { noteId: "note-6", noteTitle: "文献レビュー: Cu焼結の最適条件", blockId: "b3" },
    ],
  },
  {
    fileId: "mat-3",
    name: "Materials Project — Cu phase diagram",
    type: "url",
    mimeType: "text/html",
    url: "https://materialsproject.org/materials/mp-30",
    thumbnailUrl: "",
    uploadedAt: daysAgo(5),
    usedIn: [
      { noteId: "note-1", noteTitle: "Cu粉末の焼結実験（第1回）", blockId: "b4" },
      { noteId: "note-5", noteTitle: "焼結パラメータ最適化メモ", blockId: "b5" },
      { noteId: "note-6", noteTitle: "文献レビュー: Cu焼結の最適条件", blockId: "b6" },
    ],
    urlMeta: {
      domain: "materialsproject.org",
      description: "First-principles calculations of materials properties",
    },
  },
  {
    fileId: "mat-4",
    name: "焼結実験の様子.mp4",
    type: "video",
    mimeType: "video/mp4",
    url: "",
    thumbnailUrl: "",
    uploadedAt: hoursAgo(8),
    usedIn: [],
  },
  {
    fileId: "mat-5",
    name: "実験メモ.m4a",
    type: "audio",
    mimeType: "audio/mp4",
    url: "",
    thumbnailUrl: "",
    uploadedAt: daysAgo(1),
    usedIn: [
      { noteId: "note-7", noteTitle: "第2回焼結実験の計画", blockId: "b7" },
    ],
  },
  {
    fileId: "mat-6",
    name: "XRDピーク図1ページ目（抽出）.png",
    type: "image",
    mimeType: "image/png",
    url: "",
    thumbnailUrl: "",
    uploadedAt: daysAgo(2),
    usedIn: [
      { noteId: "note-3", noteTitle: "XRD 分析結果", blockId: "b8" },
    ],
    derivedFromAssets: ["mat-2"],
  },
  {
    fileId: "mat-7",
    name: "data-cu-sintering-2026.csv",
    type: "other",
    mimeType: "text/csv",
    url: "",
    thumbnailUrl: "",
    uploadedAt: daysAgo(7),
    usedIn: [
      { noteId: "note-3", noteTitle: "XRD 分析結果", blockId: "b9" },
      { noteId: "note-5", noteTitle: "焼結パラメータ最適化メモ", blockId: "b10" },
    ],
  },
];

// ── ストーリー meta ──

const meta: Meta = {
  title: "AssetBrowser/MaterialListItem",
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--color-background)",
          fontFamily: "'Inter', system-ui, sans-serif",
          padding: 24,
        }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj;

// ── 1. デフォルトリスト ──
export const Default: Story = {
  name: "デフォルト（全 type 網羅）",
  render: () => (
    <div className="border border-border rounded-md overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <MaterialListHeader sortKey="uploadedAt" sortAsc={false} />
        <tbody>
          {MOCK_MATERIALS.map((entry, i) => (
            <MaterialListItem
              key={entry.fileId}
              entry={entry}
              index={i}
              onOpen={(e) => console.log("open:", e.fileId)}
              onOpenFull={(e) => console.log("openFull:", e.fileId)}
              onDelete={(e) => console.log("delete:", e.fileId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  ),
};

// ── 2. 選択状態を含む ──
export const WithSelection: Story = {
  name: "選択状態あり",
  render: () => {
    const SelectableList = () => {
      const [selected, setSelected] = useState<Set<string>>(new Set(["mat-1", "mat-3"]));
      const toggle = (id: string) => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };
      const allSelected = selected.size === MOCK_MATERIALS.length;
      return (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <MaterialListHeader
              allSelected={allSelected}
              onToggleSelectAll={() => {
                if (allSelected) setSelected(new Set());
                else setSelected(new Set(MOCK_MATERIALS.map((m) => m.fileId)));
              }}
              sortKey="uploadedAt"
              sortAsc={false}
            />
            <tbody>
              {MOCK_MATERIALS.map((entry, i) => (
                <MaterialListItem
                  key={entry.fileId}
                  entry={entry}
                  index={i}
                  selected={selected.has(entry.fileId)}
                  onToggleSelect={(e) => toggle(e.fileId)}
                  onOpen={(e) => console.log("open:", e.fileId)}
                  onDelete={(e) => console.log("delete:", e.fileId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      );
    };
    return <SelectableList />;
  },
};

// ── 3. Note 一覧との視覚比較 ──
const MOCK_NOTE_INDEX: GraphiumIndex = {
  version: 1,
  updatedAt: now.toISOString(),
  notes: [
    {
      noteId: "note-1",
      title: "Cu粉末の焼結実験（第1回）",
      modifiedAt: hoursAgo(2),
      createdAt: daysAgo(14),
      headings: [],
      labels: [
        { blockId: "b1", label: "procedure", preview: "焼結条件の検討" },
        { blockId: "b2", label: "material", preview: "Cu粉末" },
      ],
      outgoingLinks: [{ targetNoteId: "note-2", layer: "prov" }],
    },
    {
      noteId: "note-3",
      title: "XRD 分析結果",
      modifiedAt: daysAgo(1),
      createdAt: daysAgo(7),
      headings: [],
      labels: [{ blockId: "b3", label: "output", preview: "Cu2O ピーク確認" }],
      outgoingLinks: [],
    },
  ],
};

export const ComparisonWithNoteList: Story = {
  name: "Note 一覧との視覚比較",
  parameters: {
    docs: {
      description: {
        story:
          "上が素材リスト、下が Note 一覧。同じ table primitives（hover, selection, date format）を共有しているか確認。",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">素材リスト</h3>
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <MaterialListHeader sortKey="uploadedAt" sortAsc={false} />
            <tbody>
              {MOCK_MATERIALS.slice(0, 4).map((entry, i) => (
                <MaterialListItem
                  key={entry.fileId}
                  entry={entry}
                  index={i}
                  onOpen={(e) => console.log("open:", e.fileId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ height: 400, display: "flex" }}>
        <h3 className="text-sm font-semibold text-foreground mb-2 sr-only">Note 一覧</h3>
        <NoteListView
          noteIndex={MOCK_NOTE_INDEX}
          onOpenNote={(id) => console.log("openNote:", id)}
          onBack={() => console.log("back")}
        />
      </div>
    </div>
  ),
};

// ── 4. 空状態 ──
export const Empty: Story = {
  name: "ノート未参照のみ",
  render: () => {
    const orphan = MOCK_MATERIALS.find((m) => m.usedIn.length === 0)!;
    return (
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <MaterialListHeader sortKey="uploadedAt" sortAsc={false} />
          <tbody>
            <MaterialListItem entry={orphan} index={0} onOpen={(e) => console.log("open:", e.fileId)} />
          </tbody>
        </table>
      </div>
    );
  },
};

// ── 5. 派生関係 ──
export const DerivedFromAsset: Story = {
  name: "派生元あり（PDF から抽出した画像）",
  render: () => {
    const derivedEntry = MOCK_MATERIALS.find((m) => m.fileId === "mat-6")!;
    const sourceEntry = MOCK_MATERIALS.find((m) => m.fileId === "mat-2")!;
    return (
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <MaterialListHeader sortKey="uploadedAt" sortAsc={false} />
          <tbody>
            <MaterialListItem entry={sourceEntry} index={0} onOpen={(e) => console.log("open:", e.fileId)} />
            <MaterialListItem entry={derivedEntry} index={1} onOpen={(e) => console.log("open:", e.fileId)} />
          </tbody>
        </table>
      </div>
    );
  },
};
