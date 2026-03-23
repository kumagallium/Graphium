// AI アシスタントモーダルのストーリー
// 各状態（初期・入力中・実行中・エラー）の見た目を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Bot } from "lucide-react";

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
// 実際の AiAssistantModal は Context 依存なので、見た目のみ再現

function MockModal({
  quotedMarkdown,
  loading = false,
  error = null,
}: {
  quotedMarkdown: string;
  loading?: boolean;
  error?: string | null;
}) {
  const [question, setQuestion] = useState("");

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 500,
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
          maxWidth: 520,
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
            <Bot size={16} color="#8b5cf6" />
            <span style={{ fontSize: 14, fontWeight: 500, color: tokens.fg }}>
              AI アシスタント
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
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 引用ブロック */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: tokens.mutedFg, marginBottom: 4 }}>
              📎 引用
            </div>
            <div
              style={{
                background: tokens.muted,
                border: `1px solid ${tokens.border}`,
                borderRadius: 4,
                padding: 12,
                fontSize: 12,
                color: `${tokens.fg}cc`,
                fontFamily: "monospace",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {quotedMarkdown}
            </div>
          </div>

          {/* 質問入力 */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: tokens.mutedFg, marginBottom: 4 }}>
              💬 質問
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="この内容について質問を入力..."
              disabled={loading}
              style={{
                width: "100%",
                background: tokens.bg,
                border: `1px solid ${tokens.border}`,
                borderRadius: 4,
                padding: 12,
                fontSize: 13,
                color: tokens.fg,
                resize: "none",
                minHeight: 80,
                outline: "none",
                opacity: loading ? 0.5 : 1,
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 10, color: tokens.mutedFg, marginTop: 4 }}>
              ⌘+Enter で実行
            </div>
          </div>

          {/* エラー */}
          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 4,
                padding: 8,
                fontSize: 12,
                color: "#dc2626",
              }}
            >
              {error}
            </div>
          )}
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
            disabled={loading || !question.trim()}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 500,
              background: loading || !question.trim() ? `${tokens.mutedFg}40` : "#4B7A52",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: loading || !question.trim() ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                実行中...
              </>
            ) : (
              "実行"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Features/AI Assistant/Modal",
  component: MockModal,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof MockModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    quotedMarkdown: "シリカ管",
  },
};

export const LongQuote: Story = {
  args: {
    quotedMarkdown: `## 実験手順

1. Cu粉末をシリカ管に封入する
2. 電気炉で 800°C まで昇温（10°C/min）
3. 800°C で 2 時間保持
4. 炉冷で室温まで冷却`,
  },
};

export const Loading: Story = {
  args: {
    quotedMarkdown: "シリカ管",
    loading: true,
  },
};

export const WithError: Story = {
  args: {
    quotedMarkdown: "シリカ管",
    error: "Agent API error 500: Internal Server Error",
  },
};
