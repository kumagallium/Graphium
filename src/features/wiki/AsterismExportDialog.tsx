// Asterism 向けの書き出しダイアログ — 対象件数・除外件数・2 つのオプション・書き出すファイルの一覧
// FrameBackfillDialogs と同じ骨格。件数は渡された知見とオプションから都度数え直す。

import { useEffect, useId, useMemo, useState } from "react";
import { isTauri } from "../../lib/platform";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { AsterismSettings } from "../settings/store";
import type { WikiMeta } from "../../lib/document-types";
import { buildAsterismBundle, normalizeClaimBaseIri } from "./asterism-export";

export type AsterismExportItem = { id: string; meta: WikiMeta; title?: string };

export type AsterismExportChoice = {
  includeUntyped: boolean;
  includeInferred: boolean;
};

const focusOnMount = (el: HTMLDivElement | null) => el?.focus();

export function AsterismExportDialog({
  items,
  asterism,
  onExport,
  onCancel,
  onOpenSettings,
}: {
  /** 一覧の知見（種別の絞り込み前でもよい。claim 以外は件数に入れない） */
  items: AsterismExportItem[];
  asterism: AsterismSettings;
  onExport: (choice: AsterismExportChoice) => void;
  onCancel: () => void;
  /** claimBaseIri 未設定の注意から設定を開く */
  onOpenSettings?: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const [includeUntyped, setIncludeUntyped] = useState(false);
  const [includeInferred, setIncludeInferred] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME の変換取り消しの Esc ではダイアログを閉じない
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // exportedAt は件数の再計算には使わないので空でよい
  const { count, counts, untyped, inferred, unknown, needsBase } = useMemo(() => {
    // base 未設定でも件数は正しく数えたいので、数える間だけ仮の base を入れる（出力は使わない）
    const needsBase = normalizeClaimBaseIri(asterism.claimBaseIri) === null;
    const r = buildAsterismBundle(
      items,
      needsBase ? { ...asterism, claimBaseIri: "https://count.invalid/" } : asterism,
      { includeUntyped, includeInferred, exportedAt: "" },
    );
    if ("error" in r) return { count: 0, counts: {} as Record<string, number>, untyped: 0, inferred: 0, unknown: 0, needsBase: true };
    return {
      // 件数は親（知見）のファイルだけを数える。子ファイルは行数が別なので足さない
      count: Object.entries(r.counts)
        .filter(([name]) => name !== "rule_terms.json" && name !== "observation_terms.json")
        .reduce((a, [, n]) => a + n, 0),
      counts: r.counts,
      untyped: r.skipped.filter((s) => s.reason === "untyped").length,
      inferred: r.skipped.filter((s) => s.reason === "inferred").length,
      unknown: r.skipped.filter((s) => s.reason === "unknown-type").length,
      needsBase,
    };
  }, [items, asterism, includeUntyped, includeInferred]);

  const canExport = !needsBase && count > 0;

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
          {t("asterismExport.title")}
        </h3>
        <p className="text-xs text-muted-foreground mb-2">{t("asterismExport.description")}</p>
        <p className="text-xs text-foreground mb-1">{t("asterismExport.targetCount", { n: String(count) })}</p>
        <p className="text-xs text-muted-foreground mb-3">
          {t("asterismExport.excluded", { untyped: String(untyped), inferred: String(inferred) })}
          {unknown > 0 && ` / ${t("asterismExport.excludedUnknown", { n: String(unknown) })}`}
        </p>
        {needsBase && (
          <div className="text-xs text-red-600 mb-3" role="alert">
            <p>{t("asterismExport.claimBaseIriMissing")}</p>
            {onOpenSettings && (
              <button onClick={onOpenSettings} className="mt-1 underline hover:no-underline">
                {t("asterismExport.openSettings")}
              </button>
            )}
          </div>
        )}
        {Object.keys(counts).length > 0 && (
          <p className="text-xs text-muted-foreground mb-1">{t("asterismExport.fileList")}</p>
        )}
        {Object.keys(counts).length > 0 && (
          <ul className="text-xs text-foreground mb-3 font-mono" aria-label={t("asterismExport.fileCounts")}>
            {Object.entries(counts).map(([name, n]) => (
              <li key={name}>{t("asterismExport.fileCountRow", { name, n: String(n) })}</li>
            ))}
          </ul>
        )}
        {!needsBase && count === 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            {untyped > 0
              ? t("asterismExport.noTargets")
              : unknown > 0
                ? t("asterismExport.noTargetsUnknown")
                : inferred > 0
                ? t("asterismExport.noTargetsInferred")
                : t("asterismExport.noTargetsEmpty")}
          </p>
        )}
        <label className="flex items-start gap-2 text-xs text-foreground mb-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeUntyped}
            onChange={(e) => setIncludeUntyped(e.target.checked)}
          />
          <span>{t("asterismExport.includeUntyped")}</span>
        </label>
        <label className="flex items-start gap-2 text-xs text-foreground mb-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeInferred}
            onChange={(e) => setIncludeInferred(e.target.checked)}
          />
          <span>{t("asterismExport.includeInferred")}</span>
        </label>
        {!needsBase && count > 0 && (
          <p className="text-xs text-muted-foreground mb-4">
            {isTauri() ? t("asterismExport.tauriNotice") : t("asterismExport.multiDownloadNotice")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("asterismExport.cancel")}
          </button>
          <button
            disabled={!canExport}
            onClick={() => onExport({ includeUntyped, includeInferred })}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {t("asterismExport.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
