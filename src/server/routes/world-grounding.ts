// World-model grounding API route (Phase 2 / PR 2B + 2C, Phase 5: web-grounding).
// POST /api/world-grounding/check
//
// 入力: claimText / language / model（任意）
// 出力: { result: WorldGroundingResult | null, model, tokenUsage, grounded } または { result: null, error }
//
// 失敗時は HTTP 4xx ではなく { result: null, error } で degrade。
// 呼び出し側 facade は result.verdict が null なら cache に書かない（鉄則）。
//
// PR 2C: body の `domain` を廃止。LLM が `tags` を生成して result に含める。
//
// web-grounding（Phase 5 前倒し）:
//   接続済み MCP の検索ツールを判定前に 1 回実行し、その証拠に基づいて判定させる。
//   検索ツールが無い / 結果が空なら従来の parametric 判定にフォールバックする。
//   - grounded=true: 出力 URL は「検索が返した URL」のみ（provenance 保証）。実在検証はスキップ。
//   - grounded=false: 従来どおり whitelist + 実在検証（記憶由来 URL の幻覚対策）。

import { Hono } from "hono";
import { createModel } from "../services/llm.js";
import { resolveModelConfig } from "../services/header-model.js";
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildWorldGroundingSystemPrompt,
  buildWorldGroundingUserMessage,
  buildWebGroundedSystemPrompt,
  buildWebGroundedUserMessage,
  parseWorldGroundingOutput,
  verifyResultSourceUrls,
} from "../services/world-grounding.js";
import { discoverAllMcpTools } from "../services/mcp-discovery.js";
import {
  findSearchTool,
  runGroundingSearch,
  normalizeUrlForMatch,
} from "../services/grounding-search.js";

const app = new Hono();

app.post("/check", async (c) => {
  const body = await c.req.json<{
    claimText: string;
    language?: string;
    model?: string;
  }>();

  if (!body.claimText || typeof body.claimText !== "string") {
    return c.json({ result: null, error: "claimText is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    // モデル未登録 → degrade。エラーにはしない（PR 2A 方針 §7）
    return c.json({ result: null, error: "no model registered" });
  }

  // ── web-grounding: 判定前に MCP 検索ツールで証拠を取得する ──
  // 検索ツール未接続 / 失敗 / 空結果は全て parametric 判定にフォールバックする
  // （= 既存ユーザーの体験は変わらない）。
  let evidenceText = "";
  let allowedUrls: Set<string> | null = null;
  try {
    const { tools } = await discoverAllMcpTools(c);
    const searchTool = findSearchTool(tools);
    if (searchTool) {
      const search = await runGroundingSearch(searchTool, body.claimText);
      if (search.evidenceText && search.urls.length > 0) {
        evidenceText = search.evidenceText;
        allowedUrls = new Set(
          search.urls
            .map((u) => normalizeUrlForMatch(u))
            .filter((x): x is string => !!x),
        );
        console.info(
          `[world-grounding] web evidence via "${searchTool.name}": ${allowedUrls.size} urls`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[world-grounding] search discovery failed (degrading to parametric):",
      err instanceof Error ? err.message : err,
    );
  }

  const grounded = !!(evidenceText && allowedUrls && allowedUrls.size > 0);
  const systemPrompt = grounded
    ? buildWebGroundedSystemPrompt(body.language || "en")
    : buildWorldGroundingSystemPrompt(body.language || "en");
  const userMessage = grounded
    ? buildWebGroundedUserMessage({ claimText: body.claimText, evidenceText })
    : buildWorldGroundingUserMessage({ claimText: body.claimText });

  try {
    const model = await createModel(modelConfig);
    const llmResult = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "world-grounding",
      modelConfig,
    });
    const parsed = parseWorldGroundingOutput(
      llmResult.message,
      grounded
        ? { mode: "evidence", allowedUrls: allowedUrls! }
        : { mode: "whitelist" },
    );
    // grounded: URL は数秒前に検索が返した実在 URL（任意ドメイン）なので実在検証はスキップ。
    //   provenance ガードレール（url ∈ evidence）が保証になっている。
    // parametric: ホスト名 whitelist を通った url も実在検証し、404 / 確認不能なものは剥がす。
    const result =
      parsed && !grounded ? await verifyResultSourceUrls(parsed) : parsed;
    return c.json({
      result,
      model: llmResult.model,
      tokenUsage: llmResult.tokenUsage,
      grounded,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[world-grounding] check error:", err);
    // LLM 呼び出し失敗 → degrade（既存 dedup の fail-open と同じ精神）
    return c.json({ result: null, error: message, grounded });
  }
});

export default app;
