// メモピッカーモーダル
// スラッシュコマンドから呼び出し、保存済みメモを選択してエディタに挿入する
// MediaPickerModal と同じレイアウト（ヘッダー + 検索 + グリッド）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { useT } from "../../i18n";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import { formatRelativeTime } from "../navigation/recent-notes-store";

function MemoPickerItem({
  entry,
  onSelect,
}: {
  entry: CaptureEntry;
  onSelect: (entry: CaptureEntry) => void;
}) {
  return (
    <button
      onClick={() => onSelect(entry)}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary/40 hover:bg-primary/5 transition-colors"
    >
      <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-3 mb-1">
        {entry.text}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {formatRelativeTime(entry.createdAt)}
      </p>
    </button>
  );
}

export type MemoPickerModalProps = {
  open: boolean;
  onClose: () => void;
  captureIndex: CaptureIndex | null;
  onSelect: (entry: CaptureEntry) => void;
};

export function MemoPickerModal({
  open,
  onClose,
  captureIndex,
  onSelect,
}: MemoPickerModalProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // モーダルが開いたらフォーカス + 検索リセット
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ESC で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // フィルタリング
  const filtered = useMemo(() => {
    const captures = captureIndex?.captures ?? [];
    if (!searchQuery.trim()) return captures;
    const q = searchQuery.trim().toLowerCase();
    return captures.filter((c) => c.text.toLowerCase().includes(q));
  }, [captureIndex, searchQuery]);

  const handleSelect = useCallback(
    (entry: CaptureEntry) => {
      onSelect(entry);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("memo.pickTitle")}
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {t("memo.count", { count: String(filtered.length) })}
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* 検索 */}
        <div className="px-4 py-2 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("memo.searchPlaceholder")}
            className="w-full text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* グリッド */}
        <div className="flex-1 overflow-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <StickyNote size={28} className="text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                {searchQuery.trim()
                  ? t("nav.noMatchingNotes")
                  : t("memo.emptyDesktop")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((entry) => (
                <MemoPickerItem
                  key={entry.id}
                  entry={entry}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
