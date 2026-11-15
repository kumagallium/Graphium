// 受信箱から届いた音声の文字起こしの知らせ（右下のトースト）。
//
// ナレッジ生成の IngestToast とは別の部品: 取得中の項目が取り込み結果と同じ箱に並んだり、
// 効かない停止ボタンが出たりしないようにする。一括の文字読み取り（OcrToast）と同じく、
// 受信箱の取り込みの横で小さく知らせるのが役目。
// - download: モデルを取得している間（取得が続くあいだ消えない）。止め方の案内つき
// - modelReady: 取得が終わった（数秒で自然に消える）
// - notices: 文字にできなかった音声・モデルが無くて始めていない音声。読む前に消えないよう、
//   自動では消さず、閉じるボタンで消す（成功の見せ方にはしない）

import { useEffect, useState } from "react";
import { Check, Info, Loader2, X } from "lucide-react";
import { useT } from "../../i18n";

export type InboxTranscribeToastState = {
  /** モデルを取得している最中（mb = 大きさの目安、percent = 進み具合） */
  download: { mb: number; percent: number } | null;
  /** 取得が終わった */
  modelReady: boolean;
  /** 閉じるまで残す知らせ（id は重複しない値） */
  notices: { id: string; text: string }[];
} | null;

/** 取得が終わった知らせを出しておく時間（ミリ秒） */
const READY_VISIBLE_MS = 4000;

export function InboxTranscribeToast({
  state,
  onDismiss,
  stacked = true,
}: {
  state: InboxTranscribeToastState;
  /** 閉じるボタン（知らせをすべて消す） */
  onDismiss: () => void;
  /** 一括の文字読み取りのトースト（右下）と重ならないよう上にずらす */
  stacked?: boolean;
}) {
  const t = useT();
  const [readyVisible, setReadyVisible] = useState(false);
  const modelReady = !!state?.modelReady;

  useEffect(() => {
    if (!modelReady) {
      setReadyVisible(false);
      return;
    }
    setReadyVisible(true);
    const timer = setTimeout(() => setReadyVisible(false), READY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [modelReady]);

  if (!state) return null;
  const download = state.download;
  const notices = state.notices;
  const showReady = !download && readyVisible;
  if (!download && !showReady && notices.length === 0) return null;

  return (
    <div
      className={`fixed ${stacked ? "bottom-36" : "bottom-4"} right-4 z-[9999] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs space-y-1.5`}
      role="status"
    >
      {download && (
        <div className="flex items-start gap-1.5">
          <Loader2 size={13} className="mt-0.5 animate-spin text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-foreground break-words">
              {t("mobile.transcribeModelDownloading", { size: String(download.mb), percent: String(download.percent) })}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground break-words">{t("mobile.transcribeModelCancelHint")}</p>
          </div>
        </div>
      )}
      {showReady && (
        <div className="flex items-start gap-1.5">
          <Check size={13} className="mt-0.5 text-emerald-600 shrink-0" />
          <p className="text-foreground">{t("mobile.transcribeModelDone")}</p>
        </div>
      )}
      {notices.map((n) => (
        <div key={n.id} className="flex items-start gap-1.5">
          <Info size={13} className="mt-0.5 text-muted-foreground shrink-0" />
          <p className="min-w-0 flex-1 text-foreground break-words">{n.text}</p>
        </div>
      ))}
      {notices.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("common.close")}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-accent transition-colors"
          >
            <X size={11} />
            {t("common.close")}
          </button>
        </div>
      )}
    </div>
  );
}
