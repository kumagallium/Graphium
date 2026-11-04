// 実行前の確認ダイアログ（MCP の道具）。ストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolApprovalDialogView } from "./ToolApprovalDialog";

const meta: Meta = {
  title: "Molecules/ToolApprovalDialog",
};
export default meta;

const noop = () => {};

/** Slack への投稿（パン作りの記録を共有する） */
export const PostMessage: StoryObj = {
  render: () => (
    <ToolApprovalDialogView
      request={{
        server: "slack",
        name: "post_message",
        title: "Post a message",
        input: { channel: "#bakery-lab", text: "Proofing at 28 °C for 90 min gave the most open crumb (run 4 of 5)." },
      }}
      onAnswer={noop}
    />
  ),
};

/** 見出しが無く、値が長い・入れ子の道具 */
export const LongInput: StoryObj = {
  render: () => (
    <ToolApprovalDialogView
      request={{
        server: "notion",
        name: "update_page",
        input: {
          page_id: "3f2a9c1e",
          properties: { Status: "Done", Tags: ["sourdough", "hydration-75"] },
          content: "Mixed 1,000 g flour with 750 g water and 200 g levain. ".repeat(20),
        },
      }}
      onAnswer={noop}
    />
  ),
};
