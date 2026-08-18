// runAgentLoop の中断契約。
//
// wiki / prov / translate / world-grounding の各ルートは `abortSignal: c.req.raw.signal` を
// runAgentLoop に渡す。クライアントが fetch を切ると Hono の request signal が発火し、
// それが generateText → モデルの doGenerate まで届いて LLM 呼び出しが止まる、という
// 一本の線が成立していることをここで固定する（ルート単位のテストは薄いので、
// チョークポイントである runAgentLoop で見る）。

import { describe, it, expect } from "vitest";
import { runAgentLoop } from "./agent-loop.js";
import { isAbortError } from "../../lib/abort-error.js";
import { aiErrorCodeOf } from "../../lib/ai-error-codes.js";

/** abort されるまで返さないダミーモデル。signal を受け取ったら AbortError で reject する */
function makeHangingModel() {
  let receivedSignal: AbortSignal | undefined;
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "hang",
    supportedUrls: {},
    doGenerate: (options: { abortSignal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        receivedSignal = options.abortSignal;
        if (!options.abortSignal) return; // signal が来なければ永久に返さない
        if (options.abortSignal.aborted) {
          reject(options.abortSignal.reason);
          return;
        }
        options.abortSignal.addEventListener("abort", () => reject(options.abortSignal!.reason), { once: true });
      }),
    doStream: async () => {
      throw new Error("not used");
    },
  };
  return { model, getReceivedSignal: () => receivedSignal };
}

const CONFIG = {
  id: "m1",
  name: "test",
  provider: "openai-compatible",
  modelId: "hang",
  apiKey: "k",
  apiBase: "https://example/v1",
} as never;

describe("runAgentLoop の中断", () => {
  it("abortSignal はモデルの doGenerate まで届く", async () => {
    const { model, getReceivedSignal } = makeHangingModel();
    const controller = new AbortController();
    const p = runAgentLoop({
      model: model as never,
      modelId: "hang",
      systemPrompt: "s",
      messages: [{ role: "user", content: "hi" }],
      modelConfig: CONFIG,
      abortSignal: controller.signal,
    });
    // doGenerate が呼ばれるまで待つ
    await new Promise((r) => setTimeout(r, 10));
    expect(getReceivedSignal()).toBeDefined();
    controller.abort();
    await expect(p).rejects.toSatisfy((e: unknown) => isAbortError(e));
  });

  it("abort 済みの signal を渡すと即座に AbortError で終わる（LLM を呼びに行かない）", async () => {
    const { model } = makeHangingModel();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgentLoop({
        model: model as never,
        modelId: "hang",
        systemPrompt: "s",
        messages: [{ role: "user", content: "hi" }],
        modelConfig: CONFIG,
        abortSignal: controller.signal,
      }),
    ).rejects.toSatisfy((e: unknown) => isAbortError(e));
  });

  it("中断は認証エラーに誤変換されない（CodedError にならず AbortError のまま伝わる）", async () => {
    const { model } = makeHangingModel();
    const controller = new AbortController();
    const p = runAgentLoop({
      model: model as never,
      modelId: "hang",
      systemPrompt: "s",
      messages: [{ role: "user", content: "hi" }],
      modelConfig: CONFIG,
      abortSignal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    // DOMException の AbortError は仕様上 code: 20 (ABORT_ERR) を持つので、
    // 「AI エラーコード（INVALID_API_KEY 等）に変換されていない」ことを見る
    await expect(p).rejects.toSatisfy((e: unknown) => isAbortError(e) && aiErrorCodeOf(e) === undefined);
  });
});
