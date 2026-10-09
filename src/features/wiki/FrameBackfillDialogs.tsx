// 判断・規則の構造の補完 — 確認ダイアログと結果ダイアログ
// DeleteConfirmDialog（WikiListView）と同じ骨格。ロジックは持たず、props で受けた内容を出すだけ。

import { useEffect, useId } from "react";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { FrameBackfillSummary } from "./frame-backfill";

/** スキップ理由コード → i18n キー（未知の理由は reason.other に生の値を添える） */
const REASON_KEYS: Record<string, string> = {
  "no-sources": "frameBackfill.reason.noSources",
  deleted: "frameBackfill.reason.deleted",
  empty: "frameBackfill.reason.empty",
  unreadable: "frameBackfill.reason.unreadable",
  "unsupported-kind": "frameBackfill.reason.unsupported",
  "no-frame": "frameBackfill.reason.noFrame",
  "open-in-editor": "frameBackfill.reason.openInEditor",
  "not-loaded": "frameBackfill.reason.notLoaded",
};

/** Esc で閉じ、開いたらダイアログへフォーカスを移す（背景クリックでも閉じる） */
function useDialogBehavior(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

const focusOnMount = (el: HTMLDivElement | null) => el?.focus();

export function FrameBackfillConfirmDialog({
  count,
  modelName,
  onStart,
  onCancel,
}: {
  /** 対象の知見数。0 のときは開始ボタンを出さず、その旨だけ見せる */
  count: number;
  /** 使うモデルの表示名（未設定なら既定のモデル） */
  modelName?: string;
  onStart: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const titleId = useId();
  useDialogBehavior(onCancel);
  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={focusOnMount}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 outline-none"
      >
        <h3 id={titleId} className="text-sm font-semibold text-foreground mb-2">
          {t("frameBackfill.confirmTitle")}
        </h3>
        {count === 0 ? (
          <p className="text-xs text-muted-foreground mb-4">{t("frameBackfill.noTargets")}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {t("frameBackfill.confirmBody", { n: String(count) })}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {t("frameBackfill.model", { model: modelName || t("frameBackfill.modelDefault") })}
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {count === 0 ? t("frameBackfill.close") : t("frameBackfill.cancel")}
          </button>
          {count > 0 && (
            <button
              onClick={onStart}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("frameBackfill.start")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type FrameBackfillResult = {
  summary: FrameBackfillSummary;
  /** 中止で処理されなかった知見の件数（中止でなければ 0） */
  unprocessed?: number;
  /** 切り詰めた出典の表示名（id → タイトル。引けなければ id を出す） */
  truncatedSources: { id: string; title: string }[];
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h4 className="text-xs font-medium text-foreground mb-1">{title}</h4>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">{children}</ul>
    </section>
  );
}

export function FrameBackfillResultDialog({
  result,
  onClose,
}: {
  result: FrameBackfillResult;
  onClose: () => void;
}) {
  const t = useT();
  const { summary, truncatedSources } = result;
  const titleId = useId();
  useDialogBehavior(onClose);
  const reasonLabel = (reason: string) => {
    const key = REASON_KEYS[reason];
    return key ? t(key) : t("frameBackfill.reason.other", { reason });
  };
  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={focusOnMount}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-md w-full mx-4 max-h-[80vh] flex flex-col outline-none"
      >
        <h3 id={titleId} className="text-sm font-semibold text-foreground mb-1">{t("frameBackfill.resultTitle")}</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t("frameBackfill.resultSummary", {
            done: String(summary.done.length),
            skipped: String(summary.skipped.length),
            failed: String(summary.failed.length),
          })}
        </p>
        <div className="overflow-y-auto flex-1 mb-4">
          {summary.aborted && (
            <p className="text-xs text-foreground mb-3">
              {t("frameBackfill.abortedNote", { count: String(result.unprocessed ?? 0) })}
            </p>
          )}
          {summary.droppedFrames > 0 && (
            <p className="text-xs text-muted-foreground mb-3">
              {t("frameBackfill.dropped", { dropped: String(summary.droppedFrames) })}
            </p>
          )}
          {summary.done.length > 0 && (
            <Section title={t("frameBackfill.doneSection")}>
              {summary.done.map((d) => (
                <li key={d.id} className="truncate">{d.title}</li>
              ))}
            </Section>
          )}
          {summary.skipped.length > 0 && (
            <Section title={t("frameBackfill.skipped")}>
              {summary.skipped.map((s) => (
                <li key={s.id}>
                  <span className="text-foreground">{s.title}</span>
                  <span className="block">{reasonLabel(s.reason)}</span>
                </li>
              ))}
            </Section>
          )}
          {summary.failed.length > 0 && (
            <Section title={t("frameBackfill.failed")}>
              {summary.failed.map((f) => (
                <li key={f.id}>
                  <span className="text-foreground">{f.title}</span>
                  <span className="block break-words">{f.error}</span>
                </li>
              ))}
            </Section>
          )}
          {truncatedSources.length > 0 && (
            <Section title={t("frameBackfill.truncated")}>
              {truncatedSources.map((s) => (
                <li key={s.id} className="truncate">{s.title}</li>
              ))}
            </Section>
          )}
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("frameBackfill.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
