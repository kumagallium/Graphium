// ChatGptPlanConnectView — 設定 > AI の、ChatGPT のプランでつなぐ流れ（Sign in with ChatGPT）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatGptPlanConnectView } from "./ChatGptPlanConnectView";
import { ChatGptPlanRowView } from "./ChatGptPlanRowView";

const meta: Meta<typeof ChatGptPlanConnectView> = {
  title: "Molecules/ChatGptPlanConnect",
  component: ChatGptPlanConnectView,
  args: {
    phase: { kind: "idle" },
    mode: "embedded",
    onStart: () => {},
    onCancelSignIn: () => {},
    onWelcomeDone: () => {},
    onOpenUsage: () => {},
    onRetry: () => {},
    onChooseOther: () => {},
    onCancel: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-[420px] rounded-lg border border-dashed border-border bg-background p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ChatGptPlanConnectView>;

/** 未接続: 「Continue with ChatGPT」が主ボタン */
export const Initial: Story = {};

/** 再サインイン: 接続済みの人向け。主ボタン 1 つだけ */
export const ReloginIdle: Story = {
  args: { mode: "relogin" },
};

/** ブラウザで続けてもらっている */
export const Waiting: Story = {
  args: { phase: { kind: "waiting" } },
};

/** 接続の確認・登録中（成功の直前） */
export const Success: Story = {
  args: { phase: { kind: "connected", model: { id: "gpt-5", name: "GPT-5" } } },
};

/** 初回だけの案内（閉じたらモデルを登録する） */
export const Welcome: Story = {
  args: { phase: { kind: "welcome", model: { id: "gpt-5", name: "GPT-5" } } },
};

/** サインインはできたが、プランの利用が許可されていない */
export const PlanUsageNotGranted: Story = {
  args: { phase: { kind: "notGranted" } },
};

/** 1455 番を別のアプリが使っている */
export const PortInUse: Story = {
  args: { phase: { kind: "portInUse" } },
};

/** ブラウザで断った（責めない文） */
export const Denied: Story = {
  args: { phase: { kind: "denied" } },
};

/** このアカウントでは使えない（再試行は出さない） */
export const NotEligible: Story = {
  args: { phase: { kind: "notEligible" } },
};

/** 状態を確認できなかった */
export const CheckFailed: Story = {
  args: { phase: { kind: "checkFailed", message: null } },
};

/** モデル一覧の行に添える表示: サインイン中 */
export const RowSignedIn: StoryObj<typeof ChatGptPlanRowView> = {
  render: (args) => <ChatGptPlanRowView {...args} />,
  args: { signedIn: true, onManageUsage: () => {}, onSignOut: () => {}, onSignInAgain: () => {} },
};

/** 行: サインアウト直後（ChatGPT 側の接続が残っているとき） */
export const RowSignedOut: StoryObj<typeof ChatGptPlanRowView> = {
  render: (args) => <ChatGptPlanRowView {...args} />,
  args: { signedIn: false, showRevokeHint: true, onManageUsage: () => {}, onSignOut: () => {}, onSignInAgain: () => {} },
};

/** 行: 認証切れの通知を受けているとき */
export const RowExpired: StoryObj<typeof ChatGptPlanRowView> = {
  render: (args) => <ChatGptPlanRowView {...args} />,
  args: { signedIn: true, expired: true, onManageUsage: () => {}, onSignOut: () => {}, onSignInAgain: () => {} },
};
