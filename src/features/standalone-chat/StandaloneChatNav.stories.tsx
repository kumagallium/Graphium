// チャット一覧（子ナビ）のストーリー。見た目のみ確認する（読み込み・削除は行わない）。
// 日付のまとまりは now を固定して再現する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { StandaloneChatNav } from "./StandaloneChatNav";
import type { StandaloneChatSummary } from "./types";

// 2026-10-26 15:00 を「今」とする
const NOW = new Date(2026, 9, 26, 15, 0, 0);

const meta: Meta<typeof StandaloneChatNav> = {
  title: "Molecules/StandaloneChatNav",
  component: StandaloneChatNav,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ノートに紐づかないチャットの子ナビ。先頭に「+ 新しいチャット」、下に題を 今日 / 昨日 / 過去 7 日 / それ以前 でまとめて並べる。題が無いうちは最初の質問を出す。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ width: 240, height: 480, background: "var(--paper, #fff)", border: "1px solid var(--rule, #e5e5e5)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
  args: {
    now: NOW,
    onSelect: (id) => console.info("[story] onSelect", id),
    onNew: () => console.info("[story] onNew"),
    onDelete: (id) => console.info("[story] onDelete", id),
  },
};
export default meta;

type Story = StoryObj<typeof StandaloneChatNav>;

function chat(id: string, modifiedAt: Date, title?: string, firstQuestion = "最初の質問"): StandaloneChatSummary {
  return { id, title, firstQuestion, messageCount: 2, modifiedAt: modifiedAt.toISOString() };
}

const sample: StandaloneChatSummary[] = [
  chat("1", new Date(2026, 9, 26, 10, 30), "焼結温度の決め方"),
  chat("2", new Date(2026, 9, 26, 9, 0), undefined, "電気炉の昇温レートは何 °C/min が妥当ですか？"),
  chat("3", new Date(2026, 9, 25, 15, 0), "シリカ管の封入手順"),
  chat("4", new Date(2026, 9, 22, 8, 20), "熱電材料の候補選定"),
  chat("5", new Date(2026, 9, 1, 8, 20), "銅粉末を用いたシリカ管封入焼結における昇温速度と保持時間の最適化"),
];

export const Default: Story = {
  name: "4 つのまとまり・1 件を選択中",
  args: { chats: sample, activeChatId: "3" },
};

export const NewChatActive: Story = {
  name: "新しいチャットを開いている（選択なし）",
  args: { chats: sample, activeChatId: null },
};

export const Empty: Story = {
  name: "0 件",
  args: { chats: [], activeChatId: null },
};
