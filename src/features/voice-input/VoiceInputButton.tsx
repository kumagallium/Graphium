// 入力欄の横に置く「声で入力」ボタン。見た目は ChatImageAttachButton（IconButton sm）に揃える。

import { Loader2, Mic, Square } from "lucide-react";
import { IconButton } from "@ui/icon-button";
import { useT } from "../../i18n";
import { useVoiceInput, type VoiceInputError, type VoiceInputStatus } from "./use-voice-input";

const ERROR_KEY: Record<VoiceInputError, string> = {
  "model-missing": "voiceInput.error.modelMissing",
  "no-speech": "voiceInput.error.noSpeech",
  "no-device": "voiceInput.error.noDevice",
  failed: "voiceInput.error.failed",
};

/** 表示だけの部品（Storybook でも使う） */
export function VoiceInputButtonView({
  status,
  level,
  error,
  disabled,
  onToggle,
  className,
}: {
  status: VoiceInputStatus;
  level: number;
  error: VoiceInputError | null;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useT();
  const label =
    status === "recording" ? t("voiceInput.stop") : status === "transcribing" ? t("voiceInput.transcribing") : t("voiceInput.start");
  const hint =
    status === "recording" ? t("voiceInput.stopHint") : status === "transcribing" ? t("voiceInput.transcribing") : t("voiceInput.startHint");
  // 音量に合わせて薄く動く輪（RMS は小さいので持ち上げて 1 に収める）
  const ring = Math.min(1, level * 6);
  return (
    // エラーはボタンの上に浮かべる（横に並べると ⌘K の入力欄やチャットのボタン列を押し縮めるため）
    <span className="relative inline-flex items-center">
      <span className="relative inline-flex">
        {status === "recording" && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-lg bg-destructive/20 transition-transform duration-100"
            style={{ transform: `scale(${1 + ring * 0.45})`, opacity: 0.4 + ring * 0.6 }}
          />
        )}
        <IconButton
          size="sm"
          aria-label={label}
          tooltip={hint}
          disabled={disabled || status === "transcribing"}
          onClick={onToggle}
          className={className ?? "-ml-1.5"}
        >
          {status === "recording" ? (
            <Square className="fill-current text-destructive" />
          ) : status === "transcribing" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Mic />
          )}
        </IconButton>
      </span>
      {error && (
        <span
          role="status"
          className="absolute bottom-full right-0 z-10 mb-1.5 w-max max-w-[18rem] rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive shadow-sm"
        >
          {t(ERROR_KEY[error])}
        </span>
      )}
    </span>
  );
}

/** onText: 文字起こし結果（整形済み）を受け取る。送信・実行は呼び出し側でしない */
export function VoiceInputButton({
  onText,
  disabled,
  className,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const voice = useVoiceInput({ onText });
  if (!voice.available) return null;
  return (
    <VoiceInputButtonView
      status={voice.status}
      level={voice.level}
      error={voice.error}
      disabled={disabled}
      onToggle={voice.toggle}
      className={className}
    />
  );
}
