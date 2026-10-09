// Asterism 向けの書き出しダイアログ — 対象件数・除外件数・2 つのオプション・ファイル名
// FrameBackfillDialogs と同じ骨格。件数は渡された知見とオプションから都度数え直す。

import { useEffect, useId, useMemo, useState } from "react";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { AsterismSettings } from "../settings/store";
import type { WikiMeta } from "../../lib/document-types";
import { buildAsterismExport } from "./asterism-export";

export type AsterismExportItem = { id: string; meta: WikiMeta; title?: string };

export type AsterismExportChoice = {
  includeUntyped: boolean;
  includeInferred: boolean;
  fileName: string;
};

const focusOnMount = (el: HTMLDivElement | null) => el?.focus();

export function AsterismExportDialog({
  items,
  asterism,
  defaultFileName,
  onExport,
  onCancel,
}: {
  /** 一覧の知見（種別の絞り込み前でもよい。claim 以外は件数に入れない） */
  items: AsterismExportItem[];
  asterism: AsterismSettings;
  defaultFileName: string;
  onExport: (choice: AsterismExportChoice) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const [includeUntyped, setIncludeUntyped] = useState(false);
  const [includeInferred, setIncludeInferred] = useState(false);
  const [fileName, setFileName] = useState(defaultFileName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME の変換取り消しの Esc ではダイアログを閉じない
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // exportedAt は件数の再計算には使わないので空でよい
  const { count, untyped, inferred } = useMemo(() => {
    const r = buildAsterismExport(items, asterism, { includeUntyped, includeInferred, exportedAt: "" });
    return {
      count: r.rows.length,
      untyped: r.skipped.filter((s) => s.reason === "untyped").length,
      inferred: r.skipped.filter((s) => s.reason === "inferred").length,
    };
  }, [items, asterism, includeUntyped, includeInferred]);

  const canExport = count > 0 && fileName.trim().length > 0;

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
        </p>
        {count === 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            {untyped > 0
              ? t("asterismExport.noTargets")
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
        <label className="block text-xs text-muted-foreground mb-4">
          {t("asterismExport.fileName")}
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="mt-1 w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("asterismExport.cancel")}
          </button>
          <button
            disabled={!canExport}
            onClick={() => onExport({ includeUntyped, includeInferred, fileName: fileName.trim() })}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {t("asterismExport.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
