// 引用ピッカーモーダル（複数選択）
// /claims, /Insights のスラッシュコマンドから呼び出し、
// 既存ノートから wikiKind === "atom" / "synthesis" のものを選んで挿入する。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { CitePickerKind } from "./slash-menu-items";

// CitePickerKind と wikiKind の対応
const KIND_TO_WIKI_KIND = {
  claims: "atom",
  insights: "synthesis",
} as const;

export type CitePickerModalProps = {
  noteIndex: GraphiumIndex | null;
  kind: CitePickerKind;
  onConfirm: (entries: NoteIndexEntry[]) => void;
  onClose: () => void;
};

export function CitePickerModal({
  noteIndex,
  kind,
  onConfirm,
  onClose,
}: CitePickerModalProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // 自動フォーカス
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC で閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const targetWikiKind = KIND_TO_WIKI_KIND[kind];

  // 該当する wikiKind のノートを抽出 + ゴミ箱・アーカイブを除外
  const filtered = useMemo(() => {
    if (!noteIndex) return [];
    const q = searchQuery.trim().toLowerCase();
    return noteIndex.notes
      .filter((n) =>
        n.source === "ai" &&
        n.wikiKind === targetWikiKind &&
        !n.deletedAt &&
        !n.archivedAt
      )
      .filter((n) => (q ? n.title.toLowerCase().includes(q) : true))
      // 新しいものが先
      .sort((a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
      );
  }, [noteIndex, targetWikiKind, searchQuery]);

  const toggleSelect = useCallback((noteId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedIds.size === 0) return;
    const entries = filtered.filter((n) => selectedIds.has(n.noteId));
    onConfirm(entries);
    onClose();
  }, [filtered, selectedIds, onConfirm, onClose]);

  // Enter で確定（input にフォーカス中でも動く: 検索 input には Enter 用の preventDefault なし）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleConfirm();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleConfirm]);

  const titleLabel = kind === "claims" ? t("cite.pickClaimTitle") : t("cite.pickInsightTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{titleLabel}</h2>
          <span className="text-[10px] text-muted-foreground">
            {t("cite.count", { count: String(filtered.length) })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
            aria-label={t("cite.close")}
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
            placeholder={t("cite.search")}
            className="w-full text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* リスト */}
        <div className="flex-1 overflow-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">{t("cite.noResults")}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((entry) => {
                const checked = selectedIds.has(entry.noteId);
                return (
                  <li key={entry.noteId}>
                    <button
                      type="button"
                      onClick={() => toggleSelect(entry.noteId)}
                      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded border transition-colors text-left ${
                        checked
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:bg-muted"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 shrink-0 rounded border ${
                          checked
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border bg-background"
                        }`}
                        aria-hidden="true"
                      >
                        {checked ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-foreground truncate">
                          {entry.title || t("cite.untitled")}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {new Date(entry.modifiedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border">
          <span className="text-[10px] text-muted-foreground">
            {t("cite.selectedCount", { count: String(selectedIds.size) })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
            >
              {t("cite.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {t("cite.insert")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
