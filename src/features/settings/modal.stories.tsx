// 設定モーダルのストーリー
// 初期状態・設定済み・保存完了の見た目を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Settings as SettingsIcon, ChevronDown } from "lucide-react";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  appearance: "none" as const,
  background: tokens.bg,
  border: `1px solid ${tokens.border}`,
  borderRadius: 4,
  padding: "8px 12px",
  paddingRight: 28,
  fontSize: 13,
  color: tokens.fg,
  outline: "none",
  boxSizing: "border-box" as const,
};

// ── モーダル静的モック ──
function MockSettingsModal({
  initialModel = "",
  models = ["Claude Sonnet", "GPT-4o"],
  saved = false,
}: {
  initialModel?: string;
  models?: string[];
  saved?: boolean;
}) {
  const [model, setModel] = useState(initialModel);

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
              Settings
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
          {/* モデル */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: tokens.fg, marginBottom: 6 }}>
              Model
            </div>
            <div style={{ position: "relative" }}>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={selectStyle}
              >
                <option value="">Server default</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <ChevronDown
                size={14}
                color={tokens.mutedFg}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              />
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
            Cancel
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
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Organisms/SettingsModal",
  component: MockSettingsModal,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof MockSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Initial (empty)",
  args: {},
};

export const WithModel: Story = {
  name: "Model selected",
  args: {
    initialModel: "Claude Sonnet",
  },
};

export const Saved: Story = {
  name: "Saved",
  args: {
    initialModel: "Claude Sonnet",
    saved: true,
  },
};
