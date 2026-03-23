// Crucible デザインガイドライン — Storybook で閲覧可能
// design.md の内容をビジュアルで確認

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = {
  title: "Design Guide",
  parameters: { layout: "padded" },
};
export default meta;

// ── トークン定義 ──
const base = [
  { name: "background", value: "#fafdf7", desc: "温かみのあるオフホワイト" },
  { name: "foreground", value: "#1a2e1d", desc: "深いグリーンブラック" },
  { name: "card", value: "#ffffff", desc: "純白" },
  { name: "border", value: "#d5e0d7", desc: "淡いグリーングレー" },
  { name: "muted", value: "#f0f5ef", desc: "薄いグリーングレー" },
  { name: "muted-foreground", value: "#6b7f6e", desc: "中間のグリーングレー" },
];
const primary = [
  { name: "primary", value: "#4B7A52", desc: "ブランドグリーン" },
  { name: "primary-foreground", value: "#ffffff", desc: "" },
  { name: "secondary", value: "#f0f5ef", desc: "" },
  { name: "secondary-foreground", value: "#2d4a32", desc: "" },
  { name: "accent", value: "#e8f0e8", desc: "" },
  { name: "accent-foreground", value: "#2d4a32", desc: "" },
  { name: "ring", value: "#4B7A52", desc: "" },
  { name: "input", value: "#d5e0d7", desc: "" },
];
const semantic = [
  { name: "成功", bg: "#edf5ee", fg: "#2d4a32", border: "#b8d4bb" },
  { name: "エラー", bg: "#fef2f2", fg: "#991b1b", border: "#fecaca" },
  { name: "情報", bg: "#f0f9ff", fg: "#0369a1", border: "#bae6fd" },
  { name: "警告", bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
];
const labelColors = [
  { name: "[手順]", color: "#3b82f6" },
  { name: "[使用したもの]", color: "#10b981" },
  { name: "[条件]", color: "#f59e0b" },
  { name: "[試料]", color: "#8b5cf6" },
  { name: "[結果]", color: "#ef4444" },
];

function Swatch({ color, size = 40 }: { color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      backgroundColor: color, border: "1px solid #d5e0d7",
      flexShrink: 0,
    }} />
  );
}

const font = "'Inter', system-ui, sans-serif";
const sectionStyle: React.CSSProperties = {
  marginBottom: 32, fontFamily: font, color: "#1a2e1d",
};
const h2Style: React.CSSProperties = {
  fontSize: 18, fontWeight: 700, marginBottom: 12, color: "#1a2e1d",
  borderBottom: "2px solid #d5e0d7", paddingBottom: 6, fontFamily: font,
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "#6b7f6e", fontFamily: font,
};

// カラーパレット
export const ColorPalette: StoryObj = {
  name: "カラーパレット",
  render: () => (
    <div style={{ maxWidth: 700, fontFamily: font }}>
      <section style={sectionStyle}>
        <h2 style={h2Style}>ベース色</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {base.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Swatch color={c.value} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "#6b7f6e" }}>{c.value} — {c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>プライマリー（ブランドグリーン）</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {primary.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Swatch color={c.value} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "#6b7f6e" }}>{c.value} {c.desc && `— ${c.desc}`}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>セマンティック色</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {semantic.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                padding: "4px 12px", borderRadius: 9999, fontSize: 12, fontWeight: 600,
                backgroundColor: s.bg, color: s.fg, border: `1px solid ${s.border}`,
              }}>
                {s.name}
              </div>
              <span style={{ fontSize: 12, color: "#6b7f6e" }}>bg: {s.bg} / fg: {s.fg}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>ラベル色（PROV-DM）</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {labelColors.map((l) => (
            <div key={l.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{
                padding: "0px 6px", borderRadius: 9999, fontSize: 11, fontWeight: 600,
                backgroundColor: l.color + "18", color: l.color, border: `1px solid ${l.color}38`,
                lineHeight: 1.6,
              }}>
                {l.name}
              </span>
              <span style={{ fontSize: 10, color: "#6b7f6e" }}>{l.color}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};

// タイポグラフィ
export const Typography: StoryObj = {
  name: "タイポグラフィ",
  render: () => (
    <div style={{ maxWidth: 700, fontFamily: font, color: "#1a2e1d" }}>
      <section style={sectionStyle}>
        <h2 style={h2Style}>フォントファミリー</h2>
        <p style={{ fontSize: 13, marginBottom: 4 }}>本文: <strong>Inter</strong></p>
        <p style={{ fontSize: 13, fontFamily: "ui-monospace, 'SF Mono', monospace" }}>コード: <code>ui-monospace, 'SF Mono', monospace</code></p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>スケール</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <span style={labelStyle}>text-lg font-semibold — セクション見出し</span>
            <p style={{ fontSize: 18, fontWeight: 600, margin: "4px 0 0" }}>Cu粉末アニール実験</p>
          </div>
          <div>
            <span style={labelStyle}>text-sm font-semibold — カードタイトル</span>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "4px 0 0" }}>sample_A (600℃, 24h)</p>
          </div>
          <div>
            <span style={labelStyle}>text-sm — 本文</span>
            <p style={{ fontSize: 14, margin: "4px 0 0" }}>XRD測定により相同定を行う。じゃがいもは変色しやすいので、炒めるまで時間がかかる場合は水にさらしておきます。</p>
          </div>
          <div>
            <span style={labelStyle}>text-xs — Badge・補足テキスト</span>
            <p style={{ fontSize: 12, margin: "4px 0 0" }}>作成日付: 2026-03-20  作成者: 熊谷 将也</p>
          </div>
        </div>
      </section>
    </div>
  ),
};

// 角丸・影・スペーシング
export const Components: StoryObj = {
  name: "角丸・影・スペーシング",
  render: () => (
    <div style={{ maxWidth: 700, fontFamily: font, color: "#1a2e1d" }}>
      <section style={sectionStyle}>
        <h2 style={h2Style}>角丸</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            { label: "カード (rounded-xl)", radius: 12 },
            { label: "ボタン (rounded-lg)", radius: 8 },
            { label: "Badge (rounded-full)", radius: 9999 },
          ].map((r) => (
            <div key={r.label} style={{ textAlign: "center" }}>
              <div style={{
                width: 80, height: 50, borderRadius: r.radius,
                border: `2px solid #4B7A52`, backgroundColor: "#edf5ee",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: "#4B7A52", fontWeight: 600,
              }}>
                {r.radius === 9999 ? "full" : `${r.radius}px`}
              </div>
              <span style={{ fontSize: 11, color: "#6b7f6e", marginTop: 4, display: "block" }}>{r.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>影</h2>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            { label: "shadow-sm (カード)", shadow: "0 1px 2px rgba(0,0,0,0.05)" },
            { label: "shadow-md (ドロップダウン)", shadow: "0 4px 6px rgba(0,0,0,0.1)" },
            { label: "shadow-lg (ダイアログ)", shadow: "0 10px 15px rgba(0,0,0,0.1)" },
          ].map((s) => (
            <div key={s.label} style={{
              width: 120, height: 60, borderRadius: 12,
              backgroundColor: "#ffffff", border: "1px solid #d5e0d7",
              boxShadow: s.shadow, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 11, color: "#6b7f6e",
            }}>
              {s.label.split("(")[0]}
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>ブランドカラー適用例</h2>
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            backgroundColor: "#4B7A52", color: "#ffffff",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>
            プライマリーボタン
          </button>
          <button style={{
            padding: "8px 16px", borderRadius: 8,
            border: "1px solid #d5e0d7", backgroundColor: "#f0f5ef",
            color: "#2d4a32", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>
            セカンダリーボタン
          </button>
        </div>
      </section>
    </div>
  ),
};
