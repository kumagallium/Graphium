// World-model grounding API route (Phase 2 / PR 2B).
// POST /api/world-grounding/check
//
// 入力: claimText / domain / language / model（任意）
// 出力: { result: WorldGroundingResult | null, model, tokenUsage } または { result: null, error }
//
// 失敗時は HTTP 4xx ではなく { result: null, error } で degrade。
// 呼び出し側 facade は result.verdict が null なら cache に書かない（鉄則）。

import { Hono } from "hono";
import { createModel } from "../services/llm.js";
import { resolveModelConfig } from "../services/header-model.js";
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildWorldGroundingSystemPrompt,
  buildWorldGroundingUserMessage,
  parseWorldGroundingOutput,
} from "../services/world-grounding.js";

const app = new Hono();

app.post("/check", async (c) => {
  const body = await c.req.json<{
    claimText: string;
    domain: string;
    language?: string;
    model?: string;
  }>();

  if (!body.claimText || typeof body.claimText !== "string") {
    return c.json({ result: null, error: "claimText is required" }, 400);
  }
  if (!body.domain || typeof body.domain !== "string") {
    return c.json({ result: null, error: "domain is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    // モデル未登録 → degrade。エラーにはしない（PR 2A 方針 §7）
    return c.json({ result: null, error: "no model registered" });
  }

  const systemPrompt = buildWorldGroundingSystemPrompt(body.language || "en");
  const userMessage = buildWorldGroundingUserMessage({
    claimText: body.claimText,
    domain: body.domain,
  });

  try {
    const model = createModel(modelConfig);
    const llmResult = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
    });
    const parsed = parseWorldGroundingOutput(llmResult.message);
    return c.json({
      result: parsed,
      model: llmResult.model,
      tokenUsage: llmResult.tokenUsage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[world-grounding] check error:", err);
    // LLM 呼び出し失敗 → degrade（既存 dedup の fail-open と同じ精神）
    return c.json({ result: null, error: message });
  }
});

export default app;
