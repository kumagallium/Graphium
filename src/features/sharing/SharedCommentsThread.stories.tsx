// SharedCommentsThread — 共有コメントのスレッド UI カタログ
//
// Library の詳細パネル（先生側）とノートのコメントタブ（学生側）で同じ部品を使う。
// ここでは書き込みをせず、props に渡すデータだけを差し替えて見た目を確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharedCommentsThread } from "./SharedCommentsThread";
import type { CommentThread, SharedComment } from "./shared-comments";

const teacher = { name: "佐藤 先生", email: "sato@lab.jp" };
const student = { name: "田中", email: "tanaka@lab.jp" };

const CURRENT_HASH = "sha256:v2";

const comment = (over: Partial<SharedComment> & { id: string }): SharedComment => ({
  author: teacher,
  createdAt: "2026-09-01T10:00:00+09:00",
  updatedAt: "2026-09-01T10:00:00+09:00",
  text: "",
  target: "note-1",
  targetHash: CURRENT_HASH,
  ...over,
});

const threads: CommentThread[] = [
  {
    root: comment({
      id: "c1",
      text: "焼成温度の根拠が書かれていません。参照した文献か、予備実験の結果を足してください。",
    }),
    replies: [
      comment({
        id: "c1r1",
        author: student,
        createdAt: "2026-09-01T14:20:00+09:00",
        text: "すみません、予備実験のノートを引用で足しました。",
      }),
    ],
  },
  {
    root: comment({
      id: "c2",
      createdAt: "2026-09-02T09:05:00+09:00",
      updatedAt: "2026-09-02T09:40:00+09:00",
      text: "この段落、単位が抜けています。",
      blockId: "b-42",
      blockText: "800 で 2 時間保持したのち炉冷した",
    }),
    replies: [],
  },
];

const olderThreads: CommentThread[] = [
  {
    root: comment({
      id: "c-old",
      createdAt: "2026-08-20T11:00:00+09:00",
      targetHash: "sha256:v1",
      text: "図 2 の軸ラベルが読めません。",
    }),
    replies: [
      comment({
        id: "c-old-r",
        author: student,
        createdAt: "2026-08-20T18:00:00+09:00",
        targetHash: "sha256:v1",
        text: "作り直して差し替えました。",
      }),
    ],
  },
];

const noop = async () => {};

const meta: Meta<typeof SharedCommentsThread> = {
  title: "Sharing/SharedCommentsThread",
  component: SharedCommentsThread,
  parameters: { layout: "padded" },
  args: {
    threads,
    currentHash: CURRENT_HASH,
    currentIdentity: teacher,
    onReply: noop,
    onEdit: noop,
    onDelete: noop,
    onCreate: noop,
    onJumpToBlock: () => {},
  },
  decorators: [
    (Story) => (
      // 右パネル相当の幅で確認する（実際の置き場所と同じ狭さ）
      <div style={{ width: 360, border: "1px solid var(--color-border-subtle)", borderRadius: 8 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof SharedCommentsThread>;

/** 先生から見た状態（自分のコメントは編集・削除できる） */
export const Playground: Story = {};

/** 学生から見た状態（先生のコメントは編集できず、返信だけできる） */
export const AsStudent: Story = {
  name: "学生側（返信のみ）",
  args: { currentIdentity: student },
};

/** 古い版へのコメントは畳んで置く（対象の hash が変わったもの） */
export const WithOlderVersions: Story = {
  name: "古い版へのコメントあり",
  args: { threads: [...threads, ...olderThreads] },
};

/** 段落を選んだ状態（入力欄の上に ¶ 抜粋が出る） */
export const WithPendingAnchor: Story = {
  name: "段落を選んだ状態",
  args: {
    pendingAnchor: { blockId: "b-42", blockText: "800 で 2 時間保持したのち炉冷した" },
    onClearAnchor: () => {},
  },
};

/** まだコメントが無い */
export const Empty: Story = {
  name: "コメント無し",
  args: { threads: [] },
};

/** identity 未登録（投稿できない）。文言は呼び出し側が渡す */
export const ComposerDisabled: Story = {
  name: "投稿できない（identity 未登録）",
  args: {
    composerDisabledReason:
      "コメントするには、設定 → 共有ストレージで名前とメールアドレスを登録してください。",
  },
};
