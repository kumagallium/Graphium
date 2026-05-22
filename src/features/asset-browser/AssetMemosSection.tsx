// この素材から保存した Memo の一覧
// MaterialFullView の右パネル「Memos」タブで使う。
// メモのテキストに含まれる出典ラベル `— {filename}` を文字列マッチで絞り込む。
// PR2 の Quote→Memo で保存したメモは末尾に `— filename · p.N` がつく仕様。

import { useMemo } from "react";
import { Trash2, FileText } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "../mobile-capture";
import { formatDateTime } from "../../lib/format-datetime";
import type { MediaIndexEntry } from "./media-index";

export type AssetMemosSectionProps = {
  entry: MediaIndexEntry;
  captureIndex?: CaptureIndex | null;
  /** メモ削除（オプション）。渡されない場合は削除ボタン非表示。 */
  onDeleteMemo?: (memoId: string) => void;
};

/**
 * テキスト内に出典ラベル `— {entry.name}` が含まれているメモを抽出する。
 * 完全一致ではなく substring 一致なのは、ユーザーが後でメモを編集しても
 * 出典行が残っていれば拾えるようにするため。
 */
function filterMemosByAsset(captureIndex: CaptureIndex | null | undefined, entry: MediaIndexEntry): CaptureEntry[] {
  if (!captureIndex) return [];
  const needle = `— ${entry.name}`;
  return captureIndex.captures
    .filter((c) => c.text.includes(needle))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function AssetMemosSection({ entry, captureIndex, onDeleteMemo }: AssetMemosSectionProps) {
  const memos = useMemo(() => filterMemosByAsset(captureIndex, entry), [captureIndex, entry]);

  if (memos.length === 0) {
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
        この素材から保存したメモはまだありません。
        <br />
        PDF のテキストを選択して「メモに保存」を押すと、ここに並びます。
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {memos.map((memo) => {
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
      })}
    </div>
  );
}
