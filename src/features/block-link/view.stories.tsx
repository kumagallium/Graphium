// リンク追加ドロップダウンのストーリー
// PrevStepLinkDropdown / AddLinkDropdown の見た目を静的に確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LINK_TYPE_CONFIG, type LinkType } from "./link-types";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
};

// ── モック見出し候補 ──
const mockCandidates = [
  { blockId: "h1", text: "1. 封入する", level: 2 },
  { blockId: "h2", text: "2. アニールする", level: 2 },
  { blockId: "h3", text: "3. 評価する", level: 2 },
  { blockId: "h4", text: "Cu粉末アニール実験", level: 1 },
];

// ── 共通ドロップダウンスタイル ──
const dropdownStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
  padding: "6px 0",
  minWidth: 260,
  maxHeight: 320,
  overflowY: "auto",
  fontFamily: tokens.font,
};
const sectionStyle: React.CSSProperties = {
  padding: "4px 10px 6px",
  fontSize: 10,
  fontWeight: 700,
  color: "#9ca3af",
  letterSpacing: "0.05em",
};
const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  textAlign: "left",
  padding: "5px 12px",
  fontSize: 13,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#374151",
};

const meta: Meta = { title: "Organisms/LinkDropdown", parameters: { layout: "padded" } };
export default meta;

// 前手順リンク選択
export const PrevStepLink: StoryObj = {
  name: "前手順リンク選択",
  render: () => {
    function Demo() {
      const [selected, setSelected] = useState<string | null>(null);
      const linkedIds = new Set(["h1"]); // h1 は既にリンク済み

      return (
        <div style={{ fontFamily: tokens.font }}>
          <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12 }}>
            「前手順: @」リンク先を選択するドロップダウン（h1 はリンク済み表示）
          </p>
          <div style={dropdownStyle}>
            <div style={sectionStyle}>前手順: @ リンク先を選択</div>
            <div style={{ padding: "2px 10px 6px" }}>
              <input
                value=""
                readOnly
                placeholder="見出しを検索..."
                style={{
                  width: "100%", fontSize: 12, padding: "4px 6px",
                  border: "1px solid #d1d5db", borderRadius: 4, outline: "none",
                }}
              />
            </div>
            {mockCandidates.map((c) => {
              const isLinked = linkedIds.has(c.blockId);
              const isSelected = selected === c.blockId;
              return (
                <button
                  key={c.blockId}
                  onClick={() => !isLinked && setSelected(c.blockId)}
                  disabled={isLinked}
                  style={{
                    ...menuItemStyle,
                    background: isSelected ? "#eaf1f5" : isLinked ? "#f3f4f6" : "none",
                    color: isLinked ? "#9ca3af" : "#374151",
                    cursor: isLinked ? "default" : "pointer",
                  }}
                >
                  <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, minWidth: 20 }}>H{c.level}</span>
                  <span style={{ flex: 1 }}>{c.text}</span>
                  {isLinked && <span style={{ fontSize: 10 }}>リンク済</span>}
                  {isSelected && <span style={{ fontSize: 10, color: "#5b8fb9" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};

// リンクタイプ選択
export const LinkTypeSelect: StoryObj = {
  name: "リンクタイプ選択",
  render: () => (
    <div style={{ fontFamily: tokens.font }}>
      <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12 }}>
        汎用リンク追加: まずリンクタイプを選択
      </p>
      <div style={dropdownStyle}>
        <div style={sectionStyle}>リンクタイプを選択</div>
        {(Object.entries(LINK_TYPE_CONFIG) as [LinkType, typeof LINK_TYPE_CONFIG[LinkType]][]).map(([type, conf]) => (
          <button key={type} style={menuItemStyle}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: conf.color, flexShrink: 0 }} />
            {conf.label}
            <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto" }}>{conf.provDM}</span>
          </button>
        ))}
      </div>
    </div>
  ),
};

// ターゲット選択
export const TargetSelect: StoryObj = {
  name: "ターゲット選択",
  render: () => (
    <div style={{ fontFamily: tokens.font }}>
      <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12 }}>
        リンクタイプ「前手順」選択後 → ターゲット見出しを選択
      </p>
      <div style={dropdownStyle}>
        <div style={sectionStyle}>
          {LINK_TYPE_CONFIG.informed_by.label} のターゲットを選択
        </div>
        <button style={{ padding: "3px 12px", fontSize: 11, color: "#5b8fb9", background: "none", border: "none", cursor: "pointer" }}>
          ← タイプ選択に戻る
        </button>
        {mockCandidates.map((c) => (
          <button key={c.blockId} style={menuItemStyle}>
            <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, minWidth: 20 }}>H{c.level}</span>
            {c.text}
          </button>
        ))}
      </div>
    </div>
  ),
};

// フルフロー（インタラクティブ）
export const FullFlow: StoryObj = {
  name: "フルフロー（インタラクティブ）",
  render: () => {
    function Demo() {
      const [selectedType, setSelectedType] = useState<LinkType | null>(null);
      const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

      return (
        <div style={{ fontFamily: tokens.font }}>
          <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12 }}>
            タイプ選択 → ターゲット選択の2ステップフロー
            {selectedTarget && <span style={{ color: "#4B7A52", marginLeft: 8 }}>✓ リンク作成完了</span>}
          </p>
          <div style={dropdownStyle}>
            {!selectedType ? (
              <>
                <div style={sectionStyle}>リンクタイプを選択</div>
                {(Object.entries(LINK_TYPE_CONFIG) as [LinkType, typeof LINK_TYPE_CONFIG[LinkType]][]).map(([type, conf]) => (
                  <button key={type} onClick={() => { setSelectedType(type); setSelectedTarget(null); }} style={menuItemStyle}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: conf.color, flexShrink: 0 }} />
                    {conf.label}
                    <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto" }}>{conf.provDM}</span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <div style={sectionStyle}>{LINK_TYPE_CONFIG[selectedType].label} のターゲットを選択</div>
                <button onClick={() => setSelectedType(null)} style={{ padding: "3px 12px", fontSize: 11, color: "#5b8fb9", background: "none", border: "none", cursor: "pointer" }}>
                  ← タイプ選択に戻る
                </button>
                {mockCandidates.map((c) => (
                  <button
                    key={c.blockId}
                    onClick={() => setSelectedTarget(c.blockId)}
                    style={{
                      ...menuItemStyle,
                      background: selectedTarget === c.blockId ? "#eaf1f5" : "none",
                    }}
                  >
                    <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, minWidth: 20 }}>H{c.level}</span>
                    {c.text}
                    {selectedTarget === c.blockId && <span style={{ fontSize: 10, color: "#5b8fb9", marginLeft: "auto" }}>✓</span>}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};
