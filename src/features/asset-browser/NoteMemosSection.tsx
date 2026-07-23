// ノート編集画面の右パネル「Memos」タブの中身。
// AssetMemosSection と並列の存在で、「素材に紐づくメモ」ではなく
// 「ノートに紐づくメモ」を表示する。
//
// データソースは同じ CaptureIndex。ノート用のフィルタは
// `sourceNote.fileId === noteFileId` で判定する。AssetMemosSection が
// `sourceAsset.fileId` を見るのと対になる。
//
// 旧仕様（テキスト末尾の出典ラベル）は素材のみで使われていたため、
// ノート側ではテキスト一致のフォールバックを設けない。新規メモは
// すべて構造化された sourceNote を持つ前提。
//
// ブロック紐付きメモ（sourceNote.blockId あり）は、紐付け先ブロックの
// テキスト抜粋チップを表示し、クリックで該当ブロックへスクロールする。
// ブロックが既に削除されている場合、チップは表示するがジャンプは no-op
// （メモ自体はノート単位の出典として生き続ける）。

import { useEffect, useMemo, useRef } from "react";
import { Trash2, FileText, Pilcrow } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "../mobile-capture";
import { formatDateTime } from "../../lib/format-datetime";
import { MemoComposer } from "./MemoComposer";
import { useT } from "../../i18n";

export type NoteMemosSectionProps = {
  /** 現在開いているノートの fileId */
  noteFileId: string;
  /** 表示用のノートタイトル（empty メッセージで使う） */
  noteTitle?: string;
  /** 全メモのインデックス。null/undefined のときは空表示 */
  captureIndex?: CaptureIndex | null;
  /** メモ削除（オプション）。渡されない場合は削除ボタン非表示 */
  onDeleteMemo?: (memoId: string) => void;
  /**
   * 入力欄から直接メモを追加（オプション）。渡されると上部に textarea が出る。
   * 親が sourceNote の付与・state 反映を担当する想定。
   */
  onCreateMemo?: (text: string) => void | Promise<void>;
  /**
   * ブロックインジケータ経由で開かれた場合の対象ブロック ID（オプション）。
   * 一致するメモをハイライトし、先頭の一致メモへスクロールする。
   */
  focusBlockId?: string | null;
};

/**
 * ノート `noteFileId` に紐づくメモを抽出する。
 *
 * 判定は `sourceNote.fileId` の完全一致のみ。旧仕様の互換は不要なので
 * AssetMemosSection と違いテキスト一致のフォールバックは持たない。
 */
export function filterMemosByNote(
  captureIndex: CaptureIndex | null | undefined,
  noteFileId: string,
): CaptureEntry[] {
  if (!captureIndex) return [];
  if (!noteFileId) return [];
  return captureIndex.captures
    .filter((c) => !c.archivedAt && !c.deletedAt)
    .filter((c) => c.sourceNote?.fileId === noteFileId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 紐付け先ブロックへスクロールして一時ハイライトする（prov-indicator と同じ挙動） */
function scrollToBlock(blockId: string) {
  const el = document.querySelector(
    `[data-id="${blockId}"][data-node-type="blockOuter"]`
  ) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.outline = "2px solid #d97706";
  setTimeout(() => {
    el.style.outline = "";
  }, 1500);
}

export function NoteMemosSection({
  noteFileId,
  noteTitle,
  captureIndex,
  onDeleteMemo,
  onCreateMemo,
  focusBlockId,
}: NoteMemosSectionProps) {
  const t = useT();
  const memos = useMemo(
    () => filterMemosByNote(captureIndex, noteFileId),
    [captureIndex, noteFileId],
  );

  // インジケータ経由で開かれたとき、対象ブロックの先頭メモへスクロールする
  const focusedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusBlockId) return;
    const timer = setTimeout(() => {
      focusedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => clearTimeout(timer);
  }, [focusBlockId, memos.length]);

  let firstFocusedAssigned = false;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {onCreateMemo && <MemoComposer onSubmit={onCreateMemo} />}

      {memos.length === 0 ? (
        <div
          style={{
            padding: 24,
            color: "var(--color-text-tertiary)",
            fontSize: 12,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          {noteTitle
            ? t("memo.emptyForNoteTitled", { title: noteTitle })
            : t("memo.emptyForNote")}
          {onCreateMemo && (
            <>
              <br />
              {t("memo.writeHint")}
            </>
          )}
        </div>
      ) : (
        memos.map((memo) => {
          const blockId = memo.sourceNote?.blockId;
          const isFocused = Boolean(focusBlockId && blockId === focusBlockId);
          // 一致する先頭メモだけにスクロール用 ref を付ける
          const takeRef = isFocused && !firstFocusedAssigned;
          if (takeRef) firstFocusedAssigned = true;
          return (
            <div
              key={memo.id}
              ref={takeRef ? focusedRef : undefined}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--color-border-subtle)",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--color-foreground)",
                backgroundColor: isFocused ? "#d9770614" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <FileText
                  size={12}
                  style={{ marginTop: 3, color: "var(--color-text-tertiary)", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {blockId && (
                    <button
                      type="button"
                      onClick={() => scrollToBlock(blockId)}
                      title={t("memo.jumpToBlock")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        maxWidth: "100%",
                        margin: "0 0 4px",
                        padding: "1px 6px",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: 9999,
                        background: "transparent",
                        color: "var(--color-text-tertiary)",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                      className="hover:text-foreground transition-colors"
                    >
                      <Pilcrow size={9} style={{ flexShrink: 0 }} />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {memo.sourceNote?.blockText || t("memo.linkedBlock")}
                      </span>
                    </button>
                  )}
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {memo.text}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 10,
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {formatDateTime(memo.createdAt)}
                    {memo.usedIn && memo.usedIn.length > 0 && (
                      <span style={{ marginLeft: 8 }}>{t("memo.citedCount", { count: String(memo.usedIn.length) })}</span>
                    )}
                  </p>
                </div>
                {onDeleteMemo && (
                  <button
                    type="button"
                    onClick={() => onDeleteMemo(memo.id)}
                    title={t("memo.delete")}
                    aria-label={t("memo.delete")}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--color-text-tertiary)",
                      cursor: "pointer",
                      padding: 2,
                      flexShrink: 0,
                    }}
                    className="hover:text-foreground transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
