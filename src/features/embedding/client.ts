// 埋め込みの呼び出し口（クライアント側で唯一の入口）
//
// 節の埋め込み（wiki-service）・重複判定の候補（wiki-service）・質問（retriever）は
// すべてここを通る。設定に応じて、このパソコンの Rust（Tauri）か、サーバーの
// /api/wiki/embed（API の提供者）に振り分ける。呼び出し側は成否だけ見ればよい。
//
// 失敗は throw せず { ok: false, error } で返す。error は aiErrorFromResponse と同じ形
// （code 付き Error）なので、呼び出し側は notifyEmbeddingFailure(error) にそのまま渡せる。

import { apiBase, isTauri } from "../../lib/platform";
import { toAsciiJson } from "../../lib/ascii-json";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getEmbeddingLLMModel, getEmbeddingModel, getSelectedModel } from "../settings/store";
import * as local from "./api";
import { hasApiVectors } from "./default-probe";
import { resolveEmbeddingEngine, type EmbeddingEngine } from "./engine";
import type { EmbedKind, LocalEmbeddingModelName } from "./types";

/** 既定の端末内モデルの取得を自動で始めたとき（note-app がトーストを出す） */
export const EMBEDDING_MODEL_DOWNLOADING_EVENT = "graphium-embedding-model-downloading";

export type EmbedTextsResult =
  | { ok: true; vectors: number[][]; modelVersion: string }
  | { ok: false; error: Error };

/** 今の設定で使うエンジン（UI の表示にも使う） */
export function currentEmbeddingEngine(): EmbeddingEngine {
  return resolveEmbeddingEngine(getEmbeddingModel(), { desktop: isTauri(), localByDefault: !hasApiVectors() });
}

// 既定で端末内になった最初の埋め込みでモデルが無ければ、取得を自動で始める（セッション 1 回）。
// 利用者は「埋め込み」を知らなくてよい、が方針。明示的に端末内を選んだ人には設定画面の
// 取得行があるので、こちらは既定（implicit）のときだけ
const autoDownloadStarted = new Set<LocalEmbeddingModelName>();

function startDefaultModelDownload(name: LocalEmbeddingModelName): void {
  if (autoDownloadStarted.has(name)) return;
  autoDownloadStarted.add(name);
  local.downloadModel(name).catch(() => {
    // 既に取得中（already downloading）・ネットワーク断など。失敗は設定画面の取得行に出る
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EMBEDDING_MODEL_DOWNLOADING_EVENT, { detail: { name } }));
  }
}

/** テスト用 */
export function resetAutoDownloadForTest(): void {
  autoDownloadStarted.clear();
}

/** Rust の失敗文字列（`CODE:detail` か素のメッセージ）を code 付き Error にする */
export function localEmbeddingError(raw: unknown): Error {
  const text = raw instanceof Error ? raw.message : String(raw);
  const m = /^([A-Z_]+):(.*)$/s.exec(text);
  const err = new Error(m ? (m[2] || text) : text);
  if (m) (err as Error & { code?: string }).code = m[1];
  return err;
}

/**
 * 文を埋め込む。順序は入力どおり。空配列なら呼ばずに空を返す。
 * @param kind "query"（質問）か "passage"（節・候補）。e5 系の接頭辞に効く。API 経路では使わない
 */
export async function embedTexts(texts: string[], kind: EmbedKind): Promise<EmbedTextsResult> {
  const engine = currentEmbeddingEngine();
  if (texts.length === 0) {
    return { ok: true, vectors: [], modelVersion: "" };
  }
  if (engine.kind === "local") {
    try {
      const r = await local.embed(engine.name, texts, kind);
      return { ok: true, vectors: r.vectors, modelVersion: r.modelVersion };
    } catch (e) {
      const error = localEmbeddingError(e);
      if (engine.implicit && (error as Error & { code?: string }).code === "EMBEDDING_MODEL_NOT_DOWNLOADED") {
        startDefaultModelDownload(engine.name);
      }
      return { ok: false, error };
    }
  }
  return embedViaApi(texts, engine.embeddingModel);
}

async function embedViaApi(texts: string[], embModel: string): Promise<EmbedTextsResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    // Web 版は埋め込み用の認証情報をヘッダーで送る（resolveModelConfig がヘッダーを最優先するため、
    // チャットモデルを送ると body.embedding_model が無視される）
    const model = getEmbeddingLLMModel();
    if (model) {
      headers["X-LLM-API-Key"] = toAsciiJson({
        provider: model.provider,
        modelId: model.modelId,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        name: model.name,
        rate: model.rate,
      });
    }
  }
  // 埋め込みモデルが未設定なら、既定モデルの表示名を body.model に載せる（サーバーは
  // embedding_model || model の順で引く）。デスクトップ版はヘッダーを送らないので、これが無いと
  // models.json の先頭（利用者の既定とは限らない）に落ちる。既定も未設定なら何も載せない
  const defaultModel = getSelectedModel();
  try {
    const res = await fetch(`${apiBase()}/wiki/embed`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        texts: texts.map((text, i) => ({ documentId: "_", sectionId: String(i), text })),
        ...(embModel ? { embedding_model: embModel } : defaultModel ? { model: defaultModel } : {}),
      }),
    });
    if (!res.ok) {
      return { ok: false, error: await aiErrorFromResponse(res, "Embedding request failed") };
    }
    const data = (await res.json()) as { embeddings?: { vector: number[] }[]; modelVersion?: string };
    const vectors = (data.embeddings ?? []).map((e) => e.vector);
    if (vectors.length !== texts.length) {
      return { ok: false, error: new Error(`Embedding response had ${vectors.length} vectors for ${texts.length} texts`) };
    }
    return { ok: true, vectors, modelVersion: data.modelVersion ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
