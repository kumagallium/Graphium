// MeetingSettingsView — 設定 > AI タブの「会議の録音と文字起こし」節

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetingSettingsView } from "./MeetingSettingsSection";

const meta: Meta<typeof MeetingSettingsView> = {
  title: "Molecules/MeetingSettingsSection",
  component: MeetingSettingsView,
  args: {
    statuses: [
      { size: "small", present: true, bytes: 488_000_000, expectedBytes: 488_000_000 },
      { size: "base", present: false, bytes: 0, expectedBytes: 148_000_000 },
    ],
    downloading: {},
    modelSize: "small",
    language: "auto",
    liveTranscribe: true,
    onModelSize: () => {},
    onLanguage: () => {},
    onLiveTranscribe: () => {},
    onDownload: () => {},
    onCancel: () => {},
    onDelete: () => {},
  },
  decorators: [(Story) => <div className="w-[480px] bg-background p-4"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof MeetingSettingsView>;

export const Default: Story = {};

export const Downloading: Story = {
  args: {
    statuses: [
      { size: "small", present: false, bytes: 0, expectedBytes: 488_000_000 },
      { size: "base", present: false, bytes: 0, expectedBytes: 148_000_000 },
    ],
    downloading: { small: { received: 180_000_000, total: 488_000_000 } },
  },
};

export const DownloadError: Story = {
  args: {
    statuses: [
      { size: "small", present: false, bytes: 0, expectedBytes: 488_000_000 },
      { size: "base", present: false, bytes: 0, expectedBytes: 148_000_000 },
    ],
    errors: { small: "network error" },
  },
};
