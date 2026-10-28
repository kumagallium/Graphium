// 来歴の「図」表示。段（起点 → … → 現在のノート）を 1 段ずつ、工程グラフと同じ
// StepFlowView（variant="preview"）で描く。手で並べた配置は工程グラフ・ステップタブと共有する
// （layoutScope は LevelFlow が持つ）。線の無い段（資料から知見が多数、など）は図にせず札の折り返しにする。

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Maximize2, Workflow, X } from "lucide-react";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { FlowGraphData, FlowNoteRef } from "./activity-graph-adapter";
import { displayLevels, type LevelFlow } from "./lineage-flow-builder";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";
import { KIND_PALETTE } from "./flow-palette";
import {
  PLAN_AS_PLANNED_COLOR,
  PLAN_UNPLANNED_COLOR,
  PLANNED_COLOR,
  StepFlowView,
} from "./step-flow-view";

function HereBadge({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "#FAEEDA", color: "#633806" }}
    >
      {label}
    </span>
  );
}

const PANEL_FLOW_HEIGHT = 300;
const EXPANDED_FLOW_HEIGHT = 440;
// 手順を表示（全工程の手順をつなげた図）は大きい。他の段より高く取る
const PROCEDURE_PANEL_FLOW_HEIGHT = 420;
const PROCEDURE_EXPANDED_FLOW_HEIGHT = 640;

/** 工程グラフの凡例と同じ 3 種（preview は凡例を出さないので、ここで足す） */
function Legend() {
  const t = useT();
  const item = (color: string, dashed: boolean, label: string) => (
    <span className="inline-flex items-center gap-1">
      <svg width="22" height="6" aria-hidden="true">
        <line x1="1" y1="3" x2="21" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {item(PLANNED_COLOR, true, t("planFlow.planned"))}
      {item(PLAN_AS_PLANNED_COLOR, false, t("planFlow.asPlanned"))}
      {item(PLAN_UNPLANNED_COLOR, false, t("planFlow.unplanned"))}
    </div>
  );
}

/**
 * 線の無い段（資料から知見が数十件、など）の札の折り返し表示。図にすると子が 1 列に
 * 並んで極端に縮むので、帯ごとの小見出しの下に札を折り返して並べる。
 * 札の見た目は工程ノード（step-node-card の noteRef カード）に揃える
 */
function CardsLevel({
  graph,
  nextId,
  currentId,
  hereLabel,
  height,
  onOpenNoteRef,
}: {
  graph: FlowGraphData;
  nextId?: string;
  /** 現在のノート（札に「現在地」を付ける） */
  currentId?: string;
  hereLabel: string;
  height: number;
  onOpenNoteRef: (ref: FlowNoteRef) => void;
}) {
  const groups = useMemo(() => {
    const ungrouped: FlowGraphData["steps"] = [];
    const byId = new Map<string, { label: string; index: number; steps: FlowGraphData["steps"] }>();
    for (const s of graph.steps) {
      if (!s.group) {
        ungrouped.push(s);
        continue;
      }
      const g = byId.get(s.group.id) ?? { label: s.group.label, index: s.group.index, steps: [] };
      g.steps.push(s);
      byId.set(s.group.id, g);
    }
    return { ungrouped, grouped: [...byId.values()].sort((a, b) => a.index - b.index) };
  }, [graph]);

  const renderCard = (s: FlowGraphData["steps"][number]) => {
    const ref = s.noteRef;
    const disabled = !ref || !!ref.readOnly;
    const isHere = !!ref?.noteId && ref.noteId === currentId;
    const selected = !!ref?.noteId && ref.noteId === nextId;
    return (
      <button
        key={s.id}
        type="button"
        disabled={disabled}
        onClick={() => ref && onOpenNoteRef(ref)}
        className={`flex min-w-0 flex-col overflow-hidden rounded-lg bg-card text-left ${disabled ? "cursor-default opacity-60" : "cursor-pointer"}`}
        style={{
          border: `1.5px solid ${selected ? "var(--color-primary)" : KIND_PALETTE.activity.main}`,
          boxShadow: selected ? "0 0 0 3px color-mix(in oklch, var(--color-primary) 25%, transparent)" : "var(--shadow-1)",
        }}
      >
        <span className="flex items-center gap-1.5 px-2 py-1" style={{ background: KIND_PALETTE.activity.bg }}>
          <FileText size={11} className="shrink-0" style={{ color: KIND_PALETTE.activity.text }} />
          {isHere && <HereBadge label={hereLabel} />}
        </span>
        {/* 余白は外側に持たせる（行の打ち切りと同じ要素に余白があると、次の行が余白の分だけはみ出して見える）。
            知見の文は長いので、ほぼ全文を出し、6 行を超える分だけ省く */}
        <span className="px-2 py-1.5" title={s.name}>
          <span className="line-clamp-6 break-words text-xs font-medium">{s.name}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3" style={{ maxHeight: height }}>
      {groups.ungrouped.length > 0 && <div className="grid gap-2" style={CARD_GRID}>{groups.ungrouped.map(renderCard)}</div>}
      {groups.grouped.map((g) => (
        <div key={g.label} className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">{g.label}</div>
          <div className="grid gap-2" style={CARD_GRID}>{g.steps.map(renderCard)}</div>
        </div>
      ))}
    </div>
  );
}

/** 「手順を表示」は端末ごとに覚える（読み書きできなければ既定のオン） */
const SHOW_STEPS_KEY = "graphium.genealogy.showSteps";
function readShowSteps(): boolean {
  try {
    return localStorage.getItem(SHOW_STEPS_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeShowSteps(on: boolean) {
  try {
    localStorage.setItem(SHOW_STEPS_KEY, on ? "1" : "0");
  } catch {
    // 保存できなくても表示は切り替わる
  }
}

type FlowLevelProps = {
  node: StackNode;
  index: number;
  last: boolean;
  flow: LevelFlow;
  next?: StackNode;
  expanded: boolean;
  currentId?: string;
  /** 計画の段で「手順を表示」がオンか（図全体で 1 つ） */
  showSteps: boolean;
  onToggleSteps: () => void;
  onOpenRef: (levelIndex: number, ref: FlowNoteRef) => void;
  onOpen?: (node: StackNode) => void;
  canOpen?: (node: StackNode) => boolean;
};

/**
 * 1 段。onOpenNoteRef を段ごとに安定させる（毎描画で作り直すと StepFlowView の
 * ノード再構築 effect が走り続けるため）。memo で、無関係な再描画でも図を触らない
 */
const FlowLevel = memo(function FlowLevel({
  node,
  index,
  last,
  flow,
  next,
  expanded,
  currentId,
  showSteps,
  onToggleSteps,
  onOpenRef,
  onOpen,
  canOpen,
}: FlowLevelProps) {
  const t = useT();
  const onOpenNoteRef = useCallback((ref: FlowNoteRef) => onOpenRef(index, ref), [onOpenRef, index]);
  // 参照を固定する（毎描画で作り直すと StepFlowView のノード再構築 effect が走り続ける）
  const expandLabel = t("lineageFlow.expand");
  const noteRefAction = useMemo(() => ({ label: expandLabel, icon: "expand" as const }), [expandLabel]);
  const openLabel = t("lineageStack.openNote");
  // 計画の段: 手順を表示オンなら全工程の手順をつなげた図、オフなら工程グラフ
  const hasSteps = flow.kind === "plan" && !!flow.steps;
  const useSteps = flow.kind === "plan" && !!flow.steps && showSteps;
  const active = flow.kind === "plan" && flow.steps && showSteps ? flow.steps : flow.kind === "none" ? null : flow;
  const height = useSteps
    ? expanded ? PROCEDURE_EXPANDED_FLOW_HEIGHT : PROCEDURE_PANEL_FLOW_HEIGHT
    : expanded ? EXPANDED_FLOW_HEIGHT : PANEL_FLOW_HEIGHT;
  const title = node.title;
  return (
    <section className={`rounded-xl border border-border bg-background ${last ? "" : "opacity-60"}`}>
      <header className={`flex items-start gap-2 px-3 py-2 ${flow.kind === "none" && !node.truncated ? "" : "border-b border-border"}`}>
        <span className="min-w-0 flex-1 break-words text-sm font-medium line-clamp-2" title={title}>
          {title}
        </span>
        {hasSteps && (
          <button
            type="button"
            aria-pressed={showSteps}
            onClick={onToggleSteps}
            className={`shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs cursor-pointer ${
              showSteps ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {t("lineageFlow.showSteps")}
          </button>
        )}
        {node.isCurrent && <HereBadge label={t("lineageStack.here")} />}
        {last && index > 0 && onOpen && node.open && (canOpen?.(node) ?? true) && (
          <button
            type="button"
            onClick={() => onOpen(node)}
            className="shrink-0 whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted"
          >
            {t("lineageStack.openNote")}
          </button>
        )}
      </header>
      {flow.kind === "none" || !active ? (
        <div className={`px-3 pb-2 text-xs text-muted-foreground ${node.truncated ? "pt-2" : ""}`}>
          {node.truncated ? t("lineageStack.truncated") : t("lineageStack.derived.none")}
        </div>
      ) : !useSteps && active.graph.edges.length === 0 ? (
        <CardsLevel
          graph={active.graph}
          nextId={next?.id}
          currentId={currentId}
          hereLabel={t("lineageStack.here")}
          height={height}
          onOpenNoteRef={onOpenNoteRef}
        />
      ) : (
        <div style={{ height }}>
          <StepFlowView
            graph={active.graph}
            variant="preview"
            toolbar="layoutOnly"
            // 右パネルの幅（300〜400px）でも図全体が収まるよう、全画面より深く縮める
            fitMinZoom={expanded ? undefined : 0.25}
            layoutScope={active.layoutScope}
            onOpenNoteRef={onOpenNoteRef}
            noteRefAction={noteRefAction}
            noteRefOpenLabel={openLabel}
          />
        </div>
      )}
      {next && (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {t("lineageFlow.opening", { title: next.title })}
        </div>
      )}
    </section>
  );
});

// 札は 200px 以上で、枠の幅いっぱいに列を詰める（右に空きを残さない）。右パネルの幅（300〜400px）では
// 1 列になり、知見の文が切れずに読める。全画面では列が増える
const CARD_GRID = { gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" } as const;

export function LineageFlowView({
  stack,
  getLevelFlow,
  onOpen,
  canOpen,
  onFocusPath,
  canFocus,
}: {
  stack: LineageStackModel;
  /** 段のノード id → その段の図。panel から注入する（memo 化は呼び出し側） */
  getLevelFlow: (nodeId: string, nextId?: string) => LevelFlow;
  /** 「ノートを開く」（サイドピーク） */
  onOpen?: (node: StackNode) => void;
  canOpen?: (node: StackNode) => boolean;
  /** まだ作っていないノードを開くとき（段の「他 N 件」と同じ） */
  onFocusPath?: (path: string[]) => void;
  /** まだ作っていないノード（上限で省いた子）を開いてよいか。無ければ許す */
  canFocus?: (nodeId: string) => boolean;
}) {
  const t = useT();
  const [path, setPath] = useState<string[]>(stack.initialPath);
  const [expanded, setExpanded] = useState(false);
  // 計画の段の「手順を表示」。図全体で 1 つ（すべての計画の段で共通）、端末ごとに覚える
  const [showSteps, setShowSteps] = useState<boolean>(readShowSteps);
  const toggleSteps = useCallback(() => {
    setShowSteps((v) => {
      writeShowSteps(!v);
      return !v;
    });
  }, []);

  // 起点と初期の経路が変わったときだけ開き方を初期に戻す（段の表示と同じ鍵）
  const modelKey = `${stack.rootId}|${stack.initialPath.join(">")}`;
  const initialPathRef = useRef(stack.initialPath);
  initialPathRef.current = stack.initialPath;
  useEffect(() => {
    setPath(initialPathRef.current);
  }, [modelKey]);

  // Esc で全画面を閉じる
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expanded]);

  // 作り直された model に無い id が混ざっていたら、そこで切る
  const validPath = useMemo(() => {
    const i = path.findIndex((id) => !stack.nodes[id]);
    return i < 0 ? path : path.slice(0, i);
  }, [path, stack]);

  const openRef = (levelIndex: number, ref: FlowNoteRef) => {
    const target = ref.noteId;
    if (!target) return;
    // 「ノートを開く」: 経路には積まず、サイドピークで開く。stack に無ければ何もしない
    if (ref.action === "open") {
      const node = stack.nodes[target];
      if (node && onOpen && (canOpen?.(node) ?? true)) onOpen(node);
      return;
    }
    // 工程の派生ノートは、経路に工程を挟む（工程の段は描かないが、経路としては必要）
    const chain = ref.via ? [ref.via, target] : [target];
    const known = chain.every((id) => !!stack.nodes[id]);
    // 作っていないノードは、ほかの手がかり（素データにある）が無ければ何もしない
    if (!known && !(onFocusPath && chain.every((id) => !!stack.nodes[id] || (canFocus?.(id) ?? true)))) return;
    const next = [...validPath.slice(0, levelIndex + 1), ...chain];
    setPath(next);
    // 上限で作っていないノードは、経路として builder に頼んで作らせる
    if (!known) onFocusPath?.(next);
  };
  // 段から渡す関数は参照を固定し、中で最新の openRef を呼ぶ
  const openRefLatest = useRef(openRef);
  openRefLatest.current = openRef;
  const stableOpenRef = useCallback((levelIndex: number, ref: FlowNoteRef) => openRefLatest.current(levelIndex, ref), []);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs">
        <Workflow size={14} className="shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {validPath.map((id, i) => {
            const last = i === validPath.length - 1;
            const title = stack.nodes[id].title;
            return (
              <span key={`${id}-${i}`} className={`flex min-w-0 items-center gap-1.5 ${last ? "flex-[2]" : "flex-1"}`}>
                {i > 0 && <span className="shrink-0 text-muted-foreground">›</span>}
                {last ? (
                  <span className="min-w-0 truncate whitespace-nowrap text-foreground" title={title}>
                    {title}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPath(validPath.slice(0, i + 1))}
                    title={title}
                    className="min-w-0 truncate whitespace-nowrap text-muted-foreground hover:underline"
                  >
                    {title}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-tooltip={expanded ? t("panel.graph.collapse") : t("panel.graph.expand")}
          aria-label={expanded ? t("panel.graph.collapse") : t("panel.graph.expand")}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
        >
          {expanded ? <X size={12} /> : <Maximize2 size={12} />}
          {expanded ? t("panel.graph.collapse") : t("panel.graph.expand")}
        </button>
      </div>
      <Legend />
    </>
  );

  const currentId = Object.values(stack.nodes).find((n) => n.isCurrent)?.id;
  // 描く段（計画の段の直後の工程の段は、計画の段に含まれるので描かない）
  const shown = displayLevels(validPath, getLevelFlow);
  const levels = shown.map(({ id, pathIndex, flow }, k) => {
    const last = k === shown.length - 1;
    // 図の種類・手順を表示の切り替えで作り直す。ノードが原点に重なるのを防ぐ
    const mode = flow.kind === "plan" && flow.steps ? (showSteps ? "steps" : "plan") : "";
    return (
      <FlowLevel
        key={`${id}-${pathIndex}-${flow.kind}-${mode}`}
        node={stack.nodes[id]}
        index={pathIndex}
        last={last}
        flow={flow}
        next={last ? undefined : stack.nodes[shown[k + 1].id]}
        expanded={expanded}
        currentId={currentId}
        showSteps={showSteps}
        onToggleSteps={toggleSteps}
        onOpenRef={stableOpenRef}
        onOpen={onOpen}
        canOpen={canOpen}
      />
    );
  });

  const body = (
    <div className="@container flex flex-col gap-3">
      {header}
      {levels}
    </div>
  );

  if (expanded) {
    return createPortal(
      <div
        className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center p-6`}
        style={{ background: "rgba(0, 0, 0, 0.45)" }}
        onClick={() => setExpanded(false)}
      >
        <div
          className="relative overflow-auto rounded-lg bg-background p-3 shadow-2xl"
          style={{ width: "min(1400px, 95vw)", height: "92vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </div>
      </div>,
      document.body,
    );
  }
  return body;
}
