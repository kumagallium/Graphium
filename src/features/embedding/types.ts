// 端末内の埋め込みモデル（Rust: src-tauri/src/embedding_models.rs）の型

/** 選べるモデルの名前。Rust 側の MODELS と同じ */
export type LocalEmbeddingModelName = "bge-m3" | "multilingual-e5-small";

export type LocalEmbeddingModelStatus = {
  name: LocalEmbeddingModelName;
  /** embedding-store の modelVersion に入る値（`local:<name>-q8`） */
  version: string;
  dims: number;
  present: boolean;
  bytes: number;
  expectedBytes: number;
};

export type LocalEmbeddingProgressEvent = { name: LocalEmbeddingModelName; received: number; total: number };
export type LocalEmbeddingDoneEvent = { name: LocalEmbeddingModelName };
export type LocalEmbeddingCancelledEvent = { name: LocalEmbeddingModelName };
export type LocalEmbeddingErrorEvent = { name: LocalEmbeddingModelName; message: string };

export type LocalEmbedResult = { vectors: number[][]; modelVersion: string };

/** 何を埋め込むか。e5 系は接頭辞（query: / passage:）が変わる。bge-m3 は区別しない */
export type EmbedKind = "query" | "passage";
