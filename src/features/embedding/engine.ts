// 埋め込みを「どこで作るか」の解決（純関数。設定値と実行環境から決める）
//
// 設定 `embeddingModel` の値:
//   ""                  … 未設定。デスクトップで API 製のベクトルが無ければ端末内の bge-m3（既定）。
//                         それ以外は API 側の既定（チャットモデル）で試す（従来どおり）
//   "<API モデル名>"     … 登録済み API モデルの表示名（従来どおり）
//   "local:<name>"      … このパソコンで動くモデル（デスクトップだけ。Web 版では API の既定に倒す）
//
// 既存ユーザーを黙って切り替えない: これまで API で埋め込んできた人（API 製のベクトルが
// 残っている）は "" のまま API。初めての人・端末内だけの人は "" で端末内（設計書 §2・§8）。

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
  | { kind: "local"; name: LocalEmbeddingModelName; /** 設定が空で既定として選ばれた */ implicit: boolean }
  | { kind: "api"; embeddingModel: string };

/** 既定として使う端末内モデル */
export const DEFAULT_LOCAL_EMBEDDING_MODEL: LocalEmbeddingModelName = "bge-m3";

export type ResolveEmbeddingOptions = {
  /** デスクトップ（Tauri）か */
  desktop: boolean;
  /** 設定が空のとき端末内を既定にしてよいか（API 製のベクトルが無い） */
  localByDefault: boolean;
};

/**
 * 設定値と環境から、埋め込みをどこで作るかを決める。
 * - local の値でもデスクトップでなければ API の既定（embeddingModel = ""）に倒す
 *   （Web 版には Rust が無い。設定を共有ストレージ経由で持ち込んだときの保険）
 * - local の値だが知らない名前なら API の既定に倒す（古い版で付けた名前など）
 */
export function resolveEmbeddingEngine(embeddingModel: string, options: boolean | ResolveEmbeddingOptions): EmbeddingEngine {
  const { desktop, localByDefault } = typeof options === "boolean" ? { desktop: options, localByDefault: false } : options;
  if (isLocalEmbeddingValue(embeddingModel)) {
    const name = parseLocalEmbeddingValue(embeddingModel);
    if (desktop && name) return { kind: "local", name, implicit: false };
    return { kind: "api", embeddingModel: "" };
  }
  if (embeddingModel === "" && desktop && localByDefault) {
    return { kind: "local", name: DEFAULT_LOCAL_EMBEDDING_MODEL, implicit: true };
  }
  return { kind: "api", embeddingModel };
}
