// 手入れ画面の「足りないところを補う」「全体をやり直す」の節（見た目だけの部品）。
// 設定の「ナレッジ管理」タブにあった一括処理を手入れ画面に集めるためのもの（2026-11-24 決定）。
// 線の引き方: ナレッジのページを作る・変える・まとめる操作は手入れ、決めておくことと下回りは設定。
// 実行・確認・進み具合の状態は呼び出し側が持ち、ここは並べて見せるだけにする。
// 見た目は手入れ画面の既存の節（もの単位にまとめる・手動で点検する）の折りたたみと小さなボタンに揃える。

import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Square } from "lucide-react";
import { useT } from "../../i18n";

/** 1 行の状態。running の text は進み具合、result の text は結果の 1 文 */
export type UpkeepJobStatus =
  | { kind: "idle" }
  | { kind: "running"; text: string; done?: number; total?: number }
  | { kind: "result"; text: string; tone: "ok" | "warn" | "error" };

export type UpkeepJob = {
  id: string;
  title: string;
  /** 対象の数と、何をするかの説明 */
  help?: string;
  status: UpkeepJobStatus;
  runLabel: string;
  /** 無いときはボタンを出さない（対象が 0 件になった・結果だけ見せるとき） */
  onRun?: () => void;
  /** 実行中に止められるときだけ渡す */
  onStop?: () => void;
  stopLabel?: string;
  /** 他の処理が走っている間など */
  disabled?: boolean;
};

const smallButton =
  "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] border transition-colors disabled:opacity-50 shrink-0";

export function UpkeepJobRow({ job }: { job: UpkeepJob }) {
  const { status } = job;
  const running = status.kind === "running";
  const ratio =
    running && status.total && status.total > 0 ? Math.min(1, (status.done ?? 0) / status.total) : null;
  return (
    <li className="py-2.5 border-t border-border/60 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">{job.title}</div>
          {job.help && (
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{job.help}</p>
          )}
        </div>
        {running
          ? job.onStop && (
              <button
                onClick={job.onStop}
                className={`${smallButton} border-border hover:bg-muted`}
              >
                <Square size={10} />
                {job.stopLabel}
              </button>
            )
          : job.onRun && (
              <button
                onClick={job.onRun}
                disabled={job.disabled}
                className={`${smallButton} border-primary/50 text-primary hover:bg-primary/10`}
              >
                {job.runLabel}
              </button>
            )}
      </div>
      {running && (
        <div className="mt-1.5 space-y-1" role="status">
          <div className="flex items-center gap-1.5 text-[11px] text-foreground">
            <Loader2 size={11} className="animate-spin text-primary shrink-0" />
            <span>{status.text}</span>
          </div>
          {ratio !== null && (
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${ratio * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {status.kind === "result" && (
        <p
          className={`mt-1.5 text-[11px] leading-relaxed ${
            status.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : status.tone === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {status.text}
        </p>
      )}
    </li>
  );
}

/**
 * おまかせ（AutoUpkeepPanel）と、その下の個別の手入れとの境目の小見出し。
 * おまかせのボタンが下の見出しの中身まで実行するように読まれないよう、構造で範囲を分ける（2026-11-24 決定）
 */
export function UpkeepOneByOneDivider() {
  const t = useT();
  return (
    <div className="px-4 pt-4 pb-0.5 flex items-center gap-2" role="separator" aria-label={t("upkeep.oneByOne.header")}>
      <span className="text-[11px] font-medium text-foreground/80 shrink-0">{t("upkeep.oneByOne.header")}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

function UpkeepFold({
  label,
  hint,
  defaultOpen,
  children,
}: {
  label: string;
  hint: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-4 pt-3 pb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        {label}
      </button>
      {open && (
        <div className="ml-4 mt-1">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>
          {children}
        </div>
      )}
    </div>
  );
}

export type UpkeepFillGapsSectionProps = {
  /** 対象のある処理（と、走っている・結果を見せている処理）だけを渡す。空なら節ごと出さない */
  jobs: UpkeepJob[];
  defaultOpen?: boolean;
};

/** 足りないところを補う: 取り込みの途中で抜けた分や、前の版で作られなかった分 */
export function UpkeepFillGapsSection({ jobs, defaultOpen = true }: UpkeepFillGapsSectionProps) {
  const t = useT();
  if (jobs.length === 0) return null;
  return (
    <UpkeepFold
      label={t("upkeep.fillGaps.header", { count: String(jobs.length) })}
      hint={t("upkeep.fillGaps.hint")}
      defaultOpen={defaultOpen}
    >
      <ul className="mt-1">
        {jobs.map((job) => (
          <UpkeepJobRow key={job.id} job={job} />
        ))}
      </ul>
    </UpkeepFold>
  );
}

export type UpkeepRebuildSectionProps = {
  /** 行で出す処理（旧形式のトピックを資料から作り直す など） */
  jobs: UpkeepJob[];
  /** 一括再生成のまとまり（対象の種類・モデルを選ぶ） */
  children?: ReactNode;
  defaultOpen?: boolean;
};

/** 全体をやり直す: 作り方を変えたあとに、ナレッジを資料から作り直す。AI を多く呼ぶのでたたんでおく */
export function UpkeepRebuildSection({ jobs, children, defaultOpen = false }: UpkeepRebuildSectionProps) {
  const t = useT();
  if (jobs.length === 0 && !children) return null;
  return (
    <UpkeepFold label={t("upkeep.rebuild.header")} hint={t("upkeep.rebuild.hint")} defaultOpen={defaultOpen}>
      {jobs.length > 0 && (
        <ul className="mt-1">
          {jobs.map((job) => (
            <UpkeepJobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
      {children && <div className="py-2.5 border-t border-border/60">{children}</div>}
    </UpkeepFold>
  );
}
