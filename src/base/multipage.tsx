// ──────────────────────────────────────────────
// タブ式マルチページエディタ
// 1つの実験内で複数ページ（タブ）を持てるようにする
// 0-C スコープ選択の試作に必要（Session 1-6）
//
// 構造:
//   タブバー（ページ1 / ページ2 / +）
//   エディタ（アクティブページ）
// ──────────────────────────────────────────────

import { ReactNode, useState } from "react";
import { cn } from "../lib/utils";

export type Page = {
  id: string;
  title: string;
  /** このページを生成したスコープのページID（暗黙的リンクの起点） */
  derivedFromPageId?: string;
  /** このページを生成したスコープのブロックID */
  derivedFromBlockId?: string;
};

type MultiPageLayoutProps = {
  pages: Page[];
  activePageId: string;
  onSelectPage: (pageId: string) => void;
  onAddPage: (title: string, derivedFrom?: { pageId: string; blockId?: string }) => void;
  onRemovePage: (pageId: string) => void;
  children: (pageId: string) => ReactNode;
};

// ページタブバー
function TabBar({
  pages,
  activePageId,
  onSelect,
  onAdd,
  onRemove,
}: {
  pages: Page[];
  activePageId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "6px 12px 0",
        borderBottom: "1px solid #e5e7eb",
        background: "#f9fafb",
        flexWrap: "wrap",
      }}
    >
      {pages.map((page) => {
        const isActive = page.id === activePageId;
        return (
          <div
            key={page.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: "6px 6px 0 0",
              border: "1px solid",
              borderBottom: isActive ? "1px solid #fff" : "1px solid transparent",
              borderColor: isActive ? "#e5e7eb" : "transparent",
              background: isActive ? "#fff" : "transparent",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "#374151" : "#6b7280",
              marginBottom: isActive ? -1 : 0,
              position: "relative",
              userSelect: "none",
            }}
          >
            {/* 派生元があればインジケーター */}
            {page.derivedFromPageId && (
              <span
                title={`${page.derivedFromPageId} から派生`}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#4B7A52",
                  flexShrink: 0,
                }}
              />
            )}
            <button
              onClick={() => onSelect(page.id)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontSize: "inherit",
                fontWeight: "inherit",
                color: "inherit",
              }}
            >
              {page.title}
            </button>
            {pages.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(page.id);
                }}
                title="ページを削除"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0 2px",
                  fontSize: 11,
                  color: "#9ca3af",
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#c26356";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* 新規ページ追加ボタン */}
      <button
        onClick={onAdd}
        title="新しいページを追加"
        style={{
          padding: "4px 8px",
          borderRadius: "6px 6px 0 0",
          border: "1px solid transparent",
          background: "none",
          cursor: "pointer",
          fontSize: 16,
          color: "#9ca3af",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#4B7A52";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
        }}
      >
        +
      </button>
    </div>
  );
}

let pageCounter = 1;

function generatePageId() {
  return `page-${Date.now()}-${pageCounter++}`;
}

/**
 * タブ式マルチページレイアウト
 * children は (pageId: string) => ReactNode を渡す
 * pageId ごとにエディタを render する
 */
export function MultiPageLayout({
  pages,
  activePageId,
  onSelectPage,
  onAddPage,
  onRemovePage,
  children,
}: MultiPageLayoutProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TabBar
        pages={pages}
        activePageId={activePageId}
        onSelect={onSelectPage}
        onAdd={() => {
          const title = `ページ ${pages.length + 1}`;
          onAddPage(title);
        }}
        onRemove={onRemovePage}
      />
      <div style={{ flex: 1, overflow: "auto" }}>
        {children(activePageId)}
      </div>
    </div>
  );
}

/**
 * マルチページの状態管理フック
 */
export function useMultiPage(initialTitle = "ページ 1") {
  const [pages, setPages] = useState<Page[]>([
    { id: generatePageId(), title: initialTitle },
  ]);
  const [activePageId, setActivePageId] = useState<string>(pages[0].id);

  const addPage = (
    title: string,
    derivedFrom?: { pageId: string; blockId?: string }
  ): string => {
    const newPage: Page = {
      id: generatePageId(),
      title,
      derivedFromPageId: derivedFrom?.pageId,
      derivedFromBlockId: derivedFrom?.blockId,
    };
    setPages((prev) => [...prev, newPage]);
    setActivePageId(newPage.id);
    return newPage.id;
  };

  const removePage = (pageId: string) => {
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== pageId);
      if (activePageId === pageId && next.length > 0) {
        setActivePageId(next[next.length - 1].id);
      }
      return next;
    });
  };

  return { pages, activePageId, setActivePageId, addPage, removePage };
}

export { generatePageId };
