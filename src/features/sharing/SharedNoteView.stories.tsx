// 共有ノートの全画面表示のストーリー。
//
// 実アプリの本文・コメントは Tauri の invoke 越しに読むので、ここでは DI
// （entries / readEntryBody / projection）で差し替えて描く。研究室の場面は
// SharedLibraryView のストーリーと同じ（先生が学生のノートを読んで返す）。
//
// 右レールの 4 パネル（コメント / 版 / プロセス / 逆引き）をそれぞれ開いた状態で
// 1 本ずつ用意する。パネルは幅を変えられる（左端をドラッグ）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import { SharedNoteView } from "./SharedNoteView";
import {
  createEmptySharedProjection,
  projectSharedNote,
  type SharedProjection,
} from "./shared-projection";
import "../../app.css";

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT_A = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const NOTE: SharedEntry = {
  id: "note-1",
  type: "note",
  author: STUDENT_A,
  created_at: daysAgo(10),
  updated_at: daysAgo(1),
  hash: "sha256:aaaa1111",
  prov: { derived_from: [] },
  version: 2,
  extra: { title: "Cu粉末の焼結実験（第1回）" },
  history: [
    {
      updated_at: daysAgo(6),
      updated_by: STUDENT_A,
      hash: "sha256:before-the-update",
      change_kind: "minor" as const,
    },
  ],
} as SharedEntry;

/** 逆引きに出る「このノートを引用している共有ノート」 */
const CITING_NOTE: SharedEntry = {
  id: "note-2",
  type: "note",
  author: TEACHER,
  created_at: daysAgo(3),
  updated_at: daysAgo(2),
  hash: "sha256:bbbb2222",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "焼結条件の比較メモ" },
} as SharedEntry;

const COMMENTS: SharedEntry[] = [
  {
    id: "comment-1",
    type: "comment",
    author: TEACHER,
    created_at: daysAgo(0.5),
    updated_at: daysAgo(0.5),
    hash: "sha256:cccc0001",
    prov: { derived_from: ["note-1"] },
    version: 1,
    extra: { target: "note-1", targetHash: NOTE.hash },
  },
  {
    id: "comment-2",
    type: "comment",
    author: STUDENT_A,
    created_at: daysAgo(0.4),
    updated_at: daysAgo(0.4),
    hash: "sha256:cccc0002",
    prov: { derived_from: ["note-1"] },
    version: 1,
    extra: { target: "note-1", targetHash: NOTE.hash, parentId: "comment-1" },
  },
  {
    id: "comment-3",
    type: "comment",
    author: TEACHER,
    created_at: daysAgo(0.3),
    updated_at: daysAgo(0.3),
    hash: "sha256:cccc0003",
    prov: { derived_from: ["note-1"] },
    version: 1,
    extra: {
      target: "note-1",
      targetHash: NOTE.hash,
      blockId: "b-sinter",
      blockText: "1050 ℃ で 2 時間保持した",
    },
  },
] as SharedEntry[];

const COMMENT_TEXTS: Record<string, string> = {
  "comment-1": "昇温速度が書かれていません。次回から記録してください。",
  "comment-2": "すみません、追記しました。5 ℃/min です。",
  "comment-3": "保持時間の根拠になった文献を引用で足しておくと良いです。",
};

const para = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const DOC: GraphiumDocument = {
  version: 6,
  title: "Cu粉末の焼結実験（第1回）",
  createdAt: daysAgo(10),
  modifiedAt: daysAgo(1),
  pages: [
    {
      id: "p1",
      title: "Cu粉末の焼結実験（第1回）",
      blocks: [
        para("b-weigh", "Cu 粉末を 5.00 g 秤量した（電子天秤 0.01 g 読み）。"),
        para("b-press", "一軸プレスで 200 MPa・60 秒 保持して圧粉体を作製した。"),
        para("b-sinter", "1050 ℃ で 2 時間保持した"),
        para("b-cool", "炉冷（自然冷却）。翌朝に取り出した。"),
        para("b-xrd", "焼結体を XRD で測定し、Cu2O のピークを確認した。"),
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

/** 手順（step ブロック）を持つ版。プロセスのパネルを描くために使う */
const PROCEDURE_DOC: GraphiumDocument = {
  version: 6,
  title: "Cu粉末の焼結実験（第1回）",
  createdAt: daysAgo(10),
  modifiedAt: daysAgo(1),
  pages: [
    {
      id: "p1",
      title: "Cu粉末の焼結実験（第1回）",
      blocks: [
        {
          id: "s1",
          type: "step",
          props: {},
          content: [{ type: "text", text: "圧粉", styles: {} }],
          children: [
            {
              id: "s1-b1",
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "Cu 粉末", styles: { inlineMaterial: "m1" } }],
              children: [],
            },
          ],
        },
        {
          id: "s2",
          type: "step",
          props: {},
          content: [{ type: "text", text: "焼結", styles: {} }],
          children: [
            {
              id: "s2-b1",
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "圧粉体", styles: { inlineMaterial: "m2" } }],
              children: [],
            },
          ],
        },
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

/** note-2 が note-1 を引用している投影（逆引きのパネル用） */
const CITING_DOC: GraphiumDocument = {
  version: 6,
  title: "焼結条件の比較メモ",
  createdAt: daysAgo(3),
  modifiedAt: daysAgo(2),
  pages: [
    {
      id: "p1",
      title: "焼結条件の比較メモ",
      blocks: [
        {
          id: "c1",
          type: "sharedCitation",
          props: { sharedId: "note-1", title: "Cu粉末の焼結実験（第1回）" },
          content: [],
          children: [],
        },
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

function projectionOf(pairs: [SharedEntry, GraphiumDocument][]): SharedProjection {
  const base = createEmptySharedProjection();
  for (const [entry, doc] of pairs) {
    base.entries[entry.id] = projectSharedNote(entry, doc);
  }
  return base;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** 本文とコメント本文の両方を返す DI リーダ（実アプリの readSharedEntryBody 相当） */
const readerFor = (doc: GraphiumDocument) => async (entry: SharedEntry) => ({
  body:
    entry.type === "comment"
      ? new TextEncoder().encode(COMMENT_TEXTS[entry.id] ?? "")
      : encode(doc),
  verified: true,
});

const NOOP_ASYNC = async () => {};

const baseArgs = {
  entry: NOTE,
  currentIdentity: TEACHER,
  sharedRoot: "/Users/yamada/shared-lab",
  onBack: () => console.log("back to library"),
  onOpenEntry: (id: string) => console.log("open entry", id),
  onForkNote: NOOP_ASYNC,
  onForkKnowledge: NOOP_ASYNC,
  onUnshare: NOOP_ASYNC,
  entries: COMMENTS,
  projection: projectionOf([[NOTE, DOC]]),
  readEntryBody: readerFor(DOC),
};

const meta: Meta<typeof SharedNoteView> = {
  title: "Sharing/SharedNoteView",
  component: SharedNoteView,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "共有エントリの全画面表示。個人のノートと同じ本文カラム幅で読み、右レール（コメント / 版 / プロセス / 逆引き）を必要なときだけ開く。本文の段落をクリックすると、その段落へのコメントとして書き始められる。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SharedNoteView>;

const jaDecorators = [
  (Story: () => React.ReactElement) => {
    syncLocale("ja");
    return (
      <LocaleProvider>
        <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    );
  },
];

export const Comments: Story = {
  name: "コメント（既定）",
  args: baseArgs,
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "開いたときの既定。コメントの一覧がパネルの高さいっぱいにスクロールし、入力欄は下端に固定される。本文の段落をクリックすると ¶ の指定が付き、入力欄へフォーカスが移る。",
      },
    },
  },
};

export const Version: Story = {
  name: "版",
  args: { ...baseArgs, initialRailTab: "version" as const },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "ID・作成日・更新日・ハッシュ（押すと検証）と、同じ id を上書きした更新の履歴。",
      },
    },
  },
};

export const Process: Story = {
  name: "プロセス",
  args: {
    ...baseArgs,
    initialRailTab: "process" as const,
    projection: projectionOf([[NOTE, PROCEDURE_DOC]]),
    readEntryBody: readerFor(PROCEDURE_DOC),
  },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "共有ノートの本文から投影した手順フロー（読み取り専用）。手順を持たないノートでは「手順はありません」と出る。",
      },
    },
  },
};

export const Backlinks: Story = {
  name: "逆引き",
  args: {
    ...baseArgs,
    initialRailTab: "links" as const,
    entries: [...COMMENTS, CITING_NOTE],
    projection: projectionOf([
      [NOTE, DOC],
      [CITING_NOTE, CITING_DOC],
    ]),
  },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "このエントリを指している共有ノート（引用・派生・テンプレート利用）。行を押すと相手のエントリへ移る。0 件のときは「まだ見つかっていない」と書く —— 元になるのは本文を読めた共有ノートの投影だけなので、0 件だと断言しない。",
      },
    },
  },
};

export const English: Story = {
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
