// インデックステーブルの行頭アイコンレイヤー
// ProvIndicatorLayer と同じパターンで body ポータルに描画する

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useIndexTableStore } from "./store";
import { getFirstCellText, createNoteFromRow } from "./create-note-from-row";
import { getIndexTableCallbacks } from "./context";

// 行ごとのアイコン情報
type RowIcon = {
  blockId: string;
  rowIndex: number;
  sampleName: string;
  linkedNoteId: string | null;
  top: number;
  left: number;
};

export function IndexTableIconLayer({ editorRef }: { editorRef: React.RefObject<any> }) {
  const store = useIndexTableStore();
  const [icons, setIcons] = useState<RowIcon[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  // テーブル行の位置を計算
  const compute = useCallback(() => {
    const next: RowIcon[] = [];
    const editor = editorRef.current;
    if (!editor) return;

    store.tables.forEach((linkedNotes, blockId) => {
      const block = editor.getBlock(blockId);
      if (!block || block.type !== "table") return;

      const blockEl = document.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      );
      if (!blockEl) return;

      const trElements = blockEl.querySelectorAll("tr");
      const tableRows = block.content?.rows;
      if (!tableRows) return;

      for (let i = 1; i < trElements.length && i < tableRows.length; i++) {
        const tr = trElements[i];
        const trRect = tr.getBoundingClientRect();
        const sampleName = getFirstCellText(block, i);
        const linkedNoteId = sampleName ? linkedNotes[sampleName] ?? null : null;

        next.push({
          blockId,
          rowIndex: i,
          sampleName,
          linkedNoteId,
          top: trRect.top + trRect.height / 2,
          left: trRect.left - 76,
        });
      }
    });

    setIcons(next);
  }, [store.tables, editorRef]);

  // store.tables 変更時に再計算
  useEffect(() => {
    const timer = setTimeout(compute, 50);
    return () => clearTimeout(timer);
  }, [compute]);

  // スクロール・リサイズ・DOM 変化にも追従
  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);

    const editorEl = document.querySelector("[data-label-wrapper]");
    let observer: MutationObserver | null = null;
    if (editorEl) {
      observer = new MutationObserver(compute);
      observer.observe(editorEl, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }

    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      observer?.disconnect();
    };
  }, [compute]);

  // リンク済みセルの位置情報（カーソル変更用オーバーレイ）
  const linkedCellRects = icons
    .filter((icon) => icon.linkedNoteId)
    .map((icon) => {
      const blockEl = document.querySelector(
        `[data-id="${icon.blockId}"][data-node-type="blockOuter"]`
      );
      if (!blockEl) return null;
      const rows = blockEl.querySelectorAll("tr");
      const row = rows[icon.rowIndex];
      if (!row) return null;
      const cell = row.cells[0];
      if (!cell) return null;
      const rect = cell.getBoundingClientRect();
      return { key: `${icon.blockId}:${icon.rowIndex}`, rect, noteId: icon.linkedNoteId! };
    })
    .filter(Boolean) as { key: string; rect: DOMRect; noteId: string }[];


  // 未リンク行 → ノート作成
  const handleCreateNote = useCallback(
    async (blockId: string, rowIndex: number, sampleName: string) => {
      const callbacks = getIndexTableCallbacks();
      const editor = editorRef.current;
      if (!callbacks || !editor) return;

      if (!sampleName) {
        alert("1列目にノートのタイトルを入力してからクリックしてください");
        return;
      }

      const key = `${blockId}:${rowIndex}`;
      setLoading(key);
      try {
        const fileId = await createNoteFromRow(
          editor,
          blockId,
          rowIndex,
          callbacks.files,
          store,
          callbacks.onAddNoteLink,
        );
        if (fileId) {
          // セルテキストを @ノート名（青文字）に変換
          const block = editor.getBlock(blockId);
          if (block?.content?.rows?.[rowIndex]) {
            const newRows = block.content.rows.map((r: any, i: number) => {
              if (i !== rowIndex) return r;
              return {
                ...r,
                cells: [
                  [{ type: "text", text: `@${sampleName}`, styles: { textColor: "blue" } }],
                  ...r.cells.slice(1),
                ],
              };
            });
            editor.updateBlock(blockId, {
              content: { type: "tableContent", rows: newRows },
            });
            // linkedNotes のキーを @付きに更新
            store.setLinkedNote(blockId, `@${sampleName}`, fileId);
          }

          callbacks.onRefreshFiles();
          // 作成直後にサイドピークで開く
          callbacks.onOpenSidePeek(fileId);
        }
      } catch (err) {
        console.error("ノート作成に失敗:", err);
        alert("ノート作成に失敗しました: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setLoading(null);
      }
    },
    [editorRef, store]
  );


  // リンク済み行はアイコンを出さない（セルテキストクリックでサイドピークが開く）
  const unlinkedIcons = icons.filter((icon) => !icon.linkedNoteId);

  return createPortal(
    <>
      {unlinkedIcons.map((icon) => {
        const key = `${icon.blockId}:${icon.rowIndex}`;
        const isLoading = loading === key;

        return (
          <button
            key={key}
            onClick={() =>
              handleCreateNote(icon.blockId, icon.rowIndex, icon.sampleName)
            }
            title={
              icon.sampleName
                ? `${icon.sampleName} のノートを作成`
                : "1列目にノートのタイトルを入力してください"
            }
            disabled={isLoading}
            style={{
              position: "fixed",
              top: icon.top - 12,
              left: icon.left,
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              cursor: icon.sampleName ? "pointer" : "default",
              opacity: icon.sampleName ? 1 : 0.5,
              fontSize: 14,
              zIndex: 50,
              transition: "all 0.15s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
            onMouseEnter={(e) => {
              if (icon.sampleName) {
                (e.currentTarget as HTMLElement).style.borderColor = "#94a3b8";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.1)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
            }}
          >
            {isLoading ? (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>...</span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            )}
          </button>
        );
      })}

      {/* リンク済みセルの透明オーバーレイ（cursor: pointer 用） */}
      {linkedCellRects.map(({ key, rect, noteId }) => (
        <div
          key={`link-${key}`}
          onClick={() => {
            const callbacks = getIndexTableCallbacks();
            callbacks?.onOpenSidePeek(noteId);
          }}
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            cursor: "pointer",
            zIndex: 49,
            background: "transparent",
          }}
        />
      ))}
    </>,
    document.body
  );
}
