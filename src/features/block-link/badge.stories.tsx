// リンクバッジ UI のストーリー
// LinkBadgeLayer / LinkDetailPanel の見た目を静的に確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Link } from "lucide-react";
import { LINK_TYPE_CONFIG, CREATED_BY_LABELS, type LinkType, type CreatedBy } from "./link-types";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
};

// ── モックリンクデータ ──
type MockLink = {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  type: LinkType;
  createdBy: CreatedBy;
  targetLabel: string;
  sourceLabel: string;
};

const mockLinks: MockLink[] = [
  { id: "l1", sourceBlockId: "b1", targetBlockId: "b2", type: "informed_by", createdBy: "human", targetLabel: "1. 封入する", sourceLabel: "2. アニールする" },
  { id: "l2", sourceBlockId: "b1", targetBlockId: "b3", type: "used", createdBy: "system", targetLabel: "Cu粉末 1g", sourceLabel: "2. アニールする" },
  { id: "l3", sourceBlockId: "b4", targetBlockId: "b1", type: "generated", createdBy: "ai", targetLabel: "2. アニールする", sourceLabel: "XRD測定結果" },
];

// ── リンクバッジ ──
function LinkBadge({ count, onClick }: { count: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`${count} リンク`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: "1px 5px",
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        background: "#eaf1f5",
        color: "#5b8fb9",
        border: "1px solid #bfdbfe",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: tokens.font,
      }}
    >
      <Link size={10} strokeWidth={2.5} /> {count}
    </button>
  );
}

// ── リンク行 ──
function LinkRow({ link, label, onRemove }: { link: MockLink; label: string; onRemove?: () => void }) {
  const conf = LINK_TYPE_CONFIG[link.type];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", fontSize: 12, fontFamily: tokens.font }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: conf.color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: conf.color, fontWeight: 600, minWidth: 40 }}>{conf.label}</span>
      <span style={{ flex: 1, color: "#374151", cursor: "pointer" }} title="クリックで移動">{label}</span>
      <span style={{ fontSize: 9, color: "#9ca3af" }}>{CREATED_BY_LABELS[link.createdBy]}</span>
      <button onClick={onRemove} title="リンクを削除" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 11, padding: "0 2px" }}>×</button>
    </div>
  );
}

// ── 詳細パネル ──
function LinkDetailPanel({ outgoing, incoming }: { outgoing: MockLink[]; incoming: MockLink[] }) {
  const sectionStyle: React.CSSProperties = { padding: "2px 10px", fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em" };
  const divStyle: React.CSSProperties = { borderTop: "1px solid #f3f4f6", margin: "4px 0" };

  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
      boxShadow: "0 4px 20px rgba(0,0,0,0.14)", padding: "6px 0", minWidth: 240, maxHeight: 300, overflowY: "auto",
    }}>
      {outgoing.length > 0 && (
        <>
          <div style={sectionStyle}>→ 出力リンク</div>
          {outgoing.map((l) => <LinkRow key={l.id} link={l} label={l.targetLabel} />)}
        </>
      )}
      {incoming.length > 0 && (
        <>
          {outgoing.length > 0 && <div style={divStyle} />}
          <div style={sectionStyle}>← 入力リンク</div>
          {incoming.map((l) => <LinkRow key={l.id} link={l} label={l.sourceLabel} />)}
        </>
      )}
    </div>
  );
}

// ── Meta ──
const meta: Meta = { title: "Organisms/LinkBadge", parameters: { layout: "padded" } };
export default meta;

// リンクタイプ一覧
export const LinkTypes: StoryObj = {
  name: "リンクタイプ一覧",
  render: () => (
    <div style={{ fontFamily: tokens.font, display: "flex", flexDirection: "column", gap: 8 }}>
      {(Object.entries(LINK_TYPE_CONFIG) as [LinkType, typeof LINK_TYPE_CONFIG[LinkType]][]).map(([type, conf]) => (
        <div key={type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: conf.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: conf.color, minWidth: 60 }}>{conf.label}</span>
          <span style={{ fontSize: 12, color: tokens.mutedFg }}>{conf.provDM}</span>
          <code style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto", fontFamily: "ui-monospace, monospace" }}>{type}</code>
        </div>
      ))}
    </div>
  ),
};

// バッジバリエーション
export const BadgeVariants: StoryObj = {
  name: "バッジバリエーション",
  render: () => (
    <div style={{ fontFamily: tokens.font, display: "flex", gap: 12, alignItems: "center" }}>
      <div><span style={{ fontSize: 11, color: tokens.mutedFg, display: "block", marginBottom: 4 }}>1リンク</span><LinkBadge count={1} /></div>
      <div><span style={{ fontSize: 11, color: tokens.mutedFg, display: "block", marginBottom: 4 }}>3リンク</span><LinkBadge count={3} /></div>
      <div><span style={{ fontSize: 11, color: tokens.mutedFg, display: "block", marginBottom: 4 }}>10リンク</span><LinkBadge count={10} /></div>
    </div>
  ),
};

// 詳細パネル（出力リンクのみ）
export const DetailPanelOutgoing: StoryObj = {
  name: "詳細パネル（出力リンク）",
  render: () => (
    <div style={{ fontFamily: tokens.font }}>
      <LinkDetailPanel outgoing={mockLinks.slice(0, 2)} incoming={[]} />
    </div>
  ),
};

// 詳細パネル（入力リンクのみ）
export const DetailPanelIncoming: StoryObj = {
  name: "詳細パネル（入力リンク）",
  render: () => (
    <div style={{ fontFamily: tokens.font }}>
      <LinkDetailPanel outgoing={[]} incoming={[mockLinks[2]]} />
    </div>
  ),
};

// 詳細パネル（入出力混在）
export const DetailPanelMixed: StoryObj = {
  name: "詳細パネル（入出力混在）",
  render: () => (
    <div style={{ fontFamily: tokens.font }}>
      <LinkDetailPanel outgoing={mockLinks.slice(0, 2)} incoming={[mockLinks[2]]} />
    </div>
  ),
};

// ノート風表示（バッジ + 展開デモ）
export const NoteDemo: StoryObj = {
  name: "ノート風（展開デモ）",
  render: () => {
    function Demo() {
      const [expanded, setExpanded] = useState<string | null>(null);
      const blocks = [
        { id: "b1", text: "2. アニールする", heading: true, linkCount: 3 },
        { id: "b2", text: "1. 封入する", heading: true, linkCount: 1 },
        { id: "b3", text: "Cu粉末 1g", heading: false, linkCount: 1 },
      ];

      return (
        <div style={{ maxWidth: 700, fontFamily: tokens.font, color: tokens.fg, background: tokens.bg, padding: 24, borderRadius: 12 }}>
          <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 12, background: tokens.muted, padding: "8px 12px", borderRadius: 8, border: `1px solid ${tokens.border}` }}>
            バッジクリックで詳細パネルを展開/閉じる
          </p>
          {blocks.map((block) => (
            <div key={block.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                {block.heading
                  ? <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{block.text}</h3>
                  : <p style={{ margin: 0, paddingLeft: 24 }}>{block.text}</p>
                }
              </div>
              <div style={{ position: "relative" }}>
                <LinkBadge count={block.linkCount} onClick={() => setExpanded(expanded === block.id ? null : block.id)} />
                {expanded === block.id && (
                  <div style={{ position: "absolute", top: 20, right: 0, zIndex: 10 }}>
                    <LinkDetailPanel
                      outgoing={mockLinks.filter((l) => l.sourceBlockId === block.id)}
                      incoming={mockLinks.filter((l) => l.targetBlockId === block.id)}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return <Demo />;
  },
};
