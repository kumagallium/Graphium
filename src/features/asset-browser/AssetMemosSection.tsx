// この素材から保存した Memo の一覧
// MaterialFullView の右パネル「Memos」タブで使う。
// PR3-a: 構造化された `sourceAsset.fileId` 一致を優先しつつ、
// 旧仕様（テキスト末尾の `— {filename}`）にも後方互換として対応する。

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Trash2, FileText } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "../mobile-capture";
import { formatDateTime } from "../../lib/format-datetime";
import type { MediaIndexEntry } from "./media-index";

export type AssetMemosSectionProps = {
  entry: MediaIndexEntry;
  captureIndex?: CaptureIndex | null;
  /** メモ削除（オプション）。渡されない場合は削除ボタン非表示。 */
  onDeleteMemo?: (memoId: string) => void;
  /**
   * 入力欄から直接メモを追加（オプション）。渡されると上部に textarea が出る。
   * 親が sourceAsset の付与・トースト表示・state 反映を担当する想定。
   */
  onCreateMemo?: (text: string) => void | Promise<void>;
};

/**
 * 素材 `entry` から派生したメモを抽出する。
 *
 * 判定は OR 条件:
 * 1. 構造化された `sourceAsset.fileId` が一致する（PR3-a 以降の Quote→Memo）
 * 2. テキスト内に出典ラベル `— {entry.name}` が含まれる（旧仕様の後方互換）
 *
 * テキスト一致を残しているのは、PR3-a 以前に保存された既存メモや、
 * ユーザーが手で書いた出典行を取り逃さないため。
 */
export function filterMemosByAsset(
  captureIndex: CaptureIndex | null | undefined,
  entry: MediaIndexEntry,
): CaptureEntry[] {
  if (!captureIndex) return [];
  const needle = `— ${entry.name}`;
  return captureIndex.captures
    .filter((c) => c.sourceAsset?.fileId === entry.fileId || c.text.includes(needle))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * 上部の直接入力欄。
 * - Enter で送信、Shift+Enter で改行（ChatGPT / Slack と同じパターン）
 * - 送信後はクリアしてフォーカス維持 → 連投できる
 * - 自動高さ拡張（auto + scrollHeight）
 *
 * 「クリック → 入力 → Enter」だけで完結することを優先。確定ボタンは出さない。
 */
function MemoComposer({ onSubmit }: { onSubmit: (text: string) => void | Promise<void> }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const adjustHeight = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText("");
      requestAnimationFrame(() => {
        adjustHeight();
        ref.current?.focus();
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-surface)",
      }}
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          adjustHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder="メモを追加…（Enter で保存・Shift+Enter で改行）"
        rows={1}
        disabled={submitting}
        style={{
          width: "100%",
          resize: "none",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--color-foreground)",
          background: "var(--color-background)",
          outline: "none",
          fontFamily: "inherit",
          overflowY: "auto",
        }}
      />
    </div>
  );
}

export function AssetMemosSection({
  entry,
  captureIndex,
  onDeleteMemo,
  onCreateMemo,
}: AssetMemosSectionProps) {
  const memos = useMemo(() => filterMemosByAsset(captureIndex, entry), [captureIndex, entry]);

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
          この素材に紐づくメモはまだありません。
          {onCreateMemo ? (
            <>
              <br />
              上の入力欄から書き込むか、PDF のテキストを選択して「メモに保存」できます。
            </>
          ) : (
            <>
              <br />
              PDF のテキストを選択して「メモに保存」を押すと、ここに並びます。
            </>
          )}
        </div>
      ) : (
        memos.map((memo) => {
          // メモ本文と出典行を分離して表示する
          // フォーマット: `<本文>\n\n— <source>`
          const lastSeparatorIdx = memo.text.lastIndexOf(`\n\n— `);
          const body = lastSeparatorIdx >= 0 ? memo.text.slice(0, lastSeparatorIdx) : memo.text;
          const sourceLine =
            lastSeparatorIdx >= 0 ? memo.text.slice(lastSeparatorIdx + 2) : null;
          return (
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
                    {body}
                  </p>
                  {sourceLine && (
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        fontStyle: "italic",
                      }}
                    >
                      {sourceLine}
                    </p>
                  )}
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 10,
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {formatDateTime(memo.createdAt)}
                    {memo.usedIn && memo.usedIn.length > 0 && (
                      <span style={{ marginLeft: 8 }}>· 引用済み {memo.usedIn.length} 件</span>
                    )}
                  </p>
                </div>
                {onDeleteMemo && (
                  <button
                    type="button"
                    onClick={() => onDeleteMemo(memo.id)}
                    title="メモを削除"
                    aria-label="メモを削除"
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
