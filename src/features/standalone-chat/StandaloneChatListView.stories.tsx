// ノートに紐づかないチャット一覧のストーリー
// 見た目のみ確認する（保存・AI 呼び出しは行わない）
// テーブルは WikiListView と同じクラスを使うため、狭い幅では横スクロールになる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { StandaloneChatListView } from "./StandaloneChatListView";
import type { StandaloneChatSummary } from "./types";

const meta: Meta<typeof StandaloneChatListView> = {
  title: "Molecules/StandaloneChatListView",
  component: StandaloneChatListView,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ノートに紐づかないチャットの一覧。見出しは AI が後から付ける題（title）で、未生成のうちは最初の質問（firstQuestion）をそのまま見出しに使う。",
      },
    },
  },
  decorators: [
    (Story, context) => {
      syncLocale("ja");
      // 既定は専用画面に置いたときの幅。狭い幅の確認はストーリー側で width を上書きする
      const width = (context.parameters.frameWidth as number | undefined) ?? 900;
      return (
        <LocaleProvider>
          <div style={{ width, background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof StandaloneChatListView>;

function chat(overrides: Partial<StandaloneChatSummary> & { id: string; firstQuestion: string }): StandaloneChatSummary {
  return {
    messageCount: 2,
    modifiedAt: "2026-09-10T09:00:00Z",
    ...overrides,
  };
}

export const Default: Story = {
  name: "通常（題あり 3 件）",
  args: {
    chats: [
      chat({
        id: "1",
        title: "焼結温度の決め方",
        firstQuestion: "焼結温度はどうやって決めればいいですか？",
        messageCount: 4,
        modifiedAt: "2026-09-18T10:30:00Z",
      }),
      chat({
        id: "2",
        title: "シリカ管の封入手順",
        firstQuestion: "シリカ管に粉末を封入するときの注意点は？",
        messageCount: 6,
        modifiedAt: "2026-09-17T15:00:00Z",
      }),
      chat({
        id: "3",
        title: "熱電材料の候補選定",
        firstQuestion: "この組成系で熱電材料として有望な候補は？",
        messageCount: 2,
        modifiedAt: "2026-09-15T08:20:00Z",
      }),
    ],
    onSelect: (id) => console.info("[story] onSelect", id),
    onNewChat: () => console.info("[story] onNewChat"),
    onDelete: (id) => console.info("[story] onDelete", id),
    onBack: () => console.info("[story] onBack"),
  },
};

export const NoTitleYet: Story = {
  name: "題がまだ無い行",
  args: {
    chats: [
      chat({
        id: "1",
        firstQuestion: "電気炉の昇温レートは何 °C/min が妥当ですか？",
        messageCount: 1,
        modifiedAt: "2026-09-18T12:00:00Z",
      }),
    ],
    onSelect: (id) => console.info("[story] onSelect", id),
    onNewChat: () => console.info("[story] onNewChat"),
    onDelete: (id) => console.info("[story] onDelete", id),
    onBack: () => console.info("[story] onBack"),
  },
};

export const LongTitleAndQuestion: Story = {
  name: "とても長い題と長い質問",
  args: {
    chats: [
      chat({
        id: "1",
        title:
          "銅粉末を用いたシリカ管封入焼結における昇温速度と保持時間の最適化についての検討結果まとめ",
        firstQuestion:
          "銅粉末をシリカ管に封入して電気炉で焼結する際に、昇温速度と保持時間をどのように組み合わせると割れを防ぎつつ緻密化を進められるか、既存の文献値と実験条件の違いを踏まえて教えてください。",
        messageCount: 12,
        modifiedAt: "2026-09-18T09:00:00Z",
      }),
    ],
    onSelect: (id) => console.info("[story] onSelect", id),
    onNewChat: () => console.info("[story] onNewChat"),
    onDelete: (id) => console.info("[story] onDelete", id),
    onBack: () => console.info("[story] onBack"),
  },
};

export const Empty: Story = {
  name: "0 件",
  args: {
    chats: [],
    onSelect: (id) => console.info("[story] onSelect", id),
    onNewChat: () => console.info("[story] onNewChat"),
    onDelete: (id) => console.info("[story] onDelete", id),
    onBack: () => console.info("[story] onBack"),
  },
};

export const TwelveChats: Story = {
  name: "12 件並んだ状態",
  args: {
    chats: Array.from({ length: 12 }, (_, i) =>
      chat({
        id: `chat-${i}`,
        title: i % 3 === 0 ? undefined : `質問その${i + 1}についての相談`,
        firstQuestion: `これは ${i + 1} 番目の質問の本文です。`,
        messageCount: (i % 5) + 1,
        modifiedAt: new Date(2026, 8, 18 - i, 9, 0).toISOString(),
      }),
    ),
    onSelect: (id) => console.info("[story] onSelect", id),
    onNewChat: () => console.info("[story] onNewChat"),
    onDelete: (id) => console.info("[story] onDelete", id),
    onBack: () => console.info("[story] onBack"),
  },
};

export const NarrowWidth: Story = {
  name: "狭い幅（320px）",
  parameters: { frameWidth: 320 },
  args: {
    chats: [
      chat({
        id: "narrow-1",
        title: "銅粉末を用いたシリカ管封入焼成の温度と保持時間の決め方",
        firstQuestion: "銅粉末をシリカ管に封入して電気炉で焼成するとき、温度と保持時間はどう決めればいいですか。",
        messageCount: 12,
        modifiedAt: "2026-09-18T09:00:00Z",
      }),
      chat({
        id: "narrow-2",
        firstQuestion: "電気炉の昇温レートはどのくらいが妥当ですか。",
        messageCount: 1,
        modifiedAt: "2026-09-18T12:00:00Z",
      }),
    ],
    onSelect: (id) => console.info("[story] onSelect", id),
    onNewChat: () => console.info("[story] onNewChat"),
    onDelete: (id) => console.info("[story] onDelete", id),
    onBack: () => console.info("[story] onBack"),
  },
};
