// 全体ビュー（プロセス一覧の上に置く、ステップ名で集約した有向グラフ）。
//
// docs/internal/note-chain-plan.md §2.5・§3 PR4。
// データは process-overview.ts の aggregateStepNameGraph（純関数）に一本化し、
// このファイルは Proposal の ProcessOverviewMock（note-chain.proposal.stories.tsx）を
// 実データ + ELK layered（RIGHT）で描く SVG レイアウトだけを担当する。
//
// ProcessIndex の購読・refresh は呼び出し側（ProcessGalleryView）が行い、
// この部品は props で受け取った processIndex を描くだけ（P-3・読み取り専用）。

import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import type { ProcessIndex } from "./process-index";
import { aggregateStepNameGraph, type StepNameGraph } from "./process-overview";
import { layoutStepFlow } from "./elk-flow-layout";

// ── 寸法（SVG viewBox 座標 = 表示 px。親幅を超えるときだけ縮小） ──

const NODE_H = 44;
const CHAR_W = 7;
const NODE_W_MIN = 100;
const NODE_W_MAX = 220;
const PAD = 24;
const MAX_SVG_HEIGHT = 320;

type Period = "3m" | "1y" | "all";

function sinceOf(period: Period): string | undefined {
  if (period === "all") return undefined;
  const now = Date.now();
  const days = period === "3m" ? 90 : 365;
  return new Date(now - days * 86400_000).toISOString();
}

/** ノード幅を名前の長さから概算する（1 文字 ≒ 7px + 余白、下限 100 上限 220） */
function nodeWidthOf(name: string): number {
  const width = name.length * CHAR_W + 24;
  return Math.min(NODE_W_MAX, Math.max(NODE_W_MIN, width));
}

export type ProcessOverviewViewProps = {
  processIndex: ProcessIndex | null;
  /** ノードクリック → 呼び出し側がプロセス一覧をこのステップ名で絞る */
  onSelectStepName?: (name: string) => void;
  /** 絞り込み中のノードを強調する */
  selectedStepName?: string | null;
};

export function ProcessOverviewView({
  processIndex,
  onSelectStepName,
  selectedStepName,
}: ProcessOverviewViewProps) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("1y");

  const graph = useMemo<StepNameGraph>(
    () => aggregateStepNameGraph(processIndex, { since: sinceOf(period) }),
    [processIndex, period],
  );

  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [nodeSizes, setNodeSizes] = useState<Map<string, { width: number; height: number }>>(new Map());

  useEffect(() => {
    const sizes = new Map(graph.nodes.map((n) => [n.name, { width: nodeWidthOf(n.name), height: NODE_H }]));
    setNodeSizes(sizes);
    let cancelled = false;
    void layoutStepFlow(
      graph.nodes.map((n) => ({ id: n.name, width: sizes.get(n.name)!.width, height: sizes.get(n.name)!.height })),
      graph.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to })),
      { direction: "RIGHT" },
    )
      .then((result) => {
        if (!cancelled) setPositions(result);
      })
      .catch((err) => {
        // ELK の失敗を握り潰さない。次の graph 変化で再試行される
        console.warn("全体ビューのレイアウトに失敗:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  // viewBox はレイアウト結果 + ノードサイズから決める
  const bounds = useMemo(() => {
    if (positions.size === 0) return { width: 0, height: 0 };
    let maxX = 0;
    let maxY = 0;
    for (const node of graph.nodes) {
      const pos = positions.get(node.name);
      const size = nodeSizes.get(node.name);
      if (!pos || !size) continue;
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }
    return { width: maxX + PAD, height: maxY + PAD };
  }, [positions, nodeSizes, graph.nodes]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
        <span className="font-medium text-foreground">{t("processOverview.title")}</span>
        <PeriodSegment period={period} onChange={setPeriod} t={t} />
        <span className="ml-auto text-xs text-muted-foreground">{t("processOverview.hint")}</span>
      </div>
      {graph.nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("process.empty")}</p>
      ) : (
        <div style={{ maxHeight: MAX_SVG_HEIGHT, overflow: "auto" }}>
          {/* 実寸で描く。親幅を超えるときだけ縮小する（100% に引き伸ばすと、
              ノードが少ない・孤立が多いレイアウトで文字が巨大化する） */}
          <svg
            viewBox={`0 0 ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}`}
            width={Math.max(bounds.width, 1)}
            height={Math.max(bounds.height, 1)}
            className="block rounded-lg border border-border bg-card"
            style={{ fontSize: 12, maxWidth: "100%", height: "auto" }}
          >
            <defs>
              <marker id="ov-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
              </marker>
            </defs>
            {graph.edges.map((edge, i) => {
              const a = positions.get(edge.from);
              const b = positions.get(edge.to);
              const sizeA = nodeSizes.get(edge.from);
              const sizeB = nodeSizes.get(edge.to);
              if (!a || !b || !sizeA || !sizeB) return null;
              const x1 = a.x + sizeA.width;
              const y1 = a.y + sizeA.height / 2;
              const x2 = b.x;
              const y2 = b.y + sizeB.height / 2;
              const d =
                y1 === y2
                  ? `M${x1} ${y1} L${x2 - 2} ${y2}`
                  : `M${x1} ${y1} C${x1 + 40} ${y1} ${x2 - 40} ${y2} ${x2 - 2} ${y2}`;
              const strokeWidth = Math.min(6, 1 + edge.count / 8);
              return (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--forest)"
                    strokeWidth={strokeWidth}
                    opacity={0.7}
                    markerEnd="url(#ov-arrow)"
                  />
                  <text x={(x1 + x2) / 2 - 8} y={(y1 + y2) / 2 - 6} fill="var(--color-muted-foreground)" fontSize={11}>
                    {edge.count}
                  </text>
                </g>
              );
            })}
            {graph.nodes.map((node) => {
              const pos = positions.get(node.name);
              const size = nodeSizes.get(node.name);
              if (!pos || !size) return null;
              const selected = selectedStepName === node.name;
              return (
                <g
                  key={node.name}
                  onClick={() => onSelectStepName?.(node.name)}
                  style={{ cursor: onSelectStepName ? "pointer" : "default" }}
                >
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={size.width}
                    height={size.height}
                    rx={8}
                    fill="var(--forest-soft)"
                    stroke="var(--forest)"
                    strokeWidth={selected ? 2.5 : 1}
                  />
                  <text x={pos.x + 12} y={pos.y + 20} fill="var(--color-foreground)" fontWeight={600}>
                    <title>{node.name}</title>
                    {node.name}
                  </text>
                  <text x={pos.x + 12} y={pos.y + 36} fill="var(--color-muted-foreground)" fontSize={11}>
                    {t("processOverview.noteCount", { n: String(node.noteCount) })}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {graph.dropped > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("processOverview.droppedRefs", { n: String(graph.dropped) })}
        </p>
      )}
    </div>
  );
}

function PeriodSegment({
  period,
  onChange,
  t,
}: {
  period: Period;
  onChange: (p: Period) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const items: { key: Period; label: string }[] = [
    { key: "3m", label: t("processOverview.period.3m") },
    { key: "1y", label: t("processOverview.period.1y") },
    { key: "all", label: t("processOverview.period.all") },
  ];
  return (
    <span className="inline-flex rounded-md border border-border overflow-hidden text-xs">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={"px-2 py-0.5 " + (item.key === period ? "bg-secondary text-foreground" : "text-muted-foreground")}
        >
          {item.label}
        </button>
      ))}
    </span>
  );
}
