// ラベルドロップダウン UI のストーリー
// LabelDropdownPortal の見た目を静的に確認する
// ※ LabelSideMenuButton は label-badge.stories.tsx でカバー済み

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CORE_LABELS, FREE_LABEL_EXAMPLES } from "./labels";

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
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[属性]": "#c08b3e",
  "[結果]": "#c26356",
};
function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? tokens.mutedFg;
}

// ── 共通スタイル ──
const dropdownStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
  padding: "6px 0",
  minWidth: 200,
  maxHeight: "80vh",
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

const meta: Meta = { title: "Organisms/LabelDropdown", parameters: { layout: "padded" } };
export default meta;

// ドロップダウン（初期状態）
export const DefaultState: StoryObj = {
  name: "初期状態（ラベル未設定）",
  render: () => (
    <div style={dropdownStyle}>
      <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
      {CORE_LABELS.map((label) => {
        const color = getLabelColor(label);
        return (
          <button key={label} style={menuItemStyle}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6, flexShrink: 0 }} />
            {label}
          </button>
        );
      })}

      <div style={dividerStyle} />
      <div style={{ ...sectionHeaderStyle, color: "#5b8fb9" }}>前手順リンク（wasInformedBy）</div>
      <button style={{ ...menuItemStyle, color: "#5b8fb9", background: "#eaf1f5", borderRadius: 4, margin: "2px 6px", width: "calc(100% - 12px)" }}>
        <span style={{ marginRight: 4 }}>→</span>
        前の手順を選択してリンク
      </button>

      <div style={dividerStyle} />
      <div style={sectionHeaderStyle}>フリーラベル（例）</div>
      {FREE_LABEL_EXAMPLES.slice(0, 4).map((label) => (
        <button key={label} style={{ ...menuItemStyle, color: "#6b7280" }}>
          {label}
        </button>
      ))}

      <div style={dividerStyle} />
      <div style={{ padding: "4px 10px 6px" }}>
        <div style={sectionHeaderStyle}>カスタム</div>
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <input
            readOnly
            placeholder="[ラベル名]"
            style={{ flex: 1, fontSize: 12, padding: "3px 6px", border: "1px solid #d1d5db", borderRadius: 4, outline: "none" }}
          />
          <button style={{ padding: "3px 8px", fontSize: 12, background: "#5b8fb9", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            追加
          </button>
        </div>
      </div>
    </div>
  ),
};

// ドロップダウン（ラベル選択済み）
export const WithActiveLabel: StoryObj = {
  name: "ラベル選択済み（[手順]）",
  render: () => {
    const activeLabel = "[手順]";
    return (
      <div style={dropdownStyle}>
        <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
        {CORE_LABELS.map((label) => {
          const active = label === activeLabel;
          const color = getLabelColor(label);
          return (
            <button
              key={label}
              style={{
                ...menuItemStyle,
                background: active ? color + "15" : "none",
                color: active ? color : "#374151",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6, flexShrink: 0 }} />
              {label}
              {active && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
            </button>
          );
        })}

        <div style={dividerStyle} />
        <button style={{ ...menuItemStyle, color: "#c26356" }}>
          ラベルを外す
        </button>
      </div>
    );
  },
};

// 前手順リンク選択モード
export const PrevStepMode: StoryObj = {
  name: "前手順リンク選択",
  render: () => {
    const candidates = [
      { blockId: "h1", text: "1. 封入する", level: 2 },
      { blockId: "h2", text: "2. アニールする", level: 2 },
    ];
    return (
      <div style={dropdownStyle}>
        <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
        {CORE_LABELS.slice(0, 2).map((label) => {
          const color = getLabelColor(label);
          return (
            <button key={label} style={menuItemStyle}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6, flexShrink: 0 }} />
              {label}
            </button>
          );
        })}
        <div style={{ padding: "2px 10px", fontSize: 11, color: "#9ca3af" }}>…</div>

        <div style={dividerStyle} />
        <div style={{ padding: "4px 0", background: "#f0f9ff", borderTop: "1px solid #e0f2fe" }}>
          <div style={{ ...sectionHeaderStyle, color: "#5b8fb9" }}>リンク先の見出しを選択</div>
          {candidates.map((c) => (
            <button key={c.blockId} style={{ ...menuItemStyle, color: "#1e40af", fontSize: 12 }}>
              <span style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginRight: 4 }}>H{c.level}</span>
              {c.text}
            </button>
          ))}
          <button style={{ ...menuItemStyle, fontSize: 11, color: "#9ca3af" }}>← 戻る</button>
        </div>
      </div>
    );
  },
};

// インタラクティブデモ
export const InteractiveDemo: StoryObj = {
  name: "インタラクティブデモ",
  render: () => {
    function Demo() {
      const [activeLabel, setActiveLabel] = useState<string | null>(null);
      const [freeInput, setFreeInput] = useState("");

      const select = (label: string | null) => {
        setActiveLabel(activeLabel === label ? null : label);
      };

      return (
        <div style={{ fontFamily: tokens.font }}>
          <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12 }}>
            選択中: {activeLabel ? <span style={{ fontWeight: 600, color: getLabelColor(activeLabel) }}>{activeLabel}</span> : <span style={{ color: "#9ca3af" }}>なし</span>}
          </p>
          <div style={dropdownStyle}>
            <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
            {CORE_LABELS.map((label) => {
              const active = label === activeLabel;
              const color = getLabelColor(label);
              return (
                <button
                  key={label}
                  onClick={() => select(label)}
                  style={{
                    ...menuItemStyle,
                    background: active ? color + "15" : "none",
                    color: active ? color : "#374151",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6, flexShrink: 0 }} />
                  {label}
                  {active && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
                </button>
              );
            })}

            <div style={dividerStyle} />
            <div style={sectionHeaderStyle}>フリーラベル（例）</div>
            {FREE_LABEL_EXAMPLES.slice(0, 4).map((label) => {
              const active = label === activeLabel;
              return (
                <button key={label} onClick={() => select(label)} style={{ ...menuItemStyle, color: "#6b7280", fontWeight: active ? 600 : 400 }}>
                  {label}
                  {active && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
                </button>
              );
            })}

            <div style={dividerStyle} />
            <div style={{ padding: "4px 10px 6px" }}>
              <div style={sectionHeaderStyle}>カスタム</div>
              <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                <input
                  value={freeInput}
                  onChange={(e) => setFreeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && freeInput.trim()) { const v = freeInput.trim(); select(v.startsWith("[") ? v : `[${v}]`); setFreeInput(""); } }}
                  placeholder="[ラベル名]"
                  style={{ flex: 1, fontSize: 12, padding: "3px 6px", border: "1px solid #d1d5db", borderRadius: 4, outline: "none" }}
                />
                <button
                  onClick={() => { if (freeInput.trim()) { const v = freeInput.trim(); select(v.startsWith("[") ? v : `[${v}]`); setFreeInput(""); } }}
                  style={{ padding: "3px 8px", fontSize: 12, background: "#5b8fb9", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                >
                  追加
                </button>
              </div>
            </div>

            {activeLabel && (
              <>
                <div style={dividerStyle} />
                <button onClick={() => setActiveLabel(null)} style={{ ...menuItemStyle, color: "#c26356" }}>
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
