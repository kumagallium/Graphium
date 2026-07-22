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

import { useMemo } from "react";
import { Trash2, FileText } from "lucide-react";
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

export function NoteMemosSection({
  noteFileId,
  noteTitle,
  captureIndex,
  onDeleteMemo,
  onCreateMemo,
}: NoteMemosSectionProps) {
  const t = useT();
  const memos = useMemo(
    () => filterMemosByNote(captureIndex, noteFileId),
    [captureIndex, noteFileId],
  );

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
        memos.map((memo) => (
          <div
            key={memo.id}
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--color-border-subtle)",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--color-foreground)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <FileText
                size={12}
                style={{ marginTop: 3, color: "var(--color-text-tertiary)", flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
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
        ))
      )}
    </div>
  );
}
