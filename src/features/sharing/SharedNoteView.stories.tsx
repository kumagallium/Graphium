// 共有ノートの全画面表示のストーリー。
import type { ComponentType } from "react";
//
// 実アプリの本文・コメントは Tauri の invoke 越しに読むので、ここでは DI
// （entries / readEntryBody / projection）で差し替えて描く。研究室の場面は
// SharedLibraryView のストーリーと同じ（先生が学生のノートを読んで返す）。
//
// 右レールの各パネル（コメント / AI に質問 / 版 / プロセス / 逆引き）をそれぞれ
// 開いた状態で 1 本ずつ用意する。パネルは幅を変えられる（左端をドラッグ）。
//
// 「AI に質問」だけは aiAvailable を渡したストーリー（Chat）でしか出ない。
// 他のストーリーが渡していないのは手抜きではなく、「AI が使えない環境では
// タブごと出ない」という既定の見え方そのもの。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument, ScopeChat } from "../../lib/document-types";
import { SharedNoteView } from "./SharedNoteView";
import type { SharedNoteChatDeps } from "./SharedNoteChatPanel";
import { sharedChatsKey } from "./shared-chat";
import type { StorageProvider } from "../../lib/storage/types";
import type { AgentRunResponse } from "../ai-assistant/api";
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

// ── 「AI に質問」ストーリーの偽の実行環境 ──
//
// Storybook にはバックエンドもストレージも無いので、DI（chatDeps）で差し替える。
// 会話の保存先はメモリ上の Map（実アプリでは手元の appData `shared-chats:<id>`）。

const memoryAppData = new Map<string, unknown>();
const memoryProvider = {
  readAppData: async (key: string) => memoryAppData.get(key) ?? null,
  writeAppData: async (key: string, value: unknown) => {
    memoryAppData.set(key, value);
  },
} as unknown as StorageProvider;

const CHAT_DEPS: SharedNoteChatDeps = {
  provider: memoryProvider,
  // 実物は共有本文（GraphiumDocument）を Markdown に起こす。ここでは段落だけ拾う
  toMarkdown: async (doc) =>
    (doc.pages ?? [])
      .flatMap((page) => page.blocks ?? [])
      .map((b: any) => (b.content ?? []).map((c: any) => c.text ?? "").join(""))
      .filter(Boolean)
      .join("\n\n"),
  // 横断検索は行わない（Storybook には索引が無い）
  retrieveWikiContext: async () => null,
  runAgent: async (req) =>
    new Promise<AgentRunResponse>((resolve) =>
      setTimeout(
        () =>
          resolve({
            session_id: "story-session",
            message: [
              "共有された本文からは次のことが読み取れます。",
              "",
              "- 圧粉は 200 MPa・60 秒",
              "- 焼結は 1050 ℃ で 2 時間保持",
              "",
              "昇温速度が本文に見当たらないので、そこは共有した人に確かめてください。",
              "",
              `（受け取った文字数: ${req.message.length}）`,
            ].join("\n"),
            tool_calls: [],
            provenance_id: null,
            token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            model: "story-model",
          }),
        600,
      ),
    ),
};

const meta: Meta<typeof SharedNoteView> = {
  title: "Sharing/SharedNoteView",
  component: SharedNoteView,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "共有エントリの全画面表示。個人のノートと同じ本文カラム幅で読み、右レール（コメント / AI に質問 / 版 / プロセス / 逆引き）を必要なときだけ開く。本文の段落をクリックすると、その段落へのコメントとして書き始められる（「AI に質問」を開いているときは、その段落を引用した会話が始まる）。",
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

/**
 * web モードの AiAssistantPanel はモデル一覧を localStorage（graphium-llm-models）から
 * 読み、空だと「モデルが登録されていません」の案内だけを出して送信できない。
 * Storybook にバックエンドは無いので、ダミーのモデルを 1 件 seed して
 * 「使える状態」の見た目と、偽 runAgent の定型回答までを再現する。
 * （settings/modal.stories.tsx と同じ手口。API キーはダミーで呼び出しには使わない）
 */
const withSeededModel = (Story: ComponentType) => {
  localStorage.setItem(
    "graphium-llm-models",
    JSON.stringify([
      { id: "story-m1", name: "Story model", provider: "openai-compatible", modelId: "story-model", apiKey: "dummy", apiBase: "http://127.0.0.1:9999/v1" },
    ]),
  );
  return <Story />;
};

export const Chat: Story = {
  name: "AI に質問",
  args: {
    ...baseArgs,
    initialRailTab: "chat" as const,
    aiAvailable: true,
    chatDeps: CHAT_DEPS,
    onIngestChat: (messages: unknown[]) => console.log("ingest chat", messages.length),
  },
  decorators: [withSeededModel, ...jaDecorators],
  parameters: {
    docs: {
      description: {
        story:
          "共有された本文を根拠に AI へ聞くパネル。送信のたびに本文（Markdown・上限 20,000 字）が質問と一緒に渡り、会話は共有フォルダではなく手元にだけ残る。本文の段落をクリックすると、その段落を引用した新しい会話が始まる（コメントの付け先指定にはならない）。AI が使えない環境ではこのタブ自体が出ない。",
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

// ── マニュアル用スクショ（英語・パン作りの世界観） ──
//
// 撮影は scripts/manual-screenshots-shared.mjs。登場人物・共有フォルダは
// SharedLibraryView の ManualEnglish と揃える（指導役 Mia Tanaka が学生役
// Ken Sato のノートを読んで返す）。右レールは既定のコメントを開いたまま撮る。

const MANUAL_MENTOR = { name: "Mia Tanaka", email: "mia@example.org" };
const MANUAL_STUDENT = { name: "Ken Sato", email: "ken@example.org" };

const MANUAL_NOTE: SharedEntry = {
  id: "manual-note-1",
  type: "note",
  author: MANUAL_STUDENT,
  created_at: daysAgo(6),
  updated_at: daysAgo(0.1),
  hash: "sha256:9f2c41ab",
  prov: { derived_from: [] },
  version: 2,
  extra: { title: "Sourdough starter log — day 3", noteContexts: ["Sourdough/Starter"] },
  history: [
    {
      updated_at: daysAgo(2),
      updated_by: MANUAL_STUDENT,
      hash: "sha256:41c7be08",
      change_kind: "minor" as const,
    },
  ],
} as SharedEntry;

const MANUAL_COMMENTS: SharedEntry[] = [
  {
    id: "manual-comment-1",
    type: "comment",
    author: MANUAL_MENTOR,
    created_at: daysAgo(0.35),
    updated_at: daysAgo(0.35),
    hash: "sha256:dddd0001",
    prov: { derived_from: ["manual-note-1"] },
    version: 1,
    extra: { target: "manual-note-1", targetHash: MANUAL_NOTE.hash },
  },
  {
    id: "manual-comment-2",
    type: "comment",
    author: MANUAL_STUDENT,
    created_at: daysAgo(0.3),
    updated_at: daysAgo(0.3),
    hash: "sha256:dddd0002",
    prov: { derived_from: ["manual-note-1"] },
    version: 1,
    extra: {
      target: "manual-note-1",
      targetHash: MANUAL_NOTE.hash,
      parentId: "manual-comment-1",
    },
  },
  {
    id: "manual-comment-3",
    type: "comment",
    author: MANUAL_MENTOR,
    created_at: daysAgo(0.2),
    updated_at: daysAgo(0.2),
    hash: "sha256:dddd0003",
    prov: { derived_from: ["manual-note-1"] },
    version: 1,
    extra: {
      target: "manual-note-1",
      targetHash: MANUAL_NOTE.hash,
      blockId: "mb-rise",
      blockText: "The starter doubled in four hours at 28 °C.",
    },
  },
] as SharedEntry[];

const MANUAL_COMMENT_TEXTS: Record<string, string> = {
  "manual-comment-1":
    "Good rise. Could you also write down the room temperature at every feeding?",
  "manual-comment-2": "Added it — 21 °C in the kitchen, 28 °C in the proofing box.",
  "manual-comment-3":
    "Worth linking the hydration page here: day 2 rose much more slowly at the same temperature.",
};

const MANUAL_DOC: GraphiumDocument = {
  version: 6,
  title: "Sourdough starter log — day 3",
  createdAt: daysAgo(6),
  modifiedAt: daysAgo(0.1),
  pages: [
    {
      id: "p1",
      title: "Sourdough starter log — day 3",
      blocks: [
        para("mb-feed", "Fed the starter at 8:00 with 50 g of bread flour and 50 g of water (1:1:1)."),
        para("mb-box", "Kept it in the proofing box at 28 °C; the kitchen itself stayed around 21 °C."),
        para("mb-rise", "The starter doubled in four hours at 28 °C."),
        para("mb-smell", "The smell has moved from sharp vinegar to something closer to yogurt."),
        para("mb-next", "Day 4: feed twice, and save the discard for the weekend baguettes."),
      ],
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
    },
  ],
} as any;

/** 本文とコメント本文の両方を返す DI リーダ（英語版の COMMENT_TEXTS を引く） */
const manualReader = async (entry: SharedEntry) => ({
  body:
    entry.type === "comment"
      ? new TextEncoder().encode(MANUAL_COMMENT_TEXTS[entry.id] ?? "")
      : encode(MANUAL_DOC),
  verified: true,
});

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  args: {
    ...baseArgs,
    entry: MANUAL_NOTE,
    currentIdentity: MANUAL_MENTOR,
    sharedRoot: "/Users/mia/shared-bakery",
    entries: MANUAL_COMMENTS,
    projection: projectionOf([[MANUAL_NOTE, MANUAL_DOC]]),
    readEntryBody: manualReader,
  },
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

// ── マニュアル用スクショ「AI に質問」（英語・パン作りの世界観） ──
//
// 撮影時に会話が写っている必要がある。手元の appData（`shared-chats:<id>`）に
// 既存の会話を 1 本入れておき、play で履歴から開く。
//
// なぜ「入れておくだけ」では写らないか: 読み込み（useAppDataChatPersistence）は
// restoreChats で会話一覧（chats）を埋めるだけで、表示中の会話（messages）には
// しない。AiAssistantPanel の「一覧を出すか」は初回レンダーで一度だけ決まり、
// そのときの chats はまだ空なので、放っておくと空の新規会話が出る。実アプリで
// 過去の会話を開くときと同じ手順（履歴 → その会話を選ぶ）を play でなぞる。

const MANUAL_ASK_QUESTION = "What temperature did the starter need to double?";

const MANUAL_ASK_ANSWER = [
  "From the shared log: the starter was fed 1:1:1 at 8:00 and doubled in four hours at 28 °C — that 28 °C is the proofing box, not the room. The kitchen itself stayed around 21 °C.",
  "",
  "One thing the log does not say is the flour brand, so that is worth asking Ken.",
].join("\n");

/** 撮影時に写っている「前に聞いた会話」。実アプリの手元の appData と同じ形 */
const MANUAL_SEEDED_CHAT: ScopeChat = {
  id: "manual-shared-chat-1",
  scopeBlockId: "",
  scopeType: "page",
  messages: [
    { role: "user", content: MANUAL_ASK_QUESTION, timestamp: daysAgo(0.05) },
    { role: "assistant", content: MANUAL_ASK_ANSWER, timestamp: daysAgo(0.04) },
  ],
  createdAt: daysAgo(0.05),
  modifiedAt: daysAgo(0.04),
};

/**
 * このストーリー専用の実行環境。会話の保存先（Map）を他のストーリーと共有しない
 * ——共有すると、先に開いたストーリーの送信結果が撮影に混ざる。
 */
function createManualChatDeps(): SharedNoteChatDeps {
  const appData = new Map<string, unknown>([
    [sharedChatsKey(MANUAL_NOTE.id), [MANUAL_SEEDED_CHAT]],
  ]);
  return {
    ...CHAT_DEPS,
    provider: {
      readAppData: async (key: string) => appData.get(key) ?? null,
      writeAppData: async (key: string, value: unknown) => {
        appData.set(key, value);
      },
    } as unknown as StorageProvider,
    // Storybook で実際に送ったときの返事も英語にする（撮影には使わない）
    runAgent: async () => ({
      session_id: "manual-story-session",
      message: MANUAL_ASK_ANSWER,
      tool_calls: [],
      provenance_id: null,
      token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model: "story-model",
    }),
  };
}

export const ManualEnglishAskAi: Story = {
  name: "Manual (English, bread world) — ask AI",
  args: {
    ...baseArgs,
    entry: MANUAL_NOTE,
    currentIdentity: MANUAL_MENTOR,
    sharedRoot: "/Users/mia/shared-bakery",
    entries: MANUAL_COMMENTS,
    projection: projectionOf([[MANUAL_NOTE, MANUAL_DOC]]),
    readEntryBody: manualReader,
    initialRailTab: "chat" as const,
    aiAvailable: true,
    chatDeps: createManualChatDeps(),
    onIngestChat: (messages: unknown[]) => console.log("ingest chat", messages.length),
  },
  decorators: [
    withSeededModel,
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 履歴は appData の読み込み（非同期）が終わってから出る
    const history = await canvas.findByTitle("Chat history");
    await userEvent.click(history);
    // 一覧の行（先頭の質問がそのまま見出しになる）
    await userEvent.click(await canvas.findByText(MANUAL_ASK_QUESTION));
    // 回答まで描かれてから撮る
    await canvas.findByText(/From the shared log/);
  },
};

// ── 変更の提案（§25）──
//
// 学生が先生のノートを派生して値を入れ直し、「元のノートへの変更の提案」として
// 共有した状態。全画面で開くと右レールに「差分」タブが出る（提案のときだけ）。
//
// 3 者比較の材料は proposalDiff（DI）で渡す。実アプリでは
//   theirs = 提案の本文 / mine = 元エントリの現在の共有本文 / base = extra.baseRef の blob
// を共有フォルダから取り寄せる。

const PROPOSAL: SharedEntry = {
  id: "proposal-1",
  type: "proposal",
  author: STUDENT_A,
  created_at: daysAgo(0.5),
  updated_at: daysAgo(0.5),
  hash: "sha256:dddd1111",
  prov: { derived_from: ["note-1"] },
  version: 1,
  extra: {
    title: "Cu粉末の焼結実験（第1回）（測定値入り）",
    target: "note-1",
    targetHash: NOTE.hash,
    targetTitle: "Cu粉末の焼結実験（第1回）",
    message: "実際に測った値に直しました。保持時間も 3 時間です。",
    baseRef: { provider: "local-folder", uri: "file:///blobs/base", hash: "sha256:base1111", size: 512 },
  },
} as SharedEntry;

const cell = (text: string) => ({
  type: "tableCell",
  props: {},
  content: text ? [{ type: "text", text, styles: {} }] : [],
});
const table = (id: string, rows: string[][]) =>
  ({
    id,
    type: "table",
    props: {},
    content: { type: "tableContent", rows: rows.map((cells) => ({ cells: cells.map(cell) })) },
    children: [],
  }) as any;

const sinteringDoc = (
  title: string,
  weigh: string,
  hold: string,
  measured: string,
  extra: unknown[] = [],
): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [
          para("b-weigh", weigh),
          para("b-press", "一軸プレスで 200 MPa・60 秒 保持して圧粉体を作製した。"),
          para("b-sinter", hold),
          table("b-table", [
            ["試料", "焼結温度 (℃)", "相対密度 (%)"],
            ["A", "1050", measured],
          ]),
          para("b-cool", "炉冷（自然冷却）。翌朝に取り出した。"),
          ...extra,
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  }) as any;

/** 派生した時点の元のノート */
const PROPOSAL_BASE_DOC = sinteringDoc(
  "Cu粉末の焼結実験（第1回）",
  "Cu 粉末を 5.00 g 秤量した（電子天秤 0.01 g 読み）。",
  "1050 ℃ で 2 時間保持した",
  "（未測定）",
);

/** 元の作者がその後に足した 1 行（by: 作者） */
const PROPOSAL_MINE_DOC = sinteringDoc(
  "Cu粉末の焼結実験（第1回）",
  "Cu 粉末を 5.00 g 秤量した（電子天秤 0.01 g 読み）。",
  "1050 ℃ で 2 時間保持した",
  "（未測定）",
  [para("b-rate", "昇温速度は 5 ℃/min。")],
);

/** 提案者が直したところ（by: 提案者 ＝ 取り込みの候補） */
const PROPOSAL_THEIRS_DOC = sinteringDoc(
  "Cu粉末の焼結実験（第1回）（測定値入り）",
  "Cu 粉末を 4.98 g 秤量した（電子天秤 0.01 g 読み）。",
  "1050 ℃ で 3 時間保持した",
  "94.2",
);

const proposalArgs = {
  ...baseArgs,
  entry: PROPOSAL,
  currentIdentity: TEACHER,
  entries: [NOTE, PROPOSAL],
  projection: createEmptySharedProjection(),
  readEntryBody: readerFor(PROPOSAL_THEIRS_DOC),
};

export const ProposalDiff: Story = {
  name: "変更の提案 — 差分（3 者）",
  args: {
    ...proposalArgs,
    proposalDiff: {
      base: PROPOSAL_BASE_DOC,
      mine: PROPOSAL_MINE_DOC,
      theirs: PROPOSAL_THEIRS_DOC,
    },
  },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "派生した時点の版（基準版）を挟んだ 3 者比較。「提案者」の印が付いた項目が取り込みの候補で、「作者」の印は元の作者がその後に入れた変更（表示のみ）。表はセル単位まで降りる。読むだけの画面で、取り込みは元の作者が自分のノート側で行う。",
      },
    },
  },
};

export const ProposalDiffNoBase: Story = {
  name: "変更の提案 — 差分（基準版なし）",
  args: {
    ...proposalArgs,
    entry: { ...PROPOSAL, extra: { ...(PROPOSAL.extra as object), baseRef: undefined } } as SharedEntry,
    proposalDiff: { mine: PROPOSAL_MINE_DOC, theirs: PROPOSAL_THEIRS_DOC },
  },
  decorators: jaDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "基準版の控えが無いとき（blob の保管先が未設定 / 古い派生）。元のノートの現在の版と 2 者で比べるだけになり、「誰が変えたか」の印は出さない —— 分けられないものを分かったように見せない。",
      },
    },
  },
};

// ── マニュアル図用（English・パン作りの世界観）──
// 研究室の題材は用語が固いので、マニュアルの図はパン作りで撮る。
// 見せたいのは「基準版・元のノート・提案の 3 行が並ぶ」ことだけなので、
// 中身は誰でも読める範囲にする。

const BREAD_NOTE: SharedEntry = {
  id: "bread-note",
  type: "note",
  author: { name: "Mia", email: "mia@example.com" },
  created_at: daysAgo(12),
  updated_at: daysAgo(2),
  hash: "sha256:bread0001",
  prov: { derived_from: [] },
  version: 1,
  extra: { title: "Sourdough loaf — Saturday bake" },
} as SharedEntry;

const BREAD_PROPOSAL: SharedEntry = {
  id: "bread-proposal",
  type: "proposal",
  author: { name: "Tom", email: "tom@example.com" },
  created_at: daysAgo(0.3),
  updated_at: daysAgo(0.3),
  hash: "sha256:bread0002",
  prov: { derived_from: ["bread-note"] },
  version: 1,
  extra: {
    title: "Sourdough loaf — Saturday bake (forked)",
    target: "bread-note",
    targetHash: BREAD_NOTE.hash,
    targetTitle: "Sourdough loaf — Saturday bake",
    message: "Longer bulk and a hotter oven worked better in my kitchen.",
    baseRef: { provider: "local-folder", uri: "file:///blobs/bread", hash: "sha256:bread-base", size: 480 },
  },
} as SharedEntry;

const breadDoc = (
  title: string,
  bulk: string,
  oven: string,
  crumb: string,
  extra: unknown[] = [],
): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [
          para("b-mix", "Mixed 500 g flour, 350 g water, 100 g starter and 10 g salt."),
          para("b-bulk", bulk),
          table("b-table", [
            ["Stage", "Time", "Temperature"],
            ["Bake", "40 min", oven],
          ]),
          para("b-crumb", crumb),
          ...extra,
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  }) as any;

const BREAD_BASE_DOC = breadDoc(
  "Sourdough loaf — Saturday bake",
  "Bulk fermentation: 4 hours at room temperature.",
  "230 °C",
  "Crumb was a little tight near the base.",
);
const BREAD_MINE_DOC = breadDoc(
  "Sourdough loaf — Saturday bake",
  "Bulk fermentation: 4 hours at room temperature.",
  "230 °C",
  "Crumb was a little tight near the base.",
  [para("b-note", "Note: the kitchen was 19 °C that morning.")],
);
const BREAD_THEIRS_DOC = breadDoc(
  "Sourdough loaf — Saturday bake (forked)",
  "Bulk fermentation: 5 hours at room temperature.",
  "250 °C",
  "Crumb was open all the way through.",
);

export const ProposalDiffEnglish: Story = {
  name: "変更の提案 — 差分（English / bread）",
  args: {
    ...baseArgs,
    entry: BREAD_PROPOSAL,
    currentIdentity: { name: "Mia", email: "mia@example.com" },
    entries: [BREAD_NOTE, BREAD_PROPOSAL],
    projection: createEmptySharedProjection(),
    readEntryBody: readerFor(BREAD_THEIRS_DOC),
    proposalDiff: { base: BREAD_BASE_DOC, mine: BREAD_MINE_DOC, theirs: BREAD_THEIRS_DOC },
  },
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
  parameters: {
    docs: {
      description: {
        story:
          "The figure used in the manual. Someone forked a bread recipe, changed the bulk time and the oven temperature, and proposed the changes back. The baseline (the version they forked) tells the proposer's changes apart from the author's own later note.",
      },
    },
  },
};
