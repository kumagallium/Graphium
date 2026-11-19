// 「共有に反映」のダイアログのストーリー（順番に更新）。
//
// 作者が「他の人の更新を受け付ける」を入れたノートの写しを、共有に反映する。
// 先に更新されていたときは、何も書かずに 3 つの選択肢を出す。
// ここでは書き込み（__update）と共有ライブラリ（entries）を DI で差し替えて描く。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import { UpdateConflictDialog, UpdateSharedNoteDialog } from "./UpdateSharedNoteDialog";
import "../../app.css";

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };

const TARGET: SharedEntry = {
  id: "note-1",
  type: "note",
  author: TEACHER,
  created_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
  updated_at: new Date(Date.now() - 86400_000).toISOString(),
  hash: "sha256:aaaa1111",
  prov: { derived_from: [] },
  version: 2,
  extra: { title: "Cu粉末の焼結実験（第1回）", acceptsUpdates: true },
} as SharedEntry;

const DOC = {
  version: 6,
  title: "Cu粉末の焼結実験（第1回） (forked)",
  pages: [{ id: "p1", title: "x", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
} as unknown as GraphiumDocument;

const meta: Meta<typeof UpdateSharedNoteDialog> = {
  title: "Sharing/UpdateSharedNoteDialog",
  component: UpdateSharedNoteDialog,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "作者が更新を受け付けているノートの写しを、共有に反映する確認ダイアログ。反映先の題と、更新者として残る名前を見せる。本文は「反映する」を押した時点で組み立てる。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof UpdateSharedNoteDialog>;

const decorators = [
  (Story: () => React.ReactElement) => {
    syncLocale("ja");
    return (
      <LocaleProvider>
        <div style={{ height: "100vh", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    );
  },
];

export const Confirm: Story = {
  name: "共有に反映 — 確認",
  args: {
    open: true,
    targetId: "note-1",
    entries: [TARGET],
    resolveSource: async () => DOC,
    onClose: () => console.log("close"),
    onUpdated: () => console.log("updated"),
    onConflict: () => console.log("conflict"),
    __update: (async (doc: GraphiumDocument) => ({
      ok: true as const,
      doc,
      entry: TARGET,
    })) as never,
  },
  decorators,
};

export const TargetMissing: Story = {
  name: "共有に反映 — 反映先が見つからない",
  args: { ...Confirm.args, entries: [] },
  decorators,
};

export const Conflict: StoryObj<typeof UpdateConflictDialog> = {
  name: "先に更新されていたとき（選択肢）",
  render: (args) => <UpdateConflictDialog {...args} />,
  args: {
    open: true,
    onFork: () => console.log("fork from latest"),
    onPropose: () => console.log("propose"),
    onClose: () => console.log("close"),
  },
  decorators,
  parameters: {
    docs: {
      description: {
        story:
          "共有には何も書いていないこと、手元の写しが残ることを伝え、「最新の版から写しを作る」「提案として出す」「閉じる」を出す。",
      },
    },
  },
};
