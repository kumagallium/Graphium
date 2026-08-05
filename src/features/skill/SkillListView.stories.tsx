// SkillListView のリスト表示確認用ストーリー
// システムスキルのバッジ（System / 言語 / 新しい内容あり）の組み合わせを見る
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkillListView } from "./SkillListView";
import type { SkillMetaSummary } from "./skill-service";
import type { GraphiumFile } from "../../lib/document-types";
import "../../app.css";

const meta: Meta<typeof SkillListView> = {
  title: "Skill/SkillListView",
  component: SkillListView,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SkillListView>;

const files: GraphiumFile[] = [
  { id: "sys-ja", name: "Default Writing Voice (日本語)", modifiedTime: "2026-07-01T09:00:00Z", createdTime: "2026-01-10T09:00:00Z" },
  { id: "sys-en", name: "Default Writing Voice (English)", modifiedTime: "2026-07-01T09:00:00Z", createdTime: "2026-01-10T09:00:00Z" },
  { id: "user-1", name: "Literature Reviewer", modifiedTime: "2026-07-20T12:00:00Z", createdTime: "2026-03-05T12:00:00Z" },
];

const baseMetas = new Map<string, SkillMetaSummary>([
  ["sys-ja", {
    title: "Default Writing Voice (日本語)",
    description: "ノート生成と AI チャットの日本語文体ガイド（敬体・em dash 不使用・リズム）",
    availableForIngest: true,
    systemSkillId: "default-voice-ja",
    language: "ja",
  }],
  ["sys-en", {
    title: "Default Writing Voice (English)",
    description: "Style guide for English note generation and chat",
    availableForIngest: true,
    systemSkillId: "default-voice-en",
    language: "en",
  }],
  ["user-1", {
    title: "Literature Reviewer",
    description: "先行研究を要約し、観点と限界を抽出する",
    availableForIngest: false,
  }],
]);

const noop = () => {};
const noopAsync = async () => {};

// 通常のリスト。システムスキル 2 件 + ユーザースキル 1 件。
export const Default: Story = {
  args: {
    skillFiles: files,
    skillMetas: baseMetas,
    onOpenSkill: noop,
    onBack: noop,
    onDeleteSkill: noopAsync,
    onNewSkill: noop,
    onEditSkill: noop,
    onResetSystemSkill: noopAsync,
  },
};

// 編集済みシステムスキルに新しいデフォルトが届いた状態。
// 「新しい内容あり」バッジが System / 言語タグの隣に出て、Reset を促す。
export const NewerDefaultAvailable: Story = {
  args: {
    ...Default.args,
    skillMetas: new Map(
      Array.from(baseMetas.entries()).map(([id, m]) =>
        id === "sys-ja" ? [id, { ...m, hasNewerDefault: true }] : [id, m],
      ),
    ),
  },
};
