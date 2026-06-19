// 翻訳 API ルート
// POST /api/translate — PDF 抽出済みテキスト（1 チャンク）を目的言語へ忠実に全文翻訳し、
//                       Markdown を返す。
//
// PDF パースとチャンク分割はクライアント側（pdfjs）で行い、ここでは LLM 呼び出しのみ担当する。
// prov / wiki ingester と同じ LLM 共通層（createModel / runAgentLoop）を流用する。

import { Hono } from "hono";
import { createModel } from "../services/llm.js";
import { resolveModelConfig } from "../services/header-model.js";
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildTranslateSystemPrompt,
  buildTranslateUserMessage,
  buildGlossarySystemPrompt,
  buildGlossaryUserMessage,
  parseGlossaryOutput,
  type GlossaryEntry,
} from "../services/translate.js";

const app = new Hono();

/** 出力全体が ```...``` で囲まれていた場合に外側のフェンスだけ剥がす */
function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : trimmed;
}

app.post("/", async (c) => {
  const body = await c.req.json<{
    text: string;
    language?: string;
    partLabel?: string;
    model?: string;
    glossary?: GlossaryEntry[];
  }>();

  if (!body.text || body.text.trim().length < 1) {
    return c.json({ error: "翻訳対象のテキストが空です。" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
  }

  const language = body.language || "en";
  const systemPrompt = buildTranslateSystemPrompt(language);
  const userMessage = buildTranslateUserMessage({
    text: body.text,
    language,
    partLabel: body.partLabel,
    glossary: Array.isArray(body.glossary) ? body.glossary : undefined,
  });

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "translate.pdf",
      modelConfig,
      temperature: 0, // 翻訳は実行間のブレを抑えるため決定的に

    });

    const markdown = stripOuterFence(result.message ?? "");
    if (!markdown) {
      return c.json({ error: "翻訳結果が空でした。" }, 502);
    }

    return c.json({
      markdown,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("translate error:", err);
    return c.json({ error: message }, 500);
  }
});

// 文書全体から訳語統一用の用語集を1回だけ抽出する。
// クライアントは並列ページ翻訳の前にこれを呼び、結果を各ページ翻訳へ渡す。
app.post("/glossary", async (c) => {
  const body = await c.req.json<{ text: string; language?: string; model?: string }>();

  if (!body.text || body.text.trim().length < 1) {
    return c.json({ glossary: [] });
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
  }

  const language = body.language || "en";
  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt: buildGlossarySystemPrompt(language),
      messages: [{ role: "user" as const, content: buildGlossaryUserMessage(body.text) }],
      maxSteps: 1,
      feature: "translate.glossary",
      modelConfig,
      temperature: 0, // 用語集も毎回同じ結果になるよう決定的に

    });
    const glossary = parseGlossaryOutput(result.message ?? "");
    return c.json({ glossary, tokenUsage: result.tokenUsage, model: result.model });
  } catch (err) {
    // 用語集はベストエフォート。失敗しても翻訳本体は続行できるよう空で返す。
    console.error("glossary error:", err);
    return c.json({ glossary: [] });
  }
});

export default app;
