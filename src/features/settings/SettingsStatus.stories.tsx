// タブ先頭に置く状態表示のストーリー。
// AI タブを開いたときに、設定の羅列より先にこの 1 行が目に入る形を確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsStatus } from "./SettingsStatus";

const meta = {
  title: "Molecules/SettingsStatus",
  component: SettingsStatus,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SettingsStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** モデルを登録して使える状態。何も操作させない。 */
export const Ready: Story = {
  args: {
    state: "ready",
    title: "AI が使えます",
    description: "Claude Sonnet 5 を使っています。",
  },
};

/** 初めて開いたとき。次にやることを 1 つだけ出す。 */
export const Setup: Story = {
  args: {
    state: "setup",
    title: "AI はまだ使えません",
    description: "使いたい AI サービスを 1 つ登録すると、チャットや要約が使えるようになります。",
    action: { label: "AI を登録する", onClick: () => {} },
  },
};

/** ブラウザ版など、そもそも動かせない環境。ボタンは出さない。 */
export const Unavailable: Story = {
  args: {
    state: "unavailable",
    title: "この画面では AI を使えません",
    description: "AI の機能はデスクトップ版の Graphium で使えます。",
  },
};
