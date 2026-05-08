// リンクされたノートをホップ距離別にリスト表示するパネル
// グラフビューの補完 — 日常的なナビゲーション用

import { useMemo } from "react";
import { FileText, Diamond } from "lucide-react";
import type { NoteGraphData, NoteNode } from "./graph-builder";
import { useT } from "../../i18n";

// グラフビューと同じカラースキーム
const NODE_COLORS = {
  current: "#4B7A52",
  hop1: "#5b8fb9",
  hop2: "#b8c9be",
  wiki: "#9b6dcc",
} as const;

// ホップ距離ごとのグループ
type HopGroup = {
  hop: number;
  nodes: NoteNode[];
};

function groupByHop(nodes: NoteNode[]): HopGroup[] {
  const groups = new Map<number, NoteNode[]>();
  for (const node of nodes) {
    if (node.isCurrent) continue; // 現在のノートは除外
    const list = groups.get(node.hop) ?? [];
    list.push(node);
    groups.set(node.hop, list);
  }
  // ホップ順にソート、各グループ内はタイトル順
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([hop, nodes]) => ({
      hop,
      nodes: nodes.sort((a, b) => a.title.localeCompare(b.title)),
    }));
}

function getNodeColor(node: NoteNode): string {
  if (node.isWiki) return NODE_COLORS.wiki;
  if (node.hop === 1) return NODE_COLORS.hop1;
  return NODE_COLORS.hop2;
}

export function LinkedNotesPanel({
  data,
  onNavigate,
}: {
  data: NoteGraphData;
  onNavigate: (noteId: string) => void;
}) {
  const t = useT();
  const groups = useMemo(() => groupByHop(data.nodes), [data.nodes]);

  // 現在のノート
  const currentNode = data.nodes.find((n) => n.isCurrent);

  if (data.nodes.length <= 1) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t("links.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* 現在のノート */}
      {currentNode && (
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: NODE_COLORS.current }}
            />
            {t("links.current")}
          </div>
          <div className="text-sm font-medium text-foreground truncate">
            {currentNode.title}
          </div>
        </div>
      )}

      {/* ホップ別グループ */}
      {groups.map((group) => (
        <div key={group.hop}>
          <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
            {group.hop === 1 ? t("links.linked") : t("links.nearby")}
            <span className="ml-1.5 text-muted-foreground/60">
              {group.nodes.length}
            </span>
          </div>
          <ul className="divide-y divide-border/50">
            {group.nodes.map((node) => (
              <li key={node.id}>
                <button
                  onClick={() => onNavigate(node.isWiki ? `wiki:${node.id}` : node.id)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors group cursor-pointer"
                >
                  <span
                    className="shrink-0"
                    style={{ color: getNodeColor(node) }}
                  >
                    {node.isWiki ? (
                      <Diamond size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                  </span>
                  <span className="text-sm truncate group-hover:text-foreground text-foreground/80">
                    {node.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

    </div>
  );
}
