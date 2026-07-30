// モバイル [音声] のアプリ内録音まわりの純ロジック（MediaRecorder の外側）。
//
// なぜアプリ内録音なのか: 以前は hidden file input（`accept="audio/*"` +
// `capture="environment"`）を開いて OS 任せにしていた。しかし HTML Media Capture の
// `capture` 属性が取る値（`user` / `environment`）は**カメラの向き**を指すもので、
// 音声に対応する値は仕様に存在しない。iOS Safari はこの属性を見てビデオ撮影 UI を
// 開くため、[音声] を押すと動画が撮れてしまっていた。その場で音を録るには
// MediaRecorder で自前に録音するしかない。
//
// 出力形式はブラウザ既定に委ねず優先順で選ぶ — 録ったものを受け取るのは
// デスクトップ側（macOS の WKWebView / Windows の WebView2）なので、そこで
// 再生・取り込みしやすい形を先に置く。

import { extensionForCapture, formatCaptureTimestamp } from "./inbox/push/naming";

/**
 * MediaRecorder に渡す MIME の優先順（前ほど互換性が高い）。
 *
 * - `audio/mp4`（AAC）: iOS / macOS Safari が録音・再生とも唯一確実に扱える形。
 *   Chrome も 130 以降は録音できるので、対応環境ではこれが選ばれる。
 * - `audio/webm`（Opus）: Chrome / Firefox / Android の従来からの形。
 * - `audio/ogg`（Opus）: Firefox のフォールバック。
 */
const PREFERRED_MIME_TYPES = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

/** 録音の上限（10 分）。これを超えたら自動停止する — 捕獲は走り書きであって録音機ではない。 */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

function supportedByMediaRecorder(type: string): boolean {
  const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  return typeof Recorder?.isTypeSupported === "function" && Recorder.isTypeSupported(type);
}

/**
 * MediaRecorder に渡す MIME を選ぶ。どれも通らなければ undefined
 * （= ブラウザ既定に委ねる。それでも録れるなら録らせる）。
 */
export function pickAudioMimeType(
  isSupported: (type: string) => boolean = supportedByMediaRecorder,
): string | undefined {
  for (const type of PREFERRED_MIME_TYPES) {
    if (isSupported(type)) return type;
  }
  return undefined;
}

/**
 * この環境でアプリ内録音ができるか。
 * `navigator.mediaDevices` は secure context でないと生えないので、
 * http 配信や古いブラウザはここで false になり、呼び出し側は
 * 従来のファイル選択（capture 属性なしの file input）に落ちる。
 */
export function isAudioRecordingSupported(): boolean {
  if (typeof (globalThis as { MediaRecorder?: unknown }).MediaRecorder !== "function") return false;
  return typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function";
}

/**
 * 録音した Blob を捕獲経路（onAddFiles → 送信キュー）に流せる File にする。
 *
 * 名前は `voice-<YYYYMMDD-HHmmss>.<ext>`。送信キューは Inbox 用の正規名に付け替える
 * ので送信経路では見えないが、キューが使えない環境ではこの名前のままこの端末の
 * ライブラリに残るため、後から見て何か分かる名前にしておく。
 * 拡張子は MIME 由来（naming.ts の表）— `audio/webm;codecs=opus` のような
 * codecs 付きも bare に落として引く。
 */
export function buildRecordedAudioFile(blob: Blob, when: Date): File {
  const mime = blob.type || "audio/mp4";
  const ext = extensionForCapture(mime, "");
  return new File([blob], `voice-${formatCaptureTimestamp(when)}.${ext}`, { type: mime });
}

/** 経過時間の表示 `m:ss`（10 分上限なので時間桁は持たない）。 */
export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
