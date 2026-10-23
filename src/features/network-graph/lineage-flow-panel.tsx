// 系譜サブタブ / 全体グラフの系譜パネルの本体。起点から現在のノートまでの経路（stack）を作り、
// 各段を LineageFlowView で工程グラフと同じ図として描く。

import { useMemo } from "react";
import { useT } from "../../i18n";
import type { LineageNode } from "./lineage-builder";
import { buildLevelFlow, type LevelFlow } from "./lineage-flow-builder";
import { LineageFlowView } from "./lineage-flow-view";
import { useLineagePanelBase, type LineageSources } from "./lineage-panel-base";

export function LineageFlowPanel({
  tree,
  sources,
  onNavigate,
  onOpenMedia,
  onOpenUrl,
  onOpenMemo,
  onShowNeighbors,
}: {
  tree: LineageNode | null;
  sources: LineageSources | null;
  onNavigate: (noteId: string) => void;
  onOpenMedia?: (fileId: string) => void;
  onOpenUrl?: (url: string) => void;
  onOpenMemo?: (captureId: string) => void;
  /** 派生が 1 件も無いとき、近傍へ誘う。未指定なら誘いを出さない */
  onShowNeighbors?: () => void;
}) {
  const t = useT();
  const { model, processIndex, canOpen, handleOpen, onFocusPath } = useLineagePanelBase({
    tree,
    sources,
    onNavigate,
    onOpenMedia,
    onOpenUrl,
    onOpenMemo,
  });

  // 段ごとの図。モデルや素データが変わるまで同じ段は作り直さない（StepFlowView が
  // graph の参照変化でノードを作り直すため、参照を安定させる）
  const getLevelFlow = useMemo(() => {
    const cache = new Map<string, LevelFlow>();
    const labels = {
      derivedBand: t("lineageFlow.derivedBand"),
      wholeNote: t("lineageStack.wholeNote"),
      bandMore: (label: string, count: number) => t("lineageFlow.bandMore", { label, count: String(count) }),
    };
    return (nodeId: string): LevelFlow => {
      const hit = cache.get(nodeId);
      if (hit) return hit;
      const flow = model
        ? buildLevelFlow({
            nodeId,
            stack: model,
            docs: sources?.docs ?? new Map(),
            index: sources?.index ?? null,
            processIndex,
            labels,
          })
        : ({ kind: "none" } as const);
      cache.set(nodeId, flow);
      return flow;
    };
  }, [model, sources, processIndex, t]);

  // 上限で省いた子の id（素データに doc が無くても、経路として作らせて開ける）
  const hiddenIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of Object.values(model?.nodes ?? {})) {
      for (const g of n.groups) for (const h of g.hidden ?? []) ids.add(h.id);
    }
    return ids;
  }, [model]);
  const canFocus = useMemo(
    () => (id: string) => hiddenIds.has(id) || !!sources?.docs.has(id),
    [hiddenIds, sources],
  );

  if (!model) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t("lineage.empty")}
      </div>
    );
  }

  // 派生元も派生先も無い（起点＝自分で、箱が 1 つも無い）。空の画面で止めずに近傍へ誘う
  const isEmpty = model.initialPath.length === 1 && (model.nodes[model.rootId]?.groups.length ?? 0) === 0;

  return (
    <div className="h-full overflow-auto p-3">
      {isEmpty && onShowNeighbors && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>{t("lineageStack.emptyHint")}</span>
          <button
            type="button"
            onClick={onShowNeighbors}
            className="ml-auto whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted/50 cursor-pointer"
          >
            {t("lineageStack.showNeighbors")}
          </button>
        </div>
      )}
      <LineageFlowView
        stack={model}
        getLevelFlow={getLevelFlow}
        onOpen={handleOpen}
        canOpen={canOpen}
        onFocusPath={onFocusPath}
        canFocus={canFocus}
      />
    </div>
  );
}
