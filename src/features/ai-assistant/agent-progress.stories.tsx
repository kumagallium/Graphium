// AI が自分で道具を呼んでいる間の経過表示のストーリー
// - 考え中の行（道具なし / 道具を呼び終えたものが並ぶ）
// - 回答の下の「調べた手順（n）」（畳んだ状態から開ける）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { LocaleProvider } from "@/i18n";
import type { AgentToolStep } from "../../lib/document-types";
import { ThinkingIndicator, ToolStepsDetails, setAgentProgress, clearAgentProgress } from "./agent-progress";

const STEPS: AgentToolStep[] = [
  { tool: "find_notes_using", input: "Ar", hits: 2 },
  { tool: "get_note_steps", input: "単ロール液体急冷法で作製した RuAl₂ の微細組織と熱伝導率（ノート）", hits: 0 },
  { tool: "trace_lineage", input: "単ロール液体急冷法で作製した RuAl₂ の微細組織と熱伝導率（ノート）", hits: 0 },
  { tool: "search_my_knowledge", input: "急冷 熱伝導率", hits: 0, empty: true },
];

const meta: Meta = {
  title: "Molecules/AgentProgress",
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ padding: 24, width: 360, background: "var(--paper)" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

/** 道具を呼ぶ前（従来の「考え中...」） */
export const ThinkingWithoutTools: Story = {
  render: () => <ThinkingIndicator chatId="story-empty" />,
};

/** 道具を呼び終えるたびに 1 行ずつ並ぶ */
export const ThinkingWithSteps: Story = {
  render: () => {
    function Live() {
      useEffect(() => {
        setAgentProgress("story-live", STEPS.slice(0, 2));
        return () => clearAgentProgress("story-live");
      }, []);
      return <ThinkingIndicator chatId="story-live" />;
    }
    return <Live />;
  },
};

/** 回答の下に畳んで残る記録（開くと同じ一覧） */
export const StepsUnderAnswer: Story = {
  render: () => <ToolStepsDetails steps={STEPS} />,
};
