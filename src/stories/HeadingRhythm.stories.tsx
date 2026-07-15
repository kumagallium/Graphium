// 見出しの縦リズム（vertical rhythm）比較ストーリー
// R2: 「上マージン > 下マージン」で見出しを続く本文と束ねる。
// dyslexia 配慮のため余白を広めに取る（ホワイトスペースが読み速度・追従性に効く）。
// 現状（BlockNote デフォルト＝均一間隔）と 目指す姿（R2 値）を並べて体感確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = {
  title: "Foundation/Heading Rhythm",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "見出しの縦リズム比較。**現状**は見出し・本文が一律間隔で上下対称のため構造が読めない。**目指す姿（R2）**は見出しの上を広く・下を狭くし、続く本文と視覚的に束ねる。dyslexia 前提で全体を一段ゆったりさせている。",
      },
    },
  },
};
export default meta;

// Typography ストーリーと同じ試料で連続性を持たせる
const H1_TEXT = "Cu 粉末アニール実験 S-A の要約";
const P1 =
  "600℃ でのアニール処理が Cu 粉末の粒径に与える影響を XRD で評価した。アニール後の粒径は処理前に比べ 2〜3 倍に成長し、X 線回折ピークの半値幅は有意に減少した。";
const H2_TEXT = "結果（Result）";
const P2 =
  "結晶性の向上が確認された。silica tube による真空封入が前提であり、sample S-B（800℃）との比較で温度依存性を議論できる。";
const H3_TEXT = "Notes";
const P3 =
  "封入時のリークは粒成長を阻害するため、封入直後の真空度を記録しておくこと。次回は昇温レートも変数に加える。";

type Mode = "current" | "wide" | "medium" | "tight";

// 各スケール。上マージン > 下マージン の比は保ちつつ、絶対値だけを段階的に詰める。
const RHYTHM = {
  current: {
    // 現状 = BlockNote デフォルト相当。見出しに上の余白が無く、全ブロックが一律間隔
    h1: { marginTop: 0, marginBottom: 8, lineHeight: 1.3 },
    h2: { marginTop: 8, marginBottom: 8, lineHeight: 1.3 },
    h3: { marginTop: 8, marginBottom: 8, lineHeight: 1.4 },
    p: { marginBottom: 8, lineHeight: 1.7 },
  },
  wide: {
    // 広め = いま app.css に入っている R2 値（記事寄り）
    h1: { marginTop: 0, marginBottom: 12, lineHeight: 1.35 }, // 先頭は :first-child で上 0
    h2: { marginTop: 40, marginBottom: 12, lineHeight: 1.35 },
    h3: { marginTop: 28, marginBottom: 8, lineHeight: 1.45 },
    p: { marginBottom: 12, lineHeight: 1.75 },
  },
  medium: {
    // 中間 = ノートアプリらしい密度。上を 1 段詰め、下は 8 に統一。リズムは明確
    h1: { marginTop: 0, marginBottom: 8, lineHeight: 1.35 },
    h2: { marginTop: 32, marginBottom: 8, lineHeight: 1.35 },
    h3: { marginTop: 24, marginBottom: 8, lineHeight: 1.45 },
    p: { marginBottom: 12, lineHeight: 1.7 },
  },
  tight: {
    // 詰め = Notion 寄り。密度最優先。上>下は残すが控えめ
    h1: { marginTop: 0, marginBottom: 4, lineHeight: 1.3 },
    h2: { marginTop: 24, marginBottom: 4, lineHeight: 1.3 },
    h3: { marginTop: 20, marginBottom: 4, lineHeight: 1.4 },
    p: { marginBottom: 8, lineHeight: 1.7 },
  },
} as const;

function Doc({ mode }: { mode: Mode }) {
  const r = RHYTHM[mode];
  return (
    <div
      style={{
        fontFamily: "var(--ui)",
        color: "var(--ink)",
        maxWidth: 620,
      }}
    >
      <h1
        style={{
          fontSize: 30,
          fontWeight: 700,
          margin: `${r.h1.marginTop}px 0 ${r.h1.marginBottom}px`,
          lineHeight: r.h1.lineHeight,
        }}
      >
        {H1_TEXT}
      </h1>
      <p style={{ fontSize: 16, margin: `0 0 ${r.p.marginBottom}px`, lineHeight: r.p.lineHeight, color: "var(--ink-2)" }}>
        {P1}
      </p>
      <h2
        style={{
          fontSize: 24,
          fontWeight: 600,
          margin: `${r.h2.marginTop}px 0 ${r.h2.marginBottom}px`,
          lineHeight: r.h2.lineHeight,
        }}
      >
        {H2_TEXT}
      </h2>
      <p style={{ fontSize: 16, margin: `0 0 ${r.p.marginBottom}px`, lineHeight: r.p.lineHeight, color: "var(--ink-2)" }}>
        {P2}
      </p>
      <h3
        style={{
          fontSize: 20,
          fontWeight: 600,
          margin: `${r.h3.marginTop}px 0 ${r.h3.marginBottom}px`,
          lineHeight: r.h3.lineHeight,
        }}
      >
        {H3_TEXT}
      </h3>
      <p style={{ fontSize: 16, margin: `0 0 ${r.p.marginBottom}px`, lineHeight: r.p.lineHeight, color: "var(--ink-2)" }}>
        {P3}
      </p>
    </div>
  );
}

function Column({ mode, label, tone }: { mode: Mode; label: string; tone: "bad" | "good" | "neutral" }) {
  const accent =
    tone === "good"
      ? "var(--forest)"
      : tone === "neutral"
        ? "var(--ink-3, #6b7f6e)"
        : "var(--rose, #b23b30)";
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: accent,
          padding: "8px 12px",
          borderBottom: `2px solid ${accent}`,
          marginBottom: 20,
        }}
      >
        {label}
      </div>
      <div style={{ background: "#fff", border: "1px solid var(--rule)", borderRadius: "var(--r-3, 10px)", padding: 28 }}>
        <Doc mode={mode} />
      </div>
    </div>
  );
}

export const BeforeAfter: StoryObj = {
  name: "現状 / 目指す（R2）",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, minHeight: "100vh" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 24,
          maxWidth: 1360,
          margin: "0 auto",
        }}
      >
        <Column mode="current" tone="bad" label="現状 — 均一間隔（上下対称・構造が見えない）" />
        <Column mode="wide" tone="good" label="目指す（R2）— 上広め・下狭め（dyslexia 前提で余白ゆったり）" />
      </div>
    </div>
  ),
};

// 余白スケールの見比べ用。上>下の比は保ちつつ絶対値だけ段階的に詰める。
export const ScaleComparison: StoryObj = {
  name: "余白スケール比較（広め / 中間 / 詰め）",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, minHeight: "100vh" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 20,
          maxWidth: 1500,
          margin: "0 auto",
        }}
      >
        <Column mode="wide" tone="neutral" label="① 広め（今の実装 / 記事寄り）H2 上40・下12" />
        <Column mode="medium" tone="good" label="② 中間（推奨 / ノートらしい密度）H2 上32・下8" />
        <Column mode="tight" tone="neutral" label="③ 詰め（Notion 寄り / 密度優先）H2 上24・下4" />
      </div>
    </div>
  ),
};

export const WideOnly: StoryObj = {
  name: "広め（R2・現行実装）単独",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 40, minHeight: "100vh" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", background: "#fff", border: "1px solid var(--rule)", borderRadius: "var(--r-3, 10px)", padding: 40 }}>
        <Doc mode="wide" />
      </div>
    </div>
  ),
};
