// Wiki リストビュー（メインエリアに表示）
// Summary / Concept / Synthesis カテゴリ別に Wiki ドキュメント一覧をテーブル形式で表示
// NoteListView と一貫したテーブル + ソート + チェックボックス削除構造

import { useCallback, useMemo, useState } from "react";
import { Bot, Search, Trash2 } from "lucide-react";
import type { WikiKind } from "../../lib/document-types";
import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import { Breadcrumb } from "../../components/Breadcrumb";

// 日付を YYYY-MM-DD 形式で表示
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type WikiMeta = {
  title: string;
  kind: WikiKind;
  headings: string[];
  /** 書記役 LLM のモデル ID (例: claude-opus-4-7) */
  model?: string;
};

type SortKey = "title" | "modifiedAt" | "createdAt";
type SortDirection = "asc" | "desc";

type Props = {
  noteIndex: GraphiumIndex | null;
  wikiKind: WikiKind;
  wikiFiles: GraphiumFile[];
  wikiMetas: Map<string, WikiMeta>;
  /** クリック時（サイドピーク表示用） */
  onOpenWiki: (wikiId: string) => void;
  /** ダブルクリック or フルで開く */
  onOpenWikiFull?: (wikiId: string) => void;
  onBack: () => void;
  onDeleteWiki: (wikiId: string) => Promise<void>;
};

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          Delete {count} {count === 1 ? "wiki" : "wikis"}?
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WikiListView({
  wikiKind,
  wikiFiles,
  wikiMetas,
  onOpenWiki,
  onOpenWikiFull,
  onBack,
  onDeleteWiki,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const wikiEntries = useMemo(() => {
    return wikiFiles
      .filter((f) => {
        const meta = wikiMetas.get(f.id);
        return meta && meta.kind === wikiKind;
      })
      .map((f) => ({
        id: f.id,
        title: wikiMetas.get(f.id)!.title,
        modifiedAt: f.modifiedTime,
        createdAt: f.createdTime,
        headings: wikiMetas.get(f.id)!.headings,
        model: wikiMetas.get(f.id)!.model,
      }));
  }, [wikiFiles, wikiMetas, wikiKind]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return key;
      }
      setSortDir(key === "title" ? "asc" : "desc");
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    let result = wikiEntries;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((e) => e.title.toLowerCase().includes(q));
    }
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title, "ja");
          break;
        case "modifiedAt":
          cmp = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [wikiEntries, searchQuery, sortKey, sortDir]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const ids = filtered.map((e) => e.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(ids));
  }, [filtered, selectedIds]);

  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      for (const id of deleteTarget) {
        await onDeleteWiki(id);
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of deleteTarget) next.delete(id);
        return next;
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteWiki]);

  const kindLabel = wikiKind === "summary" ? "Summary" : wikiKind === "synthesis" ? "Synthesis" : "Concept";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Breadcrumb items={[
          { label: "Home", onClick: onBack },
          { label: "Wiki" },
          { label: kindLabel },
        ]} />
        <span className="text-xs text-muted-foreground">
          ({filtered.length}/{wikiEntries.length})
        </span>
        {someSelected && (
          <button
            onClick={() => setDeleteTarget([...selectedIds])}
            className="ml-auto px-3 py-1 text-xs font-medium rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Delete {selectedIds.size}
          </button>
        )}
      </div>

      {/* ツールバー（検索） */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border/50">
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="pl-7 pr-2.5 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/60 w-48 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto px-6">
        {wikiMetas.size === 0 && wikiFiles.length > 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Bot size={24} className="opacity-30" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "No matching wikis found" : `No ${kindLabel} wikis yet`}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-2 w-[36px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    title={allSelected ? "Deselect all" : "Select all"}
                  />
                </th>
                <th
                  className="py-2 px-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("title")}
                >
                  Title{sortKey === "title" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-3">Headings</th>
                <th className="py-2 px-2 w-[120px]">Model</th>
                <th
                  className="py-2 pl-3 w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("createdAt")}
                >
                  Created{sortKey === "createdAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th
                  className="py-2 pl-3 w-[100px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("modifiedAt")}
                >
                  Modified{sortKey === "modifiedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                <th className="py-2 px-2 w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
                    selectedIds.has(entry.id) ? "bg-primary/5" : ""
                  }`}
                  onClick={() => onOpenWiki(entry.id)}
                  onDoubleClick={() => onOpenWikiFull?.(entry.id)}
                >
                  <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <span className="inline-flex items-center gap-2">
                      <Bot size={14} className="text-primary shrink-0" />
                      <span className="text-foreground hover:text-primary transition-colors">
                        {entry.title}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground truncate max-w-[280px]" title={entry.headings.join(" / ")}>
                    {entry.headings.length > 0 ? entry.headings.join(" / ") : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="py-2 px-2 text-xs text-muted-foreground truncate" title={entry.model ?? ""}>
                    {entry.model ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block text-xs font-medium rounded px-1 py-0.5 bg-muted">🤖</span>
                        <span className="truncate">{entry.model}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                    {formatDate(entry.createdAt)}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums">
                    {formatDate(entry.modifiedAt)}
                  </td>
                  <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setDeleteTarget([entry.id])}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
