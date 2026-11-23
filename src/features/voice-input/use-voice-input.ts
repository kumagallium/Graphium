// 声の入力 hook。録音の開始・停止・自動停止・文字起こし結果の受け渡しを持つ。
// 結果は onText に渡すだけ（自動で送信・実行はしない）。

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../lib/platform";
import { loadSettings } from "../settings/store";
import {
  cancelVoiceInput,
  onVoiceError,
  onVoiceLevel,
  onVoiceLimit,
  startVoiceInput,
  stopVoiceInput,
} from "./api";
import { initialAutoStopState, stepAutoStop, type AutoStopState } from "./auto-stop";
import { cleanVoiceText } from "./clean-text";
import { buildVoiceHint, currentVoiceHintTerms } from "./hint-terms";

export type VoiceInputStatus = "idle" | "recording" | "transcribing";
export type VoiceInputError = "model-missing" | "no-speech" | "no-device" | "failed";

/** エラー表示を自動で消すまでの時間 */
const ERROR_CLEAR_MS = 6000;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useVoiceInput({ onText }: { onText: (text: string) => void }) {
  const available = isTauri();
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<VoiceInputError | null>(null);

  // イベントやタイマーから最新を読むための ref
  const statusRef = useRef<VoiceInputStatus>("idle");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const autoStopRef = useRef<AutoStopState>(initialAutoStopState);
  const mountedRef = useRef(true);

  const setStatusBoth = useCallback((s: VoiceInputStatus) => {
    statusRef.current = s;
    if (mountedRef.current) setStatus(s);
  }, []);

  const cancel = useCallback(() => {
    if (statusRef.current !== "recording") return;
    setStatusBoth("idle");
    if (mountedRef.current) setLevel(0);
    void cancelVoiceInput().catch(() => {});
  }, [setStatusBoth]);

  const stop = useCallback(async () => {
    if (statusRef.current !== "recording") return;
    setStatusBoth("transcribing");
    setLevel(0);
    const s = loadSettings();
    try {
      const result = await stopVoiceInput({
        language: s.meetingLanguage,
        modelSize: s.meetingModelSize,
        // 自分のノートの化学式・略語を先に、設定の用語を末尾に（hint-terms.ts の測定メモ）
        vocabulary: buildVoiceHint(currentVoiceHintTerms(), s.meetingVocabulary ?? "") || undefined,
      });
      if (!mountedRef.current) return;
      const text = cleanVoiceText(result.text ?? "");
      setStatusBoth("idle");
      if (text) onTextRef.current(text);
      else setError("no-speech");
    } catch (e) {
      if (!mountedRef.current) return;
      setStatusBoth("idle");
      setError(errText(e).includes("model-missing") ? "model-missing" : "failed");
    }
  }, [setStatusBoth]);

  const start = useCallback(async () => {
    if (!available || statusRef.current !== "idle") return;
    setError(null);
    autoStopRef.current = initialAutoStopState;
    setStatusBoth("recording");
    setLevel(0);
    try {
      await startVoiceInput();
    } catch (e) {
      const msg = errText(e);
      setStatusBoth("idle");
      // 別の欄が録音中（busy）は黙って無視する
      if (msg.includes("busy")) return;
      setError(msg.includes("no-input-device") ? "no-device" : "failed");
    }
  }, [available, setStatusBoth]);

  const toggle = useCallback(() => {
    if (statusRef.current === "recording") void stop();
    else void start();
  }, [start, stop]);

  // 録音中のイベント（音量・上限・エラー）。自分が録音中のときだけ反応する
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    const unlistens: Array<() => void> = [];
    const keep = (p: Promise<() => void>) => {
      p.then((fn) => (disposed ? fn() : unlistens.push(fn))).catch(() => {});
    };
    keep(
      onVoiceLevel((e) => {
        if (statusRef.current !== "recording") return;
        setLevel(e.level);
        const r = stepAutoStop(autoStopRef.current, { level: e.level, atMs: e.seconds * 1000 });
        autoStopRef.current = r.state;
        if (r.decision === "stop-after-speech") void stop();
        else if (r.decision === "stop-no-speech") {
          // 何も話していないので文字起こしせず捨てる
          cancel();
          setError("no-speech");
        }
      }),
    );
    keep(
      onVoiceLimit(() => {
        if (statusRef.current === "recording") void stop();
      }),
    );
    keep(
      onVoiceError((e) => {
        if (statusRef.current !== "recording") return;
        cancel();
        setError(errText(e.message).includes("no-input-device") ? "no-device" : "failed");
      }),
    );
    return () => {
      disposed = true;
      unlistens.forEach((fn) => fn());
    };
  }, [available, stop, cancel]);

  // 録音中の Esc は取り消し。入力欄・⌘K の窓の Esc 処理より先に拾って止める
  useEffect(() => {
    if (status !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [status, cancel]);

  // エラー表示は数秒で消す
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), ERROR_CLEAR_MS);
    return () => clearTimeout(id);
  }, [error]);

  // アンマウント時、録音中なら捨てる
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (statusRef.current === "recording") {
        statusRef.current = "idle";
        void cancelVoiceInput().catch(() => {});
      }
    };
  }, []);

  return { available, status, level, error, start, stop, cancel, toggle };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;
