// おまかせで整える — 手入れ画面の冒頭の欄
//
// 人が一覧から 1 件ずつ選ぶ代わりに、AI が点検 → 手当て → 出典照合 → 手当て を通しで行う。
// 結果は「何件整えたか」だけを見せ、内訳はたたむ。取り消しは「手入れの履歴」から。
// 出典照合の最中だけ中断できる（点検と手当ては途中で止めない）。

import { useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { useT } from "../../i18n";
import type { AutoSourceCheckDone } from "../source-check/auto-fix";
import type { AutoTidyDone } from "./auto-tidy";
import { countFixed, countNotFixed, type AutoUpkeepProgress, type AutoUpkeepResult } from "./auto-upkeep";
import { SourceCheckEta } from "../source-check/ui/SourceCheckEta";

export type AutoUpkeepPanelProps = {
  progress: AutoUpkeepProgress | null;
  result: AutoUpkeepResult | null;
  onRun: () => void;
  /** 手で選んだ照合が走っているあいだは押させない（照合は同時に 1 つしか走らない） */
  disabled?: boolean;
  /** 出典照合の中断（照合の段階でだけ出す） */
  onCancel?: () => void;
  /** 「手入れの履歴」タブへ移る（取り消しの置き場） */
  onShowOperations?: () => void;
  onOpenWiki?: (wikiId: string) => void;
};

export function AutoUpkeepPanel({ progress, result, onRun, disabled = false, onCancel, onShowOperations, onOpenWiki }: AutoUpkeepPanelProps) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (progress) {
    const label =
      progress.phase === "checking"
        ? t("autoTidy.checking")
        : progress.phase === "fixing"
          ? t("autoTidy.fixing", { done: String(progress.done), total: String(progress.total) })
          : progress.phase === "sourceChecking"
            ? progress.total > 0
              ? t("autoTidy.sourceChecking", { index: String(progress.index + 1), total: String(progress.total) })
              : t("autoTidy.sourcePreparing")
            : t("autoTidy.sourceFixing", { done: String(progress.done), total: String(progress.total) });
    return (
      <div className="px-4 py-4 border-b border-border flex items-center gap-2 text-xs text-foreground" role="status">
        <Loader2 size={14} className="animate-spin text-primary shrink-0" />
        <span className="flex-1">
          {label}
          {progress.phase === "sourceChecking" && progress.startedAt !== undefined && (
            <SourceCheckEta startedAt={progress.startedAt} done={progress.index} total={progress.total} />
          )}
        </span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] border border-border hover:bg-muted transition-colors"
          >
            <X size={11} />
            {t("autoTidy.cancel")}
          </button>
        )}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-10 border-b border-border">
        <Sparkles size={24} className="text-primary/60" />
        <p className="text-xs text-muted-foreground leading-relaxed max-w-md">{t("autoTidy.intro")}</p>
        <button
          onClick={onRun}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Sparkles size={13} />
          {t("autoTidy.run")}
        </button>
      </div>
    );
  }

  const fixed = countFixed(result);
  const notFixed = countNotFixed(result);
  const tried = result.tidy.length + result.sourceCheck.length;
  const headline = result.interrupted
    ? t("autoTidy.interrupted", { count: String(fixed) })
    : fixed > 0
      ? t("autoTidy.doneCount", { count: String(fixed) })
      : tried > 0
        ? t("autoTidy.noneFixed")
        : t("autoTidy.nothingToDo");
  // 中断・1 件も済まなかったときは「済んだ」の印を出さない
  const warn = result.interrupted || (tried > 0 && fixed === 0);
  return (
    <div className="px-4 py-3 border-b border-border space-y-2">
      <div className="flex items-center gap-2">
        {warn ? (
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        ) : (
          <CheckCircle size={14} className="text-emerald-500 shrink-0" />
        )}
        <span className="text-xs font-medium text-foreground">{headline}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{new Date(result.finishedAt).toLocaleString()}</span>
        <button
          onClick={onRun}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] border border-border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Sparkles size={11} />
          {t("autoTidy.runAgain")}
        </button>
      </div>

      {result.lintFailed && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("autoTidy.lintFailed")}</p>
      )}
      {notFixed > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {t("autoTidy.failedCount", { count: String(notFixed) })}
        </p>
      )}

      {tried > 0 && (
        <div>
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown size={12} className={`transition-transform ${detailsOpen ? "" : "-rotate-90"}`} />
            {t("autoTidy.details")}
          </button>
          {detailsOpen && (
            <ul className="mt-1.5 ml-4 space-y-1">
              {result.tidy.map((d, i) => (
                <li key={`t${i}`} className="text-[11px] text-foreground leading-relaxed">
                  <TidyLine done={d} onOpenWiki={onOpenWiki} />
                </li>
              ))}
              {result.sourceCheck.map((d, i) => (
                <li key={`s${i}`} className="text-[11px] text-foreground leading-relaxed">
                  <SourceCheckLine done={d} onOpenWiki={onOpenWiki} />
                </li>
              ))}
            </ul>
          )}
          {onShowOperations && fixed > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {t("autoTidy.undoHint")}{" "}
              <button onClick={onShowOperations} className="text-primary hover:underline">
                {t("autoTidy.showOperations")}
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TidyLine({ done, onOpenWiki }: { done: AutoTidyDone; onOpenWiki?: (wikiId: string) => void }) {
  const t = useT();
  const step = done.step;
  const targetId = step.kind === "merge" ? step.keepId : step.wikiId;
  const label = !done.ok
    ? t("autoTidy.line.failed", { title: done.title })
    : step.kind === "merge"
      ? t("autoTidy.line.merge", { title: done.title, absorbed: done.absorbedTitle ?? "" })
      : step.kind === "rebuild"
        ? t("autoTidy.line.rebuild", { title: done.title })
        : step.kind === "reconcile"
          ? t("autoTidy.line.reconcile", { title: done.title })
          : t("autoTidy.line.archive", { title: done.title });
  // アーカイブしたページは一覧から外れるので、開く導線は付けない
  if (!onOpenWiki || (done.ok && step.kind === "archive")) return <>{label}</>;
  return (
    <button onClick={() => onOpenWiki(targetId)} className="text-left hover:underline">
      {label}
    </button>
  );
}

function SourceCheckLine({ done, onOpenWiki }: { done: AutoSourceCheckDone; onOpenWiki?: (wikiId: string) => void }) {
  const t = useT();
  const { step } = done;
  const title = step.title;
  const label = !done.ok
    ? t("autoTidy.line.failed", { title })
    : step.kind === "archive"
      ? t("autoTidy.line.archiveClaim", { title })
      : step.kind === "reconcile"
        ? done.stillFlagged
          ? t("autoTidy.line.reconcileStill", { title })
          : t("autoTidy.line.reconcile", { title })
        : step.kind === "revise"
          ? done.stillFlagged
            ? t("autoTidy.line.reviseStill", { title })
            : t("autoTidy.line.revise", { title })
          : done.stillFlagged
            ? t("autoTidy.line.rewriteStill", { title })
            : t("autoTidy.line.rebuild", { title });
  if (!onOpenWiki || (done.ok && step.kind === "archive")) return <>{label}</>;
  return (
    <button onClick={() => onOpenWiki(step.wikiId)} className="text-left hover:underline">
      {label}
    </button>
  );
}
