// ラベルバッジのストーリー
// A方式: SideMenu 内（+ の左側）にラベルバッジを配置

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CORE_LABELS } from "./labels";

// ── 色定義 ──
const LABEL_COLORS: Record<string, string> = {
  "[手順]": "#3b82f6",
  "[使用したもの]": "#10b981",
  "[条件]": "#f59e0b",
  "[試料]": "#8b5cf6",
  "[結果]": "#ef4444",
};

function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? "#6b7280";
}

// ── バッジコンポーネント ──
function LabelBadge({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  const color = getLabelColor(label);
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0px 5px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        backgroundColor: color + "18",
        color: color,
        border: `1px solid ${color}38`,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ── SideMenu ボタン（個別） ──
const btnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: 4,
  border: "none",
  background: "none",
  cursor: "pointer",
  color: "#9ca3af",
  padding: 0,
};

function LabelButton({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} title="ラベルを付ける" style={{ ...btnBase, border: "1px dashed #d1d5db", fontSize: 12 }}>
      #
    </button>
  );
}

function LinkButton() {
  return (
    <button title="リンク" style={{ ...btnBase, border: "1px dashed #bfdbfe", color: "#93c5fd", fontSize: 11 }}>
      🔗
    </button>
  );
}

function AddButton() {
  return <button style={{ ...btnBase, fontSize: 16 }}>+</button>;
}

function DragHandle() {
  return <button style={{ ...btnBase, cursor: "grab", fontSize: 10, letterSpacing: 1 }}>⠿</button>;
}

// ── SideMenu 全体 ──
// ラベル付き: [バッジ] [🔗] [+] [⠿]
// ラベルなし: [#] [🔗] [+] [⠿]
function SideMenu({ label }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {label ? <LabelBadge label={label} /> : <LabelButton />}
      <LinkButton />
      <AddButton />
      <DragHandle />
    </div>
  );
}

// ── ブロック行: SideMenu（ブロック左） + コンテンツ ──
function Block({
  label,
  children,
  indent = 0,
  hovered = false,
  onHover,
  onLeave,
}: {
  label?: string;
  children: React.ReactNode;
  indent?: number;
  hovered?: boolean;
  onHover?: () => void;
  onLeave?: () => void;
}) {
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        display: "flex",
        alignItems: "flex-start",
        minHeight: 28,
        marginLeft: indent,
        borderRadius: 4,
        background: hovered ? "#f9fafb" : "transparent",
        transition: "background 0.1s",
      }}
    >
      {/* SideMenu: ブロックのすぐ左 */}
      <div style={{ flexShrink: 0, paddingTop: 2, marginRight: 4, visibility: hovered ? "visible" : "hidden" }}>
        <SideMenu label={label} />
      </div>
      {/* コンテンツ */}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── 静的表示版（ホバー不要、常時表示） ──
function StaticBlock({
  label,
  children,
  indent = 0,
}: {
  label?: string;
  children: React.ReactNode;
  indent?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", minHeight: 28, marginLeft: indent }}>
      <div style={{ flexShrink: 0, paddingTop: 2, marginRight: 4 }}>
        <SideMenu label={label} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// テーブルスタイル
const thStyle: React.CSSProperties = {
  padding: "6px 12px", textAlign: "left", fontSize: 13, fontWeight: 600,
  borderBottom: "2px solid #d1d5db", color: "#374151",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: 13, borderBottom: "1px solid #e5e7eb", color: "#374151",
};

// ── Meta ──
const meta: Meta = {
  title: "ContextLabel/LabelBadge",
  parameters: { layout: "padded" },
};
export default meta;

// 全ラベル一覧
export const AllLabels: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {CORE_LABELS.map((label) => (
        <LabelBadge key={label} label={label} onClick={() => alert(label)} />
      ))}
    </div>
  ),
};

// SideMenu のバリエーション
export const SideMenuVariants: StoryObj = {
  name: "SideMenu 表示パターン",
  render: () => (
    <div style={{ fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>ラベル未設定:</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SideMenu />
          <span style={{ color: "#9ca3af" }}>←</span>
          <span style={{ fontSize: 12, color: "#6b7280" }}>[#] [🔗] [+] [⠿]</span>
        </div>
      </div>
      {CORE_LABELS.map((label) => (
        <div key={label}>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label} 設定済み:</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SideMenu label={label} />
            <span style={{ color: "#9ca3af" }}>←</span>
            <span style={{ fontSize: 12, color: "#6b7280" }}>[バッジ] [🔗] [+] [⠿]</span>
          </div>
        </div>
      ))}
    </div>
  ),
};

// A方式: ノート風（静的表示）
export const NoteStatic: StoryObj = {
  name: "ノート風（静的表示）",
  render: () => (
    <div style={{ maxWidth: 800, fontFamily: "Inter, sans-serif" }}>
      <StaticBlock><h1 style={{ fontSize: 28, fontWeight: 700 }}>Cu粉末アニール実験</h1></StaticBlock>

      <StaticBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>1. 封入する</h3>
      </StaticBlock>
      <StaticBlock label="[使用したもの]" indent={24}>
        <p>Cu粉末 1g</p>
      </StaticBlock>
      <StaticBlock label="[使用したもの]" indent={24}>
        <p>シリカ管</p>
      </StaticBlock>
      <StaticBlock label="[結果]" indent={24}>
        <p>封入されたCu粉末</p>
      </StaticBlock>

      <StaticBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>2. アニールする</h3>
      </StaticBlock>
      <StaticBlock label="[試料]" indent={24}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={thStyle}>試料名</th><th style={thStyle}>温度</th><th style={thStyle}>時間</th></tr></thead>
          <tbody>
            <tr><td style={tdStyle}>sample_A</td><td style={tdStyle}>600℃</td><td style={tdStyle}>24h</td></tr>
            <tr><td style={tdStyle}>sample_B</td><td style={tdStyle}>700℃</td><td style={tdStyle}>24h</td></tr>
            <tr><td style={tdStyle}>sample_C</td><td style={tdStyle}>800℃</td><td style={tdStyle}>24h</td></tr>
          </tbody>
        </table>
      </StaticBlock>
      <StaticBlock label="[条件]" indent={24}>
        <p>昇温速度: 5℃/min</p>
      </StaticBlock>
      <StaticBlock label="[条件]" indent={24}>
        <p>冷却: 炉冷</p>
      </StaticBlock>

      <StaticBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>3. 評価する</h3>
      </StaticBlock>
      <StaticBlock label="[結果]" indent={24}>
        <p>XRD測定により相同定を行う。</p>
      </StaticBlock>
    </div>
  ),
};

// A方式: ホバー操作デモ
export const NoteHoverDemo: StoryObj = {
  name: "ノート風（ホバー操作デモ）",
  render: () => {
    function Demo() {
      const [hovered, setHovered] = useState<string | null>(null);

      const blocks: { id: string; label?: string; indent?: number; content: React.ReactNode }[] = [
        { id: "t", content: <h1 style={{ fontSize: 28, fontWeight: 700 }}>Cu粉末アニール実験</h1> },
        { id: "s1", label: "[手順]", content: <h3 style={{ fontSize: 18, fontWeight: 600 }}>1. 封入する</h3> },
        { id: "u1", label: "[使用したもの]", indent: 24, content: <p>Cu粉末 1g</p> },
        { id: "u2", label: "[使用したもの]", indent: 24, content: <p>シリカ管</p> },
        { id: "p1", indent: 24, content: <p style={{ color: "#6b7280" }}>真空封入管内で封入する。（ラベルなし）</p> },
        { id: "r1", label: "[結果]", indent: 24, content: <p>封入されたCu粉末</p> },
        { id: "s2", label: "[手順]", content: <h3 style={{ fontSize: 18, fontWeight: 600 }}>2. アニールする</h3> },
        { id: "c1", label: "[条件]", indent: 24, content: <p>昇温速度: 5℃/min</p> },
        { id: "c2", label: "[条件]", indent: 24, content: <p>冷却: 炉冷</p> },
      ];

      return (
        <div style={{ maxWidth: 800, fontFamily: "Inter, sans-serif" }}>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, background: "#f3f4f6", padding: "8px 12px", borderRadius: 6 }}>
            各ブロックにホバーで SideMenu 表示。ラベル未設定ブロック（5行目）は # ボタン。
          </p>
          {blocks.map((b) => (
            <Block
              key={b.id}
              label={b.label}
              indent={b.indent}
              hovered={hovered === b.id}
              onHover={() => setHovered(b.id)}
              onLeave={() => setHovered(null)}
            >
              {b.content}
            </Block>
          ))}
        </div>
      );
    }
    return <Demo />;
  },
};
