// 共有エントリ引用ピッカーモーダル（複数選択）。
// スラッシュメニュー「共有エントリを引用」から呼び出し、Library（shared root）の
// エントリを選んで sharedCitation ブロックとして挿入する。
// UI は CitePickerModal（ローカル知見/洞察の引用）を踏襲する。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  Database,
  FileText,
  LayoutTemplate,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useT } from "../../i18n";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";
import {
  getSharedLibraryRoot,
  refreshSharedLibrary,
  useSharedLibrary,
} from "./shared-library-store";
import { formatDate } from "../../lib/format-datetime";

const TYPE_ICONS: Record<string, LucideIcon> = {
  note: FileText,
  reference: BookOpen,
  "data-manifest": Database,
  template: LayoutTemplate,
  knowledge: Brain,
  report: ScrollText,
};

function entryTitle(entry: SharedEntry): string {
  const title = (entry.extra as Record<string, unknown> | undefined)?.title;
  if (typeof title === "string" && title.trim()) return title;
  return `(untitled ${entry.type})`;
}

export type SharedCitePickerModalProps = {
  onConfirm: (entries: SharedEntry[]) => void;
  onClose: () => void;
};

export function SharedCitePickerModal({
  onConfirm,
  onClose,
}: SharedCitePickerModalProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // 共有エントリは共有ストアから受け取る（tombstone はローダー側で除外済み）。
  // 開いた時点で最新に合わせたいので refresh を 1 回だけ促す（進行中なら相乗り）
  const shared = useSharedLibrary();
  const entries = shared.entries;
  const loading = shared.loading && shared.loadedAt === null;
  const sharedLibraryRoot = getSharedLibraryRoot();
  useEffect(() => {
    void refreshSharedLibrary();
  }, []);

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

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries
      .filter((e) =>
        q
          ? entryTitle(e).toLowerCase().includes(q) ||
            (e.author?.name ?? "").toLowerCase().includes(q)
          : true,
      )
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
  }, [entries, searchQuery]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedIds.size === 0) return;
    const picked = filtered.filter((e) => selectedIds.has(e.id));
    onConfirm(picked);
    onClose();
  }, [filtered, selectedIds, onConfirm, onClose]);

  // Cmd/Ctrl+Enter で確定
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("citation.picker.title")}
          </h2>
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
            placeholder={t("citation.picker.searchPlaceholder")}
            className="w-full px-2.5 py-1.5 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* 一覧 */}
        <div className="flex-1 overflow-y-auto px-2 py-1.5">
          {!sharedLibraryRoot ? (
            <div className="text-center py-10 text-xs text-muted-foreground px-6">
              {t("share.disabled.noRoot")}
            </div>
          ) : loading ? (
            <div className="text-center py-10 text-xs text-muted-foreground">
              {t("citation.picker.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-xs text-muted-foreground">
              {t("citation.picker.empty")}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((entry) => {
                const checked = selectedIds.has(entry.id);
                const Icon = TYPE_ICONS[entry.type] ?? FileText;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => toggleSelect(entry.id)}
                      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded text-left border transition-colors ${
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
                          {entryTitle(entry)}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="inline-flex items-center gap-0.5 uppercase tracking-wide">
                            <Icon size={10} />
                            {t(`citation.type.${entry.type}` as never)}
                          </span>
                          <span className="opacity-50">·</span>
                          <span className="truncate">
                            {entry.author?.name ?? "(unknown)"}
                          </span>
                          <span className="opacity-50">·</span>
                          <span>{formatDate(entry.updated_at)}</span>
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
