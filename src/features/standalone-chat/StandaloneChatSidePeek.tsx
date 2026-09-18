// ノートに紐づかないチャットのサイドピーク
//
// 殻・配置・閉じ方は src/features/asset-browser/MaterialSidePeek.tsx（overlay 版）に揃える
// （position: fixed で右端に被せる・ESC で閉じる）。「フルスクリーンで開く」ボタンは
// src/features/index-table/side-peek.tsx の同ボタンと同じ見た目・同じ位置に置く。
// 中身は既存の StandaloneChatView をそのまま埋め込む（1 列構成なので狭い枠でも成立する）。

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { useSidePeekWidth } from "../../hooks/use-resizable-width";
import { ResizeHandle } from "../../components/ResizeHandle";
import { useIsDesktop } from "../../hooks/use-media-query";
import { StandaloneChatView } from "./StandaloneChatView";
import type { SourceLinkHandlers } from "../ai-assistant/panel";
import type { StandaloneChat } from "./types";
import type { ChatMessage } from "../../lib/document-types";

export function StandaloneChatSidePeek({
  chat,
  messages,
  loading,
  error,
  attachedNotes,
  onRemoveAttachedNote,
  onSend,
  onStop,
  onClose,
  onToggleFull,
  aiConfigured = true,
  onSaveAsAnswer,
  onResend,
  onFork,
  onOpenWiki,
  sourceLinks,
}: {
  chat: StandaloneChat | null;
  messages: ChatMessage[];
  loading: boolean;
  error?: string;
  attachedNotes?: { id: string; title: string; isWiki?: boolean }[];
  onRemoveAttachedNote?: (id: string) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  onClose: () => void;
  /** フルスクリーンで開く */
  onToggleFull: () => void;
  aiConfigured?: boolean;
  onSaveAsAnswer?: (question: string, answer: string) => Promise<string | null>;
  onResend?: (text: string, rewindIndex: number) => void;
  onFork?: (index: number) => void;
  onOpenWiki?: (wikiId: string) => void;
  sourceLinks?: SourceLinkHandlers;
}) {
  const t = useT();
  const peekResize = useSidePeekWidth();
  const isDesktop = useIsDesktop();

  // ESC で閉じる（MaterialSidePeek と同じ）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: (isDesktop ? peekResize.widthStyle : undefined) ?? "55%",
    minWidth: isDesktop && peekResize.width != null ? "min(320px, 90vw)" : 400,
    maxWidth: 800,
    background: "var(--color-card)",
    borderLeft: "1px solid var(--color-border-subtle)",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    animation: "sidePeekSlideIn 0.2s ease-out",
  };

  const body = (
    <div data-side-peek style={containerStyle}>
      {/* 左端のドラッグリサイズハンドル（デスクトップのみ。MaterialSidePeek と同じ） */}
      {isDesktop && (
        <ResizeHandle
          handleProps={peekResize.handleProps}
          isResizing={peekResize.isResizing}
          label={t("sidePeek.resizeHandle")}
        />
      )}

      {/* ヘッダー — 閉じる／フルスクリーンで開く（side-peek.tsx と同じ見た目・同じ位置） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          title={t("sidePeek.close")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
        <button
          onClick={onToggleFull}
          title={t("sidePeek.fullscreen")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="10" y1="14" x2="3" y2="21" />
          </svg>
        </button>
      </div>

      {/* 本体 — 既存の StandaloneChatView をそのまま埋め込む。onBack はピークを閉じる */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <StandaloneChatView
          title={chat?.title}
          messages={messages}
          loading={loading}
          error={error}
          attachedNotes={attachedNotes}
          onRemoveAttachedNote={onRemoveAttachedNote}
          onSend={onSend}
          onStop={onStop}
          onBack={onClose}
          aiConfigured={aiConfigured}
          onSaveAsAnswer={onSaveAsAnswer}
          onResend={onResend}
          onFork={onFork}
          onOpenWiki={onOpenWiki}
          sourceLinks={sourceLinks}
        />
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
