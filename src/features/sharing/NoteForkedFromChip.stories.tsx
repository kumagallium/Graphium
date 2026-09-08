// NoteForkedFromChip — ノートのヘッダに出る「派生元」チップ（§25b F）
//
// 共有ノートを派生（fork）した手元のノートに出る。押すと元の共有エントリを
// 全画面で開く。提案として共有している間は、右隣に提案の状態バッジが並ぶ
// （派生元 → 提案の状態、の順）。
//
// 共有ライブラリは Tauri 越しなので、Storybook では封筒を props（DI）で渡す。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import { NoteForkedFromChip } from "./NoteForkedFromChip";
import "../../app.css";

const ORIGIN_ID = "note-shared-1";

const ORIGIN: SharedEntry = {
  id: ORIGIN_ID,
  type: "note",
  author: { name: "山田 先生", email: "yamada@example.ac.jp" },
  created_at: "2026-08-20T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  hash: "sha256:v2",
  prov: { derived_from: [] },
  extra: { title: "全粒粉パンの記録" },
} as SharedEntry;

const meta: Meta<typeof NoteForkedFromChip> = {
  title: "Sharing/NoteForkedFromChip",
  component: NoteForkedFromChip,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "派生（fork）したノートのヘッダに出るチップ。元の題名は共有ライブラリから引き、まだ読めていない・共有が解除された場合は派生時に控えた作者名にフォールバックする（派生した事実は元が消えても変わらないので、チップ自体は消さない）。",
      },
    },
  },
  args: {
    forkedFrom: {
      sharedId: ORIGIN_ID,
      hash: "sha256:v1",
      authorName: "山田 先生",
      authorEmail: "yamada@example.ac.jp",
      forkedAt: "2026-09-02T10:00:00Z",
    },
    entries: [ORIGIN],
    onOpen: (id: string) => console.log("[storybook] open shared entry", id),
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: 16 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof NoteForkedFromChip>;

/** 元が共有ライブラリにある（題名が出る） */
export const Playground: Story = { name: "派生元（題名あり）" };

/** 元がまだ読めていない・共有解除された（控えた作者名にフォールバック） */
export const OriginMissing: Story = {
  name: "派生元が見つからない",
  args: { entries: [] },
};

/** 英語表示 */
export const English: Story = {
  name: "English",
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: 16 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
