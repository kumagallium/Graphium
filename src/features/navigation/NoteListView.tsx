// ノート一覧ビュー（メインエディタ領域に表示）
// 全ノートをテーブル形式で表示し、ソート・フィルタ・検索・削除に対応

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import {
  IndexFileNoteListSource,
  type NoteListEntry,
} from "./note-list-source";
import type { GraphiumIndex } from "./index-file";
import { NoteListToolbar, type SortKey, type SortDirection } from "./NoteListToolbar";
import { formatRelativeTime } from "./recent-notes-store";
import { useT, getDisplayLabelName } from "../../i18n";
import { Breadcrumb } from "../../components/Breadcrumb";

// ラベル色マッピング（design.md PROV-DM ラベル色準拠）
// ノート内の SideMenu バッジと同じゴーストスタイル: 薄い背景 + ラベル色テキスト + 薄いボーダー
const LABEL_HEX: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  result: "#c26356",
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
}) {
  const [entries, setEntries] = useState<NoteListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("outgoingLinkCount");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // 選択状態
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 削除確認ダイアログ
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
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

    // ラベルフィルタ（AND）
    if (labelFilter.length > 0) {
      result = result.filter((e) =>
        labelFilter.every((label) => e.labels.includes(label))
      );
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
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return sorted;
  }, [entries, searchQuery, labelFilter, sortKey, sortDir]);

  // 選択のトグル
  const toggleSelect = useCallback((noteId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

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
        {/* まとめて削除ボタン */}
        {someSelected && onDeleteNotes && (
          <button
            onClick={() => setDeleteTarget([...selectedIds])}
            className="ml-auto px-3 py-1 text-xs font-medium rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            {t("nav.deleteSelected", { count: String(selectedIds.size) })}
          </button>
        )}
      </div>

      {/* ツールバー */}
      <NoteListToolbar
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
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
                <th className="py-2 px-3">{t("nav.noteColumn")}</th>
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
                <th className="py-2 px-3 w-[140px]">{t("nav.labels")}</th>
                <th className="py-2 px-2 w-[56px] text-center" title={t("nav.knowledgeColumnTooltip")}>
                  <span className="inline-flex items-center justify-center" aria-label={t("nav.knowledgeColumn")}>
                    <BookOpen size={14} />
                  </span>
                </th>
                <th className="py-2 px-2 w-[96px]" title={t("nav.authorTooltip")}>{t("nav.author")}</th>
                <th
                  className="py-2 pl-3 w-[80px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("modifiedAt")}
                >
                  {t("nav.modifiedDate")}{sortKey === "modifiedAt" && (sortDir === "desc" ? " ↓" : " ↑")}
                </th>
                {/* 削除ボタン列 */}
                {onDeleteNotes && <th className="py-2 px-2 w-[40px]" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.noteId}
                  className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
                    selectedIds.has(entry.noteId) ? "bg-primary/5" : ""
                  }`}
                  onClick={() => onOpenNote(entry.noteId)}
                  onDoubleClick={() => onOpenNoteFull?.(entry.noteId)}
                >
                  {/* チェックボックス */}
                  {onDeleteNotes && (
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(entry.noteId)}
                        onChange={() => toggleSelect(entry.noteId)}
                        className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
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
                  <td className="py-2 pl-3 text-xs text-muted-foreground">
                    {formatRelativeTime(entry.modifiedAt)}
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
