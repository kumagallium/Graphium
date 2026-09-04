// Shared Library の一覧表示（表形式）。
// NoteListView / NoteListToolbar / FilterPopup と同じ「型」を踏襲する
// （表のクラス・列ヘッダの絞り込み・トリガー座標を state で持つ作法）。
//
// 呼び出し側（SharedLibraryView）が type タブ（note / knowledge / asset）に
// 応じて entries を絞ってから渡す。ここでは検索・並び替え・絞り込みのみを担う。

import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Download, FileText, Filter, GitFork, Link2, Paperclip, Trash2 } from "lucide-react";
import type { AuthorIdentity } from "../document-provenance/types";
import type { BlobRef, SharedEntry } from "../../lib/storage/shared";
import { NoteListToolbar } from "../navigation/NoteListToolbar";
import { ContextBadge } from "../note-context/ContextBadge";
import { aggregateNoteContexts, noteContextHue } from "../note-context/context-tags";
import { UNFILED_PATH } from "../note-context/folder-tree-model";
import { getSharedNoteContexts, useSharedLibrary } from "./shared-library-store";
import {
  blobKindLabelKey,
  blobRowTitle,
  buildSharedBlobRows,
  type SharedAssetItem,
} from "./shared-blob-rows";
import { FilterPopup, type FilterOption } from "../../ui/filter-popup";
import { formatDate } from "../../lib/format-datetime";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import { HashBadge, type HashStatus } from "./hash-badge";

// ラベル / プロセスは共有ノートの投影から描くタブで、この表は使わない。
// タブの識別子だけ共通の型に載せる（呼び出し側のタブ状態が 1 つで済む）。
export type SharedLibraryTab = "note" | "knowledge" | "asset" | "labels" | "process";
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
  /**
   * 素材タブに仮想行として並べる「共有ノート内の画像・ファイル」の親。
   * 呼び出し側が extra.blobs を持つ note エントリだけを絞って渡す。
   */
  blobParents?: SharedEntry[];
  /**
   * blob 行の「自分の素材に取り込む」。blob root 未設定などで取り込めないときは
   * 未指定にする（操作は無効化して理由をツールチップで出す）。
   */
  onImportBlob?: (parent: SharedEntry, blob: BlobRef) => Promise<void>;
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

// FilterPopup の左側に置く小さな色チップ（NoteListView の LabelDot と同じ見た目）。
// 表本体の ContextBadge と同じ HSL を使い、絞り込みの選択肢と行のピルが同じ色で対応する。
// color 無しは「色を持たない選択肢」（未分類）用の中空チップ — 行の左端が揃うようにする。
function LabelDot({ color }: { color?: string }) {
  return (
    <span
      className={cn("block w-2.5 h-2.5 rounded-full", color ? "" : "border border-border")}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

function isForkable(type: SharedEntry["type"]): boolean {
  return type === "note" || type === "knowledge";
}

// ── 行（SharedAssetItem）へのアクセサ ──
// blob 行は SharedEntry ではないので、作者・共有日・フォルダは親ノートから引く。
// 検索 / 絞り込み / 並び替えを 1 本の経路で回すために、値の取り出しをここに集める。

/** 作者・共有日・フォルダ・行クリックの起点になるエントリ（blob 行は親ノート）。 */
function itemSourceEntry(item: SharedAssetItem): SharedEntry {
  return item.kind === "entry" ? item.entry : item.parent;
}

function itemKey(item: SharedAssetItem): string {
  return item.kind === "entry" ? `entry:${item.entry.id}` : item.key;
}

function itemTitle(item: SharedAssetItem, t: (k: string) => string): string {
  return item.kind === "entry" ? entryTitle(item.entry, t) : blobRowTitle(item);
}

function itemKind(
  item: SharedAssetItem,
  t: (k: string) => string,
): { value: string; label: string } {
  if (item.kind === "entry") return entryKind(item.entry, t);
  const key = blobKindLabelKey(item.blob);
  return { value: key, label: t(key) };
}

/** 版の並び替え用。blob 行は版を持たないので 0（共有エントリより後ろに寄る）。 */
function itemVersion(item: SharedAssetItem): number {
  return item.kind === "entry" ? (item.entry.version ?? 1) : 0;
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
  blobParents,
  onImportBlob,
}: SharedLibraryTableProps) {
  const t = useT();
  const showKindColumn = tab === "asset" || tab === "knowledge";
  // 素材のフォルダは共有時に書かれた extra.noteContexts（自分で付けた分 ∪ 貼ったノート由来）。
  // ノートと同じ意味の列なので、ノート一覧と同じ見せ方で出す（鏡の原則）
  const showFolderColumn = tab === "note" || tab === "asset";
  // 表は表示専用なので、フォルダの値はストアのスナップショットから引く
  // （共有時に書かれた extra を優先し、無ければ本文から拾った控えで補う）
  const sharedSnapshot = useSharedLibrary();

  const [sortKey, setSortKey] = useState<SharedLibrarySortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string[]>([]);

  // blob 行の取り込み中表示。busyId は共有エントリ id なので blob 行には使えない
  const [importingKey, setImportingKey] = useState<string | null>(null);

  const [folderFilterOpen, setFolderFilterOpen] = useState(false);
  const [folderFilterPos, setFolderFilterPos] = useState({ top: 0, left: 0 });
  const folderFilterBtnRef = useRef<HTMLButtonElement>(null);
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

  // 共有ノート内の画像・ファイルは SharedEntry ではないので、行として合流させる。
  // blobParents は素材タブのときだけ渡ってくる（他タブは kind: "entry" だけになる）
  const blobRows = useMemo(
    () => (blobParents?.length ? buildSharedBlobRows(blobParents) : []),
    [blobParents],
  );
  const items = useMemo<SharedAssetItem[]>(
    () => [
      ...entries.map((entry) => ({ kind: "entry" as const, entry })),
      ...blobRows.map((row) => ({ kind: "blob" as const, ...row })),
    ],
    [entries, blobRows],
  );
  // 出どころ列は blob 行があるときだけ意味を持つ（無ければ全行ダッシュになる）
  const showOriginColumn = blobRows.length > 0;

  const kindFilterOptions = useMemo<FilterOption[]>(() => {
    if (!showKindColumn) return [];
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of items) {
      const kind = itemKind(item, t);
      if (!kind.value) continue;
      const prev = counts.get(kind.value);
      counts.set(kind.value, { label: kind.label, count: (prev?.count ?? 0) + 1 });
    }
    return Array.from(counts.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [items, showKindColumn, t]);

  const contextsOf = useCallback(
    (entry: SharedEntry) => getSharedNoteContexts(entry, sharedSnapshot),
    [sharedSnapshot],
  );

  const authorFilterOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of items) {
      const entry = itemSourceEntry(item);
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
  }, [items]);

  // フォルダの選択肢（表示中の行から集計）。「未分類」は該当が 1 件以上あるときだけ出す
  const folderFilterOptions = useMemo<FilterOption[]>(() => {
    if (!showFolderColumn) return [];
    const options: FilterOption[] = aggregateNoteContexts(
      items.map((item) => ({ noteContexts: contextsOf(itemSourceEntry(item)) })),
    )
      // 色チップはノート一覧のフォルダ列フィルタと同じ（表のピルと同色で対応が付く）
      .map(({ value, count }) => ({
        value,
        label: value,
        count,
        icon: <LabelDot color={`hsl(${noteContextHue(value)} 45% 45%)`} />,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
    const unfiled = items.filter((item) => contextsOf(itemSourceEntry(item)).length === 0).length;
    // 未分類は実在するフォルダではないので色を持たない（中空チップで左端だけ揃える）
    if (unfiled > 0)
      options.push({ value: UNFILED_PATH, label: t("nav.unfiled"), count: unfiled, icon: <LabelDot /> });
    return options;
  }, [items, showFolderColumn, contextsOf, t]);

  const filtered = useMemo(() => {
    let result = items;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((item) => {
        const entry = itemSourceEntry(item);
        const title = itemTitle(item, t).toLowerCase();
        const authorName = (entry.author?.name ?? "").toLowerCase();
        // フォルダ名も検索対象（列に出ている値はどれも同じ部分一致で当たる）
        const folderHit =
          showFolderColumn && contextsOf(entry).some((c) => c.toLowerCase().includes(q));
        return title.includes(q) || authorName.includes(q) || folderHit;
      });
    }

    // フォルダフィルタ（OR） — 小文字比較で名寄せする。
    // UNFILED_PATH は「フォルダ無し」を意味する特殊値（ノート一覧と同じ扱い）
    if (folderFilter.length > 0) {
      const hasUnfiled = folderFilter.includes(UNFILED_PATH);
      const set = new Set(
        folderFilter.filter((c) => c !== UNFILED_PATH).map((c) => c.toLowerCase()),
      );
      result = result.filter((item) => {
        const contexts = contextsOf(itemSourceEntry(item));
        return (
          (hasUnfiled && contexts.length === 0) || contexts.some((c) => set.has(c.toLowerCase()))
        );
      });
    }

    if (kindFilter.length > 0) {
      const set = new Set(kindFilter);
      result = result.filter((item) => set.has(itemKind(item, t).value));
    }

    if (authorFilter.length > 0) {
      const set = new Set(authorFilter);
      result = result.filter((item) => set.has(itemSourceEntry(item).author?.email ?? ""));
    }

    const sorted = [...result].sort((x, y) => {
      const a = itemSourceEntry(x);
      const b = itemSourceEntry(y);
      let cmp = 0;
      switch (sortKey) {
        case "updatedAt":
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
        case "title":
          cmp = itemTitle(x, t).localeCompare(itemTitle(y, t), "ja");
          break;
        case "author":
          cmp = (a.author?.name ?? "").localeCompare(b.author?.name ?? "", "ja");
          break;
        case "version":
          cmp = itemVersion(x) - itemVersion(y);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [items, searchQuery, kindFilter, authorFilter, folderFilter, contextsOf, showFolderColumn, sortKey, sortDir, t]);

  const handleImportBlob = useCallback(
    async (parent: SharedEntry, item: SharedAssetItem & { kind: "blob" }) => {
      if (!onImportBlob) return;
      setImportingKey(item.key);
      try {
        await onImportBlob(parent, item.blob);
      } finally {
        setImportingKey(null);
      }
    },
    [onImportBlob],
  );

  const emptyKey =
    tab === "note" ? "library.empty.note" : tab === "knowledge" ? "library.empty.knowledge" : "library.empty.asset";
  const isFilteredEmpty = items.length > 0 && filtered.length === 0;

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
        {items.length === 0 ? (
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
                {/* フォルダ列（共有した時点のフォルダ）。ノート一覧の同名列と同じ見せ方 */}
                {showFolderColumn && (
                  <th className="py-2 px-3 w-[150px]" title={t("nav.noteContextsTooltip")}>
                    <div className="inline-flex items-center gap-1">
                      <span>{t("nav.noteContexts")}</span>
                      {folderFilterOptions.length > 0 && (
                        <button
                          ref={folderFilterBtnRef}
                          type="button"
                          onClick={() => {
                            if (folderFilterBtnRef.current) {
                              const rect = folderFilterBtnRef.current.getBoundingClientRect();
                              setFolderFilterPos({ top: rect.bottom + 4, left: rect.left });
                            }
                            setFolderFilterOpen((v) => !v);
                          }}
                          className={cn(
                            "inline-flex items-center justify-center w-5 h-5 rounded transition-colors",
                            folderFilter.length > 0
                              ? "text-primary bg-primary/10 hover:bg-primary/15"
                              : "text-text-tertiary hover:text-foreground hover:bg-muted",
                          )}
                          aria-label={t("library.filterFolder")}
                          title={t("library.filterFolder")}
                        >
                          <Filter size={12} strokeWidth={2.25} />
                        </button>
                      )}
                      {folderFilter.length > 0 && (
                        <span className="text-[10px] tabular-nums text-primary">({folderFilter.length})</span>
                      )}
                    </div>
                  </th>
                )}
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
                {/* 出どころ（blob 行がどの共有ノートに貼られているか）。
                    共有エントリ自身は「出どころ」を持たないので空欄になる */}
                {showOriginColumn && (
                  <th className="py-2 px-3 w-[140px]">{t("library.col.origins")}</th>
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
              {filtered.map((item) => {
                // blob 行は SharedEntry ではないので、作者・共有日・フォルダ・行クリックは親ノートを使う
                const source = itemSourceEntry(item);
                const entry = item.kind === "entry" ? item.entry : null;
                const isMine = !!currentIdentity && source.author?.email === currentIdentity.email;
                const status = entry ? (hashStatus[entry.id] ?? "unknown") : "unknown";
                const isBusy = entry ? busyId === entry.id : importingKey === itemKey(item);
                const kind = showKindColumn ? itemKind(item, t) : null;
                const contexts = showFolderColumn ? contextsOf(source) : [];
                return (
                  <tr
                    key={itemKey(item)}
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group",
                      entry && selectedId === entry.id ? "bg-primary/5" : "",
                    )}
                    onClick={() => onSelect(source)}
                  >
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        {/* ノートに貼られたファイル（共有エントリではない）と分かるようにする */}
                        {item.kind === "blob" && (
                          <Paperclip size={12} className="text-muted-foreground shrink-0" />
                        )}
                        {itemTitle(item, t)}
                      </span>
                    </td>
                    {showFolderColumn && (
                      <td className="py-2 px-3">
                        {contexts.length > 0 ? (
                          <span
                            className="inline-flex flex-wrap items-center gap-1"
                            title={contexts.join(", ")}
                          >
                            {contexts.slice(0, 2).map((c) => (
                              <ContextBadge key={c} value={c} />
                            ))}
                            {contexts.length > 2 && (
                              <span className="text-[11px] text-muted-foreground">
                                +{contexts.length - 2}
                              </span>
                            )}
                          </span>
                        ) : (
                          // 空欄のダッシュはノート一覧と同じ薄さ（/30）にする
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    )}
                    {showKindColumn && (
                      <td className="py-2 px-3 text-xs text-muted-foreground">{kind?.label}</td>
                    )}
                    {showOriginColumn && (
                      <td className="py-2 px-3 text-xs text-muted-foreground truncate">
                        {item.kind === "blob" ? (
                          item.parents.length > 1 ? (
                            <span title={item.parents.map((p) => entryTitle(p, t)).join(", ")}>
                              {t("library.blobOrigins", { count: String(item.parents.length) })}
                            </span>
                          ) : (
                            <span className="truncate">{entryTitle(item.parent, t)}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-3 text-xs text-muted-foreground truncate" title={source.author?.email}>
                      <span className="inline-flex items-center gap-1">
                        <span className="truncate">{source.author?.name ?? t("library.unknownAuthor")}</span>
                        {isMine && (
                          <span className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[9px] uppercase tracking-wide shrink-0">
                            {t("library.you")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(source.updated_at)}
                    </td>
                    {/* blob は共有エントリではないので版も検証（hash 照合）も持たない。空欄にする */}
                    <td className="py-2 px-3 text-xs text-muted-foreground tabular-nums">
                      {entry ? `v${entry.version ?? 1}` : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      {entry ? (
                        <HashBadge
                          status={status}
                          onClick={() => onVerifyHash(entry)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground/30">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {item.kind === "blob" && (
                          <>
                            <button
                              onClick={() => onSelect(item.parent)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title={t("library.openParentNote")}
                              aria-label={t("library.openParentNote")}
                            >
                              <FileText size={13} />
                            </button>
                            <button
                              onClick={() => void handleImportBlob(item.parent, item)}
                              // 取り込みは blob root から bytes を読む。未設定なら押せない理由を出す
                              disabled={!onImportBlob || isBusy}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                              title={
                                onImportBlob ? t("library.importBlob") : t("share.noBlobRootPreview")
                              }
                              aria-label={t("library.importBlob")}
                            >
                              <Download size={13} />
                            </button>
                          </>
                        )}
                        {entry && (
                          <>
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
                          </>
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

      {folderFilterOpen && (
        <FilterPopup
          position={folderFilterPos}
          onClose={() => setFolderFilterOpen(false)}
          title={t("library.filterFolder")}
          options={folderFilterOptions}
          selected={folderFilter}
          onChange={setFolderFilter}
          searchPlaceholder={t("common.search")}
          clearLabel={t("nav.clearFilter")}
          noMatchText={t("library.noMatch")}
          minWidth={220}
        />
      )}
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
