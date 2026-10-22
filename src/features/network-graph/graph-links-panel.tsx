// Graph パネル内で「来歴」「近傍グラフ」をサブタブで切り替える（来歴が左・既定）
// アイコンレールは 1 つ（Network）のまま、パネル内で切り替え。
// 旧「リスト表示」(LinkedNotesPanel) は実装は残しつつ UI から非表示。

import { useState } from "react";
import { Network, GitBranch } from "lucide-react";
import { NetworkGraphPanel } from "./view";
import { LineageStackPanel, type LineageSources } from "./lineage-stack-panel";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { NoteGraphData } from "./graph-builder";
import type { LineageNode } from "./lineage-builder";

type SubTab = "graph" | "lineage";

export function GraphLinksPanel({
  data,
  lineageTree,
  lineageSources,
  onNavigate,
  onOpenMedia,
  onPeek,
  onOpenUrl,
  onOpenMemo,
  onOpenSharedEntry,
}: {
  data: NoteGraphData;
  lineageTree: LineageNode | null;
  /** 来歴スタックの組み立て用（files / docs / mediaIndex）。lineageTree と同じタイミングで更新される */
  lineageSources: LineageSources | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /**
   * 指定されると、グラフ / 来歴ノードのクリック時に全画面遷移ではなく
   * サイドピークで開く。未指定なら従来通り onNavigate を呼ぶ。
   */
  onPeek?: (noteId: string) => void;
  /** URL ソースノードをアプリ内（素材サイドピークのリーダー）で開く。未指定なら外部ブラウザ。 */
  onOpenUrl?: (url: string) => void;
  /** memo: ソースノードをメモギャラリーの該当詳細で開く。未指定なら表示のみ。 */
  onOpenMemo?: (captureId: string) => void;
  /**
   * shared / proposal ノード（派生元・このノートへの提案）を開く。未指定なら
   * クリックしても何も起きない（グラフ側でカーソルも変わらない）。
   */
  onOpenSharedEntry?: (sharedId: string) => void;
}) {
  // 既定は来歴。派生が無いノートでは来歴側が近傍への誘いを出す
  const [subTab, setSubTab] = useState<SubTab>("lineage");
  const t = useT();

  return (
    <div className="flex flex-col h-full">
      {/* サブタブ切り替え。細いパネル（下限 300px）では語を割らず、ボタン単位で折り返す */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30">
        {([
          { key: "lineage" as const, icon: <GitBranch size={14} />, label: t("panel.graph.lineage") },
          { key: "graph" as const, icon: <Network size={14} />, label: t("panel.graph.neighbors") },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer",
              subTab === tab.key
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {/* パネル本体 */}
      <div className="flex-1 overflow-hidden">
        {subTab === "graph" ? (
          <NetworkGraphPanel data={data} onNavigate={onPeek ?? onNavigate} onOpenMedia={onOpenMedia} onOpenUrl={onOpenUrl} onOpenMemo={onOpenMemo} onOpenSharedEntry={onOpenSharedEntry} />
        ) : (
          <LineageStackPanel tree={lineageTree} sources={lineageSources} onNavigate={onPeek ?? onNavigate} onOpenMedia={onOpenMedia} onOpenUrl={onOpenUrl} onOpenMemo={onOpenMemo} onShowNeighbors={() => setSubTab("graph")} />
        )}
      </div>
    </div>
  );
}
