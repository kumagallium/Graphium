// ProvIndicator ストーリー
// 右側インジケータ + 統合パネルの見た目を静的に確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CORE_LABELS, FREE_LABEL_EXAMPLES } from "./labels";
import type { LinkType } from "../block-link/link-types";
import { LINK_TYPE_CONFIG, CREATED_BY_LABELS } from "../block-link/link-types";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
};

// ラベル色
const LABEL_COLORS: Record<string, string> = {
  "procedure": "#5b8fb9",
  "material": "#4B7A52",
  "attribute": "#c08b3e",
  "result": "#c26356",
};
function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? tokens.mutedFg;
}

// ── 共通スタイル ──
const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
  padding: "6px 0",
  minWidth: 240,
  maxHeight: "70vh",
  overflowY: "auto",
  fontFamily: tokens.font,
};
const sectionHeaderStyle: React.CSSProperties = {
  padding: "2px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "#9ca3af",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};
const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  padding: "5px 12px",
  fontSize: 13,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#374151",
};
const dividerStyle: React.CSSProperties = {
  borderTop: "1px solid #f3f4f6",
  margin: "4px 0",
};

// ── ラベルバッジ ──
function LabelBadge({ label }: { label: string }) {
  const color = getLabelColor(label);
  return (
    <span style={{
      display: "inline-block", padding: "0px 6px", borderRadius: 9999,
      fontSize: 11, fontWeight: 600,
      backgroundColor: color + "18", color: color,
      border: `1px solid ${color}38`,
      cursor: "pointer", userSelect: "none", lineHeight: 1.6, whiteSpace: "nowrap",
      fontFamily: tokens.font,
    }}>
      {label}
    </span>
  );
}

// ── エディタ模擬ブロック（右側にインジケータ表示） ──
const CONTENT_LEFT = 120;

function EditorBlock({ label, children, indent = 0 }: {
  label?: string; children: React.ReactNode; indent?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", minHeight: 28 }}>
      {/* 左: SideMenu（簡素化） */}
      <div style={{ width: CONTENT_LEFT, flexShrink: 0, display: "flex", justifyContent: "flex-end", paddingTop: 2, paddingRight: 4, visibility: "hidden" }}>
        <div style={{ display: "flex", gap: 2 }}>
          <span style={{ fontSize: 16, color: tokens.mutedFg }}>+</span>
          <span style={{ fontSize: 10, color: tokens.mutedFg, letterSpacing: 1, cursor: "grab" }}>⠿</span>
        </div>
      </div>
      {/* 中央: コンテンツ */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: indent }}>{children}</div>
      {/* 右: ラベルバッジ */}
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
const meta: Meta = { title: "Organisms/ProvIndicator", parameters: { layout: "padded" } };
export default meta;

// ラベルバッジ一覧
export const AllIndicators: StoryObj = {
  name: "ラベルバッジ一覧",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: tokens.font }}>
      {CORE_LABELS.map((l) => (
        <div key={l}>
          <span style={{ fontSize: 12, color: tokens.mutedFg, width: 120, display: "inline-block" }}>{l}:</span>
          <LabelBadge label={l} />
        </div>
      ))}
    </div>
  ),
};

// ノート風レイアウト（右側にインジケータ表示）
export const NoteWithIndicators: StoryObj = {
  name: "ノート風（右側インジケータ）",
  render: () => (
    <div style={{ maxWidth: 900, fontFamily: tokens.font, color: tokens.fg, background: tokens.bg, padding: 24, borderRadius: 12 }}>
      <EditorBlock><h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3 }}>Cu粉末アニール実験</h1></EditorBlock>

      <EditorBlock label="procedure"><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>1. 封入する</h2></EditorBlock>
      <EditorBlock label="material" indent={24}><p>Cu粉末 1g</p></EditorBlock>
      <EditorBlock label="material" indent={24}><p>シリカ管</p></EditorBlock>
      <EditorBlock indent={24}><p style={{ color: tokens.mutedFg }}>真空封入管内で封入する。（ラベルなし）</p></EditorBlock>
      <EditorBlock label="result" indent={24}><p>封入されたCu粉末</p></EditorBlock>

      <EditorBlock label="procedure"><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>2. アニールする</h2></EditorBlock>
      <EditorBlock label="attribute" indent={24}><p>温度: 600℃</p></EditorBlock>
      <EditorBlock label="attribute" indent={24}><p>昇温速度: 5℃/min</p></EditorBlock>
      <EditorBlock label="attribute" indent={24}><p>冷却: 炉冷</p></EditorBlock>

      <EditorBlock label="procedure"><h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>3. 評価する</h2></EditorBlock>
      <EditorBlock label="result" indent={24}><p>XRD測定により相同定を行う。</p></EditorBlock>
    </div>
  ),
};

// 統合パネル（ラベルあり + リンクあり）
export const PanelWithLabelAndLinks: StoryObj = {
  name: "統合パネル（ラベル + リンク）",
  render: () => {
    const label = "procedure";
    const color = getLabelColor(label);
    const links = [
      { id: "l1", type: "informed_by" as LinkType, target: "1. 封入する", createdBy: "human" as const, direction: "out" },
      { id: "l2", type: "informed_by" as LinkType, target: "3. 評価する", createdBy: "ai" as const, direction: "in" },
    ];

    return (
      <div style={panelStyle}>
        {/* 現在のラベル */}
        <div style={{ padding: "6px 12px 4px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            display: "inline-block", padding: "0px 6px", borderRadius: 9999,
            fontSize: 11, fontWeight: 600, backgroundColor: color + "18",
            color, border: `1px solid ${color}38`, lineHeight: 1.6,
          }}>
            {label}
          </span>
          <button style={{ marginLeft: "auto", fontSize: 10, color: "#5b8fb9", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            変更
          </button>
        </div>

        {/* リンク一覧 */}
        <div style={dividerStyle} />
        <div style={sectionHeaderStyle}>→ 出力リンク</div>
        {links.filter(l => l.direction === "out").map((link) => {
          const conf = LINK_TYPE_CONFIG[link.type];
          return (
            <div key={link.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: conf.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: conf.color, fontWeight: 600, minWidth: 40 }}>{conf.label}</span>
              <span style={{ flex: 1, color: "#374151", fontSize: 12 }}>{link.target}</span>
              <span style={{ fontSize: 9, color: "#9ca3af" }}>{CREATED_BY_LABELS[link.createdBy]}</span>
              <span style={{ color: "#9ca3af", fontSize: 11, cursor: "pointer" }}>×</span>
            </div>
          );
        })}

        <div style={dividerStyle} />
        <div style={sectionHeaderStyle}>← 入力リンク</div>
        {links.filter(l => l.direction === "in").map((link) => {
          const conf = LINK_TYPE_CONFIG[link.type];
          return (
            <div key={link.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: conf.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: conf.color, fontWeight: 600, minWidth: 40 }}>{conf.label}</span>
              <span style={{ flex: 1, color: "#374151", fontSize: 12 }}>{link.target}</span>
              <span style={{ fontSize: 9, color: "#9ca3af" }}>{CREATED_BY_LABELS[link.createdBy]}</span>
              <span style={{ color: "#9ca3af", fontSize: 11, cursor: "pointer" }}>×</span>
            </div>
          );
        })}

        {/* 前手順リンク追加（procedure ラベルのみ表示） */}
        <div style={dividerStyle} />
        <div style={{ ...sectionHeaderStyle, color: "#5b8fb9" }}>前手順リンク（wasInformedBy）</div>
        <button style={{ ...menuItemStyle, color: "#5b8fb9", background: "#eff6ff", borderRadius: 4, margin: "2px 6px", width: "calc(100% - 12px)" }}>
          <span style={{ marginRight: 4 }}>→</span>前の手順を選択してリンク
        </button>
      </div>
    );
  },
};

// 統合パネル（procedure 以外 — 前手順リンクなし）
export const PanelWithoutPrevStep: StoryObj = {
  name: "統合パネル（material — 前手順リンクなし）",
  render: () => {
    const label = "material";
    const color = getLabelColor(label);

    return (
      <div style={panelStyle}>
        <div style={{ padding: "6px 12px 4px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            display: "inline-block", padding: "0px 6px", borderRadius: 9999,
            fontSize: 11, fontWeight: 600, backgroundColor: color + "18",
            color, border: `1px solid ${color}38`, lineHeight: 1.6,
          }}>
            {label}
          </span>
          <button style={{ marginLeft: "auto", fontSize: 10, color: "#5b8fb9", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            変更
          </button>
        </div>
        <p style={{ padding: "6px 12px", fontSize: 11, color: tokens.mutedFg }}>
          前手順リンクセクションは procedure ラベルのみに表示されます。
        </p>
      </div>
    );
  },
};

// 統合パネル（ラベル変更展開）
export const PanelLabelPicker: StoryObj = {
  name: "統合パネル（ラベル変更）",
  render: () => {
    function Demo() {
      const [label, setLabel] = useState<string | null>("procedure");
      const color = label ? getLabelColor(label) : "#9ca3af";

      return (
        <div style={panelStyle}>
          {/* 現在のラベル */}
          <div style={{ padding: "6px 12px 4px", display: "flex", alignItems: "center", gap: 6 }}>
            {label ? (
              <span style={{
                display: "inline-block", padding: "0px 6px", borderRadius: 9999,
                fontSize: 11, fontWeight: 600, backgroundColor: color + "18",
                color, border: `1px solid ${color}38`, lineHeight: 1.6,
              }}>
                {label}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#9ca3af" }}>ラベルなし</span>
            )}
          </div>

          {/* ラベル選択 */}
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 4 }}>
            <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
            {CORE_LABELS.map((l) => {
              const active = label === l;
              const c = getLabelColor(l);
              return (
                <button key={l} onClick={() => setLabel(active ? null : l)} style={{
                  ...menuItemStyle,
                  background: active ? c + "15" : "none",
                  color: active ? c : "#374151",
                  fontWeight: active ? 600 : 400,
                }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c, marginRight: 6, flexShrink: 0 }} />
                  {l}
                  {active && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
                </button>
              );
            })}

            <div style={dividerStyle} />
            <div style={sectionHeaderStyle}>フリーラベル（例）</div>
            {FREE_LABEL_EXAMPLES.slice(0, 4).map((l) => (
              <button key={l} onClick={() => setLabel(l)} style={{ ...menuItemStyle, color: "#6b7280" }}>
                {l}
              </button>
            ))}

            {label && (
              <>
                <div style={dividerStyle} />
                <button onClick={() => setLabel(null)} style={{ ...menuItemStyle, color: "#c26356" }}>
                  ラベルを外す
                </button>
              </>
            )}
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};
