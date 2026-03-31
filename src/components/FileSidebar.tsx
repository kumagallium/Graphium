// ファイル一覧サイドバー

import { RecentNotes, type RecentNote } from "../features/navigation";
import { useT } from "../i18n";

export type FileSidebarProps = {
  activeFileId: string | null;
  onSelect: (fileId: string) => void;
  onNewNote: () => void;
  onNewFromTemplate: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onShowReleaseNotes: () => void;
  onShowSettings: () => void;
  agentConfigured: boolean;
  recentNotes: RecentNote[];
  onShowNoteList: () => void;
};

export function FileSidebar({
  activeFileId,
  onSelect,
  onNewNote,
  onNewFromTemplate,
  onRefresh,
  onSignOut,
  onShowReleaseNotes,
  onShowSettings,
  agentConfigured,
  recentNotes,
  onShowNoteList,
}: FileSidebarProps) {
  const t = useT();
  return (
    <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-sidebar-foreground/60 tracking-wide">
            provnote
          </h2>
          <button
            onClick={onRefresh}
            title={t("sidebar.refresh")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            &#8635;
          </button>
        </div>
        <button
          onClick={onNewNote}
          className="w-full text-left rounded-md px-3 py-2 mb-1.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {t("sidebar.newNote")}
        </button>
        <button
          onClick={onNewFromTemplate}
          className="w-full text-left rounded-md px-3 py-2 text-sm font-medium border border-border text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
        >
          {t("sidebar.provTemplate")}
        </button>
      </div>

      {/* 最近のノート */}
      <div className="flex-1 overflow-y-auto">
        <RecentNotes
          notes={recentNotes}
          activeFileId={activeFileId}
          onSelect={onSelect}
          onShowNoteList={onShowNoteList}
        />
      </div>

      {/* フッター */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={onShowSettings}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          {t("common.settings")}
          {agentConfigured ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title={t("sidebar.aiConnected")} />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" title={t("sidebar.aiNotConfigured")} />
          )}
        </button>
        <button
          onClick={onShowReleaseNotes}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("sidebar.releaseNotes")}
        </button>
        <button
          onClick={onSignOut}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.signOut")}
        </button>
      </div>
    </aside>
  );
}
