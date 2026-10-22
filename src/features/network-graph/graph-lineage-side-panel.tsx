// 全体グラフの右に出す来歴パネル。選んだノートを起点に LineageStackPanel を描く。
// 近傍タブは全体グラフに無いので onShowNeighbors は渡さない。

import { useMemo } from "react";
import { GitBranch, X } from "lucide-react";
import { useT } from "../../i18n";
import { buildLineageTree } from "./lineage-builder";
import { LineageStackPanel, type LineageSources } from "./lineage-stack-panel";

export function GraphLineageSidePanel({
  selectedId,
  sources,
  onOpenNote,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
  onClose,
}: {
  /** 選んだノードの素の id（wiki も素の id） */
  selectedId: string;
  sources: LineageSources | null;
  /** "wiki:<id>" または素の id */
  onOpenNote: (navId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenMemo?: (captureId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const tree = useMemo(
    () => (sources ? buildLineageTree(selectedId, sources.files, sources.docs, sources.mediaIndex) : null),
    [selectedId, sources],
  );

  return (
    <aside
      className="flex flex-col shrink-0 h-full border-l border-border bg-background"
      style={{ width: 360 }}
      data-testid="graph-lineage-side-panel"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <GitBranch size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">{t("panel.graph.lineage")}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("lineageStack.close")}
          data-tooltip={t("lineageStack.close")}
          className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {sources ? (
          <LineageStackPanel
            tree={tree}
            sources={sources}
            onNavigate={onOpenNote}
            onOpenMedia={onOpenMedia}
            onOpenUrl={onOpenUrl}
            onOpenMemo={onOpenMemo}
          />
        ) : (
          <div className="px-3 py-4 text-xs text-muted-foreground">{t("lineageStack.loading")}</div>
        )}
      </div>
    </aside>
  );
}
