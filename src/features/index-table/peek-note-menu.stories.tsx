// PeekNoteMenu — ノート・ナレッジのサイドピークのヘッダー右端の ⋯
//
// 素材のピークは右端に ⋯ があるのに、ノートのピークには無かった。今は「リンクをコピー」
// だけを載せる（全画面のノートの ⋯ と同じ見た目・同じ文言）。ヘッダーの並びは本物と同じ:
// 閉じる / 全画面 / 題 / 保存の状態 / ⋯。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { PeekNoteMenu } from "./peek-note-menu";

/** 本物のピークのヘッダーと同じ並び・余白の枠（閉じる・全画面はダミー） */
function PeekHeaderFrame({ title, children }: { title: string; children: React.ReactNode }) {
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
        <span style={button}>»</span>
        <span style={button}>⤢</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 500 }}>保存済み</span>
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

/** ノートのピーク（閉じた状態） */
export const Note: Story = {
  args: { link: "https://example.com/Graphium/app/#note/n-1" },
  render: (args) => (
    <PeekHeaderFrame title="天然酵母の継ぎ足し 3 日目">
      <PeekNoteMenu {...args} />
    </PeekHeaderFrame>
  ),
};

/** ナレッジのピーク。⋯ を開いた状態 */
export const KnowledgeOpen: Story = {
  args: { link: "https://example.com/Graphium/app/#knowledge/topic/w-1" },
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

/** リンクを作れない行き先（版のスナップショット等）では ⋯ ごと出さない */
export const NoLink: Story = {
  args: { link: null },
  render: (args) => (
    <PeekHeaderFrame title="版 2026-10-20 14:03">
      <PeekNoteMenu {...args} />
    </PeekHeaderFrame>
  ),
};
