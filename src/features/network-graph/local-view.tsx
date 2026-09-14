// ローカルビュー（起点ノートの近傍を「深さ × 時間」で見る）。
//
// docs/internal/note-chain-plan.md §2.4・§3 PR3。
// データは local-view-model.ts の buildLocalView（純関数）に一本化し、
// このファイルは Proposal の Swimlane（note-chain.proposal.stories.tsx）を
// 実データで描く SVG レイアウトだけを担当する。

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "../../i18n";
import { Breadcrumb } from "../../components/Breadcrumb";
import { buildLocalView } from "./local-view-model";
import type { LocalViewModel, LocalViewNode, LocalViewStep } from "./local-view-model";
import type { GraphiumIndex } from "../navigation/index-file";
import {
  getLatestProcessIndex,
  requestLatestProcessIndexRefresh,
  subscribeLatestProcessIndex,
} from "./process-index";

// ── 寸法（SVG viewBox 座標。表示幅は 100% でスケールする） ──

const VIEW_W = 960;
const LEFT = 116;
const RIGHT_PAD = 24;
const NODE_W = 148;
const NODE_H = 44;
const ROW_GAP = 12;
const LANE_GAP = 56;
const AXIS_H = 30;
const TOP_PAD = 16;
const BOTTOM_PAD = 20;
const STEP_W = 120;
const STEP_GAP = 28;

const LANE_WIDTH = VIEW_W - LEFT - RIGHT_PAD;

// ── 時間軸 ──

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}

type TimeScale = { min: number; max: number };

function buildTimeScale(nodes: LocalViewNode[]): TimeScale | null {
  const times = nodes.map((n) => new Date(n.t).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return { min: Math.min(...times), max: Math.max(...times) };
}

/** 時刻を横位置（左端）へ写す。幅 0（全ノード同時刻）なら左寄せ */
function xOfTime(iso: string, scale: TimeScale | null): number {
  if (!scale) return LEFT;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || scale.max === scale.min) return LEFT;
  const ratio = (t - scale.min) / (scale.max - scale.min);
  return LEFT + ratio * (LANE_WIDTH - NODE_W);
}

function buildTicks(scale: TimeScale | null): { x: number; label: string }[] {
  if (!scale) return [];
  const COUNT = 5;
  if (scale.max === scale.min) {
    return [{ x: LEFT + NODE_W / 2, label: dateLabel(new Date(scale.min).toISOString()) }];
  }
  const ticks: { x: number; label: string }[] = [];
  for (let i = 0; i < COUNT; i++) {
    const ratio = i / (COUNT - 1);
    const t = scale.min + ratio * (scale.max - scale.min);
    const iso = new Date(t).toISOString();
    ticks.push({ x: LEFT + ratio * (LANE_WIDTH - NODE_W) + NODE_W / 2, label: dateLabel(iso) });
  }
  // 同じ日に収まる範囲（数分差など）だと 5 つとも同じ日付になる。同じラベルは 1 つに畳む
  return ticks.filter((tick, i) => i === 0 || tick.label !== ticks[i - 1].label);
}

// ── 行数から高さを出す ──

function rowCountOf(nodes: LocalViewNode[]): number {
  return nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => n.row)) + 1;
}

function laneHeight(rows: number): number {
  return rows === 0 ? NODE_H : rows * NODE_H + (rows - 1) * ROW_GAP;
}

// ── ノードカード ──

function NoteNodeCard({
  node,
  x,
  y,
  width,
  onOpenNote,
  trashedLabel,
  archivedLabel,
}: {
  node: LocalViewNode;
  x: number;
  y: number;
  width: number;
  onOpenNote: (noteId: string) => void;
  trashedLabel: string;
  archivedLabel: string;
}) {
  const fill = node.isOrigin ? "var(--forest-soft)" : "var(--color-card)";
  const stroke = node.isOrigin ? "var(--forest)" : "var(--color-border)";
  const dimmed = Boolean(node.state);
  const note = node.state === "trashed" ? trashedLabel : node.state === "archived" ? archivedLabel : null;
  return (
    <g
      onClick={() => onOpenNote(node.noteId)}
      style={{ cursor: "pointer" }}
      opacity={dimmed ? 0.55 : 1}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={NODE_H}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={node.isOrigin ? 2 : 1}
      />
      <text
        x={x + 10}
        y={y + (note ? 17 : NODE_H / 2 + 4)}
        fill="var(--color-foreground)"
        fontWeight={node.isOrigin ? 600 : 500}
        fontSize={12}
      >
        <title>{node.title}</title>
        {truncateLabel(node.title, width)}
      </text>
      {note && (
        <text x={x + 10} y={y + 34} fill="var(--color-muted-foreground)" fontSize={10.5}>
          {note}
        </text>
      )}
    </g>
  );
}

function truncateLabel(label: string, width: number): string {
  // 1 文字 ≒ 7px の粗い近似（等幅フォントではないが目安には十分）
  const maxChars = Math.max(4, Math.floor((width - 20) / 7));
  if (label.length <= maxChars) return label;
  return label.slice(0, Math.max(1, maxChars - 1)) + "…";
}

function StepNodeCard({ step, x, y }: { step: LocalViewStep; x: number; y: number }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={STEP_W}
        height={NODE_H}
        rx={6}
        fill="var(--color-card)"
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      <text x={x + 8} y={y + NODE_H / 2 + 4} fill="var(--color-foreground)" fontSize={12} fontWeight={500}>
        <title>{step.name}</title>
        {truncateLabel(step.name, STEP_W)}
      </text>
    </g>
  );
}

// ── 本体（描画のみ。データは props で受け取る） ──

export type LocalGraphViewProps = {
  model: LocalViewModel | null;
  depth: number;
  onDepthChange: (depth: number) => void;
  onOpenNote: (noteId: string) => void;
  onBack: () => void;
};

export function LocalGraphView({ model, depth, onDepthChange, onOpenNote, onBack }: LocalGraphViewProps) {
  const t = useT();

  if (!model) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        <Breadcrumb items={[{ label: t("globalGraph.title"), onClick: onBack }]} />
        <p className="mt-4">{t("nav.noNotes")}</p>
      </div>
    );
  }

  const originLabel = `${t("localView.title")}（${t("localView.origin")}: ${model.origin.title}）`;
  const otherPlanNames = model.plans.slice(1).map((p) => p.title);

  // ── レイアウト計算 ──
  const siblingsRows = rowCountOf(model.siblings);
  const childNotes = model.children.kind === "notes" ? model.children.notes : [];
  const childRows =
    model.children.kind === "notes"
      ? rowCountOf(childNotes)
      : model.children.steps.length === 0
        ? 0
        : Math.max(...model.children.steps.map((s) => s.row)) + 1;

  const parentY = TOP_PAD + 18; // レーンラベル分の余白
  const parentHeight = model.parent ? NODE_H : 0;
  const siblingsY = parentY + parentHeight + (model.parent ? LANE_GAP : 18);
  const siblingsHeight = laneHeight(siblingsRows);
  const childrenY = siblingsY + siblingsHeight + LANE_GAP;
  const childrenHeight = laneHeight(childRows === 0 ? 1 : childRows);
  const totalHeight = childrenY + childrenHeight + AXIS_H + BOTTOM_PAD;

  const timeScale = buildTimeScale([...model.siblings, ...childNotes]);
  const ticks = buildTicks(timeScale);

  const siblingById = new Map(model.siblings.map((n) => [n.noteId, n]));
  const originNode = model.siblings.find((n) => n.isOrigin) ?? null;

  function xOfNote(n: LocalViewNode): number {
    return xOfTime(n.t, timeScale);
  }
  function yOfSibling(n: LocalViewNode): number {
    return siblingsY + n.row * (NODE_H + ROW_GAP);
  }
  function yOfChildNote(n: LocalViewNode): number {
    return childrenY + n.row * (NODE_H + ROW_GAP);
  }
  function xOfStep(step: LocalViewStep): number {
    const base = originNode ? xOfNote(originNode) : LEFT;
    return base + step.col * (STEP_W + STEP_GAP);
  }
  function yOfStep(step: LocalViewStep): number {
    return childrenY + step.row * (NODE_H + ROW_GAP);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 pb-2 border-b border-border shrink-0 space-y-2">
        <Breadcrumb
          items={[{ label: t("globalGraph.title"), onClick: onBack }, { label: originLabel }]}
        />
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="text-muted-foreground">{t("localView.origin")}</span>
          <span className="px-2 py-0.5 rounded-md border border-border bg-card">{model.origin.title}</span>
          <span className="ml-2 text-muted-foreground">{t("localView.depth")}</span>
          <DepthSegment depth={depth} onChange={onDepthChange} />
          {otherPlanNames.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("localView.otherPlans", { names: otherPlanNames.join(", ") })}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <svg
          viewBox={`0 0 ${VIEW_W} ${totalHeight}`}
          width="100%"
          style={{ display: "block", fontSize: 12 }}
        >
          <defs>
            <marker id="lv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" />
            </marker>
          </defs>

          {/* レーンの区切り線とラベル */}
          {model.parent && (
            <LaneHeader y={parentY - 14} label={t("localView.lane.parent")} />
          )}
          {/* レーン名は相対。起点が計画ノート（子が工程ノート）なら、同じ層は「計画」、子は「工程ノート」 */}
          <LaneHeader
            y={siblingsY - 14}
            label={
              !model.parent && model.children.kind === "notes"
                ? t("localView.lane.parent")
                : t("localView.lane.siblings")
            }
          />
          <LaneHeader
            y={childrenY - 14}
            label={model.children.kind === "notes" ? t("localView.lane.siblings") : t("localView.lane.children")}
          />

          {/* 親 → 同じ層（partOf、点線） */}
          {model.parent &&
            model.siblings.map((n) => (
              <path
                key={`parent-${n.noteId}`}
                d={`M${xOfNote(n) + NODE_W / 2} ${parentY + NODE_H} L${xOfNote(n) + NODE_W / 2} ${yOfSibling(n)}`}
                fill="none"
                stroke="var(--color-muted-foreground)"
                strokeDasharray="4 3"
              />
            ))}

          {/* 起点 → 子（partOf、点線） */}
          {originNode &&
            (model.children.kind === "notes"
              ? childNotes.map((n) => (
                  <path
                    key={`child-${n.noteId}`}
                    d={`M${xOfNote(originNode) + NODE_W / 2} ${yOfSibling(originNode) + NODE_H} L${xOfNote(n) + NODE_W / 2} ${yOfChildNote(n)}`}
                    fill="none"
                    stroke="var(--color-muted-foreground)"
                    strokeDasharray="4 3"
                  />
                ))
              : model.children.steps
                  .filter((s) => s.col === 0)
                  .map((s) => (
                    <path
                      key={`child-${s.id}`}
                      d={`M${xOfNote(originNode) + NODE_W / 2} ${yOfSibling(originNode) + NODE_H} L${xOfStep(s) + STEP_W / 2} ${yOfStep(s)}`}
                      fill="none"
                      stroke="var(--color-muted-foreground)"
                      strokeDasharray="4 3"
                    />
                  )))}

          {/* handoffs（同じ層の受け渡し） */}
          {model.handoffs.map((h, i) => {
            const a = siblingById.get(h.from);
            const b = siblingById.get(h.to);
            if (!a || !b) return null;
            const x1 = xOfNote(a) + NODE_W;
            const y1 = yOfSibling(a) + NODE_H / 2;
            const x2 = xOfNote(b);
            const y2 = yOfSibling(b) + NODE_H / 2;
            const d =
              y1 === y2
                ? `M${x1} ${y1} L${x2 - 2} ${y2}`
                : `M${x1} ${y1} C${x1 + 30} ${y1} ${x2 - 30} ${y2} ${x2 - 2} ${y2}`;
            return (
              <path
                key={`ho-${i}`}
                d={d}
                fill="none"
                stroke="var(--forest)"
                strokeWidth={1.5}
                strokeDasharray={h.broken ? "4 3" : undefined}
                markerEnd="url(#lv-arrow)"
              >
                {h.broken && <title>{t("planFlow.brokenRef")}</title>}
              </path>
            );
          })}

          {/* ステップ間の線 */}
          {model.children.kind === "steps" &&
            model.children.edges.map((e, i) => {
              const a = model.children.kind === "steps" ? model.children.steps.find((s) => s.id === e.from) : null;
              const b = model.children.kind === "steps" ? model.children.steps.find((s) => s.id === e.to) : null;
              if (!a || !b) return null;
              const x1 = xOfStep(a) + STEP_W;
              const y1 = yOfStep(a) + NODE_H / 2;
              const x2 = xOfStep(b);
              const y2 = yOfStep(b) + NODE_H / 2;
              const d =
                y1 === y2
                  ? `M${x1} ${y1} L${x2 - 2} ${y2}`
                  : `M${x1} ${y1} C${x1 + 20} ${y1} ${x2 - 20} ${y2} ${x2 - 2} ${y2}`;
              return (
                <path key={`se-${i}`} d={d} fill="none" stroke="var(--forest)" strokeWidth={1.5} markerEnd="url(#lv-arrow)" />
              );
            })}

          {/* 親ノード */}
          {model.parent && (
            <NoteNodeCard
              node={model.parent}
              x={LEFT}
              y={parentY}
              width={LANE_WIDTH}
              onOpenNote={onOpenNote}
              trashedLabel={t("planFlow.trashedNote")}
              archivedLabel={t("planFlow.archivedNote")}
            />
          )}

          {/* 同じ層のノード */}
          {model.siblings.map((n) => (
            <NoteNodeCard
              key={n.noteId}
              node={n}
              x={xOfNote(n)}
              y={yOfSibling(n)}
              width={NODE_W}
              onOpenNote={onOpenNote}
              trashedLabel={t("planFlow.trashedNote")}
              archivedLabel={t("planFlow.archivedNote")}
            />
          ))}

          {/* 子のノード */}
          {model.children.kind === "notes"
            ? childNotes.map((n) => (
                <NoteNodeCard
                  key={n.noteId}
                  node={n}
                  x={xOfNote(n)}
                  y={yOfChildNote(n)}
                  width={NODE_W}
                  onOpenNote={onOpenNote}
                  trashedLabel={t("planFlow.trashedNote")}
                  archivedLabel={t("planFlow.archivedNote")}
                />
              ))
            : model.children.steps.map((s) => (
                <StepNodeCard key={s.id} step={s} x={xOfStep(s)} y={yOfStep(s)} />
              ))}

          {/* 時間軸 */}
          <line
            x1={LEFT}
            x2={VIEW_W - RIGHT_PAD}
            y1={totalHeight - AXIS_H}
            y2={totalHeight - AXIS_H}
            stroke="var(--color-muted-foreground)"
          />
          {ticks.map((tick, i) => (
            <text key={i} x={tick.x} y={totalHeight - AXIS_H + 16} fill="var(--color-muted-foreground)" textAnchor="middle">
              {tick.label}
            </text>
          ))}
        </svg>
        {model.truncated && (
          <p className="mt-2 text-xs text-muted-foreground">{t("planFlow.truncated")}</p>
        )}
      </div>
    </div>
  );
}

function LaneHeader({ y, label }: { y: number; label: string }) {
  return (
    <g>
      <line x1={0} x2={VIEW_W} y1={y} y2={y} stroke="var(--color-border)" />
      <text x={4} y={y + NODE_H / 2 + 4} fill="var(--color-muted-foreground)">
        {label}
      </text>
    </g>
  );
}

function DepthSegment({ depth, onChange }: { depth: number; onChange: (d: number) => void }) {
  return (
    <span className="inline-flex rounded-md border border-border overflow-hidden text-xs">
      {[1, 2, 3].map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={"px-2 py-0.5 " + (d === depth ? "bg-secondary text-foreground" : "text-muted-foreground")}
        >
          {d}
        </button>
      ))}
    </span>
  );
}

// ── データ配線（buildLocalView + ProcessIndex 購読） ──

export type LocalGraphViewContainerProps = {
  originNoteId: string;
  index: GraphiumIndex | null;
  onOpenNote: (noteId: string) => void;
  onBack: () => void;
};

export function LocalGraphViewContainer({ originNoteId, index, onOpenNote, onBack }: LocalGraphViewContainerProps) {
  const [depth, setDepth] = useState(1);
  const processIndex = useSyncExternalStore(
    subscribeLatestProcessIndex,
    getLatestProcessIndex,
    getLatestProcessIndex,
  );

  useEffect(() => {
    requestLatestProcessIndexRefresh();
  }, []);

  const model = useMemo(
    () => buildLocalView({ originNoteId, index, processIndex, depth }),
    [originNoteId, index, processIndex, depth],
  );

  return (
    <LocalGraphView model={model} depth={depth} onDepthChange={setDepth} onOpenNote={onOpenNote} onBack={onBack} />
  );
}
