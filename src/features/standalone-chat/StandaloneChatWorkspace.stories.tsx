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
