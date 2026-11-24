// 手入れ画面「全体をやり直す」の中の、ナレッジの一括再生成（見た目だけの部品）。
// もとは設定の「ナレッジ管理」タブにあった。対象の種類とモデルを選び、件数と AI の呼び出し回数を見てから実行する。
// 実行・確認・中断の処理は呼び出し側が持つ。

import { ChevronDown } from "lucide-react";
import { useT } from "../../i18n";

export type BulkRegenerateKindOption = { kind: string; label: string; count: number; checked: boolean };
export type BulkRegenerateModelOption = { value: string; label: string };
export type BulkRegenerateFailedItem = { id: string; title: string; error?: string };
export type BulkRegenerateProgressView = {
  done: number;
  total: number;
  failed: number;
  current?: string;
  currentModel?: string;
  failedItems: BulkRegenerateFailedItem[];
};

export type BulkRegenerateBlockProps = {
  kinds: BulkRegenerateKindOption[];
  onToggleKind: (kind: string) => void;
  models: BulkRegenerateModelOption[];
  /** トピック・知見に使うモデル */
  ingestModel: string;
  onIngestModelChange: (value: string) => void;
  /** 洞察に使うモデル */
  synthesisModel: string;
  onSynthesisModelChange: (value: string) => void;
  targetCount: number;
  totalCount: number;
  estimatedCalls: number;
  progress: BulkRegenerateProgressView | null;
  running: boolean;
  cancelling: boolean;
  onRun: () => void;
  onCancel: () => void;
  onRetryFailed: () => void;
  /** 再生成の呼び出し口が無い（AI 未設定など） */
  unavailable?: boolean;
};

const selectClass =
  "w-full appearance-none rounded-md border border-border bg-background px-2.5 py-1 pr-7 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50";
const smallButton =
  "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] border transition-colors disabled:opacity-50";

function ModelSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: BulkRegenerateModelOption[];
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <label className="block">
      <span className="block text-[11px] text-muted-foreground mb-1">{label}</span>
      <span className="relative block">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={selectClass}>
          {options.length === 0 && <option value="">{t("settings.modelNone")}</option>}
          {options.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
        />
      </span>
    </label>
  );
}

export function BulkRegenerateBlock(props: BulkRegenerateBlockProps) {
  const t = useT();
  const { progress, running } = props;
  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-xs font-medium text-foreground">{t("settings.maintenance.regenAll.title")}</div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
          {t("settings.maintenance.regenAll.help")}
        </p>
      </div>

      <div>
        <span className="block text-[11px] text-muted-foreground mb-1">{t("settings.maintenance.kindFilter")}</span>
        <div className="flex gap-1.5 flex-wrap">
          {props.kinds.map((k) => (
            <button
              key={k.kind}
              type="button"
              disabled={running}
              aria-pressed={k.checked}
              onClick={() => props.onToggleKind(k.kind)}
              className={`px-2 py-1 text-[11px] rounded-md border transition-colors disabled:opacity-50 ${
                k.checked
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {k.label} <span className="opacity-70">({k.count})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ModelSelect
          label={t("settings.maintenance.conceptSummaryModel")}
          value={props.ingestModel}
          options={props.models}
          onChange={props.onIngestModelChange}
          disabled={running}
        />
        <ModelSelect
          label={t("settings.maintenance.synthesisAtomModel")}
          value={props.synthesisModel}
          options={props.models}
          onChange={props.onSynthesisModelChange}
          disabled={running}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{t("settings.maintenance.modelOverrideHelp")}</p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-foreground">
          <span className="font-medium">
            {t("settings.maintenance.target")}: {props.targetCount}
          </span>
          <span className="text-muted-foreground ml-2">
            / {t("settings.maintenance.total")}: {props.totalCount}
          </span>
          <span className="text-muted-foreground ml-2">
            / {t("settings.maintenance.aiCalls")}: {props.estimatedCalls}
          </span>
        </span>
        <span className="ml-auto">
          {running ? (
            <button
              onClick={props.onCancel}
              disabled={props.cancelling}
              className={`${smallButton} border-border hover:bg-muted`}
            >
              {props.cancelling ? t("settings.maintenance.cancelling") : t("common.cancel")}
            </button>
          ) : (
            <button
              onClick={props.onRun}
              disabled={props.targetCount === 0 || props.unavailable}
              className={`${smallButton} border-primary/50 text-primary hover:bg-primary/10`}
            >
              {t("settings.maintenance.regenerate")}
            </button>
          )}
        </span>
      </div>
      {props.unavailable && (
        <p className="text-[11px] text-muted-foreground">{t("settings.maintenance.unavailable")}</p>
      )}

      {progress && (
        <div className="space-y-1" role="status">
          <div className="text-[11px] text-foreground">
            {progress.done} / {progress.total}
            {progress.failed > 0 && (
              <span className="text-red-500 ml-2">
                ({t("settings.maintenance.failed")}: {progress.failed})
              </span>
            )}
            {!running && progress.done > 0 && (
              <span className="text-muted-foreground ml-2">{t("settings.maintenance.done")}</span>
            )}
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
          {progress.current && running && (
            <div className="text-[11px] text-muted-foreground truncate">
              {t("settings.maintenance.current")}: {progress.current}
              {progress.currentModel && <span className="ml-2 opacity-70">— {progress.currentModel}</span>}
            </div>
          )}
          {props.cancelling && running && (
            <div className="text-[11px] text-amber-600">{t("settings.maintenance.cancellingHint")}</div>
          )}
        </div>
      )}

      {progress && !running && progress.failedItems.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-2 space-y-1.5">
          <div className="text-[11px] font-medium text-red-700 dark:text-red-400">
            {t("settings.maintenance.failedList")} ({progress.failedItems.length})
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {progress.failedItems.map((f) => (
              <li key={f.id} className="text-[11px]">
                <span className="text-foreground">{f.title}</span>
                {f.error && <span className="text-muted-foreground ml-2">— {f.error}</span>}
              </li>
            ))}
          </ul>
          <button
            onClick={props.onRetryFailed}
            disabled={props.unavailable}
            className={`${smallButton} border-border hover:bg-muted`}
          >
            {t("settings.maintenance.retryFailed")}
          </button>
        </div>
      )}
    </div>
  );
}
