// NoteSharedCommentsPanel — ノート編集画面（学生側）の右パネル「コメント」タブ
//
// 先生は Library の詳細パネル（SharedLibraryView の「詳細パネルのコメント節」）で、
// 学生はこのタブで同じスレッドを見る。ここでは学生側の見え方だけを切り出して確認する:
//   - スレッド本体（返信は 1 段・古い版へのコメントは畳まれる）
//   - ヘッダの共有済みバッジの横に出る「コメント N（新着 N）」
//   - 右レールのアイコンに乗る新着のドット
//
// 共有フォルダは Tauri の invoke 越しなので、Storybook では封筒・本文・書き込み先を
// すべて props（DI）で渡す。書き込みは console に出すだけで実際には保存しない。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  NoteSharedCommentsPanel,
  NoteSharedCommentsBadge,
  NoteSharedCommentsRailIcon,
} from "./NoteSharedCommentsPanel";
import type { SharedCommentProvider } from "./shared-comments";
import { markSeen } from "./shared-seen";
import "../../app.css";

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT = { name: "佐藤 学生", email: "sato@example.ac.jp" };

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

/** このノートの共有エントリ（＝コメントの対象）。id と hash は doc.sharedRef のもの */
const TARGET_ID = "note-shared-1";
const CURRENT_HASH = "sha256:v2-current";
const OLD_HASH = "sha256:v1-before-the-update";

/** バッジ・レール用は別の対象にする（パネルを開くと既読になり新着が消えるため） */
const BADGE_TARGET_ID = "note-shared-badge";

function commentEntry(
  id: string,
  author: { name: string; email: string },
  createdAt: string,
  extra: Record<string, unknown>,
): SharedEntry {
  return {
    id,
    type: "comment",
    author,
    created_at: createdAt,
    updated_at: createdAt,
    hash: `sha256:${id}`,
    prov: { derived_from: [String(extra.target ?? "")] },
    version: 1,
    extra,
  };
}

const COMMENTS: SharedEntry[] = [
  commentEntry("c-1", TEACHER, hoursAgo(30), {
    target: TARGET_ID,
    targetHash: CURRENT_HASH,
  }),
  commentEntry("c-1-r", STUDENT, hoursAgo(26), {
    target: TARGET_ID,
    targetHash: CURRENT_HASH,
    parentId: "c-1",
  }),
  // 段落に付いた指摘（¶ チップが出る。押すと該当ブロックへ飛ぶ）
  commentEntry("c-2", TEACHER, hoursAgo(4), {
    target: TARGET_ID,
    targetHash: CURRENT_HASH,
    blockId: "b-sinter",
    blockText: "1050 ℃ で 2 時間保持した",
  }),
  // 共有コピーを更新する前に書かれた指摘 → 「古い版へのコメント」に畳まれる
  commentEntry("c-old", TEACHER, hoursAgo(120), {
    target: TARGET_ID,
    targetHash: OLD_HASH,
  }),
  commentEntry("c-old-r", STUDENT, hoursAgo(118), {
    target: TARGET_ID,
    targetHash: OLD_HASH,
    parentId: "c-old",
  }),
  // バッジ・レール用（対象が違うのでパネルには出ない）
  commentEntry("c-badge-1", TEACHER, hoursAgo(9), {
    target: BADGE_TARGET_ID,
    targetHash: CURRENT_HASH,
  }),
  commentEntry("c-badge-2", TEACHER, hoursAgo(8), {
    target: BADGE_TARGET_ID,
    targetHash: CURRENT_HASH,
  }),
  commentEntry("c-badge-3", STUDENT, hoursAgo(7), {
    target: BADGE_TARGET_ID,
    targetHash: CURRENT_HASH,
  }),
];

const TEXTS: Record<string, string> = {
  "c-1": "昇温速度が書かれていません。次回から記録してください。",
  "c-1-r": "すみません、追記しました。5 ℃/min です。",
  "c-2": "保持時間の根拠になった文献を、引用で足しておくと良いです。",
  "c-old": "図 2 の軸ラベルが読めません。作り直してください。",
  "c-old-r": "差し替えました。",
};

const readBody = async (entry: SharedEntry) => ({
  body: new TextEncoder().encode(TEXTS[entry.id] ?? ""),
  verified: true,
});

/** 書き込みは実際には保存せず、何が呼ばれたかだけ出す */
const fakeProvider: SharedCommentProvider = {
  read: async (id: string) => {
    const entry = COMMENTS.find((e) => e.id === id);
    if (!entry) throw new Error(`not found: ${id}`);
    return { entry, body: new TextEncoder().encode(TEXTS[id] ?? "") };
  },
  write: async (entry) => {
    console.log("[storybook] write comment", entry.id, entry.extra);
  },
  delete: async (id) => {
    console.log("[storybook] delete comment", id);
  },
};

/** ¶ チップのライブ解決（エディタに今あるブロックの見出し文字） */
const resolveBlockLabel = (blockId: string): string | null =>
  blockId === "b-sinter" ? "1050 ℃ で 2 時間保持した（本文の現在の文言）" : null;

const meta: Meta<typeof NoteSharedCommentsPanel> = {
  title: "Sharing/NoteSharedCommentsPanel",
  component: NoteSharedCommentsPanel,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "学生側の右パネル「コメント」タブ。先生の指摘に返信でき、自分からも書ける。段落に付いた指摘は ¶ チップで示し、カードを押すとエディタ側の該当ブロックをハイライト＋スクロールする（エディタ本体に常時の印は出さない）。共有コピーを更新すると対象の hash が変わるので、更新前に書かれた指摘は「古い版へのコメント」に自動で畳まれる（解決フラグを持たない代わり）。",
      },
    },
  },
  args: {
    targetId: TARGET_ID,
    targetHash: CURRENT_HASH,
    root: "/Users/sato/shared-lab",
    author: STUDENT,
    entries: COMMENTS,
    readBody,
    provider: fakeProvider,
    resolveBlockLabel,
    onHighlightBlock: (blockId: string | null) =>
      console.log("[storybook] highlight block", blockId),
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          {/* 実際の置き場所（右パネル）と同じ幅で見る */}
          <div
            style={{
              width: 360,
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 8,
              overflow: "hidden",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof NoteSharedCommentsPanel>;

/** 学生から見た状態（先生のコメントには返信だけできる） */
export const Playground: Story = {};

/** 自分（学生）が書いたコメントは編集・削除できる */
export const AsAuthorOfComments: Story = {
  name: "自分のコメントがある状態",
  args: { author: TEACHER },
};

/** identity 未登録なら入力欄を出さず、設定への案内だけ出す（黙って失敗させない） */
export const WithoutIdentity: Story = {
  name: "identity 未登録（読むだけ）",
  args: { author: null },
};

/** まだ 1 件も付いていないノート */
export const Empty: Story = {
  name: "コメントなし",
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
          <div
            style={{
              width: 360,
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 8,
              overflow: "hidden",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};

/**
 * ヘッダのバッジと右レールのアイコン。
 * 「前に見たときは 1 件だった」控えを仕込むので、増えた 2 件が新着になる。
 */
export const HeaderBadgeAndRailIcon: Story = {
  name: "ヘッダのバッジ・レールのドット",
  parameters: {
    docs: {
      description: {
        story:
          "コメントが 1 件も無いときはバッジを出さない（0 の表示は場所を取るだけ）。新着があるときだけバッジを強調し、レールのアイコンに小さなドットを重ねる（パネルを閉じていても届いたことが分かる）。",
      },
    },
  },
  render: () => {
    syncLocale("ja");
    // 前に開いたときは 1 件だけ見ていた → 増えた 2 件が「新着」になる
    markSeen(BADGE_TARGET_ID, CURRENT_HASH, 1);
    return (
      <LocaleProvider>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: 12,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          <NoteSharedCommentsBadge
            targetId={BADGE_TARGET_ID}
            entries={COMMENTS}
            onClick={() => console.log("[storybook] open comments tab")}
          />
          <NoteSharedCommentsRailIcon targetId={BADGE_TARGET_ID} entries={COMMENTS} />
        </div>
      </LocaleProvider>
    );
  },
};
