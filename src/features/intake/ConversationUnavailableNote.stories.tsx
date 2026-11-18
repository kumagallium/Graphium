// ブラウザ版で使えないときの 1 行のストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConversationStoryFrame } from "./conversation-story-frame";
import { ConversationUnavailableNote } from "./ConversationUnavailableNote";
import { IntakeSectionTabs } from "./IntakeSectionTabs";

const meta: Meta<typeof ConversationUnavailableNote> = {
  title: "Features/Intake/Conversation/UnavailableNote",
  component: ConversationUnavailableNote,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ConversationUnavailableNote>;

export const OneLine: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationUnavailableNote />
    </ConversationStoryFrame>
  ),
};

export const WithReason: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationUnavailableNote withReason />
    </ConversationStoryFrame>
  ),
};

/** 「AI との会話」を選んだ下に置いた形 */
export const UnderTabs: Story = {
  render: () => (
    <ConversationStoryFrame>
      <IntakeSectionTabs value="conversations" onChange={() => {}} />
      <div className="mt-4">
        <ConversationUnavailableNote withReason />
      </div>
    </ConversationStoryFrame>
  ),
};
