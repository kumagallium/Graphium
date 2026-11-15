// 会議録音以外の音声（スマホの m4a / weba / wav など）の文字起こし
//
// 素材の実体を読み → WebView で 16 kHz・mono・16 bit に直し → Rust の一時置き場へ渡し →
// 文字起こしを始める。media/<fileId>.wav は作らない。一時の wav は Rust が終わりに消す。
// 同じ fileId は同時に 1 本だけ（変換中を共有の状態に持つ。画面のボタンも自動処理の変換中は「処理中」になる）。

import { useSyncExternalStore } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import * as api from "./api";
import { AudioConvertError, MAX_SOURCE_BYTES, convertToPcm16k, splitBytes } from "./audio-convert";
import { startTranscribeJob, waitTranscribeJob } from "./store";

/**
 * started: 文字起こしを始めた（jobId と音声の長さ） / unreadable: 形式を読めなかった / too-long: 長さの上限超え / too-large: 元ファイルが大きすぎる /
 * busy: すでに変換中・受け取り中・文字起こし中（進んでいるので何もしない） / failed: そのほか
 */
export type ExternalTranscribeOutcome =
  | { result: "started"; jobId: string; seconds: number }
  | { result: "unreadable" | "too-long" | "too-large" | "busy" | "failed" };

// ── 変換中の fileId（共有の状態） ──
const converting = new Set<string>();
const listeners = new Set<() => void>();
const setConverting = (fileId: string, on: boolean) => {
  if (on) converting.add(fileId);
  else converting.delete(fileId);
  listeners.forEach((l) => l());
};

export const isExternalConverting = (fileId: string): boolean => converting.has(fileId);
export const subscribeExternalConverting = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** その素材が、変換して渡している最中か（受信箱の自動処理の分も含む） */
export function useExternalConverting(fileId: string | null): boolean {
  return useSyncExternalStore(
    subscribeExternalConverting,
    () => !!fileId && converting.has(fileId),
    () => false,
  );
}

/** 素材の実体を Blob で読む。表示用の URL を作らない読み方（readMediaBytes）を優先する */
async function readMediaBlob(fileId: string, mimeType?: string): Promise<Blob> {
  const provider = getActiveProvider();
  const bytes = await provider.readMediaBytes?.(fileId);
  // 型を付ける（<audio> は型なしの Blob だとメタデータを読めないことがあるため）
  if (bytes) return new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined);
  // 未実装のプロバイダ: 表示用の URL から読む。この URL はプロバイダが持つ共有のキャッシュで、
  // ほかの画面も使っているので、ここでは revoke しない
  const res = await fetch(await provider.getMediaBlobUrl(fileId));
  return res.blob();
}

async function run(fileId: string, mimeType?: string): Promise<ExternalTranscribeOutcome> {
  let begun = false;
  try {
    // 読む前に大きさだけ確かめ、上限超えなら実体を読まずに断る（数 GB をメモリに載せない）。
    // 大きさが取れなかったとき（コマンド失敗・未対応）は今までどおり読む
    const size = await api.mediaFileSize(fileId).catch(() => null);
    if (typeof size === "number" && size > MAX_SOURCE_BYTES) return { result: "too-large" };
    const { pcm, seconds } = await convertToPcm16k(await readMediaBlob(fileId, mimeType));
    await api.transcribeInputBegin(fileId);
    begun = true;
    for (const part of splitBytes(pcm)) await api.transcribeInputAppend(fileId, part);
    await api.transcribeInputFinish(fileId);
    const jobId = await startTranscribeJob([fileId]);
    if (jobId) return { result: "started", jobId, seconds };
    await api.transcribeInputDiscard(fileId).catch(() => {});
    return { result: "failed" };
  } catch (e) {
    if (begun) await api.transcribeInputDiscard(fileId).catch(() => {});
    if (e instanceof AudioConvertError) return { result: e.reason };
    const msg = String(e);
    // Rust 側: begin が、すでに受け取り中・文字起こし中の fileId を断った（begun は立っていないので消さない）
    if (!begun && /\bbusy\b/.test(msg)) return { result: "busy" };
    // Rust 側の上限（audio too long）
    if (msg.includes("audio too long")) return { result: "too-long" };
    return { result: "failed" };
  }
}

/** mimeType は素材の MIME 型（分かれば。長さの読み取りに使う） */
export async function startExternalTranscribe(fileId: string, mimeType?: string): Promise<ExternalTranscribeOutcome> {
  if (converting.has(fileId)) return { result: "busy" };
  setConverting(fileId, true);
  try {
    return await run(fileId, mimeType);
  } finally {
    setConverting(fileId, false);
  }
}

/**
 * 文字起こしの終わりを待つ時間の上限（ミリ秒）。音声の長さの 2 倍 + 10 分（決め打ち）。
 * 端末内の文字起こしは音声の長さと同程度かそれより速い想定で、遅い端末に余裕を見た値。
 * 超えたらジョブは止めずに待つのをやめ、受信箱では次の音声へ進む
 */
export function transcribeWaitLimitMs(seconds: number): number {
  return (Math.max(0, seconds) * 2 + 600) * 1000;
}

/** startExternalTranscribe が始めたジョブが終わる（成功・失敗・取り消し）か、上限の時間が過ぎるまで待つ */
export function waitExternalTranscribeFinished(outcome: { jobId: string; seconds: number }): Promise<"finished" | "timeout"> {
  return waitTranscribeJob(outcome.jobId, transcribeWaitLimitMs(outcome.seconds));
}
