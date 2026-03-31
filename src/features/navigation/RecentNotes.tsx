// 最近のノート（左パネル上部）
// 最近開いた/保存したノート5件を表示する

import { type RecentNote, formatRelativeTime } from "./recent-notes-store";

export function RecentNotes({
  notes,
  activeFileId,
  onSelect,
  onShowNoteList,
}: {
  notes: RecentNote[];
  activeFileId: string | null;
  onSelect: (noteId: string) => void;
  onShowNoteList: () => void;
}) {
  return (
    <div className="px-2 py-2">
      <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider px-2 mb-1">
        最近のノート
      </div>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-1">
          まだノートがありません
        </p>
      ) : (
        notes.map((note) => (
          <button
            key={note.noteId}
            onClick={() => onSelect(note.noteId)}
            className={`w-full text-left flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer ${
              activeFileId === note.noteId
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
            }`}
          >
            <span className="shrink-0 text-muted-foreground/60">&#128196;</span>
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
        <span>&#128203;</span>
        <span>ノート一覧を開く &rarr;</span>
      </button>
    </div>
  );
}
