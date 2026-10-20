// 会議録音の開始確認。同意文・ヘッドホン推奨・権限状態を出し、始める / やめる だけを置く。

import { Mic } from "lucide-react";
import { useT } from "../../i18n";
import type { MeetingRecPermission } from "./types";

export function MeetingStartDialog({
  open,
  permission,
  busy = false,
  errorMessage,
  modelMissing = false,
  captureSystem = true,
  onCaptureSystemChange,
  onStart,
  onCancel,
  onOpenSettings,
}: {
  open: boolean;
  /** null は確認中（まだ読めていない） */
  permission: MeetingRecPermission | null;
  /** 開始処理中 */
  busy?: boolean;
  /** 権限エラーなど、開始に失敗したときの案内文 */
  errorMessage?: string | null;
  /** 録音中の文字起こしが ON なのにモデルが未取得（録音だけ行う） */
  modelMissing?: boolean;
  /** 「相手の声も録る」（オンライン会議のとき）。オフなら自分の声だけ */
  captureSystem?: boolean;
  onCaptureSystemChange?: (value: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  /** 画面収録の設定を開く（denied のときのボタン） */
  onOpenSettings?: () => void;
}) {
  const t = useT();
  if (!open) return null;
  // 相手の声を録らないときは画面収録の権限は関係ない
  const screenDenied = captureSystem && permission?.screen === "denied";
  const micDenied = permission?.mic === "denied";

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[420px] max-w-[92vw] rounded-xl border border-border bg-popover p-5 shadow-lg">
        <div className="mb-3 flex items-center gap-2">
          <Mic size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{t("meeting.dialogTitle")}</h2>
        </div>
        <p className="text-sm text-foreground">{t("meeting.consent")}</p>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={captureSystem}
            disabled={busy || !onCaptureSystemChange}
            onChange={(e) => onCaptureSystemChange?.(e.target.checked)}
          />
          {t("meeting.captureSystemLabel")}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {captureSystem ? t("meeting.headphonesHint") : t("meeting.selfOnlyHint")}
        </p>
        {screenDenied && (
          <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
            {t("meeting.permissionDenied")}
          </p>
        )}
        {screenDenied && (
          <div className="mt-2 flex flex-col items-start gap-1.5">
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="rounded-lg border border-border px-3 py-1 text-xs text-foreground hover:bg-accent transition-colors"
              >
                {t("meeting.openSettings")}
              </button>
            )}
            <p className="text-xs text-muted-foreground">{t("meeting.restartAfterGrant")}</p>
          </div>
        )}
        {micDenied && !screenDenied && (
          <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
            {t("meeting.micDenied")}
          </p>
        )}
        {modelMissing && <p className="mt-3 text-xs text-muted-foreground">{t("meeting.modelMissingNotice")}</p>}
        {errorMessage && <p className="mt-3 text-xs text-destructive">{errorMessage}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {t("meeting.cancel")}
          </button>
          <button
            onClick={onStart}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t("meeting.startConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
