// モバイル [音声] の録音ボトムシート。
//
// 以前は hidden file input を OS に開かせていたが、iOS ではビデオ撮影 UI が出て
// しまい音が録れなかった（理由は audio-recorder.ts の冒頭）。ここで録って、
// 録れたものをそのまま捕獲経路（onCapture → 送信キュー）へ渡す。
//
// 構成は StoragePickerSheet と同じ 2 層:
// - `AudioRecorderSheetView` … props 駆動のプレゼンテーション層（Storybook で
//   全状態を再現できる。マイクには触らない）
// - `AudioRecorderSheet` … `useAudioRecorder` を繋いだコンテナ（アプリはこちらを使う）
//
// 開いている間だけ mount する前提 — 閉じれば hook の後始末でマイクが解放される。

import { useEffect } from "react";
import { Mic, Square, Loader2, RotateCcw, Check, AlertCircle } from "lucide-react";
import { useT } from "../../i18n";
import { formatRecordingTime } from "./audio-recorder";
import {
  useAudioRecorder,
  type AudioRecorderErrorKind,
  type AudioRecorderStatus,
} from "./use-audio-recorder";

export type AudioRecorderSheetViewProps = {
  status: AudioRecorderStatus;
  elapsedMs: number;
  /** 録り終えた音声のプレビュー URL（status === "recorded" のときだけ）。 */
  previewUrl?: string | null;
  errorKind?: AudioRecorderErrorKind | null;
  /** 10 分の上限に当たって自動停止したか。 */
  limitReached?: boolean;
  /** 録音開始。**click から同期的に呼ばれる**（権限ダイアログをジェスチャに紐付ける）。 */
  onStart: () => void;
  onStop: () => void;
  onRetake: () => void;
  /** 録れた音声を捕獲する（親が送信キューへ流す）。 */
  onCapture: () => void;
  onClose: () => void;
};

const ERROR_KEYS: Record<AudioRecorderErrorKind, string> = {
  denied: "mobile.audio.errorDenied",
  noDevice: "mobile.audio.errorNoDevice",
  failed: "mobile.audio.errorFailed",
};

export function AudioRecorderSheetView({
  status,
  elapsedMs,
  previewUrl,
  errorKind,
  limitReached,
  onStart,
  onStop,
  onRetake,
  onCapture,
  onClose,
}: AudioRecorderSheetViewProps) {
  const t = useT();

  // ESC で閉じる（モバイル主対象だが、狭いデスクトップウィンドウでも使われる）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const recording = status === "recording";
  const busy = status === "requesting" || status === "processing";

  // 状態を 1 行で言う帯（時間表示の下）。録音中は赤い点を添える
  const statusLine =
    status === "requesting"
      ? t("mobile.audio.requesting")
      : status === "recording"
        ? t("mobile.audio.recording")
        : status === "processing"
          ? t("mobile.audio.processing")
          : status === "idle"
            ? t("mobile.audio.hintIdle")
            : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end bg-black/40"
      data-testid="audio-recorder-sheet"
      onClick={(e) => { if (e.target === e.currentTarget && !recording) onClose(); }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[85dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("mobile.audio.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-auto px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-4">
          {/* 経過時間（録音中も録り終えた後も同じ位置に出す）。
              失敗したときは録れた長さが無いので出さない */}
          {status !== "error" && (
            <p
              className={`text-4xl font-mono tabular-nums leading-none ${
                recording ? "text-destructive" : "text-foreground"
              }`}
              data-testid="audio-elapsed"
            >
              {formatRecordingTime(elapsedMs)}
            </p>
          )}

          {statusLine && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground text-center">
              {recording && (
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
              )}
              {statusLine}
            </p>
          )}

          {/* 主操作 */}
          {status === "recorded" ? (
            <div className="w-full flex flex-col gap-3">
              {previewUrl && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio src={previewUrl} controls className="w-full" data-testid="audio-preview" />
              )}
              {limitReached && (
                <p className="text-[11px] text-muted-foreground text-center">
                  {t("mobile.audio.limitReached")}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={onRetake}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-border text-sm text-foreground active:bg-muted transition-colors"
                >
                  <RotateCcw size={16} />
                  {t("mobile.audio.retake")}
                </button>
                <button
                  onClick={onCapture}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:opacity-80 transition-opacity"
                >
                  <Check size={16} />
                  {t("mobile.audio.capture")}
                </button>
              </div>
            </div>
          ) : status === "error" ? (
            <div className="w-full flex flex-col items-center gap-3">
              <p className="text-xs text-destructive leading-relaxed flex items-start gap-1">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{t(ERROR_KEYS[errorKind ?? "failed"])}</span>
              </p>
              <button
                onClick={onStart}
                className="px-4 py-2 rounded-xl border border-border text-sm text-foreground active:bg-muted transition-colors"
              >
                {t("mobile.audio.tryAgain")}
              </button>
            </div>
          ) : (
            // idle / requesting / recording / processing — 円形の主ボタン 1 つ
            <button
              onClick={recording ? onStop : onStart}
              disabled={busy}
              aria-label={recording ? t("mobile.audio.stop") : t("mobile.audio.start")}
              data-testid="audio-record-button"
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors disabled:opacity-60 ${
                recording
                  ? "bg-destructive text-white"
                  : "bg-primary text-primary-foreground active:opacity-80"
              }`}
            >
              {busy ? (
                <Loader2 size={28} className="animate-spin" />
              ) : recording ? (
                <Square size={26} fill="currentColor" />
              ) : (
                <Mic size={28} />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type AudioRecorderSheetProps = {
  /** 録れた音声を捕獲する。閉じるのは親（捕獲後にシートを畳む）。 */
  onCapture: (file: File) => void;
  onClose: () => void;
};

/** アプリが使う実体。マイクの状態は `useAudioRecorder` が持つ。 */
export function AudioRecorderSheet({ onCapture, onClose }: AudioRecorderSheetProps) {
  const recorder = useAudioRecorder();

  return (
    <AudioRecorderSheetView
      status={recorder.status}
      elapsedMs={recorder.elapsedMs}
      previewUrl={recorder.recorded?.url}
      errorKind={recorder.errorKind}
      limitReached={recorder.limitReached}
      onStart={recorder.start}
      onStop={recorder.stop}
      onRetake={recorder.reset}
      onCapture={() => {
        const file = recorder.recorded?.file;
        if (file) onCapture(file);
      }}
      onClose={onClose}
    />
  );
}
