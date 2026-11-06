// 「どの共有フォルダへ共有するか」を選ぶだけの小さなダイアログ（§26 PR3）。
//
// ノート・ナレッジ・素材の「チームと共有」は、これまでダイアログを出さずにすぐ共有していた。
// 共有フォルダが 2 件以上あり、初めて共有するときだけこれを挟む（1 件だけ・再共有は従来どおり）。
// 枠と作法は ShareTemplateDialog に合わせる。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { getSharedRoot } from "../../lib/storage/shared";
import { SharedFolderPicker } from "./SharedFolderPicker";

export type ShareToFolderDialogProps = {
  open: boolean;
  /** 共有するものの題名（見出しに出す） */
  itemTitle: string;
  /** 選んだ共有フォルダで共有する。終わったら呼び出し側が閉じる */
  onConfirm: (root: string) => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
};

export function ShareToFolderDialog({ open, itemTitle, onConfirm, onClose, busy }: ShareToFolderDialogProps) {
  const t = useT();
  const [root, setRoot] = useState<string>(() => getSharedRoot() ?? "");

  // 開くたびに既定の共有先から始める（前回選んだ先を黙って引き継がない）
  useEffect(() => {
    if (open) setRoot(getSharedRoot() ?? "");
  }, [open]);

  if (!open) return null;
  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("share.folder.dialogTitle")}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">{t("share.folder.dialogTitle")}</h3>
          <p className="text-xs text-muted-foreground break-all">{itemTitle || t("library.untitled")}</p>
        </div>
        <SharedFolderPicker value={root} onChange={setRoot} disabled={busy} />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm(root)}
            disabled={busy || !root}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {t("share.folder.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
