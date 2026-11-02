// PeekNoteMenu — ノート・ナレッジのサイドピークのヘッダー右端の ⋯
//
// 素材のピークは右端に ⋯ があるのに、ノートのピークには無かった。全画面のノートの ⋯ と
// 同じ見た目・同じ文言で、ピークでも全画面と同じ結果になる項目だけを載せる:
// Markdown で書き出し / リンクをコピー / アーカイブ / ゴミ箱へ（ナレッジは前の 2 つだけ）。
// ヘッダーの並びは本物と同じ: 閉じる / 全画面 / 題 / 保存の状態 / ⋯。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PeekNoteMenu } from "./peek-note-menu";
import { LocaleProvider, syncLocale } from "../../i18n";

/** 本物のピークのヘッダーと同じ並び・余白・アイコンの枠（閉じる・全画面は押しても何もしない） */
function PeekHeaderFrame({
  title,
  status = "保存済み",
  children,
}: {
  title: string;
  status?: string;
  children: React.ReactNode;
}) {
  const button = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 4,
    color: "var(--color-text-tertiary)",
  } as const;
  return (
    <div style={{ width: 440, marginLeft: "auto", background: "var(--color-card)", borderLeft: "1px solid var(--color-border-subtle)", minHeight: 240 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
        }}
      >
        {/* side-peek.tsx の「閉じる」「全画面」と同じ SVG */}
        <span style={button}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </span>
        <span style={button}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="10" y1="14" x2="3" y2="21" />
          </svg>
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 500 }}>{status}</span>
        {children}
      </div>
    </div>
  );
}

const meta: Meta<typeof PeekNoteMenu> = {
  title: "Molecules/PeekNoteMenu",
  component: PeekNoteMenu,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof PeekNoteMenu>;

/** ノートのピーク。⋯ を開いた状態（全部の項目） */
export const NoteOpen: Story = {
  args: {
    link: "https://example.com/Graphium/app/#note/n-1",
    onExportMarkdown: fn(),
    onArchive: fn(),
    onTrash: fn(),
  },
  render: (args) => (
    <PeekHeaderFrame title="天然酵母の継ぎ足し 3 日目">
      <PeekNoteMenu {...args} />
    </PeekHeaderFrame>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /メニュー|Menu/ }));
    const body = within(document.body);
    await expect(body.getByRole("button", { name: /Markdown/ })).toBeInTheDocument();
    await expect(body.getByRole("button", { name: /アーカイブ|Archive/ })).toBeInTheDocument();
  },
};

/** ナレッジのピーク。⋯ を開いた状態（アーカイブ・ゴミ箱は全画面と同じく出さない） */
export const KnowledgeOpen: Story = {
  args: { link: "https://example.com/Graphium/app/#knowledge/topic/w-1", onExportMarkdown: fn() },
  render: (args) => (
    <PeekHeaderFrame title="加水率とクラムの気泡">
      <PeekNoteMenu {...args} />
    </PeekHeaderFrame>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /メニュー|Menu/ }));
    await expect(within(document.body).getByRole("button", { name: /リンクをコピー|Copy link/ })).toBeInTheDocument();
  },
};

/** 出せる項目が 1 つも無いときは ⋯ ごと出さない */
export const NoItems: Story = {
  args: { link: null },
  render: (args) => (
    <PeekHeaderFrame title="版 2026-10-20 14:03">
      <PeekNoteMenu {...args} />
    </PeekHeaderFrame>
  ),
};

/**
 * マニュアル用（英語・パン作りの世界観）。manual/notes-and-editor.md の図。
 * scripts/manual-screenshots-copy-link.mjs が ⋯ を開いて、ヘッダーとメニューを切り抜く
 */
export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <Story />
        </LocaleProvider>
      );
    },
  ],
  args: {
    link: "https://example.com/Graphium/app/#note/n-1",
    onExportMarkdown: fn(),
    onArchive: fn(),
    onTrash: fn(),
  },
  render: (args) => (
    <PeekHeaderFrame title="Country loaf, 78% hydration" status="Saved">
      <PeekNoteMenu {...args} />
    </PeekHeaderFrame>
  ),
};
