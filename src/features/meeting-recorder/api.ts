// 会議録音: Tauri invoke / listen の薄いラッパー（テストでは vi.mock で差し替える）

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  MeetingModelDoneEvent,
  MeetingModelErrorEvent,
  MeetingModelProgressEvent,
  MeetingModelSize,
  MeetingModelStatus,
  MeetingLanguage,
  MeetingRecStartOptions,
  MeetingModelCancelledEvent,
  MeetingTranscribeCancelledEvent,
  MeetingTranscribeDoneEvent,
  MeetingTranscribeErrorEvent,
  MeetingTranscribeProgressEvent,
  MeetingTranscribeSegmentEvent,
  MeetingRecErrorEvent,
  MeetingRecLevelEvent,
  MeetingRecPermission,
  MeetingRecStartResult,
  MeetingRecStatus,
  MeetingRecStopResult,
  MeetingRecStoppedEvent,
} from "./types";

/** request: true のときだけ未許可なら OS の許可ダイアログを出す（同意文を読む前には出さない） */
export const getPermission = (opts: { request: boolean; captureSystem: boolean }) =>
  invoke<MeetingRecPermission>("meeting_rec_permission", { request: opts.request, captureSystem: opts.captureSystem });
export const startRecording = (options: MeetingRecStartOptions) =>
  invoke<MeetingRecStartResult>("meeting_rec_start", { options });
export const stopRecording = () => invoke<MeetingRecStopResult>("meeting_rec_stop");
export const openScreenSettings = () => invoke<void>("meeting_rec_open_screen_settings");
export const getStatus = () => invoke<MeetingRecStatus>("meeting_rec_status");

/** 戻り値は購読解除関数 */
export const onLevel = (cb: (e: MeetingRecLevelEvent) => void) =>
  listen<MeetingRecLevelEvent>("meeting-rec-level", (ev) => cb(ev.payload));
export const onError = (cb: (e: MeetingRecErrorEvent) => void) =>
  listen<MeetingRecErrorEvent>("meeting-rec-error", (ev) => cb(ev.payload));
export const onStopped = (cb: (e: MeetingRecStoppedEvent) => void) =>
  listen<MeetingRecStoppedEvent>("meeting-rec-stopped", (ev) => cb(ev.payload));

// ── 文字起こしモデル（取得・取り消し・削除） ──
export const getModelStatus = () => invoke<MeetingModelStatus[]>("meeting_model_status");
/** 完了まで resolve しない。進捗は onModelProgress で受ける */
export const downloadModel = (size: MeetingModelSize) => invoke<void>("meeting_model_download", { size });
export const cancelModelDownload = (size: MeetingModelSize) => invoke<void>("meeting_model_cancel", { size });
export const deleteModel = (size: MeetingModelSize) => invoke<void>("meeting_model_delete", { size });

export const onModelProgress = (cb: (e: MeetingModelProgressEvent) => void) =>
  listen<MeetingModelProgressEvent>("meeting-model-progress", (ev) => cb(ev.payload));
export const onModelDone = (cb: (e: MeetingModelDoneEvent) => void) =>
  listen<MeetingModelDoneEvent>("meeting-model-done", (ev) => cb(ev.payload));
export const onModelError = (cb: (e: MeetingModelErrorEvent) => void) =>
  listen<MeetingModelErrorEvent>("meeting-model-error", (ev) => cb(ev.payload));

// ── 文字起こし（既存録音のジョブ・イベント） ──
export const startTranscribe = (args: { fileIds: string[]; language: MeetingLanguage; modelSize: MeetingModelSize }) =>
  invoke<{ jobId: string }>("meeting_transcribe_start", args);
export const cancelTranscribe = (jobId: string) => invoke<void>("meeting_transcribe_cancel", { jobId });
export const readTranscript = (fileId: string) => invoke<string | null>("read_media_transcript", { fileId });

export const onTranscribeSegment = (cb: (e: MeetingTranscribeSegmentEvent) => void) =>
  listen<MeetingTranscribeSegmentEvent>("meeting-transcribe-segment", (ev) => cb(ev.payload));
export const onTranscribeProgress = (cb: (e: MeetingTranscribeProgressEvent) => void) =>
  listen<MeetingTranscribeProgressEvent>("meeting-transcribe-progress", (ev) => cb(ev.payload));
export const onTranscribeDone = (cb: (e: MeetingTranscribeDoneEvent) => void) =>
  listen<MeetingTranscribeDoneEvent>("meeting-transcribe-done", (ev) => cb(ev.payload));
export const onTranscribeError = (cb: (e: MeetingTranscribeErrorEvent) => void) =>
  listen<MeetingTranscribeErrorEvent>("meeting-transcribe-error", (ev) => cb(ev.payload));
export const onModelCancelled = (cb: (e: MeetingModelCancelledEvent) => void) =>
  listen<MeetingModelCancelledEvent>("meeting-model-cancelled", (ev) => cb(ev.payload));
export const onTranscribeCancelled = (cb: (e: MeetingTranscribeCancelledEvent) => void) =>
  listen<MeetingTranscribeCancelledEvent>("meeting-transcribe-cancelled", (ev) => cb(ev.payload));
