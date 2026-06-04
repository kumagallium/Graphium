// 上流方向のリネージ（来歴）ツリーを縦方向のインデント木として表示する
// メイン用途: ノート間 PROV のデバッグ + アイデアの経路の可視化

import { useMemo } from "react";
import { FileText, Diamond, GitBranch, RotateCcw, FileType, Link2, File, MessageSquare } from "lucide-react";
import type { LineageNode } from "./lineage-builder";
import { parseExternalSource } from "./external-source";
import { useT } from "../../i18n";
import { openExternalUrl } from "../../lib/external-link";

const NODE_COLORS = {
  current: "#4B7A52",
  ancestor: "#5b8fb9",
  wiki: "#9b6dcc",
  external: "#9aa0a6",
} as const;

function nodeColor(node: LineageNode): string {
  if (node.isCurrent) return NODE_COLORS.current;
  if (node.kind === "wiki") return NODE_COLORS.wiki;
  if (node.kind === "note") return NODE_COLORS.ancestor;
  // pdf / url / document / chat は外部ソース
  return NODE_COLORS.external;
}

function NodeIcon({ node }: { node: LineageNode }) {
  if (node.kind === "wiki") return <Diamond size={14} />;
  if (node.kind === "pdf") return <FileType size={14} />;
  if (node.kind === "document") return <File size={14} />;
  if (node.kind === "url") return <Link2 size={14} />;
  if (node.kind === "chat") return <MessageSquare size={14} />;
  return <FileText size={14} />;
}

function NodeRow({
  node,
  onNavigate,
  onOpenMedia,
}: {
  node: LineageNode;
  onNavigate: (id: string) => void;
  onOpenMedia?: (fileId: string) => void;
}) {
  // pdf / document はストレージ上の素材として開ける（onOpenMedia 経由でアセットモーダル）。
  const openableAsset =
    (node.kind === "pdf" || node.kind === "document") && !!onOpenMedia;
  const handleClick = () => {
    if (node.navId) {
      onNavigate(node.navId);
    } else if (openableAsset) {
      const key = parseExternalSource(node.id)?.key;
      if (key) onOpenMedia!(key);
    } else if (node.externalUrl) {
      void openExternalUrl(node.externalUrl);
    }
  };
  const clickable = !!(node.navId || node.externalUrl || openableAsset);
  return (
    <button
      onClick={handleClick}
      disabled={!clickable}
      className={
        "w-full px-2 py-1.5 flex items-center gap-2 text-left transition-colors group rounded-md " +
        (clickable
          ? "hover:bg-muted/50 cursor-pointer"
          : "cursor-default")
      }
      title={node.externalUrl ?? node.title}
    >
      <span className="shrink-0" style={{ color: nodeColor(node) }}>
        <NodeIcon node={node} />
      </span>
      <span
        className={
          "text-sm truncate group-hover:text-foreground " +
          (node.isCurrent ? "font-medium text-foreground" : "text-foreground/80")
        }
      >
        {node.title}
      </span>
      {node.cycle && (
        <span className="shrink-0 text-amber-500" title="cycle detected">
          <RotateCcw size={12} />
        </span>
      )}
    </button>
  );
}

function LineageBranch({
  node,
  onNavigate,
  onOpenMedia,
}: {
  node: LineageNode;
  onNavigate: (id: string) => void;
  onOpenMedia?: (fileId: string) => void;
}) {
  const hasParents = node.parents.length > 0 && !node.cycle;
  return (
    <div className="flex flex-col">
      <NodeRow node={node} onNavigate={onNavigate} onOpenMedia={onOpenMedia} />
      {hasParents && (
        <div className="ml-3 pl-3 border-l border-border/70 mt-0.5 flex flex-col gap-0.5">
          {node.parents.map((parent, i) => (
            <LineageBranch
              key={`${parent.id}:${parent.depth}:${i}`}
              node={parent}
              onNavigate={onNavigate}
              onOpenMedia={onOpenMedia}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LineagePanel({
  tree,
  onNavigate,
  onOpenMedia,
}: {
  tree: LineageNode | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
}) {
  const t = useT();

  const totalAncestors = useMemo(() => {
    if (!tree) return 0;
    let n = 0;
    const walk = (node: LineageNode) => {
      for (const p of node.parents) {
        n += 1;
        if (!p.cycle) walk(p);
      }
    };
    walk(tree);
    return n;
  }, [tree]);

  if (!tree) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t("lineage.empty")}
      </div>
    );
  }

  if (tree.parents.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-border bg-muted/20">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
            <GitBranch size={11} />
            {t("lineage.title")}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="p-2">
            <NodeRow node={tree} onNavigate={onNavigate} onOpenMedia={onOpenMedia} />
          </div>
          <div className="flex items-center justify-center px-4 py-6 text-xs text-muted-foreground text-center">
            {t("lineage.noAncestors")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-3 py-2 border-b border-border bg-muted/20 sticky top-0 z-10">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
          <GitBranch size={11} />
          {t("lineage.title")}
          <span className="ml-1 text-muted-foreground/60 normal-case tracking-normal">
            {totalAncestors}
          </span>
        </div>
      </div>
      <div className="p-2">
        <LineageBranch node={tree} onNavigate={onNavigate} onOpenMedia={onOpenMedia} />
      </div>
    </div>
  );
}
