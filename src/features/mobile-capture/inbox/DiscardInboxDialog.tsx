// 受信箱のアイテムを、ノートにも素材にも入れずに消す前の確認。
//
// 右パネルと全画面の受信箱で共用する。消すのは同期フォルダの Inbox/ 直下のファイルで、
// Graphium 側には何も残らない（取り込んでいないので控えも無い）。デスクトップ版では
// window.confirm が素通りするので、確認はアプリの中のダイアログで取る。
// 右パネルの中から開いても親の重なりで切れないよう、body に出す。

import { createPortal } from "react-dom";
import { useT } from "../../../i18n";
import { DIALOG_LAYER } from "@/ui/z-layers";

export type DiscardInboxDialogProps = {
  count: number;
  /** 消している最中（ボタンを止める） */
  deleting: boolean;
  /** 消せなかったときの理由（ダイアログは開いたまま） */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DiscardInboxDialog({ count, deleting, error, onConfirm, onCancel }: DiscardInboxDialogProps) {
  const t = useT();
  // 右パネルの中から開いても切れないよう、body に出す
  return createPortal(
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-inbox-title"
      data-test="discardInboxDialog"
    >
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 id="discard-inbox-title" className="text-sm font-semibold text-foreground mb-2">
          {t("mobile.discardConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("mobile.discardConfirmMessage", { count: String(count) })}
        </p>
        {error && (
          <p className="text-xs text-destructive mb-4" role="alert">
            {t("mobile.discardFailed", { error })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {deleting ? t("asset.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
