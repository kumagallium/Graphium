// ファイル一覧サイドバー

import { useMemo, type ReactNode } from "react";
import { Image, FileText, Video, Volume2, Link } from "lucide-react";
import { RecentNotes, type RecentNote } from "../features/navigation";
import { useT, getDisplayLabelName } from "../i18n";
import type { MediaIndex, MediaType } from "../features/asset-browser";
import { countByType } from "../features/asset-browser";
import type { ProvNoteIndex } from "../features/navigation/index-file";

export type FileSidebarProps = {
  activeFileId: string | null;
  onSelect: (fileId: string) => void;
  onNewNote: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onShowReleaseNotes: () => void;
  onShowSettings: () => void;
  agentConfigured: boolean;
  recentNotes: RecentNote[];
  onShowNoteList: () => void;
  mediaIndex: MediaIndex | null;
  onShowAssetGallery: (type: MediaType) => void;
  noteIndex: ProvNoteIndex | null;
  onShowLabelGallery: (label: string) => void;
  /** 現在アクティブなメディアタイプ（ハイライト用） */
  activeAssetType: MediaType | null;
  /** 現在アクティブなラベル（ハイライト用） */
  activeLabel: string | null;
  /** ファイル一覧の読み込み中フラグ */
  filesLoading?: boolean;
};

// ラベル色マッピング（NoteListView と同じ）
const LABEL_HEX: Record<string, string> = {
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[結果]": "#c26356",
  "[属性]": "#c08b3e",
  "[条件]": "#c08b3e",
};

// メディアタイプ別のアイコンと表示順
const MEDIA_NAV_ITEMS: { type: MediaType; icon: ReactNode }[] = [
  { type: "image", icon: <Image size={14} /> },
  { type: "pdf", icon: <FileText size={14} /> },
  { type: "video", icon: <Video size={14} /> },
  { type: "audio", icon: <Volume2 size={14} /> },
  { type: "url", icon: <Link size={14} /> },
];

export function FileSidebar({
  activeFileId,
  onSelect,
  onNewNote,
  onRefresh,
  onSignOut,
  onShowReleaseNotes,
  onShowSettings,
  agentConfigured,
  recentNotes,
  onShowNoteList,
  mediaIndex,
  onShowAssetGallery,
  noteIndex,
  onShowLabelGallery,
  activeAssetType,
  activeLabel,
  filesLoading = false,
}: FileSidebarProps) {
  const t = useT();
  const mediaCounts = mediaIndex ? countByType(mediaIndex) : null;

  // ラベルカウント（ユニークな preview 数 = ギャラリーの行数）
  const labelCounts = useMemo(() => {
    if (!noteIndex) return new Map<string, number>();
    const previewSets = new Map<string, Set<string>>();
    for (const note of noteIndex.notes) {
      for (const l of note.labels) {
        if (!previewSets.has(l.label)) previewSets.set(l.label, new Set());
        previewSets.get(l.label)!.add(l.preview);
      }
    }
    const counts = new Map<string, number>();
    for (const [label, previews] of previewSets) {
      counts.set(label, previews.size);
    }
    return counts;
  }, [noteIndex]);
  return (
    <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-7 h-7" />
            <img src={`${import.meta.env.BASE_URL}logo-text.png`} alt="Graphium" className="h-[18px] mt-px" />
          </div>
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
      </div>

      {/* 最近のノート + データ一覧 */}
      <div className="flex-1 overflow-y-auto">
        <RecentNotes
          notes={recentNotes}
          activeFileId={activeFileId}
          onSelect={onSelect}
          onShowNoteList={onShowNoteList}
          loading={filesLoading}
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
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                    activeAssetType === type
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`}
                >
                  <span className="text-muted-foreground shrink-0">{icon}</span>
                  <span className="flex-1 text-left">{t(`asset.type.${type}`)}</span>
                  {count > 0 && (
                    <span className="text-[10px] text-muted-foreground">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ラベルセクション */}
        <div className="px-4 pt-1 pb-2">
          <h3 className="text-[10px] font-semibold text-sidebar-foreground/40 tracking-wider uppercase mb-1.5">
            {t("label.section")}
          </h3>
          {!noteIndex ? (
            <p className="text-[10px] text-muted-foreground/50 px-2 py-1">{t("common.loading")}</p>
          ) : labelCounts.size === 0 ? (
            <p className="text-[10px] text-muted-foreground/50 px-2 py-1">—</p>
          ) : (
            <div className="space-y-0.5">
              {[...labelCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => {
                  const color = LABEL_HEX[label] ?? "#8fa394";
                  return (
                    <button
                      key={label}
                      onClick={() => onShowLabelGallery(label)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                        activeLabel === label
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }`}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="flex-1 text-left truncate">{getDisplayLabelName(label)}</span>
                      <span className="text-[10px] text-muted-foreground">{count}</span>
                    </button>
                  );
                })}
            </div>
          )}
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
