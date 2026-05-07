// 最近のノート（左パネル上部）
// 最近開いた/保存したノート5件を表示する

import { StickyNote, ArrowRight } from "lucide-react";
import { useT } from "../../i18n";
import { type RecentNote, formatRelativeTime } from "./recent-notes-store";

export function RecentNotes({
  notes,
  activeFileId,
  onSelect,
  onShowNoteList,
  loading = false,
  excludeNoteIds,
}: {
  notes: RecentNote[];
  activeFileId: string | null;
  onSelect: (noteId: string) => void;
  onShowNoteList: () => void;
  loading?: boolean;
  /** 表示時に除外する noteId（AI Knowledge 化された wiki などを排除するため） */
  excludeNoteIds?: ReadonlySet<string>;
}) {
  const t = useT();
  const visibleNotes = excludeNoteIds
    ? notes.filter((n) => !excludeNoteIds.has(n.noteId))
    : notes;
  return (
    <div className="px-2 py-1">
      {loading ? (
        <p className="text-xs text-muted-foreground px-2 py-1">
          {t("nav.loadingNotes")}
        </p>
      ) : visibleNotes.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-1">
          {t("nav.noNotes")}
        </p>
      ) : (
        visibleNotes.map((note) => (
          <button
            key={note.noteId}
            onClick={() => onSelect(note.noteId)}
            className={`w-full text-left flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer ${
              activeFileId === note.noteId
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
            }`}
          >
            <span className="shrink-0 text-muted-foreground/60"><StickyNote size={14} /></span>
            <span className="min-w-0 flex-1 truncate">{note.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground/60">
              {formatRelativeTime(note.lastAccessedAt)}
            </span>
          </button>
        ))
      )}
      <button
        onClick={onShowNoteList}
        className="w-full text-left flex items-center gap-1.5 rounded-md px-2 py-1.5 mt-1 text-xs text-primary/80 hover:text-primary hover:bg-sidebar-accent/50 transition-colors"
      >
        <span>{t("nav.openNoteList")}</span>
        <ArrowRight size={12} />
      </button>
    </div>
  );
}
