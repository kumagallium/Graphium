// ファイル一覧サイドバー

import { RecentNotes, type RecentNote } from "../features/navigation";
import { useT } from "../i18n";
import type { MediaIndex, MediaType } from "../features/asset-browser";
import { countByType } from "../features/asset-browser";

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
  mediaIndex: MediaIndex | null;
  onShowAssetGallery: (type: MediaType) => void;
};

// メディアタイプ別のアイコンと表示順
const MEDIA_NAV_ITEMS: { type: MediaType; icon: string }[] = [
  { type: "image", icon: "🖼️" },
  { type: "pdf", icon: "📄" },
  { type: "video", icon: "🎥" },
  { type: "audio", icon: "🔊" },
];

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
  mediaIndex,
  onShowAssetGallery,
}: FileSidebarProps) {
  const t = useT();
  const mediaCounts = mediaIndex ? countByType(mediaIndex) : null;
  return (
    <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-sidebar-foreground/60 tracking-wide">
            Graphium
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

      {/* 最近のノート + データ一覧 */}
      <div className="flex-1 overflow-y-auto">
        <RecentNotes
          notes={recentNotes}
          activeFileId={activeFileId}
          onSelect={onSelect}
          onShowNoteList={onShowNoteList}
        />

        {/* データ一覧セクション */}
        <div className="px-4 pt-3 pb-2">
          <h3 className="text-[10px] font-semibold text-sidebar-foreground/40 tracking-wider uppercase mb-1.5">
            {t("asset.dataSection")}
          </h3>
          <div className="space-y-0.5">
            {MEDIA_NAV_ITEMS.map(({ type, icon }) => {
              const count = mediaCounts?.[type] ?? 0;
              // カウント 0 でも表示（将来のアップロードに備える）
              return (
                <button
                  key={type}
                  onClick={() => onShowAssetGallery(type)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                >
                  <span className="text-sm">{icon}</span>
                  <span className="flex-1 text-left">{t(`asset.type.${type}`)}</span>
                  {count > 0 && (
                    <span className="text-[10px] text-muted-foreground">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
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
