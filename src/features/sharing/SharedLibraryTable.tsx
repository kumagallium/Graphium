// Shared Library の一覧表示（表形式）。
// NoteListView / NoteListToolbar / FilterPopup と同じ「型」を踏襲する
// （表のクラス・列ヘッダの絞り込み・トリガー座標を state で持つ作法）。
//
// 呼び出し側（SharedLibraryView）が type タブ（note / knowledge / asset）に
// 応じて entries を絞ってから渡す。ここでは検索・並び替え・絞り込みのみを担う。

import { useMemo, useRef, useState } from "react";
import { Check, Filter, GitFork, Link2, Trash2 } from "lucide-react";
import type { AuthorIdentity } from "../document-provenance/types";
import type { SharedEntry } from "../../lib/storage/shared";
import { NoteListToolbar } from "../navigation/NoteListToolbar";
import { FilterPopup, type FilterOption } from "../../ui/filter-popup";
import { formatDate } from "../../lib/format-datetime";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import { HashBadge, type HashStatus } from "./hash-badge";

export type SharedLibraryTab = "note" | "knowledge" | "asset";
export type SharedLibrarySortKey = "updatedAt" | "title" | "author" | "version";
export type SharedLibraryTableProps = {
  tab: SharedLibraryTab;
  /** 呼び出し側で tab 分に絞ってある */
  entries: SharedEntry[];
  currentIdentity: AuthorIdentity | null;
  hashStatus: Record<string, HashStatus>;
  selectedId: string | null;
  busyId: string | null;
  copiedId: string | null;
  onSelect: (entry: SharedEntry) => void;
  onVerifyHash: (entry: SharedEntry) => void;
  onCopyCitation: (entry: SharedEntry) => void;
  /** 他人作かつ fork 可能（note / knowledge）な行だけに出す */
  onFork?: (entry: SharedEntry) => void;
  /** 自分作の行だけに出す */
  onUnshare: (entry: SharedEntry) => void;
};

const SORT_OPTIONS: { key: SharedLibrarySortKey; labelKey: string }[] = [
  { key: "updatedAt", labelKey: "library.sort.sharedAt" },
  { key: "title", labelKey: "library.sort.title" },
  { key: "author", labelKey: "library.sort.author" },
  { key: "version", labelKey: "library.sort.version" },
];

function entryTitle(entry: SharedEntry, t: (k: string) => string): string {
  const title = (entry.extra as Record<string, unknown> | undefined)?.title;
  if (typeof title === "string" && title.trim()) return title;
  return t("library.untitled");
}

/** 種別列の表示値。asset タブは reference/data-manifest、knowledge タブは wikiKind。 */
function entryKind(entry: SharedEntry, t: (k: string) => string): { value: string; label: string } {
  const extra = entry.extra as Record<string, unknown> | undefined;
  if (entry.type === "reference") {
    return { value: "url", label: t("asset.type.url") };
  }
  if (entry.type === "data-manifest") {
    const mediaType = typeof extra?.media_type === "string" ? extra.media_type : "other";
    return { value: mediaType, label: t(`asset.type.${mediaType}`) };
  }
  if (entry.type === "knowledge") {
    const wikiKind = typeof extra?.wikiKind === "string" ? extra.wikiKind : "";
    // wikiKind の表示名キーは無い（自由拡張中の分類のため生文字列を表示）
    return { value: wikiKind, label: wikiKind };
  }
  return { value: entry.type, label: entry.type };
}

function isForkable(type: SharedEntry["type"]): boolean {
  return type === "note" || type === "knowledge";
}

export function SharedLibraryTable({
  tab,
  entries,
  currentIdentity,
  hashStatus,
  selectedId,
  busyId,
  copiedId,
  onSelect,
  onVerifyHash,
  onCopyCitation,
  onFork,
  onUnshare,
}: SharedLibraryTableProps) {
  const t = useT();
  const showKindColumn = tab === "asset" || tab === "knowledge";

  const [sortKey, setSortKey] = useState<SharedLibrarySortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);

  const [kindFilterOpen, setKindFilterOpen] = useState(false);
  const [kindFilterPos, setKindFilterPos] = useState({ top: 0, left: 0 });
  const kindFilterBtnRef = useRef<HTMLButtonElement>(null);
  const [authorFilterOpen, setAuthorFilterOpen] = useState(false);
  const [authorFilterPos, setAuthorFilterPos] = useState({ top: 0, left: 0 });
  const authorFilterBtnRef = useRef<HTMLButtonElement>(null);

  const handleSort = (key: SharedLibrarySortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "title" ? "asc" : "desc");
  };

  const kindFilterOptions = useMemo<FilterOption[]>(() => {
    if (!showKindColumn) return [];
    const counts = new Map<string, { label: string; count: number }>();
    for (const entry of entries) {
      const kind = entryKind(entry, t);
      if (!kind.value) continue;
      const prev = counts.get(kind.value);
      counts.set(kind.value, { label: kind.label, count: (prev?.count ?? 0) + 1 });
    }
    return Array.from(counts.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [entries, showKindColumn, t]);

  const authorFilterOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const entry of entries) {
      const email = entry.author?.email;
      if (!email) continue;
      const prev = counts.get(email);
      counts.set(email, {
        label: entry.author?.name ?? email,
        count: (prev?.count ?? 0) + 1,
      });
    }
    return Array.from(counts.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [entries]);

  const filtered = useMemo(() => {
    let result = entries;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((entry) => {
        const title = entryTitle(entry, t).toLowerCase();
        const authorName = (entry.author?.name ?? "").toLowerCase();
        return title.includes(q) || authorName.includes(q);
      });
    }

    if (kindFilter.length > 0) {
      const set = new Set(kindFilter);
      result = result.filter((entry) => set.has(entryKind(entry, t).value));
    }

    if (authorFilter.length > 0) {
      const set = new Set(authorFilter);
      result = result.filter((entry) => set.has(entry.author?.email ?? ""));
    }

    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "updatedAt":
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
        case "title":
          cmp = entryTitle(a, t).localeCompare(entryTitle(b, t), "ja");
          break;
        case "author":
          cmp = (a.author?.name ?? "").localeCompare(b.author?.name ?? "", "ja");
          break;
        case "version":
          cmp = (a.version ?? 1) - (b.version ?? 1);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [entries, searchQuery, kindFilter, authorFilter, sortKey, sortDir, t]);

  const emptyKey =
    tab === "note" ? "library.empty.note" : tab === "knowledge" ? "library.empty.knowledge" : "library.empty.asset";
  const isFilteredEmpty = entries.length > 0 && filtered.length === 0;

  return (
    <div className="flex flex-col h-full">
      <NoteListToolbar<SharedLibrarySortKey>
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        sortOptions={SORT_OPTIONS}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">{t(emptyKey)}</div>
        ) : isFilteredEmpty ? (
          <div className="text-center py-12 text-sm text-muted-foreground">{t("library.noMatch")}</div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th
                  className="py-2 px-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("title")}
                >
                  {t("library.col.title")}
                  {sortKey === "title" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                {showKindColumn && (
                  <th className="py-2 px-3 w-[120px]">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("library.col.kind")}</span>
                      {kindFilterOptions.length > 0 && (
                        <button
                          ref={kindFilterBtnRef}
                          type="button"
                          onClick={() => {
                            if (kindFilterBtnRef.current) {
                              const rect = kindFilterBtnRef.current.getBoundingClientRect();
                              setKindFilterPos({ top: rect.bottom + 4, left: rect.left });
                            }
                            setKindFilterOpen((v) => !v);
                          }}
                          className={cn(
                            "inline-flex items-center justify-center w-5 h-5 rounded transition-colors",
                            kindFilter.length > 0
                              ? "text-primary bg-primary/10 hover:bg-primary/15"
                              : "text-text-tertiary hover:text-foreground hover:bg-muted",
                          )}
                          aria-label={t("library.filterKind")}
                          title={t("library.filterKind")}
                        >
                          <Filter size={12} strokeWidth={2.25} />
                        </button>
                      )}
                      {kindFilter.length > 0 && (
                        <span className="text-[10px] tabular-nums text-primary">({kindFilter.length})</span>
                      )}
                    </div>
                  </th>
                )}
                <th className="py-2 px-3 w-[140px]">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => handleSort("author")}
                    >
                      {t("nav.author")}
                      {sortKey === "author" && (sortDir === "desc" ? " ↓" : " ↑")}
                    </button>
                    {authorFilterOptions.length > 0 && (
                      <button
                        ref={authorFilterBtnRef}
                        type="button"
                        onClick={() => {
                          if (authorFilterBtnRef.current) {
                            const rect = authorFilterBtnRef.current.getBoundingClientRect();
                            setAuthorFilterPos({ top: rect.bottom + 4, left: rect.left });
                          }
                          setAuthorFilterOpen((v) => !v);
                        }}
                        className={cn(
                          "inline-flex items-center justify-center w-5 h-5 rounded transition-colors",
                          authorFilter.length > 0
                            ? "text-primary bg-primary/10 hover:bg-primary/15"
                            : "text-text-tertiary hover:text-foreground hover:bg-muted",
                        )}
                        aria-label={t("nav.filterAuthor")}
                        title={t("nav.filterAuthor")}
                      >
                        <Filter size={12} strokeWidth={2.25} />
                      </button>
                    )}
                    {authorFilter.length > 0 && (
                      <span className="text-[10px] tabular-nums text-primary">({authorFilter.length})</span>
                    )}
                  </div>
                </th>
                <th
                  className="py-2 px-3 w-[110px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("updatedAt")}
                >
                  {t("library.col.sharedAt")}
                  {sortKey === "updatedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 px-3 w-[56px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("version")}
                >
                  {t("library.col.version")}
                  {sortKey === "version" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-3 w-[72px]">{t("library.col.verified")}</th>
                <th className="py-2 px-3 w-[110px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const isMine = !!currentIdentity && entry.author?.email === currentIdentity.email;
                const status = hashStatus[entry.id] ?? "unknown";
                const isBusy = busyId === entry.id;
                const kind = showKindColumn ? entryKind(entry, t) : null;
                return (
                  <tr
                    key={entry.id}
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group",
                      selectedId === entry.id ? "bg-primary/5" : "",
                    )}
                    onClick={() => onSelect(entry)}
                  >
                    <td className="py-2 px-3">
                      <span className="text-foreground">{entryTitle(entry, t)}</span>
                    </td>
                    {showKindColumn && (
                      <td className="py-2 px-3 text-xs text-muted-foreground">{kind?.label}</td>
                    )}
                    <td className="py-2 px-3 text-xs text-muted-foreground truncate" title={entry.author?.email}>
                      <span className="inline-flex items-center gap-1">
                        <span className="truncate">{entry.author?.name ?? t("library.unknownAuthor")}</span>
                        {isMine && (
                          <span className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[9px] uppercase tracking-wide shrink-0">
                            {t("library.you")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(entry.updated_at)}
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground tabular-nums">
                      v{entry.version ?? 1}
                    </td>
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      <HashBadge
                        status={status}
                        onClick={() => onVerifyHash(entry)}
                      />
                    </td>
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onCopyCitation(entry)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title={t("share.copyCitation")}
                        >
                          {copiedId === entry.id ? (
                            <Check size={13} className="text-emerald-600" />
                          ) : (
                            <Link2 size={13} />
                          )}
                        </button>
                        {!isMine && onFork && isForkable(entry.type) && (
                          <button
                            onClick={() => onFork(entry)}
                            disabled={isBusy}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                            title={
                              entry.type === "knowledge"
                                ? t("library.forkToKnowledge")
                                : t("library.forkToNotes")
                            }
                          >
                            <GitFork size={13} />
                          </button>
                        )}
                        {isMine && (
                          <button
                            onClick={() => onUnshare(entry)}
                            disabled={isBusy}
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            title={t("library.unshare")}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {kindFilterOpen && (
        <FilterPopup
          position={kindFilterPos}
          onClose={() => setKindFilterOpen(false)}
          title={t("library.filterKind")}
          options={kindFilterOptions}
          selected={kindFilter}
          onChange={setKindFilter}
          searchPlaceholder={t("common.search")}
          clearLabel={t("nav.clearFilter")}
          noMatchText={t("library.noMatch")}
          minWidth={200}
        />
      )}
      {authorFilterOpen && (
        <FilterPopup
          position={authorFilterPos}
          onClose={() => setAuthorFilterOpen(false)}
          title={t("nav.filterAuthor")}
          options={authorFilterOptions}
          selected={authorFilter}
          onChange={setAuthorFilter}
          searchPlaceholder={t("common.search")}
          clearLabel={t("nav.clearFilter")}
          noMatchText={t("library.noMatch")}
          minWidth={220}
        />
      )}
    </div>
  );
}
