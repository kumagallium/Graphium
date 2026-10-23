// 右パネル グラフ → 来歴サブタブの中身。上流へ遡るツリー（既定）と、起点から下へ段を積む表示を
// 切り替える。ツリーが既定なのは、段の表示に置き換えた（v0.94.7）あと利用者から「元のツリーの方が
// イメージに合う」と声があったため。段の表示は選べるように残す。選んだ方はこの端末で覚える。
//
// 切り替え（LineageViewToggle）はサブタブの行の右端に置く（graph-links-panel.tsx）。来歴の中に
// 1 行足すと、サブタブ・切り替え・ツリーの見出しが縦に 3 段積まれて窮屈になるため。

import { useState } from "react";
import { GitBranch, Layers } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { LineagePanel } from "./lineage-panel";
import { LineageStackPanel, type LineageSources } from "./lineage-stack-panel";
import type { LineageNode } from "./lineage-builder";

export type LineageViewMode = "tree" | "stack";

const STORAGE_KEY = "graphium.lineage.viewMode";

/** 保存値を読む。読めない・知らない値なら既定のツリー */
export function readLineageViewMode(): LineageViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "stack" ? "stack" : "tree";
  } catch {
    return "tree";
  }
}

function writeLineageViewMode(mode: LineageViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 保存できなくても切り替え自体は効く（次に開いたときは既定のツリー）
  }
}

/** 見せ方の状態。選んだ方をこの端末に覚える */
export function useLineageViewMode(): [LineageViewMode, (mode: LineageViewMode) => void] {
  const [mode, setMode] = useState<LineageViewMode>(readLineageViewMode);
  const choose = (next: LineageViewMode) => {
    setMode(next);
    writeLineageViewMode(next);
  };
  return [mode, choose];
}

/** 「ツリー / 段」の切り替え。サブタブの行に横並びで置く */
export function LineageViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: LineageViewMode;
  onChange: (mode: LineageViewMode) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t("lineage.view.label")}
      className={cn("inline-flex rounded-md border border-border bg-background/60 p-0.5", className)}
    >
      {([
        { key: "tree" as const, icon: <GitBranch size={12} />, label: t("lineage.view.tree") },
        { key: "stack" as const, icon: <Layers size={12} />, label: t("lineage.view.stack") },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={mode === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs transition-colors cursor-pointer",
            mode === opt.key
              ? "bg-background text-foreground shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function LineageTab({
  mode,
  tree,
  sources,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
  onShowNeighbors,
}: {
  mode: LineageViewMode;
  tree: LineageNode | null;
  sources: LineageSources | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenMemo?: (captureId: string) => void;
  /** 段の表示で、派生の無いノートを近傍へ誘うときに使う */
  onShowNeighbors?: () => void;
}) {
  return mode === "tree" ? (
    <LineagePanel tree={tree} onNavigate={onNavigate} onOpenMedia={onOpenMedia} onOpenUrl={onOpenUrl} onOpenMemo={onOpenMemo} />
  ) : (
    <LineageStackPanel
      tree={tree}
      sources={sources}
      onNavigate={onNavigate}
      onOpenMedia={onOpenMedia}
      onOpenUrl={onOpenUrl}
      onOpenMemo={onOpenMemo}
      onShowNeighbors={onShowNeighbors}
    />
  );
}
