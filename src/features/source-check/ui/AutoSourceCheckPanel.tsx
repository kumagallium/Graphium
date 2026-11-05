// おまかせで照合する — 手入れ画面の出典照合タブ冒頭の欄
//
// 人が対象・範囲を選び、要確認を 1 件ずつ判断する代わりに、AI が照合から手当て
// （知見のアーカイブ・トピックなどの作り直し）まで通しで行う。結果は件数だけを見せ、
// 内訳はたたむ。取り消しは「操作の記録」から。見た目は点検タブの AutoTidyPanel に揃える。

import { useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, FileSearch, Loader2, X } from "lucide-react";
import { useT } from "../../../i18n";
import { isFixed, type AutoSourceCheckDone, type AutoSourceCheckProgress, type AutoSourceCheckResult } from "../auto-fix";

export type AutoSourceCheckPanelProps = {
  progress: AutoSourceCheckProgress | null;
  result: AutoSourceCheckResult | null;
  onRun: () => void;
  /** 手で選んだ照合が走っているあいだは押させない（照合は同時に 1 つしか走らない） */
  disabled?: boolean;
  /** 照合中の中断（直す段階に入ったら出さない） */
  onCancel?: () => void;
  /** 「操作の記録」タブへ移る（取り消しの置き場） */
  onShowOperations?: () => void;
  onOpenWiki?: (wikiId: string) => void;
};

export function AutoSourceCheckPanel({ progress, result, onRun, disabled = false, onCancel, onShowOperations, onOpenWiki }: AutoSourceCheckPanelProps) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (progress) {
    return (
      <div className="px-4 py-4 border-b border-border flex items-center gap-2 text-xs text-foreground" role="status">
        <Loader2 size={14} className="animate-spin text-primary shrink-0" />
        <span className="flex-1">
          {progress.phase === "checking"
            ? progress.total > 0
              ? t("autoSourceCheck.checking", { index: String(progress.index + 1), total: String(progress.total) })
              : t("autoSourceCheck.preparing")
            : t("autoSourceCheck.fixing", { done: String(progress.done), total: String(progress.total) })}
        </span>
        {progress.phase === "checking" && onCancel && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] border border-border hover:bg-muted transition-colors"
          >
            <X size={11} />
            {t("wikiLint.sourceCheck.cancelRun")}
          </button>
        )}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-10 border-b border-border">
        <FileSearch size={24} className="text-primary/60" />
        <p className="text-xs text-muted-foreground leading-relaxed max-w-md">{t("autoSourceCheck.intro")}</p>
        <button
          onClick={onRun}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <FileSearch size={13} />
          {t("autoSourceCheck.run")}
        </button>
      </div>
    );
  }

  const fixed = result.done.filter(isFixed);
  const notFixedCount = result.done.length - fixed.length;
  const headline = result.interrupted
    ? t("autoSourceCheck.interrupted", { count: String(result.checkedCount) })
    : result.done.length === 0
      ? result.checkedCount > 0
        ? t("autoSourceCheck.allSupported", { count: String(result.checkedCount) })
        : t("autoSourceCheck.nothingToDo")
      : fixed.length > 0
        ? t("autoSourceCheck.doneCount", { count: String(fixed.length) })
        : t("autoSourceCheck.noneFixed");
  // 中断・直せなかったときは「済んだ」の印を出さない
  const warn = result.interrupted || (result.done.length > 0 && fixed.length === 0);
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
          <FileSearch size={11} />
          {t("autoSourceCheck.runAgain")}
        </button>
      </div>

      {notFixedCount > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {t("autoSourceCheck.notFixedCount", { count: String(notFixedCount) })}
        </p>
      )}

      {result.done.length > 0 && (
        <div>
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown size={12} className={`transition-transform ${detailsOpen ? "" : "-rotate-90"}`} />
            {t("autoSourceCheck.details")}
          </button>
          {detailsOpen && (
            <ul className="mt-1.5 ml-4 space-y-1">
              {result.done.map((d, i) => (
                <li key={i} className="text-[11px] text-foreground leading-relaxed">
                  <DoneLine done={d} onOpenWiki={onOpenWiki} />
                </li>
              ))}
            </ul>
          )}
          {onShowOperations && fixed.length > 0 && (
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

function DoneLine({ done, onOpenWiki }: { done: AutoSourceCheckDone; onOpenWiki?: (wikiId: string) => void }) {
  const t = useT();
  const { step } = done;
  const title = step.title;
  const label = !done.ok
    ? t("autoSourceCheck.line.failed", { title })
    : step.kind === "archive"
      ? t("autoSourceCheck.line.archive", { title })
      : done.stillFlagged
        ? t("autoSourceCheck.line.rewriteStill", { title })
        : t("autoSourceCheck.line.rewrite", { title });
  // アーカイブしたページは一覧から外れるので、開く導線は付けない
  if (!onOpenWiki || (done.ok && step.kind === "archive")) return <>{label}</>;
  return (
    <button onClick={() => onOpenWiki(step.wikiId)} className="text-left hover:underline">
      {label}
    </button>
  );
}
