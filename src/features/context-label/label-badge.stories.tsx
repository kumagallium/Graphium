// ラベルバッジのストーリー
// A方式（ガター）: ブロックハンドルの右側にラベルバッジを配置

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
  size = "default",
  onClick,
}: {
  label: string;
  size?: "small" | "default";
  onClick?: () => void;
}) {
  const color = getLabelColor(label);
  const s = size === "small"
    ? { fontSize: 10, padding: "0px 4px" }
    : { fontSize: 11, padding: "1px 6px" };

  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 4,
        fontWeight: 600,
        backgroundColor: color + "18",
        color: color,
        border: `1px solid ${color}38`,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        ...s,
      }}
    >
      {label}
    </span>
  );
}

// ── ブロックハンドル（BlockNote SideMenu 模擬） ──
// ホバーで表示される: # ラベルボタン | + 追加 | ⠿ ドラッグ
function BlockHandle({
  hasLabel,
  onLabelClick,
}: {
  hasLabel: boolean;
  onLabelClick?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        opacity: 0.4,
      }}
    >
      {/* ラベルボタン（ラベル未設定時のみ表示） */}
      {!hasLabel && (
        <button
          onClick={onLabelClick}
          title="ラベルを付ける"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 4,
            border: "1px dashed #d1d5db",
            background: "none",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: 12,
          }}
        >
          #
        </button>
      )}
      {/* 追加ボタン */}
      <button
        style={{
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
          fontSize: 16,
        }}
      >
        +
      </button>
      {/* ドラッグハンドル */}
      <button
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 4,
          border: "none",
          background: "none",
          cursor: "grab",
          color: "#9ca3af",
          fontSize: 10,
          letterSpacing: 1,
        }}
      >
        ⠿
      </button>
    </div>
  );
}

// ── A方式ブロック: ハンドル | ガター（ラベル） | コンテンツ ──
const GUTTER_WIDTH = 90;
const HANDLE_WIDTH = 70;

function GutterBlock({
  label,
  children,
  showHandle = true,
  indent = 0,
}: {
  label?: string;
  children: React.ReactNode;
  showHandle?: boolean;
  indent?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        minHeight: 28,
        paddingLeft: indent,
      }}
    >
      {/* ブロックハンドル領域 */}
      <div style={{ width: HANDLE_WIDTH, flexShrink: 0, paddingTop: 2 }}>
        {showHandle && <BlockHandle hasLabel={!!label} />}
      </div>
      {/* ガター: ラベルバッジ */}
      <div style={{ width: GUTTER_WIDTH, flexShrink: 0, paddingTop: 3 }}>
        {label && <LabelBadge label={label} size="small" />}
      </div>
      {/* コンテンツ */}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// テーブルスタイル
const thStyle: React.CSSProperties = {
  padding: "6px 12px",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: "2px solid #d1d5db",
  color: "#374151",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  borderBottom: "1px solid #e5e7eb",
  color: "#374151",
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

// A方式: ブロックハンドル + ガターラベル — 基本
export const GutterNote: StoryObj = {
  name: "A方式: ノート風（基本）",
  render: () => (
    <div style={{ maxWidth: 800, fontFamily: "Inter, sans-serif" }}>
      <div style={{ marginLeft: HANDLE_WIDTH + GUTTER_WIDTH }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>カレーの作り方</h1>
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20 }}>
          作成日付: 2026-01-16&nbsp;&nbsp;タグ: 料理、カレー&nbsp;&nbsp;作成者: 熊谷 将也
        </p>
      </div>

      <GutterBlock>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>1. 目的</h2>
      </GutterBlock>
      <GutterBlock>
        <p>当日に食べたカレーと1晩寝かしたカレーがどちらのほうが美味しいか</p>
      </GutterBlock>

      <GutterBlock>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>2. 作り方</h2>
      </GutterBlock>

      <GutterBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>2.1 切る</h3>
      </GutterBlock>
      <GutterBlock label="[使用したもの]" indent={16}>
        <p>玉ねぎ 中 2個（400g）</p>
      </GutterBlock>
      <GutterBlock label="[使用したもの]" indent={16}>
        <p>じゃがいも 中 1・1/2個（230g）</p>
      </GutterBlock>
      <GutterBlock label="[使用したもの]" indent={16}>
        <p>にんじん 中 1/2本（100g）</p>
      </GutterBlock>
      <GutterBlock label="[条件]" indent={16}>
        <p>くし切り、6〜8等分、乱切り</p>
      </GutterBlock>

      <GutterBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>2.2 炒める</h3>
      </GutterBlock>
      <GutterBlock label="[条件]" indent={16}>
        <p>サラダ油を熱し、玉ねぎを中火で炒める。しんなりしたら肉を加える。</p>
      </GutterBlock>

      <GutterBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>2.3 煮込む</h3>
      </GutterBlock>
      <GutterBlock label="[条件]" indent={16}>
        <p>水850mlを加え、弱火〜中火で約20分煮込む。</p>
      </GutterBlock>
      <GutterBlock label="[結果]" indent={16}>
        <p>じゃがいもに竹串がスッと通れば完成。</p>
      </GutterBlock>
    </div>
  ),
};

// A方式: テーブル（試料）+ 箇条書き
export const GutterWithTable: StoryObj = {
  name: "A方式: テーブル（試料）パターン",
  render: () => (
    <div style={{ maxWidth: 800, fontFamily: "Inter, sans-serif" }}>
      <div style={{ marginLeft: HANDLE_WIDTH + GUTTER_WIDTH }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Cu粉末アニール実験</h1>
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20 }}>
          作成日付: 2026-03-20&nbsp;&nbsp;作成者: 熊谷 将也
        </p>
      </div>

      {/* 手順 1 */}
      <GutterBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>1. 封入する</h3>
      </GutterBlock>
      <GutterBlock label="[使用したもの]" indent={16}>
        <p>Cu粉末 1g</p>
      </GutterBlock>
      <GutterBlock label="[使用したもの]" indent={16}>
        <p>シリカ管</p>
      </GutterBlock>
      <GutterBlock label="[結果]" indent={16}>
        <p>封入されたCu粉末</p>
      </GutterBlock>

      {/* 手順 2 */}
      <GutterBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>2. アニールする</h3>
      </GutterBlock>
      <GutterBlock label="[試料]" indent={16}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr><th style={thStyle}>試料名</th><th style={thStyle}>温度</th><th style={thStyle}>時間</th></tr>
          </thead>
          <tbody>
            <tr><td style={tdStyle}>sample_A</td><td style={tdStyle}>600℃</td><td style={tdStyle}>24h</td></tr>
            <tr><td style={tdStyle}>sample_B</td><td style={tdStyle}>700℃</td><td style={tdStyle}>24h</td></tr>
            <tr><td style={tdStyle}>sample_C</td><td style={tdStyle}>800℃</td><td style={tdStyle}>24h</td></tr>
          </tbody>
        </table>
      </GutterBlock>
      <GutterBlock label="[条件]" indent={16}>
        <p>昇温速度: 5℃/min</p>
      </GutterBlock>
      <GutterBlock label="[条件]" indent={16}>
        <p>冷却: 炉冷</p>
      </GutterBlock>

      {/* 手順 3 */}
      <GutterBlock label="[手順]">
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>3. 評価する</h3>
      </GutterBlock>
      <GutterBlock label="[結果]" indent={16}>
        <p>XRD測定により相同定を行う。</p>
      </GutterBlock>
    </div>
  ),
};

// A方式: ホバー操作のシミュレーション
export const GutterHoverDemo: StoryObj = {
  name: "A方式: ホバー操作デモ",
  render: () => {
    function Demo() {
      const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);

      const blocks = [
        { id: "s1", label: "[手順]", content: <h3 style={{ fontSize: 18, fontWeight: 600 }}>1. 封入する</h3> },
        { id: "u1", label: "[使用したもの]", content: <p>Cu粉末 1g</p>, indent: 16 },
        { id: "u2", label: "[使用したもの]", content: <p>シリカ管</p>, indent: 16 },
        { id: "c1", label: undefined, content: <p>真空封入管内で封入する。</p>, indent: 16 },
        { id: "r1", label: "[結果]", content: <p>封入されたCu粉末</p>, indent: 16 },
      ];

      return (
        <div style={{ maxWidth: 800, fontFamily: "Inter, sans-serif" }}>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16, background: "#f3f4f6", padding: "8px 12px", borderRadius: 6 }}>
            各ブロックにホバーするとブロックハンドルが表示されます。<br />
            ラベル未設定のブロックには # ボタンが表示されます（4行目）。
          </p>
          {blocks.map((b) => (
            <div
              key={b.id}
              onMouseEnter={() => setHoveredBlock(b.id)}
              onMouseLeave={() => setHoveredBlock(null)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                minHeight: 28,
                paddingLeft: b.indent ?? 0,
                borderRadius: 4,
                background: hoveredBlock === b.id ? "#f9fafb" : "transparent",
                transition: "background 0.1s",
              }}
            >
              {/* ハンドル: ホバー時のみ表示 */}
              <div style={{ width: HANDLE_WIDTH, flexShrink: 0, paddingTop: 2, visibility: hoveredBlock === b.id ? "visible" : "hidden" }}>
                <BlockHandle hasLabel={!!b.label} />
              </div>
              {/* ガター */}
              <div style={{ width: GUTTER_WIDTH, flexShrink: 0, paddingTop: 3 }}>
                {b.label && <LabelBadge label={b.label} size="small" />}
              </div>
              {/* コンテンツ */}
              <div style={{ flex: 1, minWidth: 0 }}>{b.content}</div>
            </div>
          ))}
        </div>
      );
    }
    return <Demo />;
  },
};
