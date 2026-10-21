// CopilotOneClickView — 設定 > AI の空状態にある Copilot ワンクリック接続

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotOneClickView } from "./CopilotOneClickView";

const meta: Meta<typeof CopilotOneClickView> = {
  title: "Molecules/CopilotOneClick",
  component: CopilotOneClickView,
  args: {
    phase: { kind: "idle" },
    onStart: () => {},
    onCancelInstall: () => {},
    onCancelLogin: () => {},
    onUseDeviceCode: () => {},
    onCopyCode: () => {},
    onOpenGithub: () => {},
    onOpenCopilotSettings: () => {},
    onRetry: () => {},
    onRecheck: () => {},
    onAddManually: () => {},
    onOpenEligibility: () => {},
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

type Story = StoryObj<typeof CopilotOneClickView>;

/** 初期: 2 行（GitHub アカウント / API キーやサーバー）が同じ重さで並ぶ */
export const Initial: Story = {};

/** CLI が無く取得もできない環境: 行 B だけ */
export const Unavailable: Story = {
  args: { phase: { kind: "unavailable" } },
};

export const Installing: Story = {
  args: { phase: { kind: "installing", received: 45_000_000, total: 108_000_000, seen: true } },
};

export const InstallFailed: Story = {
  args: { phase: { kind: "installError", code: null, message: "network error" } },
};

export const WaitingBrowser: Story = {
  args: { phase: { kind: "login", mode: "web", verificationUri: null, userCode: null } },
};

export const ShowingCode: Story = {
  args: {
    phase: { kind: "login", mode: "device", verificationUri: "https://github.com/login/device", userCode: "ABCD-1234" },
  },
};

export const CodeCopied: Story = {
  args: {
    phase: { kind: "login", mode: "device", verificationUri: "https://github.com/login/device", userCode: "ABCD-1234" },
    copied: true,
  },
};

export const Verifying: Story = {
  args: { phase: { kind: "verifying", afterLogin: true } },
};

export const NoAccess: Story = {
  args: { phase: { kind: "noAccess" } },
};

export const CheckFailed: Story = {
  args: { phase: { kind: "loginError", code: "COPILOT_CHECK_FAILED", message: "offline" } },
};

export const LoginFailed: Story = {
  args: { phase: { kind: "loginError", code: "COPILOT_NOT_SIGNED_IN", message: null } },
};
