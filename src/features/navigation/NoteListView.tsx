// ノート一覧ビュー（メインエディタ領域に表示）
// 全ノートをテーブル形式で表示し、ソート・フィルタ・検索・削除に対応

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Download, Filter } from "lucide-react";
import { Dropdown } from "@/ui/dropdown";
import { MenuItem } from "@/ui/menu-item";
import { FilterPopup, type FilterOption } from "@/ui/filter-popup";
import {
  IndexFileNoteListSource,
  type NoteListEntry,
} from "./note-list-source";
import type { GraphiumIndex } from "./index-file";
import { NoteListToolbar, type SortKey, type SortDirection } from "./NoteListToolbar";
import { useT, getDisplayLabelName } from "../../i18n";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useRangeSelect } from "../../hooks/use-range-select";
import { formatDateTime } from "../../lib/format-datetime";
import { cn } from "../../lib/utils";

// ラベル色マッピング（design.md PROV-DM ラベル色準拠）
// ノート内の SideMenu バッジと同じゴーストスタイル: 薄い背景 + ラベル色テキスト + 薄いボーダー
const LABEL_HEX: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  result: "#c26356",
};

// FilterPopup の左側に置く小さな色チップ
function LabelDot({ color }: { color: string }) {
  return (
    <span
      className="block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}


// 削除確認ダイアログ
function DeleteConfirmDialog({
  count,
  onConfirm,
  onCancel,
  deleting,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("nav.deleteConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("nav.deleteConfirmMessage", { count: String(count) })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("nav.deleteConfirmCancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {deleting ? t("nav.deleting") : t("nav.deleteConfirmOk")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NoteListView({
  noteIndex,
  onOpenNote,
  onOpenNoteFull,
  onBack,
  onDeleteNotes,
  onOpenWikiPeek,
  onImportDocx,
  onImportMarkdown,
  onIngestNotes,
}: {
  noteIndex: GraphiumIndex | null;
  /** クリック時のコールバック（サイドピーク表示用） */
  onOpenNote: (noteId: string) => void;
  /** ダブルクリック or フルで開くコールバック */
  onOpenNoteFull?: (noteId: string) => void;
  onBack: () => void;
  onDeleteNotes?: (noteIds: string[]) => Promise<void>;
  /** Knowledge アイコン押下で対応 wiki エントリをサイドピークで開くコールバック */
  onOpenWikiPeek?: (wikiNoteId: string) => void;
  /** Word ファイルインポート（複数ファイル可、進捗コールバック付き） */
  onImportDocx?: (
    files: File[],
    onProgress: (p: { done: number; total: number; current?: string; failed: string[] }) => void,
  ) => Promise<void>;
  /**
   * Markdown ファイル / Obsidian Vault フォルダのインポート。
   * webkitdirectory のフォルダ選択時は files に複数の MD と画像が混在し、
   * 単体選択時は 1 つの .md のみが渡る。
   */
  onImportMarkdown?: (
    files: File[],
    onProgress: (p: { done: number; total: number; current?: string; failed: string[] }) => void,
  ) => Promise<void>;
  /** 選択中ノートを Knowledge 化（既存トーストキューに登録） */
  onIngestNotes?: (noteIds: string[]) => Promise<void>;
}) {
  const [entries, setEntries] = useState<NoteListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // 列ヘッダから開く filter popup の表示状態と位置
  const [labelFilterOpen, setLabelFilterOpen] = useState(false);
  const [labelFilterPos, setLabelFilterPos] = useState({ top: 0, left: 0 });
  const labelFilterBtnRef = useRef<HTMLButtonElement>(null);
  const [authorFilterOpen, setAuthorFilterOpen] = useState(false);
  const [authorFilterPos, setAuthorFilterPos] = useState({ top: 0, left: 0 });
  const authorFilterBtnRef = useRef<HTMLButtonElement>(null);
  // 選択状態
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 削除確認ダイアログ
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  // インポート
  const importInputRef = useRef<HTMLInputElement>(null);
  const importMdInputRef = useRef<HTMLInputElement>(null);
  const importMdFolderInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const [importing, setImporting] = useState(false);
  const [importKind, setImportKind] = useState<"docx" | "markdown" | null>(null);
  const [importMenuPos, setImportMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
    current?: string;
    failed: string[];
  } | null>(null);
  const t = useT();

  // インデックスからノート一覧を構築
  useEffect(() => {
    if (!noteIndex) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const source = new IndexFileNoteListSource(noteIndex);
      const result = await source.loadNoteList();
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [noteIndex]);

  // ソート切り替え
  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return key;
      }
      // 新しいキーの場合はデフォルト方向
      setSortDir(key === "title" ? "asc" : "desc");
      return key;
    });
  }, []);

  // フィルタ + ソート適用
  const filtered = useMemo(() => {
    let result = entries;

    // テキスト検索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((e) => e.title.toLowerCase().includes(q));
    }

    // ラベルフィルタ（AND） — 列ヘッダから絞り込み
    if (labelFilter.length > 0) {
      result = result.filter((e) =>
        labelFilter.every((label) => e.labels.includes(label))
      );
    }

    // 著者フィルタ（OR） — 列ヘッダから絞り込み
    if (authorFilter.length > 0) {
      const set = new Set(authorFilter);
      result = result.filter((e) => set.has(e.author ?? ""));
    }

    // ソート
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "outgoingLinkCount":
          cmp = a.outgoingLinkCount - b.outgoingLinkCount;
          break;
        case "incomingLinkCount":
          cmp = a.incomingLinkCount - b.incomingLinkCount;
          break;
        case "modifiedAt":
          cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "title":
          cmp = a.title.localeCompare(b.title, "ja");
          break;
        case "labels":
          // 先頭ラベルで比較（ラベル無しは最後）
          cmp = (a.labels[0] ?? "￿").localeCompare(b.labels[0] ?? "￿", "ja");
          break;
        case "knowledgeCount":
          cmp = a.knowledgeCount - b.knowledgeCount;
          break;
        case "author":
          cmp = (a.author ?? "￿").localeCompare(b.author ?? "￿", "ja");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [entries, searchQuery, labelFilter, authorFilter, sortKey, sortDir]);

  // 列ヘッダ filter の選択肢を entries から動的に集計
  const labelFilterOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const label of e.labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: getDisplayLabelName(value),
        count,
        icon: <LabelDot color={LABEL_HEX[value] ?? "#8fa394"} />,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [entries]);

  const authorFilterOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const a = e.author ?? "";
      if (!a) continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [entries]);

  // ドラッグ範囲選択（チェックボックス列）
  const orderedIds = useMemo(() => filtered.map((e) => e.noteId), [filtered]);
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);

  // 全選択 / 全解除（フィルタ後のリストに対して）
  const toggleSelectAll = useCallback(() => {
    const filteredIds = filtered.map((e) => e.noteId);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  }, [filtered, selectedIds]);

  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.noteId));
  const someSelected = selectedIds.size > 0;

  // 削除実行
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || !onDeleteNotes) return;
    setDeleting(true);
    try {
      await onDeleteNotes(deleteTarget);
      // 選択状態をクリア
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of deleteTarget) next.delete(id);
        return next;
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteNotes]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Breadcrumb items={[
          { label: "Home", onClick: onBack },
          { label: t("nav.noteList") },
        ]} />
        <span className="text-xs text-muted-foreground">
          {loading ? t("nav.loadingNotes") : t("nav.noteCount", { filtered: String(filtered.length), total: String(entries.length) })}
        </span>
        {/* インポートボタン（選択中でなければ表示） */}
        {!someSelected && (onImportDocx || onImportMarkdown) && (
          <button
            ref={importButtonRef}
            onClick={() => {
              if (importMenuPos) {
                setImportMenuPos(null);
                return;
              }
              const rect = importButtonRef.current?.getBoundingClientRect();
              if (rect) {
                setImportMenuPos({ top: rect.bottom + 4, left: rect.right - 220 });
              }
            }}
            disabled={importing}
            className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="ファイルを取り込む"
            aria-label="ファイルを取り込む"
          >
            <Download size={14} />
          </button>
        )}
        {importMenuPos && (
          <Dropdown
            position={importMenuPos}
            onClose={() => setImportMenuPos(null)}
            minWidth={220}
          >
            <div className="py-1">
              {onImportDocx && (
                <MenuItem
                  onClick={() => {
                    setImportMenuPos(null);
                    importInputRef.current?.click();
                  }}
                >
                  Word (.docx) を取り込む
                </MenuItem>
              )}
              {onImportMarkdown && (
                <>
                  <MenuItem
                    onClick={() => {
                      setImportMenuPos(null);
                      importMdInputRef.current?.click();
                    }}
                  >
                    Markdown (.md) を取り込む
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setImportMenuPos(null);
                      importMdFolderInputRef.current?.click();
                    }}
                  >
                    Obsidian Vault フォルダを取り込む
                  </MenuItem>
                </>
              )}
            </div>
          </Dropdown>
        )}
        <input
          ref={importInputRef}
          type="file"
          accept=".docx"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length === 0 || !onImportDocx) return;
            setImportKind("docx");
            setImporting(true);
            setImportProgress({ done: 0, total: files.length, failed: [] });
            try {
              await onImportDocx(files, (p) => setImportProgress(p));
            } finally {
              setImporting(false);
              setImportProgress((prev) => {
                if (!prev) return null;
                if (prev.failed.length === 0) {
                  setTimeout(() => setImportProgress(null), 2500);
                }
                return prev;
              });
            }
          }}
        />
        <input
          ref={importMdInputRef}
          type="file"
          accept=".md,.markdown"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length === 0 || !onImportMarkdown) return;
            setImportKind("markdown");
            setImporting(true);
            setImportProgress({ done: 0, total: files.length, failed: [] });
            try {
              await onImportMarkdown(files, (p) => setImportProgress(p));
            } finally {
              setImporting(false);
              setImportProgress((prev) => {
                if (!prev) return null;
                if (prev.failed.length === 0) {
                  setTimeout(() => setImportProgress(null), 2500);
                }
                return prev;
              });
            }
          }}
        />
        <input
          ref={importMdFolderInputRef}
          type="file"
          // webkitdirectory はフォルダ全体を渡す（型に存在しないので型上は ignore）
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length === 0 || !onImportMarkdown) return;
            setImportKind("markdown");
            setImporting(true);
            // 進捗 total は MD ファイル数。画像は副次なので別カウントしない
            const mdCount = files.filter((f) => /\.(md|markdown)$/i.test(f.name)).length;
            setImportProgress({ done: 0, total: Math.max(mdCount, 1), failed: [] });
            try {
              await onImportMarkdown(files, (p) => setImportProgress(p));
            } finally {
              setImporting(false);
              setImportProgress((prev) => {
                if (!prev) return null;
                if (prev.failed.length === 0) {
                  setTimeout(() => setImportProgress(null), 2500);
                }
                return prev;
              });
            }
          }}
        />
        {/* 一括アクション（複数選択時） */}
        {someSelected && (
          <div className="ml-auto flex items-center gap-2">
            {onIngestNotes && (
              <button
                onClick={async () => {
                  const ids = [...selectedIds];
                  await onIngestNotes(ids);
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1 text-xs font-medium rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                title="選択したノートから Concept / Summary を抽出してナレッジに追加します"
              >
                {selectedIds.size} 件を Knowledge 化
              </button>
            )}
            {onDeleteNotes && (
              <button
                onClick={() => setDeleteTarget([...selectedIds])}
                className="px-3 py-1 text-xs font-medium rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                {t("nav.deleteSelected", { count: String(selectedIds.size) })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* インポート進捗 */}
      {importProgress && (
        <div className="px-6 py-2 border-b border-border bg-muted/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              {importKind === "markdown" ? "Markdown 取り込み" : "Word 取り込み"}: {importProgress.done} / {importProgress.total}
              {importProgress.failed.length > 0 && (
                <span className="text-destructive ml-2">
                  （失敗: {importProgress.failed.length}）
                </span>
              )}
            </span>
            {!importing && (
              <button
                onClick={() => setImportProgress(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                閉じる
              </button>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%` }}
            />
          </div>
          {importProgress.current && importing && (
            <div className="text-[11px] text-muted-foreground truncate">
              処理中: {importProgress.current}
            </div>
          )}
          {importProgress.failed.length > 0 && !importing && (
            <div className="text-[11px] text-destructive">
              失敗したファイル: {importProgress.failed.join(", ")}
            </div>
          )}
        </div>
      )}

      {/* ツールバー */}
      <NoteListToolbar
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* テーブル */}
      <div className="flex-1 overflow-auto px-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("nav.loadingNotes")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {entries.length === 0 ? t("nav.noNotes") : t("nav.noMatchingNotes")}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                {/* チェックボックス列 */}
                {onDeleteNotes && (
                  <th className="py-2 px-2 w-[36px]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                      title={allSelected ? t("nav.deselectAll") : t("nav.selectAll")}
                    />
                  </th>
                )}
                <th
                  className="py-2 px-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("title")}
                >
                  {t("nav.noteColumn")}{sortKey === "title" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 px-2 w-[56px] cursor-pointer hover:text-foreground text-center"
                  onClick={() => handleSort("outgoingLinkCount")}
                  title="参照先（このノートが参照しているノート数）"
                >
                  {t("nav.outgoing")}{sortKey === "outgoingLinkCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 px-2 w-[56px] cursor-pointer hover:text-foreground text-center"
                  onClick={() => handleSort("incomingLinkCount")}
                  title="被参照（他ノートから参照されている数）"
                >
                  {t("nav.incoming")}{sortKey === "incomingLinkCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-3 w-[140px]">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => handleSort("labels")}
                    >
                      {t("nav.labels")}{sortKey === "labels" && (sortDir === "desc" ? " ↓" : " ↑")}
                    </button>
                    {labelFilterOptions.length > 0 && (
                      <button
                        ref={labelFilterBtnRef}
                        type="button"
                        onClick={() => {
                          if (labelFilterBtnRef.current) {
                            const rect = labelFilterBtnRef.current.getBoundingClientRect();
                            setLabelFilterPos({ top: rect.bottom + 4, left: rect.left });
                          }
                          setLabelFilterOpen((v) => !v);
                        }}
                        className={cn(
                          "inline-flex items-center justify-center w-5 h-5 rounded transition-colors",
                          labelFilter.length > 0
                            ? "text-primary bg-primary/10 hover:bg-primary/15"
                            : "text-text-tertiary hover:text-foreground hover:bg-muted",
                        )}
                        aria-label={t("nav.filterLabels")}
                        title={t("nav.filterLabels")}
                      >
                        <Filter size={12} strokeWidth={2.25} />
                      </button>
                    )}
                    {labelFilter.length > 0 && (
                      <span className="text-[10px] tabular-nums text-primary">
                        ({labelFilter.length})
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className="py-2 px-2 w-[56px] text-center cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("knowledgeCount")}
                  title={t("nav.knowledgeColumnTooltip")}
                >
                  <span className="inline-flex items-center justify-center" aria-label={t("nav.knowledgeColumn")}>
                    <BookOpen size={14} />
                  </span>
                  {sortKey === "knowledgeCount" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-2 w-[96px]" title={t("nav.authorTooltip")}>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => handleSort("author")}
                    >
                      {t("nav.author")}{sortKey === "author" && (sortDir === "desc" ? " ↓" : " ↑")}
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
                      <span className="text-[10px] tabular-nums text-primary">
                        ({authorFilter.length})
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className="py-2 pl-3 w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("createdAt")}
                >
                  {t("nav.createdDate")}{sortKey === "createdAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("modifiedAt")}
                >
                  {t("nav.modifiedDate")}{sortKey === "modifiedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                {/* 削除ボタン列 */}
                {onDeleteNotes && <th className="py-2 px-2 w-[40px]" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, index) => (
                <tr
                  key={entry.noteId}
                  className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
                    selectedIds.has(entry.noteId) ? "bg-primary/5" : ""
                  }`}
                  onMouseDown={(e) => range.onRowMouseDown(e, index)}
                  onMouseEnter={() => range.onRowMouseEnter(index)}
                  onClick={() => {
                    if (range.shouldSuppressClick()) return;
                    onOpenNote(entry.noteId);
                  }}
                  onDoubleClick={() => onOpenNoteFull?.(entry.noteId)}
                >
                  {/* チェックボックス（クリックでトグル / 行ドラッグで範囲選択） */}
                  {onDeleteNotes && (
                    <td
                      className="py-2 px-2 cursor-pointer"
                      title={t("nav.dragToRangeSelect")}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => range.onCheckboxMouseDown(e, index)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(entry.noteId)}
                        readOnly
                        tabIndex={-1}
                        className="w-3.5 h-3.5 rounded border-border accent-primary pointer-events-none"
                      />
                    </td>
                  )}
                  <td className="py-2 px-3">
                    <span className="text-foreground hover:text-primary transition-colors">
                      {entry.title}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    {entry.outgoingLinkCount > 0 && (
                      <span
                        className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full ${
                          entry.outgoingLinkCount >= 3
                            ? "bg-info-bg text-info font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {entry.outgoingLinkCount} &rarr;
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {entry.incomingLinkCount > 0 && (
                      <span
                        className={`inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full ${
                          entry.incomingLinkCount >= 2
                            ? "bg-label-sample-bg text-label-sample font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        &larr; {entry.incomingLinkCount}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-1">
                      {entry.labels.map((label) => {
                        const color = LABEL_HEX[label] ?? "#8fa394";
                        return (
                          <span
                            key={label}
                            className="inline-block text-xs font-semibold rounded-full whitespace-nowrap"
                            style={{
                              padding: "0px 6px",
                              backgroundColor: color + "18",
                              color,
                              border: `1px solid ${color}38`,
                              lineHeight: 1.6,
                            }}
                          >
                            {getDisplayLabelName(label)}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {entry.knowledgeCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.primaryKnowledgeWikiId && onOpenWikiPeek) {
                            onOpenWikiPeek(`wiki:${entry.primaryKnowledgeWikiId}`);
                          }
                        }}
                        disabled={!onOpenWikiPeek}
                        title={
                          entry.knowledgeCount === 1
                            ? t("knowledge.inKnowledge")
                            : t("knowledge.inKnowledgeCount", { count: String(entry.knowledgeCount) })
                        }
                        className="inline-flex items-center justify-center text-primary hover:text-primary/80 transition-colors disabled:cursor-default"
                      >
                        <BookOpen size={14} />
                        {entry.knowledgeCount > 1 && (
                          <span className="ml-0.5 text-[10px] font-semibold">{entry.knowledgeCount}</span>
                        )}
                      </button>
                    ) : (
                      <span className="text-muted-foreground/30 text-xs">—</span>
                    )}
                  </td>
                  <td
                    className="py-2 px-2 text-xs text-muted-foreground truncate"
                    title={entry.model ? `${entry.author ?? ""} / ${entry.model}` : entry.author ?? ""}
                  >
                    {entry.author ? (
                      <span className="inline-flex items-center gap-1">
                        {entry.model && (
                          <span
                            className="inline-block text-xs font-medium rounded px-1 py-0.5 bg-muted text-muted-foreground"
                            title={entry.model}
                          >
                            🤖
                          </span>
                        )}
                        <span className="truncate">{entry.author}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDateTime(entry.modifiedAt)}
                  </td>
                  {/* 個別削除ボタン（ホバーで表示） */}
                  {onDeleteNotes && (
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setDeleteTarget([entry.noteId])}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-xs p-1"
                        title={t("nav.delete")}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 列ヘッダ filter popup（portal で描画されるのでテーブル外でも OK） */}
      {labelFilterOpen && (
        <FilterPopup
          position={labelFilterPos}
          onClose={() => setLabelFilterOpen(false)}
          title={t("nav.filterLabels")}
          options={labelFilterOptions}
          selected={labelFilter}
          onChange={setLabelFilter}
          searchPlaceholder={t("common.search")}
          clearLabel={t("nav.clearFilter")}
          noMatchText={t("nav.noMatchingNotes")}
          minWidth={220}
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
          noMatchText={t("nav.noMatchingNotes")}
          minWidth={220}
        />
      )}

      {/* 削除確認ダイアログ */}
      {deleteTarget && (
        <DeleteConfirmDialog
          count={deleteTarget.length}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
