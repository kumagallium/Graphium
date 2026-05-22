// MaterialSidePeek の Storybook
// type 別 viewer + inline モード（list の右側に並べた状態）を確認する

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MaterialSidePeek } from "./MaterialSidePeek";
import { MaterialListItem, MaterialListHeader } from "./MaterialListItem";
import type { MediaIndexEntry } from "./media-index";
import "../../app.css";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

// ── モック素材（type ごと、実画像を含む） ──
// 実画像は picsum.photos のシード固定で安定表示
const IMAGE: MediaIndexEntry = {
  fileId: "mat-img",
  name: "Cu粉末焼結実験のSEM画像.png",
  type: "image",
  mimeType: "image/png",
  url: "https://picsum.photos/seed/sem-cu/1024/768",
  thumbnailUrl: "https://picsum.photos/seed/sem-cu/256/192",
  uploadedAt: hoursAgo(3),
  usedIn: [
    { noteId: "note-1", noteTitle: "Cu粉末の焼結実験（第1回）", blockId: "b1" },
    { noteId: "note-7", noteTitle: "第2回焼結実験の計画", blockId: "b2" },
  ],
};

const PDF: MediaIndexEntry = {
  fileId: "mat-pdf",
  name: "Theory of Sintering by Kingery (1958).pdf",
  type: "pdf",
  mimeType: "application/pdf",
  url: "https://www.africau.edu/images/default/sample.pdf",
  thumbnailUrl: "",
  uploadedAt: daysAgo(2),
  usedIn: [
    { noteId: "note-6", noteTitle: "文献レビュー: Cu焼結の最適条件", blockId: "b3" },
  ],
};

const URL_ENTRY: MediaIndexEntry = {
  fileId: "mat-url",
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
    description: "First-principles calculations of materials properties: phase diagrams, band structures, and more.",
    ogImage: "https://picsum.photos/seed/mp-cu/1200/630",
  },
};

const VIDEO: MediaIndexEntry = {
  fileId: "mat-video",
  name: "焼結実験の様子.mp4",
  type: "video",
  mimeType: "video/mp4",
  url: "",
  thumbnailUrl: "",
  uploadedAt: hoursAgo(8),
  usedIn: [],
};

const AUDIO: MediaIndexEntry = {
  fileId: "mat-audio",
  name: "実験メモ.m4a",
  type: "audio",
  mimeType: "audio/mp4",
  url: "",
  thumbnailUrl: "",
  uploadedAt: daysAgo(1),
  usedIn: [
    { noteId: "note-7", noteTitle: "第2回焼結実験の計画", blockId: "b7" },
  ],
};

const FILE: MediaIndexEntry = {
  fileId: "mat-csv",
  name: "data-cu-sintering-2026.csv",
  type: "other",
  mimeType: "text/csv",
  url: "",
  thumbnailUrl: "",
  uploadedAt: daysAgo(7),
  usedIn: [
    { noteId: "note-3", noteTitle: "XRD 分析結果", blockId: "b9" },
  ],
};

const ALL = [IMAGE, PDF, URL_ENTRY, VIDEO, AUDIO, FILE];

// ── meta ──

const meta: Meta = {
  title: "AssetBrowser/MaterialSidePeek",
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
        }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj;

// ── 単体 viewer 比較（inline） ──
const SinglePeek = ({ entry }: { entry: MediaIndexEntry }) => (
  <div style={{ display: "flex", height: "100vh" }}>
    {/* ダミー本文（背景に何か必要） */}
    <div
      style={{
        flex: 1,
        padding: 24,
        background: "var(--color-background)",
        overflow: "auto",
      }}
    >
      <h2 className="text-base font-semibold text-foreground mb-2">List view（背景）</h2>
      <p className="text-sm text-muted-foreground">
        サイドピークは右に inline で差し込まれる想定。background は操作可能。
      </p>
    </div>
    <MaterialSidePeek
      entry={entry}
      inline
      onClose={() => console.log("close")}
      onOpenFull={(e) => console.log("openFull", e.fileId)}
      onDelete={(e) => console.log("delete", e.fileId)}
      onNavigateNote={(id) => console.log("navigateNote", id)}
    />
  </div>
);

export const ImageEntry: Story = {
  name: "image",
  render: () => <SinglePeek entry={IMAGE} />,
};

export const PdfEntry: Story = {
  name: "pdf",
  render: () => <SinglePeek entry={PDF} />,
};

export const UrlEntry: Story = {
  name: "url（OGP + iframe toggle）",
  render: () => <SinglePeek entry={URL_ENTRY} />,
};

export const VideoEntry: Story = {
  name: "video",
  render: () => <SinglePeek entry={VIDEO} />,
};

export const AudioEntry: Story = {
  name: "audio",
  render: () => <SinglePeek entry={AUDIO} />,
};

export const FileEntry: Story = {
  name: "other（汎用ファイル）",
  render: () => <SinglePeek entry={FILE} />,
};

// ── インタラクション: list → side peek（実運用シミュレーション） ──
export const ListWithSidePeek: Story = {
  name: "List → SidePeek（実運用フロー）",
  parameters: {
    docs: {
      description: {
        story:
          "list の行をクリックするとサイドピークが開く想定の挙動。サイドピーク表示中も list は操作可能。",
      },
    },
  },
  render: () => {
    const Demo = () => {
      const [activeId, setActiveId] = useState<string | null>(IMAGE.fileId);
      const active = ALL.find((m) => m.fileId === activeId) ?? null;
      return (
        <div style={{ display: "flex", height: "100vh" }}>
          <div style={{ flex: 1, padding: 16, overflow: "auto", background: "var(--color-background)" }}>
            <h2 className="text-base font-semibold text-foreground mb-3">Materials</h2>
            <div className="border border-border rounded-md overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <MaterialListHeader sortKey="uploadedAt" sortAsc={false} />
                <tbody>
                  {ALL.map((entry, i) => (
                    <MaterialListItem
                      key={entry.fileId}
                      entry={entry}
                      index={i}
                      selected={activeId === entry.fileId}
                      onOpen={(e) => setActiveId(e.fileId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {active && (
            <MaterialSidePeek
              entry={active}
              inline
              onClose={() => setActiveId(null)}
              onOpenFull={(e) => console.log("openFull", e.fileId)}
              onDelete={(e) => console.log("delete", e.fileId)}
              onNavigateNote={(id) => console.log("navigateNote", id)}
            />
          )}
        </div>
      );
    };
    return <Demo />;
  },
};

// ── オーバーレイモード（portal、fixed 配置） ──
export const OverlayMode: Story = {
  name: "Overlay（portal モード）",
  parameters: {
    docs: {
      description: {
        story:
          "inline=false で portal + fixed 配置。画面右から被さるパターン。背景は操作可能（薄暗くしない）。",
      },
    },
  },
  render: () => (
    <div style={{ minHeight: "100vh", padding: 24, background: "var(--color-background)" }}>
      <h2 className="text-base font-semibold text-foreground mb-3">
        背景コンテンツ（操作可能）
      </h2>
      <p className="text-sm text-muted-foreground mb-2">
        画面右側に MaterialSidePeek が fixed で被さっている状態。
      </p>
      <MaterialSidePeek
        entry={IMAGE}
        onClose={() => console.log("close")}
        onOpenFull={(e) => console.log("openFull", e.fileId)}
        onDelete={(e) => console.log("delete", e.fileId)}
        onNavigateNote={(id) => console.log("navigateNote", id)}
      />
    </div>
  ),
};
