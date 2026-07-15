// ゴミ箱・アーカイブビュー
// deletedAt / archivedAt が設定されているインデックスエントリを 1 画面で扱う。
// 上部のタブで「ゴミ箱」「アーカイブ」を切り替える。
//
// - ゴミ箱: ユーザーの削除意思。復元 / 完全削除 の 2 アクション。
// - アーカイブ: 参照保護目的の退避（主に Concept merge 吸収）。
//   復元 / ゴミ箱に送る の 2 アクション。完全削除はゴミ箱経由のみ。

import { useMemo, useState } from "react";
import { Trash2, RotateCcw, AlertTriangle, Archive, Send } from "lucide-react";
import type { GraphiumIndex, NoteIndexEntry } from "./index-file";
import { findIncomingReferences } from "./index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { useT } from "../../i18n";
import { Breadcrumb } from "../../components/Breadcrumb";

type TabKey = "trash" | "archive";

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// 完全削除確認ダイアログ。参照がある場合は参照元一覧を表示する
function PermanentDeleteDialog({
  count,
  refsBreakdown,
  onConfirm,
  onCancel,
  busy,
}: {
  count: number;
  /** 削除対象ノートと、それぞれを参照しているノート一覧 */
  refsBreakdown: { note: NoteIndexEntry; referrers: NoteIndexEntry[] }[];
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = useT();
  const totalRefs = refsBreakdown.reduce((sum, r) => sum + r.referrers.length, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-start gap-2 mb-2">
          {totalRefs > 0 && (
            <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
          )}
          <h3 className="text-sm font-semibold text-foreground">
            {t("trash.permanentDeleteTitle", { count: String(count) })}
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {t("trash.permanentDeleteMessage")}
        </p>
        {totalRefs > 0 && (
          <div className="mb-3 p-2 rounded border border-destructive/30 bg-destructive/5">
            <p className="text-xs text-destructive font-semibold mb-1">
              {t("trash.refsWillBreak", { total: String(totalRefs) })}
            </p>
            <ul className="text-xs text-foreground/70 space-y-1 max-h-40 overflow-y-auto">
              {refsBreakdown
                .filter((r) => r.referrers.length > 0)
                .map(({ note, referrers }) => (
                  <li key={note.noteId}>
                    <span className="font-medium">{note.title || t("nav.untitled")}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      ← {referrers.map((r) => r.title || t("nav.untitled")).join(", ")}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("nav.deleteConfirmCancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {busy ? t("nav.deleting") : t("trash.permanentDeleteConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TrashView({
  rawNoteIndex,
  trashedNotes,
  archivedNotes,
  onBack,
  onRestore,
  onPermanentDelete,
  onRestoreArchive,
  onSendArchiveToTrash,
  onOpenArchived,
  archivedMedia = [],
  onRestoreMedia,
  onPermanentDeleteMedia,
}: {
  rawNoteIndex: GraphiumIndex | null;
  trashedNotes: NoteIndexEntry[];
  archivedNotes: NoteIndexEntry[];
  onBack: () => void;
  onRestore: (noteIds: string[]) => Promise<void>;
  onPermanentDelete: (noteIds: string[]) => Promise<void>;
  onRestoreArchive: (noteIds: string[]) => Promise<void>;
  onSendArchiveToTrash: (noteIds: string[]) => Promise<void>;
  /** アーカイブ行クリック時のサイドピーク呼び出し（archive タブのみ有効） */
  onOpenArchived?: (noteId: string, isWiki: boolean) => void;
  /** アーカイブ済み素材（archive タブの下部に表示） */
  archivedMedia?: MediaIndexEntry[];
  /** 素材をギャラリー一覧へ復元 */
  onRestoreMedia?: (entry: MediaIndexEntry) => void;
  /** 素材を完全に削除（バイナリごと。確認はこのビュー内で行う） */
  onPermanentDeleteMedia?: (entry: MediaIndexEntry) => Promise<void>;
}) {
  const t = useT();
  const [tab, setTab] = useState<TabKey>("trash");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string[] | null>(null);

  const entries = tab === "trash" ? trashedNotes : archivedNotes;
  // 素材のアーカイブは archive タブのみに出す（素材にゴミ箱概念は無い）
  const archivedMediaList = tab === "archive" ? archivedMedia : [];

  const handleMediaPermanentDelete = async (entry: MediaIndexEntry) => {
    if (!onPermanentDeleteMedia) return;
    if (typeof window !== "undefined" && !window.confirm(t("asset.deleteConfirmMessage", { name: entry.name }))) return;
    setBusy(true);
    try {
      await onPermanentDeleteMedia(entry);
    } finally {
      setBusy(false);
    }
  };

  // 参照数の事前計算（noteId → 参照元エントリ配列）
  const refMap = useMemo(() => {
    const map = new Map<string, NoteIndexEntry[]>();
    for (const note of entries) {
      map.set(note.noteId, findIncomingReferences(rawNoteIndex, note.noteId));
    }
    return map;
  }, [rawNoteIndex, entries]);

  // タブごとのソート: ゴミ箱は deletedAt 降順、アーカイブは archivedAt 降順
  const sorted = useMemo(() => {
    const key = tab === "trash" ? "deletedAt" : "archivedAt";
    return [...entries].sort((a, b) => {
      const ta = a[key] ? new Date(a[key]!).getTime() : 0;
      const tb = b[key] ? new Date(b[key]!).getTime() : 0;
      return tb - ta;
    });
  }, [entries, tab]);

  const switchTab = (next: TabKey) => {
    setTab(next);
    setSelectedIds(new Set());
  };

  const toggleAll = () => {
    if (selectedIds.size === sorted.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sorted.map((n) => n.noteId)));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRestoreClick = async () => {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      const ids = [...selectedIds];
      if (tab === "trash") await onRestore(ids);
      else await onRestoreArchive(ids);
      setSelectedIds(new Set());
    } finally {
      setBusy(false);
    }
  };

  const handleSendToTrashClick = async () => {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      await onSendArchiveToTrash([...selectedIds]);
      setSelectedIds(new Set());
    } finally {
      setBusy(false);
    }
  };

  const requestPermanentDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    setConfirmTarget(ids);
  };

  const handleConfirmDelete = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      await onPermanentDelete(confirmTarget);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of confirmTarget) next.delete(id);
        return next;
      });
      setConfirmTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const refsBreakdownForConfirm = useMemo(() => {
    if (!confirmTarget) return [];
    const set = new Set(confirmTarget);
    return sorted
      .filter((n) => set.has(n.noteId))
      .map((note) => ({ note, referrers: refMap.get(note.noteId) ?? [] }));
  }, [confirmTarget, sorted, refMap]);

  const tabBaseClass = "px-3 py-1 text-xs rounded transition-colors flex items-center gap-1";
  const tabActiveClass = "bg-muted text-foreground font-medium";
  const tabInactiveClass = "text-muted-foreground hover:bg-muted/50";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Breadcrumb
          items={[
            { label: t("nav.home"), onClick: onBack },
            { label: t("nav.trashAndArchive") },
          ]}
        />
      </div>
      <div className="px-6 py-3 border-b border-border flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => switchTab("trash")}
            className={`${tabBaseClass} ${tab === "trash" ? tabActiveClass : tabInactiveClass}`}
          >
            <Trash2 size={12} />
            {t("nav.trash")}
            {trashedNotes.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">{trashedNotes.length}</span>
            )}
          </button>
          <button
            onClick={() => switchTab("archive")}
            className={`${tabBaseClass} ${tab === "archive" ? tabActiveClass : tabInactiveClass}`}
          >
            <Archive size={12} />
            {t("nav.archive")}
            {archivedNotes.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">{archivedNotes.length}</span>
            )}
          </button>
        </div>
        <span className="text-xs text-muted-foreground ml-2">
          {sorted.length > 0 ? `${sorted.length} ${t("trash.itemsCount")}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleRestoreClick}
            disabled={selectedIds.size === 0 || busy}
            className="px-2.5 py-1 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            <RotateCcw size={12} />
            {t("trash.restore")}
          </button>
          {tab === "trash" ? (
            <button
              onClick={() => requestPermanentDelete([...selectedIds])}
              disabled={selectedIds.size === 0 || busy}
              className="px-2.5 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              <Trash2 size={12} />
              {t("trash.permanentDelete")}
            </button>
          ) : (
            <button
              onClick={handleSendToTrashClick}
              disabled={selectedIds.size === 0 || busy}
              className="px-2.5 py-1 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              <Send size={12} />
              {t("archive.sendToTrash")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 && archivedMediaList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            {tab === "trash" ? (
              <Trash2 size={32} className="opacity-30" />
            ) : (
              <Archive size={32} className="opacity-30" />
            )}
            <p className="text-sm">
              {tab === "trash" ? t("trash.empty") : t("archive.empty")}
            </p>
            {tab === "archive" && (
              <p className="text-xs text-muted-foreground/70 max-w-sm text-center px-6">
                {t("archive.emptyHint")}
              </p>
            )}
          </div>
        ) : (
          <>
          {sorted.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr className="text-xs text-muted-foreground">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === sorted.length && sorted.length > 0}
                    onChange={toggleAll}
                    aria-label={t("trash.selectAll")}
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">{t("trash.colTitle")}</th>
                <th className="px-3 py-2 text-left font-medium w-32">
                  {tab === "trash" ? t("trash.colDeletedAt") : t("archive.colArchivedAt")}
                </th>
                <th className="px-3 py-2 text-left font-medium w-24">{t("trash.colRefs")}</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((note) => {
                const refs = refMap.get(note.noteId) ?? [];
                const isSelected = selectedIds.has(note.noteId);
                const dateField = tab === "trash" ? note.deletedAt : note.archivedAt;
                return (
                  <tr
                    key={note.noteId}
                    className={`border-b border-border/50 ${
                      isSelected ? "bg-muted/30" : "hover:bg-muted/20"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(note.noteId)}
                        aria-label={t("trash.selectRow")}
                      />
                    </td>
                    <td className="px-3 py-2 text-foreground truncate max-w-md">
                      {tab === "archive" && onOpenArchived ? (
                        <button
                          onClick={() => onOpenArchived(note.noteId, note.source === "ai")}
                          className="text-left text-foreground hover:underline truncate max-w-full"
                          title={t("archive.openPeek")}
                        >
                          {note.title || <span className="text-muted-foreground italic">{t("nav.untitled")}</span>}
                        </button>
                      ) : (
                        note.title || <span className="text-muted-foreground italic">{t("nav.untitled")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(dateField)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {refs.length > 0 ? (
                        <span
                          title={refs.map((r) => r.title).join("\n")}
                          className={`inline-flex items-center gap-1 ${
                            tab === "trash"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {tab === "trash" && <AlertTriangle size={10} />}
                          {refs.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {tab === "trash" ? (
                        <button
                          onClick={() => requestPermanentDelete([note.noteId])}
                          disabled={busy}
                          className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                          title={t("trash.permanentDelete")}
                        >
                          <Trash2 size={12} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
          {/* アーカイブ済み素材（ノートと違いゴミ箱を経由せず、復元か完全削除の 2 択） */}
          {archivedMediaList.length > 0 && (
            <div className="px-6 py-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                {t("asset.archivedSection")}
                <span className="ml-1.5 font-normal">{archivedMediaList.length}</span>
              </h3>
              <div className="space-y-1">
                {archivedMediaList.map((m) => (
                  <div
                    key={m.fileId}
                    className="flex items-center gap-3 rounded border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/20"
                  >
                    <span className="flex-1 truncate text-foreground" title={m.name}>
                      {m.name}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{m.type}</span>
                    <span className="shrink-0 text-muted-foreground">{formatDate(m.archivedAt)}</span>
                    <span
                      className="shrink-0 w-8 text-right text-muted-foreground"
                      title={m.usedIn.map((u) => u.noteTitle).join("\n")}
                    >
                      {m.usedIn.length}
                    </span>
                    {onRestoreMedia && (
                      <button
                        onClick={() => onRestoreMedia(m)}
                        disabled={busy}
                        className="shrink-0 px-2 py-1 rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1"
                      >
                        <RotateCcw size={11} />
                        {t("asset.restore")}
                      </button>
                    )}
                    {onPermanentDeleteMedia && (
                      <button
                        onClick={() => void handleMediaPermanentDelete(m)}
                        disabled={busy}
                        className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                        title={t("asset.deletePermanently")}
                        aria-label={t("asset.deletePermanently")}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {confirmTarget && (
        <PermanentDeleteDialog
          count={confirmTarget.length}
          refsBreakdown={refsBreakdownForConfirm}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmTarget(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
