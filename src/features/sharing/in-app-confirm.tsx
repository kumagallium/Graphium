// アプリ内の確認ダイアログ（Promise で答えを返す）。
//
// なぜ window.confirm を使わないか: デスクトップ版（Tauri）では window.confirm が
// dialog プラグイン経由に差し替わっており、権限が無いと「dialog.confirm not allowed」で
// 失敗したうえ、戻り値が Promise（= truthy）になって確認を素通りする（2026-11-06 実機で確認）。
// 共有フォルダをまたぐ引用の警告は「聞いたつもりで聞いていない」と意味が無いので、
// 画面の中に自前で出す。
//
// 使い方: アプリのどこかに <InAppConfirmHost /> を 1 つ置き、requestInAppConfirm(message) を await する。
// ホストが無いとき（テスト・Storybook）は false を返す（黙って進めない）。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useT } from "../../i18n";

type Pending = { message: string; confirmLabel?: string; resolve: (ok: boolean) => void };

let listener: ((p: Pending) => void) | null = null;

/** 確認を出して答えを待つ。ホストが無ければ false */
export function requestInAppConfirm(message: string, confirmLabel?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ message, confirmLabel, resolve });
  });
}

/** 確認ダイアログを描く場所。アプリに 1 つだけ置く */
export function InAppConfirmHost() {
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    listener = (p) =>
      setPending((prev) => {
        // 前の確認が残っていれば断った扱いで閉じる（答えを宙に浮かせない）
        prev?.resolve(false);
        return p;
      });
    return () => {
      listener = null;
    };
  }, []);

  if (!pending) return null;
  const answer = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };
  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      role="alertdialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === "Escape") answer(false);
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
        <p className="text-sm text-foreground flex items-start gap-2 whitespace-pre-wrap">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>{pending.message}</span>
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => answer(false)}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            {pending.confirmLabel ?? t("share.crossFolder.proceed")}
          </button>
        </div>
      </div>
    </div>
  );
}
