// 端末内 OCR（PP-OCRv6 small）: Tauri invoke / listen の薄いラッパー（テストでは vi.mock で差し替える）。
// デスクトップ版（Rust の ocr_models.rs）専用。ocr.ts が isTauri() のときだけ動的 import する。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type NativeOcrModelStatus = {
  name: string;
  present: boolean;
  bytes: number;
  expectedBytes: number;
};
export type NativeOcrResult = {
  text: string;
  confidence: number;
  engine: string;
  /** 検索用の別の読み（macOS の Vision）。表示には使わない。無ければ付かない */
  altText?: string;
  altEngine?: string;
};
export type NativeOcrProgressEvent = { name: string; received: number; total: number };
export type NativeOcrDoneEvent = { name: string };
export type NativeOcrCancelledEvent = { name: string };
export type NativeOcrErrorEvent = { name: string; message: string };

/** モデルが未取得のとき Rust が返すエラー文字列 */
export const OCR_MODEL_NOT_DOWNLOADED = "OCR_MODEL_NOT_DOWNLOADED";

export const getOcrModelStatus = () => invoke<NativeOcrModelStatus>("ocr_model_status");
export const downloadOcrModel = () => invoke<void>("ocr_model_download");
export const cancelOcrModelDownload = () => invoke<void>("ocr_model_cancel");
export const deleteOcrModel = () => invoke<void>("ocr_model_delete");

export const onOcrModelProgress = (cb: (e: NativeOcrProgressEvent) => void) =>
  listen<NativeOcrProgressEvent>("ocr-model-progress", (e) => cb(e.payload));
export const onOcrModelDone = (cb: (e: NativeOcrDoneEvent) => void) =>
  listen<NativeOcrDoneEvent>("ocr-model-done", (e) => cb(e.payload));
export const onOcrModelCancelled = (cb: (e: NativeOcrCancelledEvent) => void) =>
  listen<NativeOcrCancelledEvent>("ocr-model-cancelled", (e) => cb(e.payload));
export const onOcrModelError = (cb: (e: NativeOcrErrorEvent) => void) =>
  listen<NativeOcrErrorEvent>("ocr-model-error", (e) => cb(e.payload));

/** 画像の生バイト（PNG・JPEG など）を Raw body で送って文字を読む。未取得なら OCR_MODEL_NOT_DOWNLOADED で失敗する */
export const recognizeNative = (bytes: Uint8Array) => invoke<NativeOcrResult>("ocr_recognize", bytes);
