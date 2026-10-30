// メモの一覧（本文と出典を分けて表示し、日時を添える）
// 素材の「Memos」タブ（AssetMemosSection）と、ノートの素材ブロックに付く小窓（MemoPopover）が
// 同じ見た目で並べるための共通部品。付け先（素材・ノート・つながり）に依存しない。
//
// 並びは呼び出し側が決める（filterMemosByAsset は新しい順で返す）。
// 削除ボタンは onDeleteMemo があるときだけ、項目を押す動作は onOpenMemo があるときだけ出す。

import type { KeyboardEvent, ReactNode } from "react";
import { Trash2, FileText } from "lucide-react";
import type { CaptureEntry } from "../mobile-capture";
import { formatDateTime } from "../../lib/format-datetime";
import { useT } from "../../i18n";

export type MemoListProps = {
  memos: CaptureEntry[];
  /** メモ削除（オプション）。渡されない場合は削除ボタン非表示 */
  onDeleteMemo?: (memoId: string) => void;
  /** 項目を押したときの動作（オプション）。渡されると項目が押せる見た目になる */
  onOpenMemo?: (memoId: string) => void;
  /** メモが 0 件のときに出す中身。省略時は何も出さない */
  emptyContent?: ReactNode;
};

/**
 * メモ本文と出典行を分ける。
 * フォーマット: `<本文>\n\n— <source>`（最後の区切りで分ける）。区切りが無ければ出典なし。
 */
export function splitMemoBody(text: string): { body: string; sourceLine: string | null } {
  const idx = text.lastIndexOf(`\n\n— `);
  if (idx < 0) return { body: text, sourceLine: null };
  return { body: text.slice(0, idx), sourceLine: text.slice(idx + 2) };
}

export function MemoList({ memos, onDeleteMemo, onOpenMemo, emptyContent }: MemoListProps) {
  const t = useT();

  if (memos.length === 0) {
    if (!emptyContent) return null;
    return (
      <div
        style={{
          padding: 24,
          color: "var(--color-text-tertiary)",
          fontSize: 12,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        {emptyContent}
      </div>
    );
  }

  return (
    <>
      {memos.map((memo) => {
        const { body, sourceLine } = splitMemoBody(memo.text);
        const openable = Boolean(onOpenMemo);
        const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
          if (!onOpenMemo) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenMemo(memo.id);
          }
        };
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
              <div
                style={{ flex: 1, minWidth: 0, cursor: openable ? "pointer" : undefined }}
                {...(openable
                  ? {
                      role: "button",
                      tabIndex: 0,
                      onClick: () => onOpenMemo?.(memo.id),
                      onKeyDown: handleKeyDown,
                      "data-test": "memoListItem",
                    }
                  : {})}
              >
                <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{body}</p>
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
                    <span style={{ marginLeft: 8 }}>
                      {t("memo.citedCount", { count: String(memo.usedIn.length) })}
                    </span>
                  )}
                </p>
              </div>
              {onDeleteMemo && (
                <button
                  type="button"
                  onClick={() => onDeleteMemo(memo.id)}
                  data-tooltip={t("memo.delete")}
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
      })}
    </>
  );
}
