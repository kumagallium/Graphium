// AssistantConnectView — 設定 > AI「外の AI からノートを使う」

import type { Meta, StoryObj } from "@storybook/react-vite";
import { AssistantConnectView, type AssistantConnectViewProps } from "./AssistantConnectView";

const NODE = "/Applications/Graphium.app/Contents/Resources/sidecar/node";
const MCP = "/Applications/Graphium.app/Contents/Resources/mcp/graphium-mcp.mjs";

const snippets: AssistantConnectViewProps["snippets"] = {
  "claude-code": `claude mcp add --scope user graphium -- "${NODE}" "${MCP}"`,
  codex: `codex mcp add graphium -- "${NODE}" "${MCP}"`,
  json: JSON.stringify({ mcpServers: { graphium: { command: NODE, args: [MCP] } } }, null, 2),
};

const allIdle: AssistantConnectViewProps["rows"] = {
  "claude-desktop": { kind: "idle" },
  "claude-code": { kind: "idle" },
  codex: { kind: "idle" },
};

const meta: Meta<typeof AssistantConnectView> = {
  title: "Molecules/AssistantConnect",
  component: AssistantConnectView,
  args: {
    available: true,
    rows: allIdle,
    snippets,
    onRegister: () => {},
    onCopy: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-[480px] rounded-lg border border-dashed border-border bg-background p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AssistantConnectView>;

/** 初期: 3 つのクライアントに「登録する」。ほかのアシスタントは畳んでおく */
export const Initial: Story = {};

/** 登録の途中と、登録済み（使い始め方の 1 行が出る） */
export const RegisteringAndRegistered: Story = {
  args: {
    rows: {
      "claude-desktop": { kind: "registered" },
      "claude-code": { kind: "working" },
      codex: { kind: "registered" },
    },
  },
};

/** Claude Desktop が開いている: 終了してから押し直してもらう */
export const ClaudeDesktopOpen: Story = {
  args: { rows: { ...allIdle, "claude-desktop": { kind: "needs-quit" } } },
};

/** 手でビルドした以前の版が登録されている: 登録し直しで同梱版に切り替える */
export const Outdated: Story = {
  args: {
    rows: {
      "claude-desktop": { kind: "outdated" },
      "claude-code": { kind: "outdated" },
      codex: { kind: "idle" },
    },
  },
};

/** CLI が見つからない: コマンドをコピーしてターミナルで実行（コピー直後） */
export const NoCli: Story = {
  args: {
    rows: { "claude-desktop": { kind: "registered" }, "claude-code": { kind: "no-cli" }, codex: { kind: "no-cli" } },
    copied: "codex",
  },
};

/** 失敗 */
export const Failed: Story = {
  args: {
    rows: {
      ...allIdle,
      "claude-desktop": { kind: "error", message: "設定ファイルを読めませんでした（JSON の形が壊れています）。" },
    },
  },
};

/** Web 版: デスクトップ版でだけ使える */
export const WebVersion: Story = {
  args: { available: false },
};
