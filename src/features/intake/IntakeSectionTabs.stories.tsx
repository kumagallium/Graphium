// 取り込みの区画の切り替えのストーリー

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocale } from "@/i18n";
import { ConversationStoryFrame } from "./conversation-story-frame";
import { IntakeSectionTabs, type IntakeSection } from "./IntakeSectionTabs";

const meta: Meta<typeof IntakeSectionTabs> = {
  title: "Features/Intake/Conversation/SectionTabs",
  component: IntakeSectionTabs,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof IntakeSectionTabs>;

// ストーリーの中だけの文字（i18n には入れない）
function Placeholder() {
  const { locale } = useLocale();
  return (
    <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {locale === "ja" ? "（ここに区画の中身が入ります）" : "(The section's content goes here)"}
    </div>
  );
}

const noop = () => {};

export const FilesSelected: Story = {
  render: () => (
    <ConversationStoryFrame>
      <IntakeSectionTabs value="files" onChange={noop} />
      <Placeholder />
    </ConversationStoryFrame>
  ),
};

export const ConversationsSelected: Story = {
  render: () => (
    <ConversationStoryFrame>
      <IntakeSectionTabs value="conversations" onChange={noop} />
      <Placeholder />
    </ConversationStoryFrame>
  ),
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = useState<IntakeSection>("files");
    return (
      <ConversationStoryFrame>
        <IntakeSectionTabs value={value} onChange={setValue} />
        <Placeholder />
      </ConversationStoryFrame>
    );
  },
};
