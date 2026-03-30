// Notion 風サイドピーク
// 画面右側からスライドインし、リンク先ノートを編集可能な BlockNote で表示する
// 背景ページは操作可能（薄暗くならない）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import {
  loadFile,
  saveFile,
  type ProvNoteDocument,
} from "../../lib/google-drive";

type SidePeekProps = {
  noteId: string;
  onClose: () => void;
  onNavigate: (noteId: string) => void;
};

export function SidePeek({ noteId, onClose, onNavigate }: SidePeekProps) {
  const [doc, setDoc] = useState<ProvNoteDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "dirty">("saved");
  const docRef = useRef<ProvNoteDocument | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidePeekRef = useRef<HTMLDivElement>(null);

  // ノート読み込み
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    setSaveStatus("saved");
    docRef.current = null;

    loadFile(noteId)
      .then((d) => {
        if (!cancelled) {
          setDoc(d);
          docRef.current = d;
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "読み込みに失敗しました"
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [noteId]);

  const blocks = useMemo(
    () => doc?.pages?.[0]?.blocks ?? [],
    [doc]
  );

  const editor = useCreateBlockNote({
    initialContent: blocks.length > 0 ? blocks : undefined,
  });

  // noteId が変わったらエディタの内容を差し替え
  useEffect(() => {
    if (blocks.length > 0 && editor) {
      editor.replaceBlocks(editor.document, blocks);
    }
  }, [blocks, editor]);

  // 保存処理（直接 Drive API を呼ぶ、状態に依存しない）
  const doSave = useCallback(async () => {
    if (!editor || !docRef.current) return;

    const currentBlocks = editor.document;
    const updatedDoc: ProvNoteDocument = {
      ...docRef.current,
      pages: [
        {
          ...docRef.current.pages[0],
          blocks: currentBlocks,
        },
      ],
      modifiedAt: new Date().toISOString(),
    };

    setSaveStatus("saving");
    try {
      await saveFile(noteId, updatedDoc);
      docRef.current = updatedDoc;
      setSaveStatus("saved");
    } catch (err) {
      console.error("サイドピーク保存に失敗:", err);
      setSaveStatus("dirty");
    }
  }, [noteId, editor]);

  // 最新の doSave を ref に保持
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // 変更検知 → 3秒後に自動保存
  const handleChange = useCallback(() => {
    setSaveStatus("dirty");
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doSaveRef.current();
    }, 3000);
  }, []);

  // Cmd+S / Ctrl+S — サイドピーク内にフォーカスがあれば即保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        const peekEl = sidePeekRef.current;
        if (peekEl && peekEl.contains(document.activeElement)) {
          e.preventDefault();
          e.stopPropagation();
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
          doSaveRef.current();
        }
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, []);

  // 閉じるときに未保存の変更を保存（完了を待ってから閉じる）
  const handleClose = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (saveStatus === "dirty" && editor && docRef.current) {
      const currentBlocks = editor.document;
      const updatedDoc: ProvNoteDocument = {
        ...docRef.current,
        pages: [
          {
            ...docRef.current.pages[0],
            blocks: currentBlocks,
          },
        ],
        modifiedAt: new Date().toISOString(),
      };
      try {
        await saveFile(noteId, updatedDoc);
      } catch (err) {
        console.error("閉じる前の保存に失敗:", err);
      }
    }
    onClose();
  }, [saveStatus, noteId, editor, onClose]);

  // フルで開くときも未保存の変更を保存
  const handleNavigate = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (saveStatus === "dirty" && editor && docRef.current) {
      const currentBlocks = editor.document;
      const updatedDoc: ProvNoteDocument = {
        ...docRef.current,
        pages: [
          {
            ...docRef.current.pages[0],
            blocks: currentBlocks,
          },
        ],
        modifiedAt: new Date().toISOString(),
      };
      try {
        await saveFile(noteId, updatedDoc);
      } catch (err) {
        console.error("遷移前の保存に失敗:", err);
      }
    }
    onNavigate(noteId);
  }, [saveStatus, noteId, editor, onNavigate]);

  // 保存状態の表示テキスト（親ページと同じ挙動: 常時表示）
  const statusText = saveStatus === "saving" ? "保存中..."
    : saveStatus === "dirty" ? "未保存"
    : "保存済み";

  const statusColor = saveStatus === "dirty" ? "#f59e0b"
    : saveStatus === "saving" ? "#94a3b8"
    : "#94a3b8";

  return createPortal(
    <div
      ref={sidePeekRef}
      data-side-peek
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "55%",
        minWidth: 400,
        maxWidth: 800,
        background: "white",
        borderLeft: "1px solid #e2e8f0",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        animation: "sidePeekSlideIn 0.2s ease-out",
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 12px",
          borderBottom: "1px solid #e2e8f0",
          background: "#fafbfc",
          flexShrink: 0,
        }}
      >
        {/* >> 閉じるボタン */}
        <button
          onClick={handleClose}
          title="サイドピークを閉じる"
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
            color: "#64748b",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "#f1f5f9";
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

        {/* 拡大（フルで開く）ボタン */}
        <button
          onClick={handleNavigate}
          title="フルスクリーンで開く"
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
            color: "#64748b",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "#f1f5f9";
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

        {/* タイトル */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: "#1e293b",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginLeft: 4,
          }}
        >
          {doc?.title ?? ""}
        </span>

        {/* 保存状態インジケーター */}
        <span
          style={{
            fontSize: 10,
            color: statusColor,
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {statusText}
        </span>
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            読み込み中...
          </div>
        )}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "#ef4444",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && (
          <div style={{ padding: "16px 24px" }}>
            <BlockNoteView
              editor={editor}
              editable={true}
              theme="light"
              onChange={handleChange}
            />
          </div>
        )}
      </div>

      {/* CSS アニメーション */}
      <style>{`
        @keyframes sidePeekSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
