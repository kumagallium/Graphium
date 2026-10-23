// 来歴の「図」表示。段（起点 → … → 現在のノート）を 1 段ずつ、工程グラフと同じ
// StepFlowView（variant="preview"）で描く。手で並べた配置は工程グラフ・ステップタブと共有する
// （layoutScope は LevelFlow が持つ）。図が描けない段（知識・資料など）は段の表示の札のまま。

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GitBranch, Maximize2, X } from "lucide-react";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { FlowNoteRef } from "./activity-graph-adapter";
import type { LevelFlow } from "./lineage-flow-builder";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";
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

type FlowLevelProps = {
  node: StackNode;
  index: number;
  last: boolean;
  flow: LevelFlow;
  next?: StackNode;
  expanded: boolean;
  onOpenRef: (levelIndex: number, ref: FlowNoteRef) => void;
  onOpen?: (node: StackNode) => void;
  canOpen?: (node: StackNode) => boolean;
};

/**
 * 1 段。onOpenNoteRef を段ごとに安定させる（毎描画で作り直すと StepFlowView の
 * ノード再構築 effect が走り続けるため）。memo で、無関係な再描画でも図を触らない
 */
const FlowLevel = memo(function FlowLevel({ node, index, last, flow, next, expanded, onOpenRef, onOpen, canOpen }: FlowLevelProps) {
  const t = useT();
  const onOpenNoteRef = useCallback((ref: FlowNoteRef) => onOpenRef(index, ref), [onOpenRef, index]);
  return (
    <section className={`rounded-xl border border-border bg-background ${last ? "" : "opacity-60"}`}>
      <header className={`flex items-start gap-2 px-3 py-2 ${flow.kind === "none" && !node.truncated ? "" : "border-b border-border"}`}>
        <span className="min-w-0 flex-1 break-words text-sm font-medium line-clamp-2" title={node.title}>
          {node.title}
        </span>
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
      {flow.kind === "none" ? (
        <div className={`px-3 pb-2 text-xs text-muted-foreground ${node.truncated ? "pt-2" : ""}`}>
          {node.truncated ? t("lineageStack.truncated") : t("lineageStack.derived.none")}
        </div>
      ) : (
        <div style={{ height: expanded ? EXPANDED_FLOW_HEIGHT : PANEL_FLOW_HEIGHT }}>
          <StepFlowView
            graph={flow.graph}
            variant="preview"
            toolbar="layoutOnly"
            // 右パネルの幅（300〜400px）でも図全体が収まるよう、全画面より深く縮める
            fitMinZoom={expanded ? undefined : 0.25}
            layoutScope={flow.layoutScope}
            onOpenNoteRef={onOpenNoteRef}
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
  getLevelFlow: (nodeId: string) => LevelFlow;
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
    const known = !!stack.nodes[target];
    // 作っていないノードは、ほかの手がかり（素データにある）が無ければ何もしない
    if (!known && !(onFocusPath && (canFocus?.(target) ?? true))) return;
    const next = [...validPath.slice(0, levelIndex + 1), target];
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
        <GitBranch size={14} className="shrink-0 text-muted-foreground" />
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

  const levels = validPath.map((id, i) => {
    const flow = getLevelFlow(id);
    const last = i === validPath.length - 1;
    return (
      <FlowLevel
        // 図の種類が変わったら（手順の索引の読み込み後など）作り直す。ノードが原点に重なるのを防ぐ
        key={`${id}-${i}-${flow.kind}`}
        node={stack.nodes[id]}
        index={i}
        last={last}
        flow={flow}
        next={last ? undefined : stack.nodes[validPath[i + 1]]}
        expanded={expanded}
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
