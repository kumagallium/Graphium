// 系譜の表示。起点 → … → 注目（いま見ているノート）→ ここから作ったもの を点と線の 1 本線で描く。
// 計画・手順のあるノートは「図を見る」で、工程グラフと同じ StepFlowView（variant="preview"）を
// その行の下に開く。手で並べた配置は工程グラフ・ステップタブと共有する（layoutScope は LevelFlow が持つ）。

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, Library, Lightbulb, Maximize2, NotebookPen, Workflow, X } from "lucide-react";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { FlowGraphData, FlowNoteRef } from "./activity-graph-adapter";
import type { LevelFlow } from "./lineage-flow-builder";
import type { LineageStackModel, StackNode, StackNodeKind } from "./lineage-stack-model";
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

type LineItem = { id: string; title: string; kind: StackNodeKind };

/** 段のノードの子（箱の中身と、上限で省いた名前だけの札）。箱の見出しごと */
function childGroupsOf(stack: LineageStackModel, node: StackNode): { key: string; label: string; items: LineItem[] }[] {
  return node.groups
    .map((g) => {
      const items: LineItem[] = [];
      const seen = new Set<string>();
      for (const id of g.children) {
        const c = stack.nodes[id];
        if (!c || seen.has(id)) continue;
        seen.add(id);
        items.push({ id, title: c.title, kind: c.kind });
      }
      for (const h of g.hidden ?? []) {
        if (seen.has(h.id)) continue;
        seen.add(h.id);
        items.push(h);
      }
      return { key: g.key, label: g.label, items };
    })
    .filter((g) => g.items.length > 0);
}

/** 種類ごとの印（工程グラフの色に揃える） */
function KindIcon({ kind, size = 12 }: { kind: StackNodeKind; size?: number }) {
  const [Icon, color] =
    kind === "plan"
      ? [Workflow, KIND_PALETTE.activity.text]
      : kind === "knowledge"
        ? [Lightbulb, KIND_PALETTE.tool.text]
        : kind === "asset"
          ? [FileText, KIND_PALETTE.material.text]
          : kind === "root"
            ? [Library, "var(--color-text-tertiary)"]
            : [NotebookPen, KIND_PALETTE.activity.text];
  return <Icon size={size} className="shrink-0" style={{ color }} />;
}

/** 1 本線の点。いま注目しているものは大きい輪 */
function Dot({ focus }: { focus?: boolean }) {
  return focus ? (
    <span className="mt-2 h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-primary bg-background" />
  ) : (
    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/50" />
  );
}

/** 1 本線の 1 行（左に点と縦線、右に中身） */
function LineRow({ dot, line, children }: { dot: ReactNode; line: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex w-3.5 shrink-0 flex-col items-center">
        {dot}
        {line && <span className="w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-3">{children}</div>
    </div>
  );
}

const linkButton = "cursor-pointer text-left text-[11px] text-primary hover:underline";

/** 名前の一覧。押すとそのノートを 1 本線の注目に据える */
function ItemList({ items, onPick, muted }: { items: LineItem[]; onPick: (item: LineItem) => void; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onPick(it)}
          title={it.title}
          className={`flex min-w-0 cursor-pointer items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted ${muted ? "text-[11px] text-muted-foreground" : "text-xs"}`}
        >
          <span className="mt-0.5">
            <KindIcon kind={it.kind} size={muted ? 11 : 12} />
          </span>
          <span className="min-w-0 flex-1 break-words line-clamp-2">{it.title}</span>
        </button>
      ))}
    </div>
  );
}

/** ここから作ったもの：箱ごとに先頭の数件を出し、残りは「ほかに N 件」に畳む */
const DERIVED_VISIBLE = 5;

function DerivedRows({
  stack,
  node,
  onPick,
  inDiagram,
}: {
  stack: LineageStackModel;
  node: StackNode;
  onPick: (item: LineItem) => void;
  /** 一覧に出すものは無いが、図（計画の工程など）にはある */
  inDiagram?: boolean;
}) {
  const t = useT();
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const groups = childGroupsOf(stack, node);
  if (node.truncated) return <div className="text-xs text-muted-foreground">{t("lineageStack.truncated")}</div>;
  if (groups.length === 0)
    return (
      <div className="text-xs text-muted-foreground">{inDiagram ? t("lineageLine.derivedInDiagram") : t("lineageLine.derivedNone")}</div>
    );
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const open = openKeys.has(g.key);
        const shown = open ? g.items : g.items.slice(0, DERIVED_VISIBLE);
        const rest = g.items.length - DERIVED_VISIBLE;
        return (
          <div key={g.key} className="flex flex-col gap-0.5">
            {groups.length > 1 && <div className="text-[11px] text-muted-foreground">{g.label}</div>}
            <div className={open ? "max-h-72 overflow-y-auto" : ""}>
              <ItemList items={shown} onPick={onPick} />
            </div>
            {rest > 0 && (
              <button type="button" onClick={() => toggle(g.key)} className={`${linkButton} px-1`}>
                {open ? t("lineageStack.close") : t("lineageLine.others", { count: String(rest) })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 図を描ける段か（線のある図。線の無い札の並びは「ここから作ったもの」の一覧で足りる） */
function hasDiagram(flow: LevelFlow): boolean {
  if (flow.kind === "none") return false;
  if (flow.kind === "plan") return true;
  return flow.graph.edges.length > 0;
}

type LevelDiagramProps = {
  index: number;
  flow: LevelFlow;
  expanded: boolean;
  currentId?: string;
  nextId?: string;
  /** 計画の段で「手順を表示」がオンか（図全体で 1 つ） */
  showSteps: boolean;
  onToggleSteps: () => void;
  onOpenRef: (levelIndex: number, ref: FlowNoteRef) => void;
};

/**
 * 1 本線の行の下に開く図（工程グラフ・ステップタブと同じ StepFlowView）。onOpenNoteRef を段ごとに
 * 安定させる（毎描画で作り直すと StepFlowView のノード再構築 effect が走り続けるため）
 */
const LevelDiagram = memo(function LevelDiagram({
  index,
  flow,
  expanded,
  currentId,
  nextId,
  showSteps,
  onToggleSteps,
  onOpenRef,
}: LevelDiagramProps) {
  const t = useT();
  const onOpenNoteRef = useCallback((ref: FlowNoteRef) => onOpenRef(index, ref), [onOpenRef, index]);
  // 参照を固定する（毎描画で作り直すと StepFlowView のノード再構築 effect が走り続ける）
  const expandLabel = t("lineageFlow.expand");
  const noteRefAction = useMemo(() => ({ label: expandLabel, icon: "expand" as const }), [expandLabel]);
  const openLabel = t("lineageStack.openNote");
  if (flow.kind === "none") return null;
  const hasSteps = flow.kind === "plan" && !!flow.steps;
  const useSteps = flow.kind === "plan" && !!flow.steps && showSteps;
  const active = flow.kind === "plan" && flow.steps && showSteps ? flow.steps : flow;
  const height = useSteps
    ? expanded ? PROCEDURE_EXPANDED_FLOW_HEIGHT : PROCEDURE_PANEL_FLOW_HEIGHT
    : expanded ? EXPANDED_FLOW_HEIGHT : PANEL_FLOW_HEIGHT;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {(flow.kind === "plan" || hasSteps) && (
        <div className="flex flex-wrap items-center gap-2">
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
          <Legend />
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {!useSteps && active.graph.edges.length === 0 ? (
          <CardsLevel
            graph={active.graph}
            nextId={nextId}
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
      </div>
    </div>
  );
});

// 札は 200px 以上で、枠の幅いっぱいに列を詰める（右に空きを残さない）。右パネルの幅（300〜400px）では
// 1 列になり、知見の文が切れずに読める。全画面では列が増える
const CARD_GRID = { gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" } as const;

/**
 * 系譜を「元 → いま → ここから作ったもの」の 1 本線で描く。経路（path）の最後が注目で、
 * それより上は元にしたもの（押すとそこへ戻る）。同じ元から作ったほかのものは「ほかに N 件」に畳む。
 * 計画・手順のあるノートは「図を見る」で工程グラフと同じ図をその場に開く
 */
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
  /** まだ作っていないノードを開くとき（上限で省いた子） */
  onFocusPath?: (path: string[]) => void;
  /** まだ作っていないノード（上限で省いた子）を開いてよいか。無ければ許す */
  canFocus?: (nodeId: string) => boolean;
}) {
  const t = useT();
  const [path, setPath] = useState<string[]>(stack.initialPath);
  const [expanded, setExpanded] = useState(false);
  // 図の開閉を手で切り替えた行（ノード id → 開いているか）。無ければ既定（注目が計画なら開く）
  const [diagramToggled, setDiagramToggled] = useState<Map<string, boolean>>(() => new Map());
  // 「ほかに N 件」を開いている元の行（ノード id）
  const [siblingsOpen, setSiblingsOpen] = useState<Set<string>>(() => new Set());
  // 計画の段の「手順を表示」。図全体で 1 つ（すべての計画の段で共通）、端末ごとに覚える
  const [showSteps, setShowSteps] = useState<boolean>(readShowSteps);
  const toggleSteps = useCallback(() => {
    setShowSteps((v) => {
      writeShowSteps(!v);
      return !v;
    });
  }, []);

  // 起点と初期の経路が変わったときだけ開き方を初期に戻す
  const modelKey = `${stack.rootId}|${stack.initialPath.join(">")}`;
  const initialPathRef = useRef(stack.initialPath);
  initialPathRef.current = stack.initialPath;
  useEffect(() => {
    setPath(initialPathRef.current);
    setDiagramToggled(new Map());
    setSiblingsOpen(new Set());
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

  /** 経路を chain まで伸ばす。stack に無い（上限で省いた）ノートは builder に作らせる */
  const extendPath = (levelIndex: number, chain: string[]) => {
    const known = chain.every((id) => !!stack.nodes[id]);
    // 作っていないノードは、ほかの手がかり（素データにある）が無ければ何もしない
    if (!known && !(onFocusPath && chain.every((id) => !!stack.nodes[id] || (canFocus?.(id) ?? true)))) return;
    const next = [...validPath.slice(0, levelIndex + 1), ...chain];
    setPath(next);
    if (!known) onFocusPath?.(next);
  };

  const openRef = (levelIndex: number, ref: FlowNoteRef) => {
    const target = ref.noteId;
    if (!target) return;
    // 「ノートを開く」: 経路には積まず、サイドピークで開く。stack に無ければ何もしない
    if (ref.action === "open") {
      const node = stack.nodes[target];
      if (node && onOpen && (canOpen?.(node) ?? true)) onOpen(node);
      return;
    }
    // 工程の派生ノートは、経路に工程を挟む
    extendPath(levelIndex, ref.via ? [ref.via, target] : [target]);
  };
  // 図から渡す関数は参照を固定し、中で最新の openRef を呼ぶ
  const openRefLatest = useRef(openRef);
  openRefLatest.current = openRef;
  const stableOpenRef = useCallback((levelIndex: number, ref: FlowNoteRef) => openRefLatest.current(levelIndex, ref), []);

  const toggleIn = (set: (f: (prev: Set<string>) => Set<string>) => void, id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const currentId = Object.values(stack.nodes).find((n) => n.isCurrent)?.id;
  const lastIndex = validPath.length - 1;

  // 計画は工程が図にしか無いので、注目になったら最初から図を開く
  const isDiagramOpen = (id: string, i: number, flow: LevelFlow) =>
    diagramToggled.get(id) ?? (i === lastIndex && flow.kind === "plan");
  const diagramToggle = (id: string, i: number, flow: LevelFlow) => {
    if (!hasDiagram(flow)) return null;
    const open = isDiagramOpen(id, i, flow);
    return (
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setDiagramToggled((prev) => new Map(prev).set(id, !open))}
        className={linkButton}
      >
        {open ? t("lineageLine.hideDiagram") : t("lineageLine.showDiagram")}
      </button>
    );
  };

  const diagramOf = (id: string, i: number, flow: LevelFlow) =>
    isDiagramOpen(id, i, flow) && hasDiagram(flow) ? (
      <LevelDiagram
        index={i}
        flow={flow}
        expanded={expanded}
        currentId={currentId}
        nextId={validPath[i + 1]}
        showSteps={showSteps}
        onToggleSteps={toggleSteps}
        onOpenRef={stableOpenRef}
      />
    ) : null;

  const rows = validPath.map((id, i) => {
    const node = stack.nodes[id];
    const flow = getLevelFlow(id, validPath[i + 1]);
    if (i < lastIndex) {
      // 元にしたもの。押すとそこを注目に戻す。同じ元から作ったほかのものは畳む
      const others = childGroupsOf(stack, node)
        .flatMap((g) => g.items)
        .filter((it, k, all) => it.id !== validPath[i + 1] && all.findIndex((x) => x.id === it.id) === k);
      const open = siblingsOpen.has(id);
      return (
        <LineRow key={`${id}-${i}`} dot={<Dot />} line>
          <div className="flex flex-col gap-1">
            {i === lastIndex - 1 && <div className="text-[11px] text-muted-foreground">{t("lineageLine.from")}</div>}
            <div className="flex min-w-0 items-start gap-1.5">
              <button
                type="button"
                onClick={() => setPath(validPath.slice(0, i + 1))}
                title={node.title}
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 text-left text-xs hover:underline"
              >
                <span className="mt-0.5">
                  <KindIcon kind={node.kind} />
                </span>
                <span className="min-w-0 break-words line-clamp-2">{node.title}</span>
              </button>
              {node.isCurrent && <HereBadge label={t("lineageStack.here")} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {others.length > 0 && (
                <button type="button" aria-expanded={open} onClick={() => toggleIn(setSiblingsOpen, id)} className={linkButton}>
                  {open ? t("lineageStack.close") : t("lineageLine.others", { count: String(others.length) })}
                </button>
              )}
              {diagramToggle(id, i, flow)}
            </div>
            {open && (
              <div className="max-h-60 overflow-y-auto">
                <ItemList items={others} onPick={(it) => extendPath(i, [it.id])} muted />
              </div>
            )}
            {diagramOf(id, i, flow)}
          </div>
        </LineRow>
      );
    }
    // 注目（経路の最後）。現在のノートなら「いま見ている」
    const canOpenHere = i > 0 && !!onOpen && !!node.open && (canOpen?.(node) ?? true);
    return (
      <LineRow key={`${id}-${i}`} dot={<Dot focus />} line>
        <div className="rounded-xl border-2 border-primary bg-background px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <KindIcon kind={node.kind} size={11} />
            <span className="min-w-0 flex-1">{node.isCurrent ? t("lineageLine.here") : t("lineageLine.selected")}</span>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-sm font-semibold line-clamp-3" title={node.title}>
              {node.title}
            </span>
            {canOpenHere && (
              <button
                type="button"
                onClick={() => onOpen?.(node)}
                className="shrink-0 cursor-pointer whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted"
              >
                {t("lineageStack.openNote")}
              </button>
            )}
          </div>
          {hasDiagram(flow) && <div className="mt-1">{diagramToggle(id, i, flow)}</div>}
          {diagramOf(id, i, flow)}
        </div>
      </LineRow>
    );
  });

  const focusNode = lastIndex >= 0 ? stack.nodes[validPath[lastIndex]] : undefined;
  const focusHasDiagram = !!focusNode && hasDiagram(getLevelFlow(focusNode.id));

  const header = (
    <div className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1" />
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
  );

  const body = (
    <div className="@container flex flex-col gap-3">
      {header}
      <div className="flex flex-col">
        {rows}
        {focusNode && (
          <LineRow dot={<Dot />} line={false}>
            <div className="flex flex-col gap-1">
              <div className="text-[11px] text-muted-foreground">{t("lineageLine.derived")}</div>
              <DerivedRows
                key={focusNode.id}
                stack={stack}
                node={focusNode}
                onPick={(it) => extendPath(lastIndex, [it.id])}
                inDiagram={focusHasDiagram}
              />
            </div>
          </LineRow>
        )}
      </div>
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
