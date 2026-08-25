// @vitest-environment jsdom
// notifyEmbeddingFailure（embedding 失敗の可視化ファネル）のテスト
//
// 不変条件:
// - 同じ原因（エラーコード、無ければメッセージ）はセッション内 1 回だけ通知する
//   （embedding は保存・検索のたびに自動で走るため、連発でトーストが積み上がらない）
// - 原因が変わったら改めて通知する（設定を直した後に出た別のエラーが埋もれない）
// - detail.message は localizeAiError 済みの表示用文言（既知 code は i18n、無ければ生メッセージ）

import { describe, it, expect, vi } from "vitest";

// モジュールレベルの通知済み Set を毎テスト新品にするため、resetModules + 動的 import で読み込む
async function freshModule() {
  vi.resetModules();
  const { syncLocale } = await import("../i18n");
  syncLocale("en");
  return import("./ai-error");
}

function collect(eventName: string): { messages: string[]; dispose: () => void } {
  const messages: string[] = [];
  const listener = (e: Event) =>
    messages.push((e as CustomEvent<{ message: string }>).detail.message);
  window.addEventListener(eventName, listener);
  return { messages, dispose: () => window.removeEventListener(eventName, listener) };
}

describe("notifyEmbeddingFailure", () => {
  it("既知 code のエラーは i18n 文言で 1 回だけ通知し、同じ code の連発は抑える", async () => {
    const { notifyEmbeddingFailure, EMBEDDING_FAILED_EVENT } = await freshModule();
    const { CodedError } = await import("./ai-error-codes");
    const { messages, dispose } = collect(EMBEDDING_FAILED_EVENT);
    try {
      notifyEmbeddingFailure(
        new CodedError("Embedding requires OpenAI provider", "EMBEDDING_MODEL_UNSUPPORTED"),
      );
      notifyEmbeddingFailure(
        // code が同じならメッセージが違ってもシグネチャは同一（code 優先）
        new CodedError("another raw message", "EMBEDDING_MODEL_UNSUPPORTED"),
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe(
        "Embedding requires an OpenAI-compatible model. Add one in Settings → AI.",
      );
    } finally {
      dispose();
    }
  });

  it("code 無し Error は生メッセージで通知し、同一メッセージの連発は抑える", async () => {
    const { notifyEmbeddingFailure, EMBEDDING_FAILED_EVENT } = await freshModule();
    const { messages, dispose } = collect(EMBEDDING_FAILED_EVENT);
    try {
      // 実例: さくらの chat モデルが /v1/embeddings に流れて返す 400
      notifyEmbeddingFailure(new Error("Bad Request: This model is not available"));
      notifyEmbeddingFailure(new Error("Bad Request: This model is not available"));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe("Bad Request: This model is not available");
    } finally {
      dispose();
    }
  });

  it("原因が変わったら改めて通知する（設定変更後の別エラーが埋もれない）", async () => {
    const { notifyEmbeddingFailure, EMBEDDING_FAILED_EVENT } = await freshModule();
    const { CodedError } = await import("./ai-error-codes");
    const { messages, dispose } = collect(EMBEDDING_FAILED_EVENT);
    try {
      notifyEmbeddingFailure(new CodedError("x", "EMBEDDING_MODEL_UNSUPPORTED"));
      notifyEmbeddingFailure(new Error("context length exceeded (LM Studio)"));
      expect(messages).toHaveLength(2);
      expect(messages[1]).toBe("context length exceeded (LM Studio)");
    } finally {
      dispose();
    }
  });
});
