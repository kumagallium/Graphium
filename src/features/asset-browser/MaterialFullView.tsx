// 素材全画面ビュー（material as note の Full mode）
//
// レイアウト方針 (2026-05-22 議論):
//   - 左ナビゲーションサイドバーをオーバーレイしない。AssetGalleryView と同じく
//     `<main>` の中で flex-1 で描画する（fixed/portal は使わない）。
//   - 構成は Note のフル画面に揃える:
//       上: タイトルバー（filename + chip + meta + Minimize + 3-dot menu）
//       中: viewer（中央、大）+ 下に Metadata セクション
//       右: アイコンレール（w-10）+ 選択時のみ展開する右パネル（asset graph）
//   - X 閉じるは存在しない（ESC または Minimize でサイドピークに戻る）
//   - 削除や Knowledge / PROV / Extract / Share は 3-dot メニューの中に集約

import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import type { MediaIndex, MediaIndexEntry, MediaSharedRef } from "./media-index";
import { MediaPreview } from "./media-preview";
import { AssetGraphPanel, shouldShowAssetGraph, type KnowledgeKindLookup } from "./asset-graph-panel";
import { MaterialDetailHeader } from "./material-detail-header";
import { MaterialMetadataSection } from "./material-metadata-section";

type RightTab = "graph" | null;

export type MaterialFullViewProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  onToggleFull?: () => void;
  onDelete?: (entry: MediaIndexEntry) => void;
  onNavigateNote?: (noteId: string) => void;
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  onIngest?: (entry: MediaIndexEntry) => void;
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  knowledgeWikiNoteId?: string;
  mediaIndex?: MediaIndex | null;
  getKnowledgeKind?: KnowledgeKindLookup;
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
};

export function MaterialFullView({
  entry,
  onClose,
  onToggleFull,
  onDelete,
  onNavigateNote,
  onRename,
  onIngest,
  onCreateProvNote,
  onExtractPdfPages,
  onSharedRefUpdated,
  knowledgeWikiNoteId,
  mediaIndex,
  getKnowledgeKind,
  onSwitchAsset,
}: MaterialFullViewProps) {
  const t = useT();
  const [rightTab, setRightTab] = useState<RightTab>(null);

  const toggleRight = (tab: RightTab) => {
    setRightTab((cur) => (cur === tab ? null : tab));
  };

  // ESC キーで閉じる（呼び出し側で fullMode → false に戻す想定）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const graphAvailable = shouldShowAssetGraph(entry, mediaIndex);

  return (
    <div
      data-material-full-view
      className="flex-1 flex flex-col overflow-hidden bg-background min-w-0"
    >
      <MaterialDetailHeader
        entry={entry}
        onClose={onClose}
        onRename={onRename}
        onIngest={onIngest}
        onCreateProvNote={onCreateProvNote}
        onExtractPdfPages={onExtractPdfPages}
        onSharedRefUpdated={onSharedRefUpdated}
        onNavigateNote={onNavigateNote}
        knowledgeWikiNoteId={knowledgeWikiNoteId}
        onToggleFull={onToggleFull}
        fullMode
        onDelete={onDelete}
        variant="titleBar"
      />

      {/* コンテンツ行: 中央 viewer + 右パネル + 右レール */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              overflow: "auto",
              minHeight: 0,
            }}
          >
            <MediaPreview entry={entry} />
          </div>
          <MaterialMetadataSection
            entry={entry}
            onNavigateNote={onNavigateNote}
            onRename={onRename}
            defaultOpen={false}
          />
        </div>

        {rightTab && (
          <div className="w-[480px] shrink-0 border-l border-border bg-muted flex flex-col overflow-hidden relative z-10">
            <div className="px-3 py-2 border-b border-border flex items-center gap-2">
              <span className="text-xs font-bold tracking-wide text-foreground">
                {rightTab === "graph" ? t("asset.rightPanel.graph") : ""}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              {rightTab === "graph" && onNavigateNote && (
                <AssetGraphPanel
                  entry={entry}
                  mediaIndex={mediaIndex}
                  getKnowledgeKind={getKnowledgeKind}
                  onNavigateNote={onNavigateNote}
                  onSwitchAsset={onSwitchAsset}
                  showLegend
                />
              )}
            </div>
          </div>
        )}

        <div
          className={cn(
            "shrink-0 border-border bg-muted/50 flex items-center gap-1 relative z-10",
            "w-10 border-l flex-col py-2",
          )}
        >
          {graphAvailable && onNavigateNote && (
            <button
              onClick={() => toggleRight("graph")}
              title={t("asset.rightPanel.graph")}
              className={cn(
                "flex items-center justify-center rounded-md transition-colors w-8 h-8",
                rightTab === "graph"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50",
              )}
            >
              <Network size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
