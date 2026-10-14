// 選んだドキュメントを、ファイル内のタイトルで一括して名前を付け直すダイアログ
//
// 開くと 1 件ずつ中身を読み、「いまの名前 → 新しい名前」を並べる。
// 見つからない・変更なしの行はチェックできない（理由を薄く出す）。
// 確定は、チェックした行だけを onApply へ渡す（実際の改名は呼び出し側の onRenameMedia）。

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { DIALOG_LAYER } from "@/ui/z-layers";
import { useT } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";
import { extractDocumentTitle, isSameName, titleToName } from "./document-info";
import { readEntryBytes } from "./read-entry-bytes";

type RowState =
  | { status: "pending" }
  | { status: "ready"; newName: string; checked: boolean }
  | { status: "notFound" }
  | { status: "unchanged" }
  | { status: "error" };

export function BulkTitleRenameDialog({
  entries,
  onApply,
  onClose,
}: {
  entries: MediaIndexEntry[];
  /** チェックされた行の（素材, 新しい名前）。順に改名する */
  onApply: (items: { entry: MediaIndexEntry; newName: string }[]) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [done, setDone] = useState(0);
  const [applying, setApplying] = useState(false);
  // 開いた時点の対象で固定する（親の再描画で読み直さない）
  const targetsRef = useRef(entries);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 巨大な実体を同時に抱えないよう 1 件ずつ読む
      for (const entry of targetsRef.current) {
        if (cancelled) return;
        let next: RowState;
        try {
          const bytes = await readEntryBytes(entry);
          const title = await extractDocumentTitle(bytes, entry);
          if (!title) {
            next = { status: "notFound" };
          } else {
            const newName = titleToName(title, entry.name);
            next = isSameName(newName, entry.name)
              ? { status: "unchanged" }
              : { status: "ready", newName, checked: true };
          }
        } catch {
          next = { status: "error" };
        }
        if (cancelled) return;
        setRows((prev) => ({ ...prev, [entry.fileId]: next }));
        setDone((d) => d + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = targetsRef.current.length;
  const reading = done < total;
  const checkedItems = useMemo(
    () =>
      targetsRef.current.flatMap((entry) => {
        const r = rows[entry.fileId];
        return r?.status === "ready" && r.checked && r.newName.trim()
          ? [{ entry, newName: r.newName.trim() }]
          : [];
      }),
    [rows],
  );

  const patchReady = (fileId: string, patch: { newName?: string; checked?: boolean }) =>
    setRows((prev) => {
      const r = prev[fileId];
      return r?.status === "ready" ? { ...prev, [fileId]: { ...r, ...patch } } : prev;
    });

  const handleApply = async () => {
    if (applying || checkedItems.length === 0) return;
    setApplying(true);
    try {
      await onApply(checkedItems);
    } finally {
      setApplying(false);
      onClose();
    }
  };

  const reasonOf = (r: RowState | undefined): string | null => {
    if (!r || r.status === "ready") return null;
    if (r.status === "pending") return t("asset.titleReading");
    if (r.status === "notFound") return t("asset.bulkTitleNotFound");
    if (r.status === "unchanged") return t("asset.bulkTitleUnchanged");
    return t("asset.bulkTitleReadFailed");
  };

  return (
    <div className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}>
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-2xl w-full mx-4 flex flex-col max-h-[80vh]">
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {t("asset.bulkTitleDialogTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
          {reading ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {t("asset.bulkTitleReading", { done: String(done), total: String(total) })}
            </>
          ) : (
            t("asset.bulkTitleDialogHint")
          )}
        </p>
        <div className="flex-1 overflow-auto border border-border rounded">
          {targetsRef.current.map((entry) => {
            const r = rows[entry.fileId];
            const reason = reasonOf(r);
            return (
              <div
                key={entry.fileId}
                className="flex items-start gap-2 px-3 py-2 border-b border-border/50 last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={r?.status === "ready" && r.checked}
                  disabled={r?.status !== "ready" || applying}
                  onChange={(e) => patchReady(entry.fileId, { checked: e.target.checked })}
                  className="w-3.5 h-3.5 mt-1 rounded border-border accent-primary shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground truncate" title={entry.name}>
                    {entry.name}
                  </p>
                  {r?.status === "ready" ? (
                    <input
                      type="text"
                      value={r.newName}
                      disabled={applying}
                      onChange={(e) => patchReady(entry.fileId, { newName: e.target.value })}
                      className="mt-1 w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground outline-none focus:border-primary transition-colors"
                    />
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">{reason}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void handleApply()}
            disabled={applying || reading || checkedItems.length === 0}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {applying
              ? t("asset.bulkTitleApplying")
              : t("asset.bulkTitleApply", { count: String(checkedItems.length) })}
          </button>
        </div>
      </div>
    </div>
  );
}
