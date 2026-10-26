// ノートに紐づかないチャットの入力欄のストーリー。
// 一覧の先頭（新しいチャットを始める）と会話画面の下（続きを送る）で共用する部品。
// 送信・停止・渡す範囲チップ・エラー表示の見た目だけを確認する（AI 呼び出しはしない）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { GroundingScope } from "../../lib/grounding-scope";
import { StandaloneChatComposer } from "./StandaloneChatComposer";

const meta: Meta<typeof StandaloneChatComposer> = {
  title: "Molecules/StandaloneChatComposer",
  component: StandaloneChatComposer,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "ノートに紐づかないチャットの入力欄。渡す範囲は外部参照 / 内部参照の 2 値（常に横断検索するので「ノート内参照」は無い）。",
      },
    },
  },
  decorators: [
    (Story, context) => {
      syncLocale("ja");
      const width = (context.parameters.frameWidth as number | undefined) ?? 640;
      return (
        <LocaleProvider>
          <div style={{ width, padding: 12, background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof StandaloneChatComposer>;

function WithScopeState({ initial, ...rest }: { initial: GroundingScope } & Partial<React.ComponentProps<typeof StandaloneChatComposer>>) {
  const [scope, setScope] = useState<GroundingScope>(initial);
  return (
    <StandaloneChatComposer
      onSend={(text) => console.info("[story] onSend", text, scope)}
      scope={scope}
      onScopeChange={setScope}
      {...rest}
    />
  );
}

export const Default: Story = {
  name: "既定（内部参照）",
  render: () => <WithScopeState initial="internal" />,
};

export const External: Story = {
  name: "外部参照を選んだ状態",
  render: () => <WithScopeState initial="external" />,
};

export const Loading: Story = {
  name: "応答待ち（停止ボタン）",
  render: () => <WithScopeState initial="internal" loading onStop={() => console.info("[story] onStop")} />,
};

export const WithError: Story = {
  name: "エラー表示",
  render: () => (
    <WithScopeState initial="internal" error="応答の取得に失敗しました。しばらくしてからもう一度お試しください。" />
  ),
};

export const WithoutScopeChip: Story = {
  name: "チップなし（onScopeChange 未指定）",
  args: {
    onSend: (text) => console.info("[story] onSend", text),
  },
};

/** ピークと同じ 320px 幅。チップは送信ヒントの右に収まらず 2 行目に折り返す */
export const Narrow: Story = {
  name: "狭い幅（320px）",
  parameters: { frameWidth: 320 },
  render: () => <WithScopeState initial="internal" />,
};
