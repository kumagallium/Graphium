// モバイル [音声] の録音状態機械（MediaRecorder の実体）。
//
//   idle ──start()──▶ requesting ──▶ recording ──stop()──▶ processing ──▶ recorded
//     ▲                   │              │(10 分で自動停止)                   │
//     └───────reset()─────┴──────────────┴──── error ◀────────────────────────┘
//
// UI（AudioRecorderSheet）は props 駆動のプレゼンテーション層に保ちたいので、
// マイクを握る責務はこの hook に閉じる。呼ぶ側はシートを開いている間だけ mount する
// （= 閉じればマイクは必ず解放される）。
//
// 契約:
// - `start()` は **click ハンドラから同期的に呼ぶ**（getUserMedia の権限ダイアログを
//   ユーザー操作に紐付けるため。await を挟まない）。
// - 停止・アンマウント・録り直しのどの経路でも MediaStream のトラックを止める。
//   止め忘れると OS の録音インジケータが点きっぱなしになる。

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS, buildRecordedAudioFile, pickAudioMimeType } from "./audio-recorder";

export type AudioRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "recorded"
  | "error";

/** 失敗の種類（文言は UI 側で引く）。 */
export type AudioRecorderErrorKind = "denied" | "noDevice" | "failed";

export type AudioRecorderState = {
  status: AudioRecorderStatus;
  /** 録音中は伸びる経過時間。停止後は録れた長さ。 */
  elapsedMs: number;
  /** 録り終えた音声（プレビュー再生用の object URL 付き）。 */
  recorded: { file: File; url: string } | null;
  errorKind: AudioRecorderErrorKind | null;
  /** 上限（MAX_RECORDING_MS）に当たって自動停止したか。 */
  limitReached: boolean;
  start: () => void;
  stop: () => void;
  /** 録り直し（録れた音声を捨てて idle に戻す）。 */
  reset: () => void;
};

/** getUserMedia の DOMException を UI が出し分けられる種類に写す。 */
function errorKindFromRejection(err: unknown): AudioRecorderErrorKind {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "noDevice";
  return "failed";
}

export function useAudioRecorder(): AudioRecorderState {
  const [status, setStatus] = useState<AudioRecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recorded, setRecorded] = useState<{ file: File; url: string } | null>(null);
  const [errorKind, setErrorKind] = useState<AudioRecorderErrorKind | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // アンマウント時に revoke するための最新 URL（state は cleanup から読めない）
  const recordedUrlRef = useRef<string | null>(null);

  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /** マイクを解放する（OS の録音インジケータを消す）。 */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const revokeRecorded = useCallback(() => {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = null;
    }
  }, []);

  /** 録音を終える。上限による自動停止も同じ経路を通す。 */
  const finish = useCallback(
    (viaLimit: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return;
      stopTick();
      if (viaLimit) setLimitReached(true);
      setElapsedMs(Math.min(Date.now() - startedAtRef.current, MAX_RECORDING_MS));
      setStatus("processing");
      recorder.stop(); // Blob 化は onstop で
    },
    [stopTick],
  );

  const fail = useCallback(
    (kind: AudioRecorderErrorKind) => {
      stopTick();
      releaseStream();
      recorderRef.current = null;
      chunksRef.current = [];
      setErrorKind(kind);
      setStatus("error");
    },
    [releaseStream, stopTick],
  );

  const start = useCallback(() => {
    if (status === "requesting" || status === "recording" || status === "processing") return;
    revokeRecorded();
    setRecorded(null);
    setErrorKind(null);
    setLimitReached(false);
    setElapsedMs(0);
    setStatus("requesting");

    // gesture 内から同期的に呼ぶ（await を挟まない）
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const mimeType = pickAudioMimeType();
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch {
          // mimeType を弾く実装が稀にあるので既定で作り直す
          recorder = new MediaRecorder(stream);
        }
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onerror = () => fail("failed");
        recorder.onstop = () => {
          releaseStream();
          const chunks = chunksRef.current;
          chunksRef.current = [];
          recorderRef.current = null;
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/mp4" });
          // 押した瞬間に離した等で中身が無いことがある。空ファイルを捕獲させない
          if (blob.size === 0) {
            setErrorKind("failed");
            setStatus("error");
            return;
          }
          const file = buildRecordedAudioFile(blob, new Date());
          const url = URL.createObjectURL(blob);
          recordedUrlRef.current = url;
          setRecorded({ file, url });
          setStatus("recorded");
        };

        startedAtRef.current = Date.now();
        recorder.start();
        setStatus("recording");
        tickRef.current = setInterval(() => {
          const ms = Date.now() - startedAtRef.current;
          if (ms >= MAX_RECORDING_MS) finish(true);
          else setElapsedMs(ms);
        }, 200);
      })
      .catch((err: unknown) => fail(errorKindFromRejection(err)));
  }, [fail, finish, releaseStream, revokeRecorded, status]);

  const stop = useCallback(() => finish(false), [finish]);

  const reset = useCallback(() => {
    revokeRecorded();
    setRecorded(null);
    setErrorKind(null);
    setLimitReached(false);
    setElapsedMs(0);
    setStatus("idle");
  }, [revokeRecorded]);

  // アンマウント（= シートを閉じた）時の後始末。録音途中でもマイクは必ず離す
  useEffect(() => {
    return () => {
      stopTick();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {
          // 既に止まっている場合は無視
        }
      }
      recorderRef.current = null;
      releaseStream();
      revokeRecorded();
    };
  }, [releaseStream, revokeRecorded, stopTick]);

  return { status, elapsedMs, recorded, errorKind, limitReached, start, stop, reset };
}
