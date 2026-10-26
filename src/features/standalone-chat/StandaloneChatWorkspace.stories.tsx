// チャット画面（子ナビ + 会話）のストーリー。見た目と切り替えだけを確認する
// （保存・AI 呼び出しは行わない。選択・送信は console に出すだけ）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { ChatMessage } from "../../lib/document-types";
import { StandaloneChatWorkspace } from "./StandaloneChatWorkspace";
import type { StandaloneChat, StandaloneChatSummary } from "./types";

const NOW = new Date(2026, 9, 26, 15, 0, 0);

const meta: Meta<typeof StandaloneChatWorkspace> = {
  title: "Organisms/StandaloneChatWorkspace",
  component: StandaloneChatWorkspace,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "ノートに紐づかないチャットの画面。左に子ナビ（一覧）、右に会話。選択が無いときは「新しいチャット」として入力欄が中央に出る。",
      },
    },
  },
  decorators: [
    (Story, context) => {
      syncLocale("ja");
      const width = (context.parameters.frameWidth as number | undefined) ?? 960;
      const height = (context.parameters.frameHeight as number | undefined) ?? 600;
      return (
        <LocaleProvider>
          <div style={{ width, height, display: "flex", background: "var(--paper, #fff)", border: "1px solid var(--rule, #e5e5e5)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof StandaloneChatWorkspace>;

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: "2026-10-26T01:00:00Z" };
}

const summaries: StandaloneChatSummary[] = [
  { id: "1", title: "焼結温度の決め方", firstQuestion: "焼結温度はどうやって決めればいいですか？", messageCount: 4, modifiedAt: new Date(2026, 9, 26, 10, 30).toISOString() },
  { id: "2", firstQuestion: "電気炉の昇温レートは何 °C/min が妥当ですか？", messageCount: 1, modifiedAt: new Date(2026, 9, 26, 9, 0).toISOString() },
  { id: "3", title: "シリカ管の封入手順", firstQuestion: "シリカ管に粉末を封入するときの注意点は？", messageCount: 6, modifiedAt: new Date(2026, 9, 25, 15, 0).toISOString() },
  { id: "4", title: "熱電材料の候補選定", firstQuestion: "この組成系で熱電材料として有望な候補は？", messageCount: 2, modifiedAt: new Date(2026, 9, 22, 8, 20).toISOString() },
];

const bodies: Record<string, StandaloneChat> = {
  "1": {
    id: "1",
    title: "焼結温度の決め方",
    scope: "internal",
    messages: [
      msg("user", "焼結温度はどうやって決めればいいですか？"),
      msg("assistant", "材料の融点や既存文献の条件を参考に、まずは融点の 70〜80% 程度から検討するのが一般的です。"),
      msg("user", "文献値が無い新規組成の場合はどうすればいいですか？"),
      msg("assistant", "近い組成系の値を出発点にして、小刻みに条件を振りながら密度や相の変化を確認するのがおすすめです。"),
    ],
    createdAt: "2026-10-26T01:00:00Z",
    modifiedAt: "2026-10-26T01:30:00Z",
  },
  "3": {
    id: "3",
    title: "シリカ管の封入手順",
    scope: "external",
    messages: [
      msg("user", "シリカ管に粉末を封入するときの注意点は？"),
      msg("assistant", "封入前に 10<sup>-3</sup> Pa 程度まで引き、200 ℃ で 1 時間ほど焼き出してから封じます。"),
    ],
    createdAt: "2026-10-25T06:00:00Z",
    modifiedAt: "2026-10-25T06:00:00Z",
  },
};

/** 選択の切り替えだけを state で再現する（読み込み・保存はしない） */
function Interactive({ initialId }: { initialId: string | null }) {
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const activeChat = activeId ? bodies[activeId] ?? { id: activeId, messages: [], createdAt: "", modifiedAt: "" } : null;
  return (
    <StandaloneChatWorkspace
      chats={summaries}
      activeChatId={activeId}
      activeChat={activeChat}
      loading={false}
      onSelectChat={setActiveId}
      onNewChat={() => setActiveId(null)}
      onDeleteChat={(id) => console.info("[story] onDeleteChat", id)}
      onSend={(text, scope) => console.info("[story] onSend", text, scope)}
      onScopeChange={(scope) => console.info("[story] onScopeChange", scope)}
      onHome={() => console.info("[story] onHome")}
      now={NOW}
    />
  );
}

export const NewChat: Story = {
  name: "新しいチャット（選択なし・入力欄が中央）",
  render: () => <Interactive initialId={null} />,
};

export const ChatSelected: Story = {
  name: "会話を選択中",
  render: () => <Interactive initialId="1" />,
};

export const ExternalScopeChat: Story = {
  name: "外部参照の会話を選択中",
  render: () => <Interactive initialId="3" />,
};

export const Empty: Story = {
  name: "まだ会話が 0 件",
  render: () => (
    <StandaloneChatWorkspace
      chats={[]}
      activeChatId={null}
      activeChat={null}
      loading={false}
      onSelectChat={(id) => console.info("[story] onSelectChat", id)}
      onNewChat={() => console.info("[story] onNewChat")}
      onSend={(text, scope) => console.info("[story] onSend", text, scope)}
      onScopeChange={(scope) => console.info("[story] onScopeChange", scope)}
      now={NOW}
    />
  ),
};

// 狭い画面（md 未満）の 1 列表示は useIsDesktop（window のメディアクエリ）で切り替わるため、
// 枠の幅を縮めたストーリーでは再現できない。dev をモバイル幅にして確かめる。

// マニュアルの図（英語 UI・パン作りの世界観）。scripts/manual-screenshots-chat.mjs で撮る。
// meta の decorator が毎回 syncLocale("ja") するので、ストーリー側の decorator（内側）で英語に戻す。
const breadSummaries: StandaloneChatSummary[] = [
  { id: "b1", title: "Proofing time for a tighter crumb", firstQuestion: "Why did the second batch come out with a tighter crumb?", messageCount: 4, modifiedAt: new Date(2026, 9, 26, 10, 30).toISOString() },
  { id: "b2", firstQuestion: "What hydration should I try for the rye loaf?", messageCount: 1, modifiedAt: new Date(2026, 9, 26, 9, 0).toISOString() },
  { id: "b3", title: "Oven temperature for the first bake", firstQuestion: "How hot should the oven be for the first ten minutes?", messageCount: 6, modifiedAt: new Date(2026, 9, 25, 15, 0).toISOString() },
  { id: "b4", title: "Keeping the starter over a long weekend", firstQuestion: "Can the starter stay in the fridge for four days?", messageCount: 2, modifiedAt: new Date(2026, 9, 22, 8, 20).toISOString() },
  { id: "b5", title: "Salt and fermentation speed", firstQuestion: "Does more salt slow the bulk ferment?", messageCount: 2, modifiedAt: new Date(2026, 9, 10, 8, 20).toISOString() },
];

const breadConversation: StandaloneChat = {
  id: "b1",
  title: "Proofing time for a tighter crumb",
  scope: "external",
  messages: [
    { role: "user", content: "Why did the second batch come out with a tighter crumb?", timestamp: "2026-10-26T01:00:00Z" },
    {
      role: "assistant",
      content:
        "Your notes point at the proof. The second batch proved for 60 minutes at 22 °C, while the batch you liked last week had 90 minutes at the same temperature. A shorter proof leaves less gas in the dough, so the crumb closes up. Try 90 minutes again and record the room temperature next to it.",
      timestamp: "2026-10-26T01:00:20Z",
    },
    { role: "user", content: "Should I change the oven as well?", timestamp: "2026-10-26T01:02:00Z" },
    {
      role: "assistant",
      content: "Keep the oven as it is for now. Change one thing at a time so you can tell which change opened the crumb.",
      timestamp: "2026-10-26T01:02:15Z",
    },
  ],
  createdAt: "2026-10-26T01:00:00Z",
  modifiedAt: "2026-10-26T01:30:00Z",
};

const englishDecorator = (Story: () => React.ReactElement) => {
  syncLocale("en");
  return <Story />;
};

export const ManualEnglishNewChat: Story = {
  name: "Manual (English, bread world): new chat",
  decorators: [englishDecorator],
  parameters: { frameWidth: 1100, frameHeight: 640 },
  render: () => (
    <StandaloneChatWorkspace
      chats={breadSummaries}
      activeChatId={null}
      activeChat={null}
      loading={false}
      onSelectChat={() => {}}
      onNewChat={() => {}}
      onDeleteChat={() => {}}
      onSend={() => {}}
      onScopeChange={() => {}}
      onHome={() => {}}
      now={NOW}
    />
  ),
};

export const ManualEnglishConversation: Story = {
  name: "Manual (English, bread world): conversation",
  decorators: [englishDecorator],
  parameters: { frameWidth: 1100, frameHeight: 640 },
  render: () => (
    <StandaloneChatWorkspace
      chats={breadSummaries}
      activeChatId="b1"
      activeChat={breadConversation}
      loading={false}
      onSelectChat={() => {}}
      onNewChat={() => {}}
      onDeleteChat={() => {}}
      onSend={() => {}}
      onScopeChange={() => {}}
      onHome={() => {}}
      now={NOW}
    />
  ),
};
