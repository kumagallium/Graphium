// ノートに紐づかないチャットの会話画面のストーリー
// 見た目のみ確認する（保存・AI 呼び出しは行わない）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { StandaloneChatView } from "./StandaloneChatView";
import type { ChatMessage } from "../../lib/document-types";

const meta: Meta<typeof StandaloneChatView> = {
  title: "Molecules/StandaloneChatView",
  component: StandaloneChatView,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ノートに紐づかないチャット 1 件の会話画面。表示のみを受け持ち、AI 呼び出し・保存は行わない。",
      },
    },
  },
  decorators: [
    (Story, context) => {
      syncLocale("ja");
      // この画面は一覧より広いので既定幅を 760 にする
      const width = (context.parameters.frameWidth as number | undefined) ?? 760;
      const height = (context.parameters.frameHeight as number | undefined) ?? 560;
      return (
        <LocaleProvider>
          <div style={{ width, height, background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof StandaloneChatView>;

function msg(overrides: Partial<ChatMessage> & { role: ChatMessage["role"]; content: string }): ChatMessage {
  return {
    timestamp: "2026-09-18T10:00:00Z",
    ...overrides,
  };
}

const threeTurnMessages: ChatMessage[] = [
  msg({ role: "user", content: "焼結温度はどうやって決めればいいですか？" }),
  msg({ role: "assistant", content: "材料の融点や既存文献の条件を参考に、まずは融点の 70〜80% 程度から検討するのが一般的です。" }),
  msg({ role: "user", content: "文献値が無い新規組成の場合はどうすればいいですか？" }),
  msg({ role: "assistant", content: "近い組成系の値を出発点にして、小刻みに条件を振りながら密度や相の変化を確認するのがおすすめです。" }),
  msg({ role: "user", content: "昇温レートも一緒に振るべきですか？" }),
  msg({ role: "assistant", content: "まずは温度を固定して保持時間を振り、傾向が掴めてから昇温レートを検討する方が、要因を切り分けやすくなります。" }),
];

export const Empty: Story = {
  name: "空（まだ何も話していない）",
  args: {
    messages: [],
    loading: false,
    onSend: (text) => console.info("[story] onSend", text),
    onBack: () => console.info("[story] onBack"),
  },
};

export const ThreeTurns: Story = {
  name: "3 往復の会話",
  args: {
    title: "焼結温度の決め方",
    messages: threeTurnMessages,
    loading: false,
    onSend: (text) => console.info("[story] onSend", text),
    onBack: () => console.info("[story] onBack"),
  },
};

export const WithAttachedNotes: Story = {
  name: "引用チップが 2 件付いている",
  args: {
    messages: [
      msg({ role: "user", content: "この 2 つのノートを踏まえて、次に試すべき条件を教えてください。" }),
      msg({ role: "assistant", content: "両ノートの条件を比較すると、保持時間を延ばす余地がありそうです。" }),
    ],
    loading: false,
    attachedNotes: [
      { id: "note-1", title: "焼結温度の決め方" },
      { id: "note-2", title: "シリカ管の封入手順", isWiki: true },
    ],
    onRemoveAttachedNote: (id) => console.info("[story] onRemoveAttachedNote", id),
    onSend: (text) => console.info("[story] onSend", text),
    onBack: () => console.info("[story] onBack"),
  },
};

export const Loading: Story = {
  name: "応答待ち",
  args: {
    title: "焼結温度の決め方",
    messages: [
      msg({ role: "user", content: "焼結温度はどうやって決めればいいですか？" }),
    ],
    loading: true,
    onSend: (text) => console.info("[story] onSend", text),
    onStop: () => console.info("[story] onStop"),
    onBack: () => console.info("[story] onBack"),
  },
};

export const WithMessageActions: Story = {
  name: "ナレッジに残す・編集&再実行・分岐が見える状態",
  args: {
    title: "焼結温度の決め方",
    messages: threeTurnMessages,
    loading: false,
    onSend: (text) => console.info("[story] onSend", text),
    onBack: () => console.info("[story] onBack"),
    onSaveAsAnswer: async (question, answer) => {
      console.info("[story] onSaveAsAnswer", question, answer);
      return "story-answer-id";
    },
    onResend: (text, rewindIndex) => console.info("[story] onResend", text, rewindIndex),
    onFork: (index) => console.info("[story] onFork", index),
  },
};

export const WithSuperscriptSubscript: Story = {
  name: "回答に上付き・下付きがある",
  args: {
    title: "封入時の真空度",
    messages: [
      msg({ role: "user", content: "シリカ管に封入するときの真空度と、気をつけることを教えてください。" }),
      msg({
        role: "assistant",
        content: [
          "封入前に 10<sup>-3</sup> Pa 程度まで引いておくのが目安です。",
          "",
          "- 残った H<sub>2</sub>O は加熱中に試料を酸化させるので、200 ℃ で 1 時間ほど焼き出してから封じます",
          "- Ar を 2×10<sup>4</sup> Pa ほど戻して封じると、高温での管の変形を抑えられます",
          "",
          "| 排気 | 到達圧力 |",
          "| --- | --- |",
          "| ロータリーポンプのみ | 10<sup>-1</sup> Pa |",
          "| ターボ分子ポンプ併用 | 10<sup>-4</sup> Pa |",
        ].join("\n"),
      }),
      msg({ role: "user", content: "Markdown で上付き・下付きを書くにはどうすればいいですか？" }),
      msg({
        role: "assistant",
        content:
          "`10<sup>5</sup>` のように `<sup>` で囲むと 10<sup>5</sup> に、`<sub>` で囲むと H<sub>2</sub>O のようになります。閉じタグを忘れると 10<sup>5 のように文字のまま出ます。",
      }),
    ],
    loading: false,
    onSend: (text) => console.info("[story] onSend", text),
    onBack: () => console.info("[story] onBack"),
  },
};

export const WithError: Story = {
  name: "エラー表示",
  args: {
    title: "焼結温度の決め方",
    messages: [
      msg({ role: "user", content: "焼結温度はどうやって決めればいいですか？" }),
    ],
    loading: false,
    error: "応答の取得に失敗しました。しばらくしてからもう一度お試しください。",
    onSend: (text) => console.info("[story] onSend", text),
    onBack: () => console.info("[story] onBack"),
  },
};
