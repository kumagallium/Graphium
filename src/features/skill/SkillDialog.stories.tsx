// SkillDialog の作成 / 編集モードの見た目確認用ストーリー
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkillDialog } from "./SkillDialog";
import "../../app.css";

const meta: Meta<typeof SkillDialog> = {
  title: "Skill/SkillDialog",
  component: SkillDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SkillDialog>;

// 新規作成。全項目が初期値（説明は空、全言語、Ingest 自動適用 ON）。
export const Create: Story = {
  args: {
    mode: "create",
    onClose: () => {},
    onSubmit: () => {},
  },
};

// 既存 Skill の編集。初期値がフォームに反映され、ボタンが「Save」になる。
export const Edit: Story = {
  args: {
    mode: "edit",
    initial: {
      title: "Literature Reviewer",
      description: "先行研究を要約し、観点と限界を抽出する",
      availableForIngest: true,
      language: "ja",
    },
    onClose: () => {},
    onSubmit: () => {},
  },
};
