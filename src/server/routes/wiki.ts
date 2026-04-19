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

// URL からテキストコンテンツを取得（CORS 回避用サーバーサイドプロキシ）
app.post("/fetch-url", async (c) => {
  const body = await c.req.json<{ url: string }>();

  if (!body.url) {
    return c.json({ error: "url は必須です" }, 400);
  }

  try {
    const res = await fetch(body.url, {
      headers: {
        "User-Agent": "Graphium/1.0 (Knowledge Layer)",
        "Accept": "text/html,application/xhtml+xml,text/plain,application/pdf",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return c.json({ error: `Fetch failed: ${res.status} ${res.statusText}` }, 400);
    }

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/pdf")) {
      // PDF: テキスト抽出は将来対応（現時点ではエラー）
      return c.json({ error: "PDF URL の直接取得は未対応です。PDF ブロックとしてノートに貼り付けてから Ingest してください。" }, 400);
    }

    const html = await res.text();

    // HTML からテキストを抽出（簡易パーサー）
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
    // OGP
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
    const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
    // meta description
    const metaDescription = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";

    // 本文テキスト抽出: script/style/nav/header/footer タグを除去 → タグを除去 → 空行を整理
    let bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // 最大 5000 文字に制限（LLM のコンテキスト節約）
    if (bodyText.length > 5000) {
      bodyText = bodyText.slice(0, 5000) + "\n\n[... truncated]";
    }

    return c.json({
      title: ogTitle || title,
      description: ogDescription || metaDescription,
      text: bodyText,
      url: body.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return c.json({ error: message }, 500);
  }
});

export default app;
