// 外部画像のローカル取り込みの進行トースト。
//
// 貼ってから画像が出るまでの間、本文にはブロック中のプレースホルダが立っている。
// 何も出さないと「貼ったのに読み込まれない枠」に見えるので、取り込み中であることと、
// 取り込めなかったこと（枠のまま残る理由）だけを短く出す。
//
// 見た目と作法は OcrToast に合わせる。位置だけ 1 段上げてあるのは、取り込みの直後に
// 同じ画像の自動 OCR が走り、OcrToast と重なるため。

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import type { RemoteImportToastState } from "./use-remote-image-import";

export function RemoteImportToast({ state }: { state: RemoteImportToastState }) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  const active = !!state && state.running > 0;
  const done = !!state && state.running === 0;

  useEffect(() => {
    if (!state) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (done) {
      // 結果は数秒だけ出して自然に消す（操作を邪魔しない）
      const timer = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, done]);

  // 取り込むものが無かった走査では何も出さない
  if (!state || !visible) return null;
  if (done && state.imported === 0 && state.failed === 0) return null;

  const tone = active
    ? "bg-popover border-border"
    : state.failed > 0
      ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
      : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800";

  return (
    <div
      className={`fixed bottom-16 right-4 z-[9999] flex items-center gap-1.5 rounded-full border shadow-lg pl-3 pr-3.5 py-1.5 text-xs transition-all duration-300 ${tone}`}
      role="status"
    >
      {active ? (
        <>
          <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />
          <span className="text-foreground">{t("remoteImport.running")}</span>
        </>
      ) : state.failed > 0 ? (
        <>
          <AlertTriangle size={13} className="text-amber-600 shrink-0" />
          <span className="text-foreground">
            {t("remoteImport.failed", { count: String(state.failed) })}
          </span>
        </>
      ) : (
        <>
          <Check size={13} className="text-emerald-600 shrink-0" />
          <span className="text-foreground">
            {t("remoteImport.done", { count: String(state.imported) })}
          </span>
        </>
      )}
    </div>
  );
}
