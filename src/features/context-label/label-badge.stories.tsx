// ラベルバッジ + 右側インジケータ レイアウトのストーリー
// 新レイアウト: 左 SideMenu(+ ⠿) / 中央 コンテンツ / 右 ラベルバッジ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CORE_LABELS } from "./labels";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  primary: "#4B7A52",
  font: "'Inter', system-ui, sans-serif",
};

// ラベル色
const LABEL_COLORS: Record<string, string> = {
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[属性]": "#c08b3e",
  "[試料]": "#8b7ab5",
  "[結果]": "#c26356",
};
function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? tokens.mutedFg;
}

// ── バッジ ──
function LabelBadge({ label }: { label: string }) {
  const color = getLabelColor(label);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "0px 6px", borderRadius: 9999, fontSize: 11, fontWeight: 600,
      backgroundColor: color + "18", color, border: `1px solid ${color}38`,
      userSelect: "none", lineHeight: 1.6, whiteSpace: "nowrap", fontFamily: tokens.font,
    }}>
      {label}
    </span>
  );
}

// ── 簡素化 SideMenu（+ ⠿ のみ） ──
const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 20, height: 20, borderRadius: 8, border: "none",
  background: "none", cursor: "pointer", color: tokens.mutedFg, padding: 0,
};

function SideMenu() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
      <button style={{ ...btn, fontSize: 16 }}>+</button>
      <button style={{ ...btn, cursor: "grab", fontSize: 10, letterSpacing: 1 }}>⠿</button>
    </div>
  );
}

// ── エディタ模擬ブロック（左: SideMenu / 中央: コンテンツ / 右: ラベル） ──
const CONTENT_LEFT = 100;

// ホバーハイライト色
const HOVER_BG = "rgba(75, 122, 82, 0.05)";
const HOVER_BORDER = "rgba(75, 122, 82, 0.15)";

function EditorBlock({ label, children, indent = 0 }: {
  label?: string; children: React.ReactNode; indent?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", minHeight: 28 }}>
      <div style={{ width: CONTENT_LEFT, flexShrink: 0, display: "flex", justifyContent: "flex-end", paddingTop: 2, paddingRight: 4, visibility: "hidden" }}>
        <SideMenu />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingLeft: indent }}>{children}</div>
      <div style={{ flexShrink: 0, paddingLeft: 12, paddingTop: 2, minWidth: 90, textAlign: "right" }}>
        {label && <LabelBadge label={label} />}
      </div>
    </div>
  );
}

function HoverBlock({ id, label, children, indent = 0, hoveredId, setHoveredId }: {
  id: string; label?: string; children: React.ReactNode; indent?: number;
  hoveredId: string | null; setHoveredId: (id: string | null) => void;
}) {
  const isHovered = hoveredId === id;
  return (
    <div
      onMouseEnter={() => setHoveredId(id)}
      onMouseLeave={() => setHoveredId(null)}
      style={{ display: "flex", alignItems: "flex-start", minHeight: 28 }}
    >
      <div style={{ width: CONTENT_LEFT, flexShrink: 0, display: "flex", justifyContent: "flex-end", paddingTop: 2, paddingRight: 4, visibility: isHovered ? "visible" : "hidden" }}>
        <SideMenu />
      </div>
      <div style={{
        flex: 1, minWidth: 0, paddingLeft: indent,
        borderRadius: 4,
        background: isHovered ? HOVER_BG : "transparent",
        outline: isHovered ? `1.5px solid ${HOVER_BORDER}` : "none",
        transition: "background 0.15s, outline 0.15s",
      }}>
        {children}
      </div>
      <div style={{ flexShrink: 0, paddingLeft: 12, paddingTop: 2, minWidth: 90, textAlign: "right" }}>
        {label && <LabelBadge label={label} />}
      </div>
    </div>
  );
}

// テーブルスタイル
const th: React.CSSProperties = {
  padding: "6px 12px", textAlign: "left", fontSize: 13, fontWeight: 600,
  borderBottom: `2px solid ${tokens.border}`, color: tokens.fg, fontFamily: tokens.font,
};
const td: React.CSSProperties = {
  padding: "6px 12px", fontSize: 13, borderBottom: `1px solid ${tokens.border}`,
  color: tokens.fg, fontFamily: tokens.font,
};

// ── Meta ──
const meta: Meta = { title: "ContextLabel/LabelBadge", parameters: { layout: "padded" } };
export default meta;

// 全ラベル一覧
export const AllLabels: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontFamily: tokens.font }}>
      {CORE_LABELS.map((l) => <LabelBadge key={l} label={l} />)}
    </div>
  ),
};

// SideMenu（簡素化版）
export const SideMenuSimplified: StoryObj = {
  name: "SideMenu（+ ⠿ のみ）",
  render: () => (
    <div style={{ fontFamily: tokens.font, display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 13, color: tokens.mutedFg }}>SideMenu は + と ⠿ のみ。ラベルは右側に表示。</p>
      <SideMenu />
    </div>
  ),
};

// 静的表示（新レイアウト）
export const NoteStatic: StoryObj = {
  name: "ノート風（右側ラベル・静的）",
  render: () => (
    <div style={{ maxWidth: 900, fontFamily: tokens.font, color: tokens.fg, background: tokens.bg, padding: 24, borderRadius: 12 }}>
      <EditorBlock><h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3 }}>Cu粉末アニール実験</h1></EditorBlock>

      <EditorBlock label="[手順]"><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>1. 封入する</h2></EditorBlock>
      <EditorBlock label="[使用したもの]" indent={24}><p>Cu粉末 1g</p></EditorBlock>
      <EditorBlock label="[使用したもの]" indent={24}><p>シリカ管</p></EditorBlock>
      <EditorBlock label="[結果]" indent={24}><p>封入されたCu粉末</p></EditorBlock>

      <EditorBlock label="[手順]"><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>2. アニールする</h2></EditorBlock>
      <EditorBlock label="[試料]" indent={24}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>試料名</th><th style={th}>温度</th><th style={th}>時間</th></tr></thead>
          <tbody>
            <tr><td style={td}>sample_A</td><td style={td}>600℃</td><td style={td}>24h</td></tr>
            <tr><td style={td}>sample_B</td><td style={td}>700℃</td><td style={td}>24h</td></tr>
            <tr><td style={td}>sample_C</td><td style={td}>800℃</td><td style={td}>24h</td></tr>
          </tbody>
        </table>
      </EditorBlock>
      <EditorBlock label="[属性]" indent={24}><p>昇温速度: 5℃/min</p></EditorBlock>
      <EditorBlock label="[属性]" indent={24}><p>冷却: 炉冷</p></EditorBlock>

      <EditorBlock label="[手順]"><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>3. 評価する</h2></EditorBlock>
      <EditorBlock label="[結果]" indent={24}><p>XRD測定により相同定を行う。</p></EditorBlock>
    </div>
  ),
};

// ホバー操作デモ（新レイアウト）
export const NoteHoverDemo: StoryObj = {
  name: "ノート風（ホバーデモ）",
  render: () => {
    function Demo() {
      const [h, setH] = useState<string | null>(null);
      return (
        <div style={{ maxWidth: 900, fontFamily: tokens.font, color: tokens.fg, background: tokens.bg, padding: 24, borderRadius: 12 }}>
          <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12, background: tokens.muted, padding: "8px 12px", borderRadius: 8, border: `1px solid ${tokens.border}` }}>
            ホバーでブロックをハイライト + 左に SideMenu 表示。ラベルは常に右に表示。
          </p>

          <HoverBlock id="t" hoveredId={h} setHoveredId={setH}><h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3 }}>Cu粉末アニール実験</h1></HoverBlock>
          <HoverBlock id="s1" label="[手順]" hoveredId={h} setHoveredId={setH}><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>1. 封入する</h2></HoverBlock>
          <HoverBlock id="u1" label="[使用したもの]" indent={24} hoveredId={h} setHoveredId={setH}><p>Cu粉末 1g</p></HoverBlock>
          <HoverBlock id="u2" label="[使用したもの]" indent={24} hoveredId={h} setHoveredId={setH}><p>シリカ管</p></HoverBlock>
          <HoverBlock id="p1" indent={24} hoveredId={h} setHoveredId={setH}><p style={{ color: tokens.mutedFg }}>真空封入管内で封入する。（ラベルなし）</p></HoverBlock>
          <HoverBlock id="r1" label="[結果]" indent={24} hoveredId={h} setHoveredId={setH}><p>封入されたCu粉末</p></HoverBlock>
          <HoverBlock id="s2" label="[手順]" hoveredId={h} setHoveredId={setH}><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>2. アニールする</h2></HoverBlock>
          <HoverBlock id="st" label="[試料]" indent={24} hoveredId={h} setHoveredId={setH}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>試料名</th><th style={th}>温度</th><th style={th}>時間</th></tr></thead>
              <tbody>
                <tr><td style={td}>sample_A</td><td style={td}>600℃</td><td style={td}>24h</td></tr>
                <tr><td style={td}>sample_B</td><td style={td}>700℃</td><td style={td}>24h</td></tr>
                <tr><td style={td}>sample_C</td><td style={td}>800℃</td><td style={td}>24h</td></tr>
              </tbody>
            </table>
          </HoverBlock>
          <HoverBlock id="c1" label="[属性]" indent={24} hoveredId={h} setHoveredId={setH}><p>昇温速度: 5℃/min</p></HoverBlock>
          <HoverBlock id="c2" label="[属性]" indent={24} hoveredId={h} setHoveredId={setH}><p>冷却: 炉冷</p></HoverBlock>
          <HoverBlock id="s3" label="[手順]" hoveredId={h} setHoveredId={setH}><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>3. 評価する</h2></HoverBlock>
          <HoverBlock id="r2" label="[結果]" indent={24} hoveredId={h} setHoveredId={setH}><p>XRD測定により相同定を行う。</p></HoverBlock>
        </div>
      );
    }
    return <Demo />;
  },
};
