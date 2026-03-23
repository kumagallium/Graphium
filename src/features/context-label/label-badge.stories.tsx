// ラベルバッジのストーリー
// デザイン議論用: 配置方式・サイズ・色のバリエーションを確認

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CORE_LABELS } from "./labels";

// ラベルの色定義（ui.tsx と同じ）
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

// ── バッジコンポーネント（単体表示用） ──
function LabelBadge({
  label,
  size = "default",
  onClick,
}: {
  label: string;
  size?: "small" | "default" | "large";
  onClick?: () => void;
}) {
  const color = getLabelColor(label);
  const sizeStyles = {
    small: { fontSize: 10, padding: "0px 4px" },
    default: { fontSize: 11, padding: "1px 6px" },
    large: { fontSize: 13, padding: "2px 8px" },
  };

  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        borderRadius: 4,
        fontWeight: 600,
        backgroundColor: color + "18",
        color: color,
        border: `1px solid ${color}38`,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        ...sizeStyles[size],
      }}
    >
      {label}
    </span>
  );
}

// ── ブロック内での配置シミュレーション ──
function BlockWithLabel({
  label,
  text,
  blockType = "heading",
  placement = "gutter",
}: {
  label: string;
  text: string;
  blockType?: "heading" | "paragraph" | "list";
  placement: "gutter" | "inline" | "above";
}) {
  const gutterWidth = 90;

  // ガター方式: ブロック左マージンにバッジ
  if (placement === "gutter") {
    return (
      <div style={{ position: "relative", paddingLeft: gutterWidth, minHeight: 32 }}>
        <div style={{ position: "absolute", left: 0, top: 2 }}>
          <LabelBadge label={label} />
        </div>
        <BlockContent type={blockType} text={text} />
      </div>
    );
  }

  // インライン方式: テキスト先頭にバッジ
  if (placement === "inline") {
    return (
      <div>
        <BlockContent type={blockType} text={text} badge={<LabelBadge label={label} />} />
      </div>
    );
  }

  // 上方配置: ブロック上部にバッジ
  return (
    <div>
      <div style={{ marginBottom: 2 }}>
        <LabelBadge label={label} size="small" />
      </div>
      <BlockContent type={blockType} text={text} />
    </div>
  );
}

function BlockContent({
  type,
  text,
  badge,
}: {
  type: "heading" | "paragraph" | "list";
  text: string;
  badge?: React.ReactNode;
}) {
  if (type === "heading") {
    return <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{badge}{text}</h3>;
  }
  if (type === "list") {
    return (
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        <li>{badge}{text}</li>
      </ul>
    );
  }
  return <p style={{ margin: 0 }}>{badge}{text}</p>;
}

// ── ストーリー定義 ──

const meta: Meta = {
  title: "ContextLabel/LabelBadge",
  parameters: {
    layout: "padded",
  },
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

// サイズバリエーション
export const Sizes: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <LabelBadge label="[手順]" size="small" />
      <LabelBadge label="[手順]" size="default" />
      <LabelBadge label="[手順]" size="large" />
    </div>
  ),
};

// 配置方式の比較（メインの議論ポイント）
export const PlacementComparison: StoryObj = {
  name: "配置方式の比較",
  render: () => (
    <div style={{ maxWidth: 700, fontFamily: "Inter, sans-serif" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#374151" }}>
        配置方式の比較
      </h2>

      {/* ガター方式 */}
      <section style={{ marginBottom: 32, padding: 16, border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          A. ガター方式（ブロックハンドル右側）
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <BlockWithLabel label="[手順]" text="2.1 切る" blockType="heading" placement="gutter" />
          <BlockWithLabel label="[使用したもの]" text="玉ねぎ 中 2個（400g）" blockType="paragraph" placement="gutter" />
          <BlockWithLabel label="[条件]" text="くし切り、縦半分に切る" blockType="paragraph" placement="gutter" />
        </div>
      </section>

      {/* インライン方式 */}
      <section style={{ marginBottom: 32, padding: 16, border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          B. インライン方式（テキスト先頭）
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <BlockWithLabel label="[手順]" text="2.1 切る" blockType="heading" placement="inline" />
          <BlockWithLabel label="[使用したもの]" text="玉ねぎ 中 2個（400g）" blockType="paragraph" placement="inline" />
          <BlockWithLabel label="[条件]" text="くし切り、縦半分に切る" blockType="paragraph" placement="inline" />
        </div>
      </section>

      {/* 上方配置 */}
      <section style={{ marginBottom: 32, padding: 16, border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>
          C. 上方配置（ブロック上部）
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <BlockWithLabel label="[手順]" text="2.1 切る" blockType="heading" placement="above" />
          <BlockWithLabel label="[使用したもの]" text="玉ねぎ 中 2個（400g）" blockType="paragraph" placement="above" />
          <BlockWithLabel label="[条件]" text="くし切り、縦半分に切る" blockType="paragraph" placement="above" />
        </div>
      </section>
    </div>
  ),
};

// 実際のノート風レイアウト
export const RealisticNote: StoryObj = {
  name: "実際のノート風",
  render: () => (
    <div style={{ maxWidth: 700, fontFamily: "Inter, sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>カレーの作り方</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 24 }}>
        作成日付: 2026-01-16 タグ: 料理、カレー
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <BlockWithLabel label="[手順]" text="2.1 切る" blockType="heading" placement="gutter" />
        <div style={{ paddingLeft: 90 }}>
          <BlockWithLabel label="[使用したもの]" text="玉ねぎ 中 2個（400g）" blockType="list" placement="gutter" />
          <BlockWithLabel label="[使用したもの]" text="じゃがいも 中 1個（230g）" blockType="list" placement="gutter" />
          <BlockWithLabel label="[使用したもの]" text="にんじん 中 1/2本（100g）" blockType="list" placement="gutter" />
        </div>
        <BlockWithLabel label="[条件]" text="くし切り、縦半分に切る" blockType="heading" placement="gutter" />
        <BlockWithLabel label="[手順]" text="2.2 炒める" blockType="heading" placement="gutter" />
        <BlockWithLabel label="[結果]" text="野菜に火が通り、しんなりする" blockType="paragraph" placement="gutter" />
      </div>
    </div>
  ),
};
