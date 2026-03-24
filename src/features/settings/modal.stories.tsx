// 設定モーダルのストーリー
// 初期状態・URL 入力済み・保存完了の見た目を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
};

// ── モーダル静的モック ──
function MockSettingsModal({
  initialUrl = "",
  initialApiKey = "",
  saved = false,
}: {
  initialUrl?: string;
  initialApiKey?: string;
  saved?: boolean;
}) {
  const [agentUrl, setAgentUrl] = useState(initialUrl);
  const [agentApiKey, setAgentApiKey] = useState(initialApiKey);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 400,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: tokens.font,
      }}
    >
      <div
        style={{
          background: tokens.bg,
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: `1px solid ${tokens.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SettingsIcon size={16} color={tokens.mutedFg} />
            <span style={{ fontSize: 14, fontWeight: 500, color: tokens.fg }}>
              設定
            </span>
          </div>
          <button
            style={{
              color: tokens.mutedFg,
              fontSize: 18,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        {/* コンテンツ */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: tokens.fg, marginBottom: 6 }}>
              AI エージェント URL
            </div>
            <input
              type="url"
              value={agentUrl}
              onChange={(e) => setAgentUrl(e.target.value)}
              placeholder="http://localhost:8090"
              style={{
                width: "100%",
                background: tokens.bg,
                border: `1px solid ${tokens.border}`,
                borderRadius: 4,
                padding: "8px 12px",
                fontSize: 13,
                color: tokens.fg,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 11, color: tokens.mutedFg, marginTop: 6, lineHeight: 1.5 }}>
              AI アシスタント機能を使うには{" "}
              <a
                href="https://github.com/kumagallium/crucible-agent"
                style={{ textDecoration: "underline", color: tokens.mutedFg }}
              >
                crucible-agent
              </a>{" "}
              を起動し、そのアドレスを入力してください。
            </div>
          </div>

          {/* API キー */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: tokens.fg, marginBottom: 6 }}>
              API キー
            </div>
            <input
              type="password"
              value={agentApiKey}
              onChange={(e) => setAgentApiKey(e.target.value)}
              placeholder="未設定（認証なし）"
              style={{
                width: "100%",
                background: tokens.bg,
                border: `1px solid ${tokens.border}`,
                borderRadius: 4,
                padding: "8px 12px",
                fontSize: 13,
                color: tokens.fg,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "monospace",
              }}
            />
            <div style={{ fontSize: 11, color: tokens.mutedFg, marginTop: 6, lineHeight: 1.5 }}>
              crucible-agent の AGENT_API_KEY と同じ値を設定してください。未設定の場合は認証なしで接続します。
            </div>
          </div>
        </div>

        {/* フッター */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 16px",
            borderTop: `1px solid ${tokens.border}`,
          }}
        >
          <button
            style={{
              padding: "6px 12px",
              fontSize: 12,
              color: tokens.mutedFg,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 500,
              background: "#4B7A52",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {saved ? "保存しました" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Features/Settings/Modal",
  component: MockSettingsModal,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof MockSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "初期状態（未設定）",
  args: {},
};

export const WithUrl: Story = {
  name: "URL 入力済み",
  args: {
    initialUrl: "http://localhost:8090",
  },
};

export const WithApiKey: Story = {
  name: "URL + API キー入力済み",
  args: {
    initialUrl: "http://localhost:8090",
    initialApiKey: "my-secret-key",
  },
};

export const Saved: Story = {
  name: "保存完了",
  args: {
    initialUrl: "http://localhost:8090",
    initialApiKey: "my-secret-key",
    saved: true,
  },
};
