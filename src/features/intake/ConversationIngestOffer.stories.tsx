// 候補の本数と費用の見込みの 1 行のストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useT } from "@/i18n";
import { Button } from "@/ui/button";
import { ConversationStoryFrame } from "./conversation-story-frame";
import { ConversationIngestOffer } from "./ConversationIngestOffer";

const meta: Meta<typeof ConversationIngestOffer> = {
  title: "Features/Intake/Conversation/IngestOffer",
  component: ConversationIngestOffer,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ConversationIngestOffer>;

export const Full: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationIngestOffer total={27} candidates={4} />
    </ConversationStoryFrame>
  ),
};

export const Short: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationIngestOffer total={27} candidates={4} variant="short" />
    </ConversationStoryFrame>
  ),
};

export const NoCandidates: Story = {
  render: () => (
    <ConversationStoryFrame>
      <ConversationIngestOffer total={6} candidates={0} />
    </ConversationStoryFrame>
  ),
};

function WordingCandidatesBody() {
  const t = useT();
  const label = "text-[11px] text-muted-foreground mb-1";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className={label}>案 A（説明つき）</p>
        <ConversationIngestOffer total={27} candidates={4} variant="full" />
      </div>
      <div>
        <p className={label}>案 B（短い）</p>
        <ConversationIngestOffer total={27} candidates={4} variant="short" />
      </div>
      <div>
        <Button variant="primary" size="sm">
          {t("intake.ingestAll")}
        </Button>
      </div>
    </div>
  );
}

// 文言の 2 案を並べる。見出しはストーリーの中だけの文字
export const WordingCandidates: Story = {
  render: () => (
    <ConversationStoryFrame>
      <WordingCandidatesBody />
    </ConversationStoryFrame>
  ),
};
