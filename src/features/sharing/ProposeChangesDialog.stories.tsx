// 「元のノートへ変更を提案」ダイアログのストーリー（§25 C-3）。
//
// 実アプリでは ⋯ メニューから開き、押した時点の本文を封筒にして proposals/ に置く。
// ここでは書き込み（__share）と共有ライブラリ（entries）を DI で差し替えて描く。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import { ProposeChangesDialog } from "./ProposeChangesDialog";
import "../../app.css";

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };

const TARGET: SharedEntry = {
  id: "note-1",
  type: "note",
  author: TEACHER,
  created_at: daysAgo(10),
  updated_at: daysAgo(1),
  hash: "sha256:aaaa1111",
  prov: { derived_from: [] },
  version: 2,
  extra: { title: "Cu粉末の焼結実験（第1回）" },
} as SharedEntry;

const DOC: GraphiumDocument = {
  version: 6,
  title: "Cu粉末の焼結実験（第1回）（forked）",
  pages: [
    {
      id: "p1",
      title: "Cu粉末の焼結実験（第1回）（forked）",
      blocks: [],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

/** 共有フォルダに書かずに成功したことにする（Storybook には共有フォルダが無い） */
const fakeShare = (async (doc: GraphiumDocument) => {
  console.log("propose", doc.title);
  return {
    ok: true as const,
    doc,
    entry: { ...TARGET, id: "proposal-1", type: "proposal" } as SharedEntry,
    isUpdate: false,
  };
}) as never;

const meta: Meta<typeof ProposeChangesDialog> = {
  title: "Sharing/ProposeChangesDialog",
  component: ProposeChangesDialog,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "派生（fork）したノートの変更を、元のノートへの提案として共有するダイアログ。元のノートは書き換わらない（提案は自分名義の別の封筒）。本文は「提案する」を押した時点で組み立てるので、開いたまま編集を続けても最新が出る。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof ProposeChangesDialog>;

const baseArgs = {
  open: true,
  targetId: "note-1",
  entries: [TARGET],
  forkedFrom: {
    sharedId: "note-1",
    hash: TARGET.hash,
    authorName: TEACHER.name,
    authorEmail: TEACHER.email,
    forkedAt: daysAgo(2),
  },
  resolveSource: async () => DOC,
  resolveBase: async () => ({ origin: "fork" as const, body: "{}" }),
  onClose: () => console.log("close"),
  onShared: () => console.log("shared"),
  __share: fakeShare,
};

const jaDecorators = [
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

export const Propose: Story = {
  name: "変更の提案 — 提案する（ダイアログ）",
  args: baseArgs,
  decorators: jaDecorators,
};

export const TargetUpdated: Story = {
  name: "変更の提案 — 元がその後更新されている",
  args: {
    ...baseArgs,
    forkedFrom: { ...baseArgs.forkedFrom, hash: "sha256:before-the-update" },
  },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "派生したあとに元のノートが更新された場合。提案は出せるが、差分は元の現在の版と比べて表示されることを先に伝える。",
      },
    },
  },
};

export const TargetMissing: Story = {
  name: "変更の提案 — 元が見つからない",
  args: { ...baseArgs, entries: [] },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "派生元が共有ライブラリに無いとき（共有解除・まだ読み込めていない）。何への提案か分からない封筒を作らないよう、提案そのものを止める。",
      },
    },
  },
};

export const English: Story = {
  name: "English",
  args: baseArgs,
  decorators: [
    (Story: () => React.ReactElement) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
