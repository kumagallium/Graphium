// 端末内の埋め込み: Tauri invoke / listen の薄いラッパー（テストでは vi.mock で差し替える）

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  EmbedKind,
  LocalEmbedResult,
  LocalEmbeddingCancelledEvent,
  LocalEmbeddingDoneEvent,
  LocalEmbeddingErrorEvent,
  LocalEmbeddingModelName,
  LocalEmbeddingModelStatus,
  LocalEmbeddingProgressEvent,
} from "./types";

export const getModelStatus = () => invoke<LocalEmbeddingModelStatus[]>("embedding_model_status");
export const downloadModel = (name: LocalEmbeddingModelName) => invoke<void>("embedding_model_download", { name });
export const cancelModelDownload = (name: LocalEmbeddingModelName) => invoke<void>("embedding_model_cancel", { name });
export const deleteModel = (name: LocalEmbeddingModelName) => invoke<void>("embedding_model_delete", { name });

export const onModelProgress = (cb: (e: LocalEmbeddingProgressEvent) => void) =>
  listen<LocalEmbeddingProgressEvent>("embedding-model-progress", (e) => cb(e.payload));
export const onModelDone = (cb: (e: LocalEmbeddingDoneEvent) => void) =>
  listen<LocalEmbeddingDoneEvent>("embedding-model-done", (e) => cb(e.payload));
export const onModelCancelled = (cb: (e: LocalEmbeddingCancelledEvent) => void) =>
  listen<LocalEmbeddingCancelledEvent>("embedding-model-cancelled", (e) => cb(e.payload));
export const onModelError = (cb: (e: LocalEmbeddingErrorEvent) => void) =>
  listen<LocalEmbeddingErrorEvent>("embedding-model-error", (e) => cb(e.payload));

/** 文を埋め込む。モデルが未取得なら Rust が `EMBEDDING_MODEL_NOT_DOWNLOADED:<name>` で失敗する */
export const embed = (name: LocalEmbeddingModelName, texts: string[], kind: EmbedKind) =>
  invoke<LocalEmbedResult>("embedding_embed", { name, texts, kind });
