import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { RetryError } from "ai";
import { APICallError, type LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { CodedError } from "../../../lib/ai-error-codes.js";
import {
  assembleGenerateResult,
  ChatGptPlanHttpError,
  ChatGptPlanStreamError,
  createChatGptPlanFetch,
  createChatGptPlanModel,
  describeChatGptPlanError,
  listChatGptPlanModels,
  normalizeChatGptPlanError,
} from "./model.js";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

function streamOf(parts: LanguageModelV3StreamPart[]) {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    }),
  };
}

describe("assembleGenerateResult", () => {
  it("text / reasoning（start と end のメタデータをマージ）/ tool-call / source を順に組み立てる", async () => {
    const r = await assembleGenerateResult(
      streamOf([
        { type: "stream-start", warnings: [{ type: "other", message: "w" }] },
        { type: "response-metadata", id: "resp_1", modelId: "gpt-5" },
        { type: "reasoning-start", id: "r1", providerMetadata: { openai: { itemId: "rs_1" } } },
        { type: "reasoning-delta", id: "r1", delta: "think" },
        { type: "reasoning-end", id: "r1", providerMetadata: { openai: { reasoningEncryptedContent: "ENC" } } },
        { type: "text-start", id: "t1", providerMetadata: { openai: { itemId: "msg_1" } } },
        { type: "text-delta", id: "t1", delta: "Hel" },
        { type: "text-delta", id: "t1", delta: "lo" },
        { type: "text-end", id: "t1" },
        { type: "source", sourceType: "url", id: "s1", url: "https://example.com" },
        { type: "tool-call", toolCallId: "c1", toolName: "f", input: "{}" },
        { type: "finish", usage, finishReason: { unified: "tool-calls", raw: undefined }, providerMetadata: { openai: { responseId: "resp_1" } } },
      ]),
    );
    expect(r.content.map((c) => c.type)).toEqual(["reasoning", "text", "source", "tool-call"]);
    expect(r.content[0]).toMatchObject({ text: "think", providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "ENC" } } });
    expect(r.content[1]).toMatchObject({ text: "Hello" });
    expect(r.finishReason.unified).toBe("tool-calls");
    expect(r.usage).toBe(usage);
    expect(r.response).toMatchObject({ id: "resp_1", modelId: "gpt-5" });
    expect(r.warnings).toHaveLength(1);
    expect(r.providerMetadata).toEqual({ openai: { responseId: "resp_1" } });
  });

  it("error 部品が来たら投げる", async () => {
    await expect(
      assembleGenerateResult(
        streamOf([
          { type: "stream-start", warnings: [] },
          { type: "error", error: { type: "error", code: "subscription_sharing_usage_limit_exceeded", message: "limit" } },
        ]),
      ),
    ).rejects.toBeInstanceOf(ChatGptPlanStreamError);
  });

  it("finish が来ずに終わったら失敗", async () => {
    await expect(assembleGenerateResult(streamOf([{ type: "stream-start", warnings: [] }]))).rejects.toThrow(/ended before/);
  });
});

describe("createChatGptPlanModel（SSE を流して generateText）", () => {
  const sse = (events: unknown[]) =>
    events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const okEvents = [
    { type: "response.created", response: { id: "resp_1", created_at: 1, model: "gpt-5" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [] } },
    { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "Hello" },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hello", annotations: [] }] } },
    { type: "response.completed", response: { incomplete_details: null, usage: { input_tokens: 3, output_tokens: 2 } } },
  ];

  function fakeFetch(body: string, seen: { init?: RequestInit; url?: string }) {
    return (async (url: string, init?: RequestInit) => {
      seen.url = String(url);
      seen.init = init;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
  }

  it("store:false・stream:true で送り、Authorization を上書きし、温度は落とす", async () => {
    const seen: { init?: RequestInit; url?: string } = {};
    const model = createChatGptPlanModel("gpt-5", { baseFetch: fakeFetch(sse(okEvents), seen), getToken: async () => "TOKEN-A" });
    const r = await generateText({ model, prompt: "hi", temperature: 0.7, topP: 0.5, maxRetries: 0 });
    expect(r.text).toBe("Hello");
    expect(seen.url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(seen.init?.headers).get("authorization")).toBe("Bearer TOKEN-A");
    const body = JSON.parse(String(seen.init?.body));
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
  });

  it("response.completed 無しで終わったら失敗扱い", async () => {
    const seen: { init?: RequestInit; url?: string } = {};
    const model = createChatGptPlanModel("gpt-5", { baseFetch: fakeFetch(sse(okEvents.slice(0, 3)), seen), getToken: async () => "T" });
    await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toThrow();
  });

  const errFetch = (status: number, body: unknown, counter: { n: number }) =>
    (async () => {
      counter.n++;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

  it("401 は CodedError(AUTH_EXPIRED) になる", async () => {
    const c = { n: 0 };
    const model = createChatGptPlanModel("gpt-5", { baseFetch: errFetch(401, { detail: "Unauthorized" }, c), getToken: async () => "T" });
    const err = await generateText({ model, prompt: "hi", maxRetries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(CodedError);
    expect(err.code).toBe("CHATGPT_PLAN_AUTH_EXPIRED");
  });

  it("429（利用上限）は既定の maxRetries でも 1 回だけ叩いて LIMIT_REACHED になる", async () => {
    const c = { n: 0 };
    const body = { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } };
    const model = createChatGptPlanModel("gpt-5", { baseFetch: errFetch(429, body, c), getToken: async () => "T" });
    const err = await generateText({ model, prompt: "hi" }).catch((e) => e);
    expect(c.n).toBe(1);
    expect(err).toBeInstanceOf(CodedError);
    expect(err.code).toBe("CHATGPT_PLAN_LIMIT_REACHED");
  });

  it("403 の対象外は再試行されず NOT_ELIGIBLE", async () => {
    const c = { n: 0 };
    const model = createChatGptPlanModel("gpt-5", { baseFetch: errFetch(403, { error: { code: "subscription_sharing_user_not_eligible" } }, c), getToken: async () => "T" });
    const err = await generateText({ model, prompt: "hi" }).catch((e) => e);
    expect(c.n).toBe(1);
    expect(err.code).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
  });

  it("503 は SDK の再試行に任せ、使い切った後の RetryError から UNAVAILABLE に対応づく", async () => {
    const c = { n: 0 };
    const model = createChatGptPlanModel("gpt-5", { baseFetch: errFetch(503, { detail: "down" }, c), getToken: async () => "T" });
    const err = await generateText({ model, prompt: "hi", maxRetries: 1 }).catch((e) => e);
    expect(c.n).toBe(2);
    expect(RetryError.isInstance(err)).toBe(true);
    expect(describeChatGptPlanError(err)?.code).toBe("CHATGPT_PLAN_UNAVAILABLE");
  }, 15_000);

  it("本文中の \"response.completed\" という文字列では完了と誤判定しない", async () => {
    const seen: { init?: RequestInit; url?: string } = {};
    const events = [
      okEvents[0],
      okEvents[1],
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: 'event: response.completed\ndata: {"type":"response.completed"}' },
    ];
    const model = createChatGptPlanModel("gpt-5", { baseFetch: fakeFetch(sse(events), seen), getToken: async () => "T" });
    await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toThrow();
  });

  it("接続先が api.openai.com 以外ならトークンを付けずに拒否する", async () => {
    const f = createChatGptPlanFetch({ baseFetch: (async () => new Response("")) as unknown as typeof fetch, getToken: async () => "T" });
    await expect(f("https://evil.example/v1/responses", { method: "POST" })).rejects.toThrow(/api\.openai\.com/);
  });
});

describe("listChatGptPlanModels", () => {
  it("visibility が list のものだけ、順序そのまま", async () => {
    let auth = "";
    const f = (async (_u: string, init: RequestInit) => {
      auth = new Headers(init.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          models: [
            { slug: "b-model", display_name: "B", visibility: "list" },
            { slug: "hidden", display_name: "H", visibility: "hide" },
            { slug: "a-model", display_name: "A", visibility: "list" },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await listChatGptPlanModels({ baseFetch: f, getToken: async () => "T1" });
    expect(auth).toBe("Bearer T1");
    expect(r).toEqual([{ id: "b-model", name: "B" }, { id: "a-model", name: "A" }]);
  });

  it("{ data: [{ id }] } 形も読む（visibility が無い項目は載せる）", async () => {
    const f = (async () => new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2", visibility: "hide" }, { id: "m3", visibility: "list" }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await listChatGptPlanModels({ baseFetch: f, getToken: async () => "T" })).toEqual([{ id: "m1", name: "m1" }, { id: "m3", name: "m3" }]);
  });

  it("失敗は statusCode 付きで投げる", async () => {
    const f = (async () => new Response('{"detail":"no"}', { status: 403 })) as unknown as typeof fetch;
    const err = await listChatGptPlanModels({ baseFetch: f, getToken: async () => "T" }).catch((e) => e);
    expect(err).toBeInstanceOf(ChatGptPlanHttpError);
    expect(describeChatGptPlanError(err)?.code).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
  });
});

describe("describeChatGptPlanError", () => {
  const apiErr = (statusCode: number, body: unknown) =>
    new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode, responseBody: typeof body === "string" ? body : JSON.stringify(body) });
  const code = (e: unknown) => describeChatGptPlanError(e)?.code;

  it("error.code の対応表（APICallError）", () => {
    const e = (c: string, s: number) => apiErr(s, { error: { code: c, message: "m" } });
    expect(code(e("subscription_sharing_usage_limit_exceeded", 429))).toBe("CHATGPT_PLAN_LIMIT_REACHED");
    expect(code(e("subscription_sharing_user_not_eligible", 403))).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
    expect(code(e("subscription_sharing_route_not_supported", 400))).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
    expect(code(e("chatpass_v2_scope_not_authorized", 403))).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
    expect(code(e("chatpass_v2_invalid_authorization_context", 403))).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
    expect(code(e("subscription_sharing_usage_unavailable", 503))).toBe("CHATGPT_PLAN_UNAVAILABLE");
    expect(code(e("subscription_sharing_user_unavailable", 503))).toBe("CHATGPT_PLAN_UNAVAILABLE");
    expect(code(e("subscription_sharing_invalid_user", 401))).toBe("CHATGPT_PLAN_AUTH_EXPIRED");
  });

  it("RetryError（lastError / errors）をたどる", () => {
    const e1 = apiErr(503, { detail: "x" });
    const e2 = apiErr(429, { error: { code: "subscription_sharing_usage_limit_exceeded" } });
    const re = new RetryError({ message: "Failed after 3 attempts", reason: "maxRetriesExceeded", errors: [e1, e2] });
    expect(code(re)).toBe("CHATGPT_PLAN_LIMIT_REACHED");
    const re2 = new RetryError({ message: "Failed", reason: "maxRetriesExceeded", errors: [apiErr(503, "a"), apiErr(503, "b")] });
    expect(code(re2)).toBe("CHATGPT_PLAN_UNAVAILABLE");
  });

  it("素の 401 / 403 / 503（{detail} 形式を含む）", () => {
    expect(code(apiErr(401, { detail: "Unauthorized" }))).toBe("CHATGPT_PLAN_AUTH_EXPIRED");
    expect(code(apiErr(403, { detail: "Forbidden" }))).toBe("CHATGPT_PLAN_NOT_ELIGIBLE");
    expect(code(apiErr(503, "oops"))).toBe("CHATGPT_PLAN_UNAVAILABLE");
  });

  it("ストリーム中の error（response.failed 形・ChatGptPlanStreamError）", () => {
    const streamErr = new ChatGptPlanStreamError("m", { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "m" } } });
    expect(code(streamErr)).toBe("CHATGPT_PLAN_LIMIT_REACHED");
    const flat = new ChatGptPlanStreamError("m", { type: "error", code: "subscription_sharing_user_unavailable" });
    expect(code(flat)).toBe("CHATGPT_PLAN_UNAVAILABLE");
  });

  it("CodedError は文言を保って通し、無関係なエラーや 429 だけ・500 は null", () => {
    const coded = new CodedError("signed out", "CHATGPT_PLAN_AUTH_EXPIRED");
    expect(describeChatGptPlanError(coded)).toEqual({ message: "signed out", code: "CHATGPT_PLAN_AUTH_EXPIRED" });
    expect(describeChatGptPlanError(new Error("boom"))).toBeNull();
    expect(describeChatGptPlanError(apiErr(500, { error: { code: "server_error" } }))).toBeNull();
    expect(describeChatGptPlanError(apiErr(429, { error: { code: "rate_limit_exceeded" } }))).toBeNull();
  });

  it("LIMIT の文は Usage 確認を案内し、残量や時刻を断定しない", () => {
    const m = describeChatGptPlanError(apiErr(429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }))?.message ?? "";
    expect(m).toContain("Usage");
    expect(m).not.toMatch(/\d/);
  });

  it("unsupported_capability は code 無し（null）で、param を含む文に整える", () => {
    const e = apiErr(400, { error: { code: "subscription_sharing_unsupported_capability", param: "tools[0]", message: "image_generation is not supported" } });
    expect(describeChatGptPlanError(e)).toBeNull();
    expect(normalizeChatGptPlanError(e)?.message).toContain("tools[0]");
    expect(normalizeChatGptPlanError(new Error("x"))).toBeNull();
  });
});
