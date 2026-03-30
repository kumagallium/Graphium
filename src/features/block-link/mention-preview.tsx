// @ リンクのプレビュー/ピーク表示
// リンク先ノートの内容をポップオーバーで表示する

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadFile, type ProvNoteDocument } from "../../lib/google-drive";

type MentionPreviewProps = {
  noteId: string;
  // ポップオーバーの表示位置（クリック位置基準）
  anchorRect: { top: number; left: number };
  onClose: () => void;
  onNavigate: (noteId: string) => void;
};

export function MentionPreview({
  noteId,
  anchorRect,
  onClose,
  onNavigate,
}: MentionPreviewProps) {
  const [doc, setDoc] = useState<ProvNoteDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadFile(noteId)
      .then((d) => {
        if (!cancelled) {
          setDoc(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "読み込みに失敗しました");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // 外部クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".mention-preview-popover")) {
        onClose();
      }
    };
    // 少し遅延させて、開くクリック自体で閉じないようにする
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Escape で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleNavigate = useCallback(() => {
    onNavigate(noteId);
    onClose();
  }, [noteId, onNavigate, onClose]);

  // ポップオーバーの位置計算（画面内に収まるように調整）
  const popoverWidth = 400;
  const popoverHeight = 300;
  let top = anchorRect.top + 4;
  let left = anchorRect.left;

  // 画面下にはみ出す場合は上に表示
  if (top + popoverHeight > window.innerHeight - 16) {
    top = anchorRect.top - popoverHeight - 4;
  }
  // 画面右にはみ出す場合は左にシフト
  if (left + popoverWidth > window.innerWidth - 16) {
    left = window.innerWidth - popoverWidth - 16;
  }

  // ブロック内容をテキストとして描画する（読み取り専用）
  const renderBlocks = (blocks: any[]): string => {
    return blocks
      .map((block: any) => {
        if (block.type === "heading") {
          const level = block.props?.level ?? 1;
          const prefix = "#".repeat(level);
          const text = extractText(block.content);
          return `${prefix} ${text}`;
        }
        if (block.type === "bulletListItem") {
          return `- ${extractText(block.content)}`;
        }
        if (block.type === "numberedListItem") {
          return `1. ${extractText(block.content)}`;
        }
        if (block.type === "table") {
          return "[テーブル]";
        }
        return extractText(block.content);
      })
      .filter(Boolean)
      .join("\n");
  };

  const extractText = (content: any): string => {
    if (!content) return "";
    if (Array.isArray(content)) {
      return content
        .map((c: any) => (c.type === "text" ? c.text : ""))
        .join("");
    }
    return "";
  };

  const previewText = doc?.pages?.[0]?.blocks
    ? renderBlocks(doc.pages[0].blocks)
    : "";

  return createPortal(
    <div
      className="mention-preview-popover"
      style={{
        position: "fixed",
        top,
        left,
        width: popoverWidth,
        maxHeight: popoverHeight,
        zIndex: 9999,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f8fafc",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#1e293b",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {doc?.title ?? "読み込み中..."}
        </span>
        <button
          onClick={handleNavigate}
          style={{
            fontSize: 11,
            color: "#3b82f6",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 4,
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.background = "#eff6ff";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = "none";
          }}
        >
          開く &rarr;
        </button>
      </div>

      {/* コンテンツ */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 12px",
          fontSize: 12,
          lineHeight: 1.6,
          color: "#475569",
          whiteSpace: "pre-wrap",
          fontFamily: "inherit",
        }}
      >
        {loading && (
          <div style={{ color: "#94a3b8", textAlign: "center", padding: 16 }}>
            読み込み中...
          </div>
        )}
        {error && (
          <div style={{ color: "#ef4444", textAlign: "center", padding: 16 }}>
            {error}
          </div>
        )}
        {!loading && !error && previewText}
        {!loading && !error && !previewText && (
          <div style={{ color: "#94a3b8", textAlign: "center", padding: 16 }}>
            （空のノート）
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
