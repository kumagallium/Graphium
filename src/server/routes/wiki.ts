// Wiki API ルート
// POST /api/wiki/ingest — ノートから Wiki ドキュメントを生成
// POST /api/wiki/embed — テキストの embedding を生成

import { Hono } from "hono";
import { getDefaultModel, listModels } from "../config/models.js";
import { createModel } from "../services/llm.js";
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildIngesterSystemPrompt,
  parseIngesterOutput,
  type ExistingWikiInfo,
} from "../services/wiki-ingester.js";
import { generateEmbeddings } from "../services/embedding.js";

const app = new Hono();

// ノートから Wiki を生成
app.post("/ingest", async (c) => {
  const body = await c.req.json<{
    noteId: string;
    noteContent: string;
    noteTitle: string;
    existingWikiTitles: ExistingWikiInfo[];
    language: string;
    model?: string;
  }>();

  if (!body.noteContent) {
    return c.json({ error: "noteContent は必須です" }, 400);
  }

  // モデル解決
  let modelConfig = getDefaultModel();
  if (body.model) {
    const models = listModels();
    modelConfig = models.find((m) => m.name === body.model) ?? modelConfig;
  }

  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
  }

  const systemPrompt = buildIngesterSystemPrompt(
    body.language || "en",
    body.existingWikiTitles || [],
  );

  const userMessage = `# ${body.noteTitle}\n\n${body.noteContent}`;

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
    });

    const wikis = parseIngesterOutput(result.message);

    return c.json({
      wikis,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Wiki ingest error:", err);
    return c.json({ error: message }, 500);
  }
});

// テキストの embedding を生成
app.post("/embed", async (c) => {
  const body = await c.req.json<{
    texts: { documentId: string; sectionId: string; text: string }[];
    model?: string;
    embedding_model?: string;
  }>();

  if (!body.texts || body.texts.length === 0) {
    return c.json({ error: "texts は必須です" }, 400);
  }

  // Embedding 用モデルを解決: embedding_model → model → デフォルト
  const models = listModels();
  let modelConfig = getDefaultModel();
  if (body.embedding_model) {
    modelConfig = models.find((m) => m.name === body.embedding_model) ?? modelConfig;
  } else if (body.model) {
    modelConfig = models.find((m) => m.name === body.model) ?? modelConfig;
  }

  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。" },
      400,
    );
  }

  try {
    const textValues = body.texts.map((t) => t.text);
    const result = await generateEmbeddings(textValues, modelConfig);

    const embeddings = body.texts.map((t, i) => ({
      documentId: t.documentId,
      sectionId: t.sectionId,
      vector: result.vectors[i],
    }));

    return c.json({
      embeddings,
      modelVersion: result.modelVersion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Wiki embed error:", err);
    return c.json({ error: message }, 500);
  }
});

export default app;
