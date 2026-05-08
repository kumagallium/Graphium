// Graph パネル内で「グラフ表示」「来歴ツリー」をサブタブで切り替える
// アイコンレールは 1 つ（Network）のまま、パネル内で切り替え。
// 旧「リスト表示」(LinkedNotesPanel) は実装は残しつつ UI から非表示。

import { useState } from "react";
import { Network, GitBranch } from "lucide-react";
import { NetworkGraphPanel } from "./view";
import { LineagePanel } from "./lineage-panel";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { NoteGraphData } from "./graph-builder";
import type { LineageNode } from "./lineage-builder";

type SubTab = "graph" | "lineage";

export function GraphLinksPanel({
  data,
  lineageTree,
  onNavigate,
  onOpenMedia,
  onPeek,
}: {
  data: NoteGraphData;
  lineageTree: LineageNode | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  /**
   * 指定されると、グラフ / 来歴ノードのクリック時に全画面遷移ではなく
   * サイドピークで開く。未指定なら従来通り onNavigate を呼ぶ。
   */
  onPeek?: (noteId: string) => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("graph");
  const t = useT();

  return (
    <div className="flex flex-col h-full">
      {/* サブタブ切り替え */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30">
        {([
          { key: "graph" as const, icon: <Network size={14} />, label: t("panel.graph.neighbors") },
          { key: "lineage" as const, icon: <GitBranch size={14} />, label: t("panel.graph.lineage") },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer",
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
          <NetworkGraphPanel data={data} onNavigate={onPeek ?? onNavigate} onOpenMedia={onOpenMedia} />
        ) : (
          <LineagePanel tree={lineageTree} onNavigate={onPeek ?? onNavigate} onOpenMedia={onOpenMedia} />
        )}
      </div>
    </div>
  );
}
