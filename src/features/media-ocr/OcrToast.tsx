// 画像 OCR の進行トースト。
//
// 自動 OCR は「画像を貼っただけ」で裏で走るため、何が起きているか分からないと
// 不安になる。IngestToast と同じ右下ピルで、実行中と結果だけを短く出す。

import { useEffect, useState } from "react";
import { Check, Loader2, ScanText } from "lucide-react";
import { useT } from "../../i18n";

export type OcrToastState = {
  /** 実行中の画像枚数（0 なら完了表示） */
  running: number;
  /** 完了時の抽出文字数の合計 */
  chars: number;
  /** 文字が取れなかった枚数 */
  empty: number;
} | null;

export function OcrToast({ state }: { state: OcrToastState }) {
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
      const timer = setTimeout(() => setVisible(false), 3200);
      return () => clearTimeout(timer);
    }
  }, [state, done]);

  if (!state || !visible) return null;

  const tone = active
    ? "bg-popover border-border"
    : state.chars > 0
      ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
      : "bg-popover border-border";

  return (
    <div
      className={`fixed bottom-4 right-4 z-[9999] flex items-center gap-1.5 rounded-full border shadow-lg pl-3 pr-3.5 py-1.5 text-xs transition-all duration-300 ${tone}`}
      role="status"
    >
      {active ? (
        <>
          <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />
          <span className="text-foreground">{t("ocr.running")}</span>
        </>
      ) : state.chars > 0 ? (
        <>
          <Check size={13} className="text-emerald-600 shrink-0" />
          <span className="text-foreground">
            {t("ocr.done")}
            <span className="ml-1.5 text-muted-foreground">
              {t("ocr.chars", { count: String(state.chars) })}
            </span>
          </span>
        </>
      ) : (
        <>
          <ScanText size={13} className="text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">{t("ocr.noText")}</span>
        </>
      )}
    </div>
  );
}
