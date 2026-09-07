// データ表の拡大表示
//
// 本文の表の拡大ビュー（features/table-meta/expand-modal）と同じ枠に、データ表の
// 仮想スクロール表を載せる。あちらは全行を DOM にするので数千行までしか持たないが、
// データ表は行数が桁違いになり得るので、ブロック内と同じ「見えている行だけ」を使う。

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { t, useLocaleSubscription } from "../../i18n";
import type { DataTableData } from "./data";
import type { LinkedColumn } from "./linked";
import { DataGrid } from "./grid";
import { ROW_HEIGHT } from "./model";

export function DataTableExpandModal({
  caption,
  data,
  linked = [],
  onClose,
}: {
  caption: string;
  data: DataTableData;
  linked?: LinkedColumn[];
  onClose: () => void;
}) {
  useLocaleSubscription();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 見せる行数は開いたときの画面の高さから決める（枠の高さ 90dvh からヘッダ分を引く）
  const visibleRows = useMemo(
    () => Math.max(8, Math.floor((window.innerHeight * 0.9 - 120) / ROW_HEIGHT)),
    [],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      data-modal-portal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[min(1400px,94vw)] max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {caption || t("tableMeta.expandUntitled")}
          </h2>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {t("tableMeta.expandCount", {
              rows: String(data.rows.length),
              cols: String(data.headers.length),
            })}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground hidden sm:block">
            {t("tableMeta.expandSortHint")}
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
        <div className="p-3 overflow-hidden">
          <DataGrid data={data} visibleRows={visibleRows} linked={linked} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
