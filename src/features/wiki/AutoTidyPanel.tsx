// おまかせで整える — 手入れ画面の点検タブ冒頭の欄
//
// 人が一覧から 1 件ずつ選ぶ代わりに、AI が点検から手当て（統合・作り直し・再生成）まで
// 通しで行う。結果は「何件整えたか」だけを見せ、内訳はたたむ。取り消しは「操作の記録」から。

import { useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useT } from "../../i18n";
import type { AutoTidyDone, AutoTidyProgress, AutoTidyResult } from "./auto-tidy";

export type AutoTidyPanelProps = {
  progress: AutoTidyProgress | null;
  result: AutoTidyResult | null;
  onRun: () => void;
  /** 「操作の記録」タブへ移る（取り消しの置き場） */
  onShowOperations?: () => void;
  onOpenWiki?: (wikiId: string) => void;
};

export function AutoTidyPanel({ progress, result, onRun, onShowOperations, onOpenWiki }: AutoTidyPanelProps) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (progress) {
    return (
      <div className="px-4 py-4 border-b border-border flex items-center gap-2 text-xs text-foreground" role="status">
        <Loader2 size={14} className="animate-spin text-primary shrink-0" />
        {progress.phase === "checking"
          ? t("autoTidy.checking")
          : t("autoTidy.fixing", { done: String(progress.done), total: String(progress.total) })}
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
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Sparkles size={13} />
          {t("autoTidy.run")}
        </button>
      </div>
    );
  }

  const fixed = result.done.filter((d) => d.ok);
  const failedCount = result.done.length - fixed.length;
  return (
    <div className="px-4 py-3 border-b border-border space-y-2">
      <div className="flex items-center gap-2">
        {/* 手当てを試したのに 1 件も済まなかったときは「整えるところが無かった」と言わない */}
        {fixed.length === 0 && failedCount > 0 ? (
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        ) : (
          <CheckCircle size={14} className="text-emerald-500 shrink-0" />
        )}
        <span className="text-xs font-medium text-foreground">
          {fixed.length > 0
            ? t("autoTidy.doneCount", { count: String(fixed.length) })
            : failedCount > 0
              ? t("autoTidy.noneFixed")
              : t("autoTidy.nothingToDo")}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">{new Date(result.finishedAt).toLocaleString()}</span>
        <button
          onClick={onRun}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] border border-border hover:bg-muted transition-colors"
        >
          <Sparkles size={11} />
          {t("autoTidy.runAgain")}
        </button>
      </div>

      {result.lintFailed && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("autoTidy.lintFailed")}</p>
      )}
      {failedCount > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {t("autoTidy.failedCount", { count: String(failedCount) })}
        </p>
      )}

      {fixed.length > 0 && (
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
              {fixed.map((d, i) => (
                <li key={i} className="text-[11px] text-foreground leading-relaxed">
                  <DoneLine done={d} onOpenWiki={onOpenWiki} />
                </li>
              ))}
            </ul>
          )}
          {onShowOperations && (
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

function DoneLine({ done, onOpenWiki }: { done: AutoTidyDone; onOpenWiki?: (wikiId: string) => void }) {
  const t = useT();
  const step = done.step;
  const targetId = step.kind === "merge" ? step.keepId : step.wikiId;
  const label =
    step.kind === "merge"
      ? t("autoTidy.line.merge", { title: done.title, absorbed: done.absorbedTitle ?? "" })
      : step.kind === "rebuild"
        ? t("autoTidy.line.rebuild", { title: done.title })
        : t("autoTidy.line.regenerate", { title: done.title });
  if (!onOpenWiki) return <>{label}</>;
  return (
    <button onClick={() => onOpenWiki(targetId)} className="text-left hover:underline">
      {label}
    </button>
  );
}
