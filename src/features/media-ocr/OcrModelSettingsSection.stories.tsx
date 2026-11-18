// OcrModelSettingsView — 設定 > AI タブの「画像の文字を読むモデル」節

import type { Meta, StoryObj } from "@storybook/react-vite";
import { OcrModelSettingsView } from "./OcrModelSettingsSection";

const absent = { name: "pp-ocrv6-small", present: false, bytes: 0, expectedBytes: 31_000_000 };
const present = { name: "pp-ocrv6-small", present: true, bytes: 31_000_000, expectedBytes: 31_000_000 };

const meta: Meta<typeof OcrModelSettingsView> = {
  title: "Molecules/OcrModelSettingsSection",
  component: OcrModelSettingsView,
  args: {
    status: absent,
    downloading: null,
    enabled: true,
    onToggle: () => {},
    onDownload: () => {},
    onCancel: () => {},
    onDelete: () => {},
    // 中身を見せる図なので開いた形で出す
    defaultOpen: true,
  },
  decorators: [(Story) => <div className="w-[480px] bg-background p-4"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof OcrModelSettingsView>;

export const NotDownloaded: Story = {};

export const Downloading: Story = {
  args: { downloading: { received: 12_000_000, total: 31_000_000 } },
};

export const Downloaded: Story = {
  args: { status: present },
};

export const Failed: Story = {
  args: { error: "HTTP 503" },
};

export const SwitchOff: Story = {
  args: { enabled: false, status: present },
};
