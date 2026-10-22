// 来歴スタックビュー。起点（最上流）から下へ、派生ノートを「箱」でまとめて並べ、
// 札をクリックするとその場で下に段が開く。深さは入れ子でなく段の縦積みで表す。
// データは LineageStackModel（純データ）で受け取る。docs からの組み立ては別担当。

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Diamond,
  File,
  FileText,
  FileType,
  GitBranch,
  GitCompareArrows,
  X,
} from "lucide-react";
import { useT } from "../../i18n";
import {
  diffSteps,
  nextPath,
  type LineageStackModel,
  type StackGroup,
  type StackNode,
  type StackNodeKind,
} from "./lineage-stack-model";

const LINK_COLOR = "#9cb5a4";

function KindIcon({ kind }: { kind: StackNodeKind }) {
  if (kind === "knowledge") return <Diamond size={14} />;
  if (kind === "asset") return <FileType size={14} />;
  if (kind === "text") return <File size={14} />;
  return <FileText size={14} />;
}

function HereBadge({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "#FAEEDA", color: "#633806" }}
    >
      {label}
    </span>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "green" | "purple" | "gray" }) {
  if (tone === "gray") {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
  }
  const style =
    tone === "green" ? { background: "#E1F5EE", color: "#085041" } : { background: "#EEEDFE", color: "#3C3489" };
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px]" style={style}>
      {children}
    </span>
  );
}

type LevelProps = {
  model: LineageStackModel;
  node: StackNode;
  index: number;
  path: string[];
  keepParentSteps: boolean;
  closedGroups: Set<string>;
  onToggleGroup: (groupKey: string) => void;
  onPick: (levelIndex: number, childId: string) => void;
  onCut: (length: number) => void;
  onOpenNote?: (nodeId: string) => void;
};

function Level({
  model,
  node,
  index,
  path,
  keepParentSteps,
  closedGroups,
  onToggleGroup,
  onPick,
  onCut,
  onOpenNote,
}: LevelProps) {
  const t = useT();
  const markerId = useId();
  const levelRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ key: string; d: string }[]>([]);

  const isLast = index === path.length - 1;
  const nextId = isLast ? undefined : path[index + 1];
  const parent = index > 0 ? model.nodes[path[index - 1]] : undefined;

  // 受け渡しの線: 札の DOM 位置から段基準の座標を取り、右端中央 → 左端中央のベジェで結ぶ
  useLayoutEffect(() => {
    const el = levelRef.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const cards = new Map<string, DOMRect>();
      el.querySelectorAll<HTMLElement>("[data-card]").forEach((c) => {
        cards.set(c.dataset.card ?? "", c.getBoundingClientRect());
      });
      const next: { key: string; d: string }[] = [];
      for (const l of node.links) {
        const a = cards.get(l.from);
        const b = cards.get(l.to);
        if (!a || !b) continue; // 折りたたまれて札が無い線は描かない
        const x1 = a.right - base.left;
        const y1 = a.top + a.height / 2 - base.top;
        const x2 = b.left - base.left;
        const y2 = b.top + b.height / 2 - base.top;
        const dx = Math.max(20, (x2 - x1) / 2);
        next.push({
          key: `${l.from}->${l.to}`,
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 4} ${y2}`,
        });
      }
      setLines((prev) =>
        prev.length === next.length && prev.every((p, i) => p.key === next[i].key && p.d === next[i].d)
          ? prev
          : next,
      );
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.links, closedGroups, path]);

  // 内容（手順・本文など）は開いている段に出す。上の段は「手順を残す」が ON の proc だけ
  const showContent = isLast || (keepParentSteps && node.kind === "proc" && index > 0);
  const contentDim = !isLast;

  const diff =
    isLast && parent && parent.kind === "proc" && node.kind === "proc" ? diffSteps(parent, node) : null;
  const parentStepNames = diff && parent?.steps ? new Set(parent.steps.map((s) => s.name)) : null;

  const derivedLabel =
    node.kind === "knowledge"
      ? t("lineageStack.derived.knowledge")
      : node.kind === "asset"
        ? t("lineageStack.derived.asset")
        : t("lineageStack.derived.note");

  const renderGroup = (g: StackGroup) => {
    const gKey = `${node.id}:${g.key}`;
    const closed = closedGroups.has(gKey);
    const hasNext = !!nextId && g.children.includes(nextId);
    return (
      <div
        key={g.key}
        className={`min-w-[130px] rounded-xl border border-border bg-card p-2 ${
          !isLast && !hasNext ? "opacity-40" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleGroup(gKey)}
          className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground"
        >
          {closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>{g.label}</span>
          {closed && <span>({g.children.length})</span>}
        </button>
        {!closed && (
          <div className="flex flex-col items-start gap-1.5">
            {g.children.map((cid) => {
              const child = model.nodes[cid];
              if (!child) return null;
              const selected = cid === nextId;
              return (
                <button
                  key={cid}
                  type="button"
                  data-card={cid}
                  onClick={() => onPick(index, cid)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[13px] ${
                    selected ? "border-primary ring-1 ring-primary" : "border-border"
                  } ${hasNext && !selected ? "opacity-40" : ""}`}
                >
                  <KindIcon kind={child.kind} />
                  <span>{child.title}</span>
                  {child.isCurrent && <HereBadge label={t("lineageStack.here")} />}
                  {selected && <ChevronUp size={12} className="text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={levelRef} className="relative rounded-xl border border-border bg-background p-3">
      <div className={`mb-2 flex items-center gap-2 ${isLast ? "" : "opacity-40"}`}>
        <span className="text-sm font-medium">{node.title}</span>
        {node.isCurrent && <HereBadge label={t("lineageStack.here")} />}
        {isLast && index > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            {onOpenNote && (
              <button
                type="button"
                onClick={() => onOpenNote(node.id)}
                className="rounded-md border border-border bg-card px-2 py-0.5 text-xs hover:bg-muted"
              >
                {t("lineageStack.openNote")}
              </button>
            )}
            <button
              type="button"
              onClick={() => onCut(index)}
              aria-label={t("lineageStack.close")}
              title={t("lineageStack.close")}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X size={14} />
            </button>
          </span>
        )}
      </div>

      {showContent && (
        <div
          className={`mb-3 ${contentDim ? (node.kind === "proc" ? "opacity-70" : "opacity-40") : ""}`}
        >
          {node.kind === "proc" && (
            <>
              <div className="mb-1 text-xs text-muted-foreground">{t("lineageStack.steps")}</div>
              <div className="flex flex-wrap items-start gap-1.5">
                {(node.steps ?? []).map((s, i) => {
                  const isNew = !!parentStepNames && !parentStepNames.has(s.name);
                  return (
                    <div key={`${s.name}-${i}`} className="flex items-start gap-1.5">
                      {i > 0 && <ArrowRight size={14} className="mt-2 text-muted-foreground" />}
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`rounded-lg border bg-card px-2.5 py-1.5 text-[13px] ${
                            isNew ? "" : "border-border"
                          }`}
                          style={isNew ? { borderColor: "#633806" } : undefined}
                        >
                          {s.name}
                        </span>
                        {s.inputFrom && <Chip tone="green">← {s.inputFrom}</Chip>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {node.outputs && node.outputs.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{t("lineageStack.outputs")}</span>
                  {node.outputs.map((o) => (
                    <Chip key={o} tone="purple">
                      {o}
                    </Chip>
                  ))}
                </div>
              )}
              {diff && parent && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {t("lineageStack.diffPrefix", { title: parent.title })}{" "}
                  {[
                    diff.omitted.length > 0
                      ? t("lineageStack.diffOmitted", { names: diff.omitted.join(" · ") })
                      : null,
                    diff.added.length > 0
                      ? t("lineageStack.diffAdded", { names: diff.added.join(" · ") })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
              )}
            </>
          )}
          {node.kind === "knowledge" && (
            <>
              {node.body && <p className="mb-2 max-w-[520px] text-xs text-muted-foreground">{node.body}</p>}
              {node.sources && node.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{t("lineageStack.sources")}</span>
                  {node.sources.map((s) => (
                    <Chip key={s} tone="gray">
                      {s}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          )}
          {node.kind === "text" && (
            <>
              <div className="mb-1 text-xs text-muted-foreground">{t("lineageStack.bodyPreview")}</div>
              {node.body && <p className="max-w-[520px] text-xs text-muted-foreground">{node.body}</p>}
            </>
          )}
          {node.kind === "asset" && node.body && (
            <p className="max-w-[520px] text-xs text-muted-foreground">{node.body}</p>
          )}
        </div>
      )}

      {node.groups.length > 0 && node.kind !== "root" && (
        <div className={`mb-1.5 text-xs text-muted-foreground ${isLast ? "" : "opacity-40"}`}>{derivedLabel}</div>
      )}
      {node.groups.length === 0 && isLast && (
        <div className="text-xs text-muted-foreground">{t("lineageStack.derived.none")}</div>
      )}
      {node.groups.length > 0 && <div className="flex flex-wrap gap-3.5">{node.groups.map(renderGroup)}</div>}

      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke={LINK_COLOR} strokeWidth="1.5" />
          </marker>
        </defs>
        {lines.map((l) => (
          <path
            key={l.key}
            d={l.d}
            fill="none"
            stroke={LINK_COLOR}
            strokeWidth={1.3}
            markerEnd={`url(#${markerId})`}
          />
        ))}
      </svg>
    </div>
  );
}

export function LineageStackView({
  model,
  onOpenNote,
  className,
}: {
  model: LineageStackModel;
  /** 「ノートを開く」。未指定ならボタンを出さない */
  onOpenNote?: (nodeId: string) => void;
  className?: string;
}) {
  const t = useT();
  const [path, setPath] = useState<string[]>(model.initialPath);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  const [keepParentSteps, setKeepParentSteps] = useState(true);

  // モデルが差し替わったら開き方を初期に戻す
  useEffect(() => {
    setPath(model.initialPath);
    setClosedGroups(new Set());
  }, [model]);

  const validPath = useMemo(() => path.filter((id) => model.nodes[id]), [path, model]);

  const toggleGroup = (key: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setKeepParentSteps((v) => !v)}
          aria-pressed={keepParentSteps}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
            keepParentSteps
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground"
          }`}
        >
          <GitCompareArrows size={14} />
          {t("lineageStack.keepParentSteps")}
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <GitBranch size={14} className="text-muted-foreground" />
        {validPath.map((id, i) => {
          const last = i === validPath.length - 1;
          return (
            <span key={`${id}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground">›</span>}
              {last ? (
                <span className="text-foreground">{model.nodes[id].title}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setPath(validPath.slice(0, i + 1))}
                  className="text-muted-foreground hover:underline"
                >
                  {model.nodes[id].title}
                </button>
              )}
            </span>
          );
        })}
        <span className="ml-auto text-muted-foreground/70">{t("lineageStack.hint")}</span>
      </div>

      {validPath.map((id, i) => (
        <Level
          key={`${id}-${i}`}
          model={model}
          node={model.nodes[id]}
          index={i}
          path={validPath}
          keepParentSteps={keepParentSteps}
          closedGroups={closedGroups}
          onToggleGroup={toggleGroup}
          onPick={(levelIndex, childId) => setPath(nextPath(validPath, levelIndex, childId))}
          onCut={(length) => setPath(validPath.slice(0, length))}
          onOpenNote={onOpenNote}
        />
      ))}
    </div>
  );
}
