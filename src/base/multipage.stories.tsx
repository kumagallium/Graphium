// MultiPageLayout のストーリー
// タブ式マルチページレイアウトの各状態を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { Page } from "./multipage";

// ── Crucible デザイントークン ──
const tokens = {
  bg: "#fafdf7",
  fg: "#1a2e1d",
  border: "#d5e0d7",
  muted: "#f0f5ef",
  mutedFg: "#6b7f6e",
  font: "'Inter', system-ui, sans-serif",
};

// ── タブバー再現（MultiPageLayout の TabBar を静的に再現） ──
function TabBarMock({ pages, activeId, onSelect, onRemove, onAdd }: {
  pages: Page[];
  activeId: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 2,
      padding: "6px 12px 0", borderBottom: "1px solid #e5e7eb",
      background: "#f9fafb", flexWrap: "wrap", fontFamily: tokens.font,
    }}>
      {pages.map((page) => {
        const isActive = page.id === activeId;
        return (
          <div key={page.id} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: "6px 6px 0 0",
            border: "1px solid", borderBottom: isActive ? "1px solid #fff" : "1px solid transparent",
            borderColor: isActive ? "#e5e7eb" : "transparent",
            background: isActive ? "#fff" : "transparent",
            cursor: "pointer", fontSize: 12,
            fontWeight: isActive ? 600 : 400,
            color: isActive ? "#374151" : "#6b7280",
            marginBottom: isActive ? -1 : 0, userSelect: "none",
          }}>
            {page.derivedFromPageId && (
              <span title={`${page.derivedFromPageId} から派生`} style={{ width: 6, height: 6, borderRadius: "50%", background: "#4B7A52", flexShrink: 0 }} />
            )}
            <button onClick={() => onSelect(page.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "inherit", fontWeight: "inherit", color: "inherit" }}>
              {page.title}
            </button>
            {pages.length > 1 && (
              <button onClick={() => onRemove(page.id)} title="ページを削除" style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 11, color: "#9ca3af", lineHeight: 1 }}>×</button>
            )}
          </div>
        );
      })}
      <button onClick={onAdd} title="新しいページを追加" style={{ padding: "4px 8px", borderRadius: "6px 6px 0 0", border: "1px solid transparent", background: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af", lineHeight: 1 }}>+</button>
    </div>
  );
}

const meta: Meta = { title: "Organisms/MultiPage", parameters: { layout: "padded" } };
export default meta;

// 1ページ（追加ボタンあり）
export const SinglePage: StoryObj = {
  name: "1ページ",
  render: () => (
    <div style={{ maxWidth: 700, fontFamily: tokens.font }}>
      <TabBarMock
        pages={[{ id: "p1", title: "ページ 1" }]}
        activeId="p1"
        onSelect={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
      />
      <div style={{ padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderTop: "none", minHeight: 100 }}>
        <p style={{ fontSize: 13, color: tokens.mutedFg }}>ページ 1 のコンテンツ（削除ボタンなし、1ページのため）</p>
      </div>
    </div>
  ),
};

// 複数ページ
export const MultiplePages: StoryObj = {
  name: "複数ページ",
  render: () => {
    function Demo() {
      const [pages, setPages] = useState<Page[]>([
        { id: "p1", title: "ページ 1" },
        { id: "p2", title: "ページ 2" },
        { id: "p3", title: "ページ 3" },
      ]);
      const [activeId, setActiveId] = useState("p1");

      let counter = pages.length;
      const addPage = () => {
        counter++;
        const newId = `p-new-${Date.now()}`;
        setPages((prev) => [...prev, { id: newId, title: `ページ ${counter}` }]);
        setActiveId(newId);
      };
      const removePage = (id: string) => {
        setPages((prev) => {
          const next = prev.filter((p) => p.id !== id);
          if (activeId === id && next.length > 0) setActiveId(next[next.length - 1].id);
          return next;
        });
      };

      const activePage = pages.find((p) => p.id === activeId);
      return (
        <div style={{ maxWidth: 700, fontFamily: tokens.font }}>
          <TabBarMock pages={pages} activeId={activeId} onSelect={setActiveId} onRemove={removePage} onAdd={addPage} />
          <div style={{ padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderTop: "none", minHeight: 100 }}>
            <p style={{ fontSize: 13, color: tokens.fg }}>
              アクティブ: <strong>{activePage?.title}</strong>（タブ切り替え可能）
            </p>
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};

// 派生ページ（青ドット表示）
export const DerivedPages: StoryObj = {
  name: "派生ページ（青ドット）",
  render: () => {
    const pages: Page[] = [
      { id: "p1", title: "実験テンプレート" },
      { id: "p2", title: "sample_A", derivedFromPageId: "p1" },
      { id: "p3", title: "sample_B", derivedFromPageId: "p1" },
    ];
    return (
      <div style={{ maxWidth: 700, fontFamily: tokens.font }}>
        <p style={{ fontSize: 12, color: tokens.mutedFg, marginBottom: 8, background: tokens.muted, padding: "8px 12px", borderRadius: 8, border: `1px solid ${tokens.border}` }}>
          派生元があるページにはタブに青いドットが表示される
        </p>
        <TabBarMock pages={pages} activeId="p2" onSelect={() => {}} onRemove={() => {}} onAdd={() => {}} />
        <div style={{ padding: 16, background: "#fff", border: "1px solid #e5e7eb", borderTop: "none", minHeight: 100 }}>
          <p style={{ fontSize: 13, color: tokens.fg }}>
            sample_A（実験テンプレートから派生）
          </p>
        </div>
      </div>
    );
  },
};
