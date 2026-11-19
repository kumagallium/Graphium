// AI との会話を開いて読む画面のストーリー（本文を props で渡す）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConversationStoryFrame } from "../intake/conversation-story-frame";
import { ConversationPreviewView } from "./ConversationPreview";

const meta: Meta<typeof ConversationPreviewView> = {
  title: "Features/Intake/Conversation/Preview",
  component: ConversationPreviewView,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ConversationPreviewView>;

const META = {
  provider: "claude-code",
  sessionId: "bread-1",
  workdir: "/work/rye-sourdough",
  startedAt: "2026-10-05T09:00:00",
  endedAt: "2026-10-06T10:00:00",
  ownTurns: 5,
  ownChars: 180,
  bodyChars: 600,
  importedAt: "2026-10-07T00:00:00",
} as const;

const JA = [
  "この資料は、私（利用者）と AI（Claude Code）の会話の記録である。「私」の行は本人の発言の原文、「AI」の行は直前の返答の抜粋である。",
  "",
  "## 2026-10-05",
  "",
  "- 依頼文（09:00）: ライ麦サワー種のパンの発酵時間を決めたい",
  "- AI（直前の返答の抜粋）: ライ麦サワー種は温度に敏感で、24 度なら 6〜8 時間が目安です",
  "- 私（09:12）: 酸味は控えめにしたいので、6 時間で止めます",
  "  生地は 24 度の部屋に置きます",
  "  朝に焼くので、夜のうちに仕込みます",
  "",
  "## 2026-10-06",
  "",
  "- AI（直前の返答の抜粋）: 焼き時間は 230 度で 35 分前後です",
  "- 私（09:20、/review）: 焼き時間の根拠を見直してください",
].join("\n");

const EN = [
  "This is a record of a conversation between me (the user) and an AI (Claude Code). Lines marked Me are my own words; lines marked AI are excerpts of the previous reply.",
  "",
  "## 2026-10-05",
  "",
  "- Brief (09:00): Decide the simmering time for the curry",
  "- AI (previous reply): Onions need about 40 minutes to turn golden",
  "- Me (09:12): I want it mild, so I will stop at 30 minutes",
  "  I will add the spices at the end",
].join("\n");

const LONG = (() => {
  const out = ["この資料は、私（利用者）と AI（Claude Code）の会話の記録である。", "", "## 2026-10-05", ""];
  for (let i = 1; i <= 200; i++) {
    out.push(`- 私（09:${String(i % 60).padStart(2, "0")}）: ${i} 回目の仕込み。カレーの煮込みを 10 分ずつ延ばします`);
  }
  return out.join("\n");
})();

export const Default: Story = {
  render: () => (
    <ConversationStoryFrame width={640}>
      <ConversationPreviewView entry={{ conversation: META }} text={JA} />
    </ConversationStoryFrame>
  ),
};

export const English: Story = {
  render: () => (
    <ConversationStoryFrame width={640}>
      <ConversationPreviewView entry={{ conversation: { ...META, workdir: "/work/curry", endedAt: "2026-10-05T10:00:00" } }} text={EN} />
    </ConversationStoryFrame>
  ),
};

export const WithCreatedNotes: Story = {
  render: () => (
    <ConversationStoryFrame width={640}>
      <ConversationPreviewView
        entry={{ conversation: META }}
        text={JA}
        createdNotes={[
          { noteId: "00000000-0000-4000-8000-000000000001", title: "ライ麦サワー種の発酵は 6 時間で止める" },
          { noteId: "00000000-0000-4000-8000-000000000002", title: "焼き時間は 230 度で 35 分前後にする" },
        ]}
        onOpenNote={() => {}}
      />
    </ConversationStoryFrame>
  ),
};

export const Missing: Story = {
  render: () => (
    <ConversationStoryFrame width={640}>
      <ConversationPreviewView entry={{ conversation: META }} text={null} />
    </ConversationStoryFrame>
  ),
};

export const Long: Story = {
  render: () => (
    <ConversationStoryFrame width={640}>
      <ConversationPreviewView entry={{ conversation: META }} text={LONG} />
    </ConversationStoryFrame>
  ),
};
