// 複数選択したノート / Knowledge の一括共有モーダル。
// マウント時に bulkShare を開始し、進捗 → 完了サマリ（失敗一覧つき）を表示する。
// 実行中はキャンセル可能（処理済み分はそのまま残る。Share は snapshot コピーなので
// 巻き戻しは不要 — 誤共有は Library の Unshare でリカバリする）。

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Share2 } from "lucide-react";
import { useT } from "../../i18n";
import {
  bulkShare,
  type BulkShareDeps,
  type BulkShareSummary,
  type BulkShareTarget,
} from "./bulk-share";

export type BulkShareModalProps = {
  targets: BulkShareTarget[];
  deps: Omit<BulkShareDeps, "onProgress" | "isCancelled">;
  /** didShareAny: 1 件以上共有 / 更新できたか（呼び出し側の一覧リフレッシュ用） */
  onClose: (didShareAny: boolean) => void;
};

type Phase =
  | { kind: "running"; done: number; total: number; current: string }
  | { kind: "done"; summary: BulkShareSummary };

export function BulkShareModal({ targets, deps, onClose }: BulkShareModalProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({
    kind: "running",
    done: 0,
    total: targets.length,
    current: "",
  });
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode の二重 effect で共有が二度走らないようにする
    if (startedRef.current) return;
    startedRef.current = true;
    void bulkShare(targets, {
      ...deps,
      onProgress: (done, total, current) =>
        setPhase({ kind: "running", done, total, current }),
      isCancelled: () => cancelledRef.current,
    }).then((summary) => {
      setPhase({ kind: "done", summary });
    });
  }, [targets, deps]);

  const summary = phase.kind === "done" ? phase.summary : null;
  const didShareAny = !!summary && summary.shared + summary.updated > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[480px] max-h-[70vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Share2 size={14} className="text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            {t("share.bulk.title")}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {phase.kind === "running" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Loader2 size={14} className="animate-spin text-primary" />
                {t("share.bulk.running", {
                  done: String(phase.done + 1),
                  total: String(phase.total),
                })}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {phase.current}
              </div>
            </div>
          ) : summary ? (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-foreground">
                {summary.cancelled
                  ? t("share.bulk.cancelledNote", {
                      count: String(summary.results.length),
                    })
                  : t("share.bulk.summary", {
                      shared: String(summary.shared),
                      updated: String(summary.updated),
                      failed: String(summary.failed),
                    })}
              </div>
              {summary.failed > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-medium text-foreground flex items-center gap-1">
                    <AlertTriangle size={12} className="text-destructive" />
                    {t("share.bulk.failedList")}
                  </div>
                  <ul className="flex flex-col gap-1 text-xs">
                    {summary.results
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <li
                          key={`${r.kind}:${r.id}`}
                          className="p-2 rounded border border-destructive/30 bg-destructive/5"
                        >
                          <div className="font-medium text-foreground truncate">
                            {r.title}
                          </div>
                          <div className="text-muted-foreground break-all">
                            {r.error}
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border">
          {phase.kind === "running" ? (
            <button
              type="button"
              onClick={() => {
                cancelledRef.current = true;
              }}
              className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
            >
              {t("common.cancel")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onClose(didShareAny)}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
