// MeetingStartDialog — 会議録音の開始確認
// 同意文とヘッドホン推奨、権限が拒否されているときの案内を出す。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetingStartDialog } from "./MeetingStartDialog";

const meta: Meta<typeof MeetingStartDialog> = {
  title: "Molecules/MeetingStartDialog",
  component: MeetingStartDialog,
  parameters: { layout: "fullscreen" },
  args: { open: true, onStart: () => {}, onCancel: () => {} },
};
export default meta;

type Story = StoryObj<typeof MeetingStartDialog>;

export const Default: Story = {
  args: { permission: { screen: "granted", mic: "granted" } },
};

export const SelfOnly: Story = {
  args: { permission: { screen: "denied", mic: "granted" }, captureSystem: false, onCaptureSystemChange: () => {} },
};

export const GuideOnly: Story = {
  args: { permission: { screen: "denied", mic: "granted" }, guideOnly: true, onOpenSettings: () => {}, onRestart: () => {} },
};

export const Checking: Story = { args: { permission: null } };

export const ScreenDenied: Story = {
  args: { permission: { screen: "denied", mic: "granted" }, onOpenSettings: () => {} },
};

export const Starting: Story = {
  args: { permission: { screen: "granted", mic: "granted" }, busy: true },
};

export const MicDenied: Story = {
  args: { permission: { screen: "granted", mic: "denied" } },
};

export const ModelMissing: Story = {
  args: { permission: { screen: "granted", mic: "granted" }, modelMissing: true },
};

/** 未取得: 「始める」を押すと取得する（大きさを出す）。取り消し・削除した人には出ない（ModelMissing の文になる） */
export const ModelAutoDownload: Story = {
  args: { permission: { screen: "granted", mic: "granted" }, modelMissing: true, modelDownloadMb: 574 },
};

/** すでに取得している最中（受信箱・設定から）。完了すると文は消える */
export const ModelDownloading: Story = {
  args: { permission: { screen: "granted", mic: "granted" }, modelMissing: true, modelDownloadMb: 574, modelDownloading: true },
};
