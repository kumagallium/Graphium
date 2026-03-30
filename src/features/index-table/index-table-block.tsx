// インデックステーブル カスタムブロック
// 通常のテーブルと同じ見た目だが、行頭にノート作成アイコンがある
// content: "table" を使い、BlockNote 標準のテーブル編集機能をそのまま活用する
//
// 注意: createReactBlockSpec の型定義は "none" | "inline" のみだが、
// BlockNote 内部では "table" もサポートされている（標準 table ブロックが使用）。
// 型アサーションでバイパスし、実行時の動作で検証する。

import { createReactBlockSpec } from "@blocknote/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseLinkedNotes } from "./types";
import { getFirstCellText, createNoteFromRow } from "./create-note-from-row";
import { getIndexTableCallbacks } from "./context";
import { MentionPreview } from "../block-link/mention-preview";

// 各行のリンク状態
type RowIconState = {
  rowIndex: number;
  sampleName: string;
  linkedNoteId: string | null;
  top: number;
};

// プレビュー表示状態
type PreviewState = {
  noteId: string;
  anchorRect: { top: number; left: number };
} | null;

// 行頭アイコンレイヤー
function IndexTableIcons({
  blockId,
  editor,
  linkedNotesJson,
}: {
  blockId: string;
  editor: any;
  linkedNotesJson: string;
}) {
  const [rows, setRows] = useState<RowIconState[]>([]);
  const [loading, setLoading] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // テーブル行の位置とリンク状態を計算
  const compute = useCallback(() => {
    const block = editor.getBlock(blockId);
    if (!block) return;

    const linkedNotes = parseLinkedNotes(linkedNotesJson);
    const tableRows = block.content?.rows;
    if (!tableRows) return;

    // DOM からテーブル行の位置を取得
    const blockEl = wrapperRef.current?.closest(
      '[data-node-type="blockOuter"]'
    );
    if (!blockEl) return;

    const trElements = blockEl.querySelectorAll("tr");
    const next: RowIconState[] = [];
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    if (!wrapperRect) return;

    // ヘッダー行（最初の行）はスキップ
    for (let i = 1; i < trElements.length && i < tableRows.length; i++) {
      const tr = trElements[i];
      const trRect = tr.getBoundingClientRect();
      const sampleName = getFirstCellText(block, i);
      const linkedNoteId = sampleName ? linkedNotes[sampleName] ?? null : null;

      next.push({
        rowIndex: i,
        sampleName,
        linkedNoteId,
        top: trRect.top - wrapperRect.top + trRect.height / 2,
      });
    }
    setRows(next);
  }, [blockId, editor, linkedNotesJson]);

  // DOM 変化を監視してアイコン位置を再計算
  useEffect(() => {
    compute();

    const blockEl = wrapperRef.current?.closest(
      '[data-node-type="blockOuter"]'
    );
    if (!blockEl) return;

    const observer = new MutationObserver(compute);
    observer.observe(blockEl, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    // スクロール・リサイズにも追従
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [compute]);

  // 未リンク行のアイコンクリック → ノート作成
  const handleCreateNote = useCallback(
    async (rowIndex: number) => {
      const callbacks = getIndexTableCallbacks();
      if (!callbacks) return;

      setLoading(rowIndex);
      try {
        const fileId = await createNoteFromRow(
          editor,
          blockId,
          rowIndex,
          callbacks.files
        );
        if (fileId) {
          callbacks.onRefreshFiles();
        }
      } catch (err) {
        console.error("ノート作成に失敗:", err);
      } finally {
        setLoading(null);
      }
    },
    [editor, blockId]
  );

  // リンク済み行のアイコンクリック → プレビュー表示
  const handleLinkedClick = useCallback(
    (noteId: string, e: React.MouseEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setPreview({
        noteId,
        anchorRect: { top: rect.bottom, left: rect.right + 8 },
      });
    },
    []
  );

  // プレビューからのノート遷移
  const handleNavigate = useCallback((noteId: string) => {
    const callbacks = getIndexTableCallbacks();
    if (!callbacks) return;
    callbacks.onNavigateNote(noteId);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="index-table-icons"
      style={{
        position: "absolute",
        left: -32,
        top: 0,
        width: 28,
        pointerEvents: "auto",
      }}
    >
      {rows.map((row) => (
        <button
          key={row.rowIndex}
          onClick={(e) =>
            row.linkedNoteId
              ? handleLinkedClick(row.linkedNoteId, e)
              : handleCreateNote(row.rowIndex)
          }
          title={
            row.linkedNoteId
              ? `${row.sampleName} のノートをプレビュー`
              : row.sampleName
                ? `${row.sampleName} のノートを作成`
                : "セルにテキストを入力してください"
          }
          disabled={!row.sampleName || loading === row.rowIndex}
          style={{
            position: "absolute",
            top: row.top - 10,
            left: 0,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "none",
            background: "transparent",
            cursor: row.sampleName ? "pointer" : "default",
            opacity: row.sampleName ? 1 : 0.3,
            fontSize: 12,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            if (row.sampleName)
              (e.target as HTMLElement).style.background = "#f0f0f0";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = "transparent";
          }}
        >
          {loading === row.rowIndex ? (
            <span style={{ fontSize: 10 }}>...</span>
          ) : row.linkedNoteId ? (
            <span style={{ color: "#22c55e" }}>&#10003;</span>
          ) : (
            <span style={{ color: "#6b7280" }}>&#128196;</span>
          )}
        </button>
      ))}

      {/* プレビューポップオーバー */}
      {preview && (
        <MentionPreview
          noteId={preview.noteId}
          anchorRect={preview.anchorRect}
          onClose={() => setPreview(null)}
          onNavigate={handleNavigate}
        />
      )}
    </div>
  );
}

export const IndexTableBlock = createReactBlockSpec(
  {
    type: "indexTable" as const,
    propSchema: {
      // 各行のリンク状態を管理（サンプル名 → ノートファイル ID）
      linkedNotes: { default: "{}" },
    },
    content: "table" as any,
  } as any,
  {
    render: (props: any) => {
      return (
        <div
          className="index-table-wrapper"
          style={{ position: "relative" }}
        >
          <IndexTableIcons
            blockId={props.block.id}
            editor={props.editor}
            linkedNotesJson={props.block.props.linkedNotes}
          />
          <div ref={props.contentRef} />
        </div>
      );
    },
  }
);
