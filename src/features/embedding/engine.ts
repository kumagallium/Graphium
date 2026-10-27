// 埋め込みを「どこで作るか」の解決（純関数。設定値と実行環境から決める）
//
// 設定 `embeddingModel` の値:
//   ""                  … 未設定。API 側の既定（チャットモデル）で試す（従来どおり）
//   "<API モデル名>"     … 登録済み API モデルの表示名（従来どおり）
//   "local:<name>"      … このパソコンで動くモデル（デスクトップだけ。Web 版では API の既定に倒す）
//
// 既存ユーザーの設定は黙って変えない: "" の意味は従来のまま（設計書 §2）。

import type { LocalEmbeddingModelName } from "./types";

export const LOCAL_EMBEDDING_PREFIX = "local:";

export type LocalEmbeddingModelInfo = {
  name: LocalEmbeddingModelName;
  /** embedding-store の modelVersion（Rust 側 MODELS.version と同じ） */
  version: string;
  dims: number;
  /** 取得サイズの目安（状態が読めるまでの表示用。実値は Rust の status） */
  expectedBytes: number;
  recommended: boolean;
};

/** 並びは設定画面の順（先頭 = おすすめ） */
export const LOCAL_EMBEDDING_MODELS: readonly LocalEmbeddingModelInfo[] = [
  { name: "bge-m3", version: "local:bge-m3-q8", dims: 1024, expectedBytes: 587_000_000, recommended: true },
  { name: "multilingual-e5-small", version: "local:multilingual-e5-small-q8", dims: 384, expectedBytes: 136_000_000, recommended: false },
];

export function localEmbeddingValue(name: LocalEmbeddingModelName): string {
  return `${LOCAL_EMBEDDING_PREFIX}${name}`;
}

export function isLocalEmbeddingValue(value: string): boolean {
  return value.startsWith(LOCAL_EMBEDDING_PREFIX);
}

/** "local:<name>" から name を取り出す。知らない名前・形が違えば null */
export function parseLocalEmbeddingValue(value: string): LocalEmbeddingModelName | null {
  if (!isLocalEmbeddingValue(value)) return null;
  const name = value.slice(LOCAL_EMBEDDING_PREFIX.length);
  return LOCAL_EMBEDDING_MODELS.some((m) => m.name === name) ? (name as LocalEmbeddingModelName) : null;
}

export function localEmbeddingInfo(name: LocalEmbeddingModelName): LocalEmbeddingModelInfo {
  return LOCAL_EMBEDDING_MODELS.find((m) => m.name === name)!;
}

export type EmbeddingEngine =
  | { kind: "local"; name: LocalEmbeddingModelName }
  | { kind: "api"; embeddingModel: string };

/**
 * 設定値と環境から、埋め込みをどこで作るかを決める。
 * - local の値でもデスクトップでなければ API の既定（embeddingModel = ""）に倒す
 *   （Web 版には Rust が無い。設定を共有ストレージ経由で持ち込んだときの保険）
 * - local の値だが知らない名前なら API の既定に倒す（古い版で付けた名前など）
 */
export function resolveEmbeddingEngine(embeddingModel: string, desktop: boolean): EmbeddingEngine {
  if (isLocalEmbeddingValue(embeddingModel)) {
    const name = parseLocalEmbeddingValue(embeddingModel);
    if (desktop && name) return { kind: "local", name };
    return { kind: "api", embeddingModel: "" };
  }
  return { kind: "api", embeddingModel };
}
