// PROV API ルート
// POST /api/prov/ingest-url — URL から PROV ラベル付きブロック構造を生成
// POST /api/prov/ingest-pdf — PDF 抽出済みテキストから PROV ラベル付きブロック構造を生成
//
// 処理の流れ:
//   1. (URL の場合) URL を fetch してテキスト抽出（url-fetcher 共通処理）
//      (PDF の場合) クライアント側で pdfjs により抽出したテキストを受け取る
//   2. PROV ingester プロンプトで LLM に投げる
//   3. 構造化 JSON を返す（フロント側で BlockNote ブロックに組み立て）

import { Hono } from "hono";
import { createModel } from "../services/llm.js";
import { resolveModelConfig } from "../services/header-model.js";
import { runAgentLoop, type AgentRunResult } from "../services/agent-loop.js";
import {
  buildProvIngesterSystemPrompt,
  buildProvIngesterUserMessage,
  parseProvIngesterOutput,
  type ProvIngesterOutput,
} from "../services/prov-ingester.js";
import { fetchPageAsText, type FetchPageError } from "../services/url-fetcher.js";
import {
  noModelRegisteredBody,
  provStructureFailedBody,
  errorBody,
} from "../../lib/ai-error-codes.js";
import type { ModelConfig } from "../config/models.js";

const app = new Hono();

// LLM 生成 + パースをまとめて実行し、blocks が空なら 1 回だけ生成し直す。
// 空になるのは (a) 出力 JSON が壊れて jsonrepair でも直らない、(b) LLM が手順を
// 全 drop した、のどちらかで、いずれもサンプリング起因のため引き直しで成功する
// ことが多い（gpt-oss-120b × 4 ページ論文 PDF の実測で初回失敗はおよそ 1/4）。
async function generateProvBlocksWithRetry(opts: {
  modelConfig: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  feature: "prov.from-url" | "prov.from-pdf";
}): Promise<{ parsed: ProvIngesterOutput; result: AgentRunResult }> {
  const model = await createModel(opts.modelConfig);
  const runOnce = () =>
    runAgentLoop({
      model,
      modelId: opts.modelConfig.modelId,
      systemPrompt: opts.systemPrompt,
      messages: [{ role: "user" as const, content: opts.userMessage }],
      maxSteps: 1,
      feature: opts.feature,
      modelConfig: opts.modelConfig,
    });

  let result = await runOnce();
  let parsed = parseProvIngesterOutput(result.message);
  if (parsed.blocks.length === 0) {
    console.warn(`[${opts.feature}] PROV blocks が空 (JSON 破損 or 全 drop)、1 回だけ再生成する`);
    result = await runOnce();
    parsed = parseProvIngesterOutput(result.message);
  }
  return { parsed, result };
}

// URL から PROV 構造化ブロックを生成
app.post("/ingest-url", async (c) => {
  const body = await c.req.json<{
    url: string;
    language?: string;
    model?: string;
  }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  // モデル解決: ヘッダー → body.model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  // URL fetch
  let page;
  try {
    page = await fetchPageAsText(body.url);
  } catch (err) {
    const e = err as FetchPageError;
    if (typeof e?.status === "number" && typeof e?.message === "string") {
      return c.json({ error: e.message }, e.status as 400 | 500);
    }
    return c.json(errorBody(err), 500);
  }

  if (!page.text || page.text.length < 50) {
    return c.json(
      { error: "Could not extract enough text from the page." },
      400,
    );
  }

  const language = body.language || "en";

  // LLM 呼び出し（open-set 単一 prompt）
  const systemPrompt = buildProvIngesterSystemPrompt(language);
  const userMessage = buildProvIngesterUserMessage({
    url: page.url,
    title: page.title || body.url,
    description: page.description,
    text: page.text,
  });

  try {
    const { parsed, result } = await generateProvBlocksWithRetry({
      modelConfig,
      systemPrompt,
      userMessage,
      feature: "prov.from-url",
    });

    if (parsed.blocks.length === 0) {
      return c.json(provStructureFailedBody(), 502);
    }

    return c.json({
      title: parsed.title || page.title || body.url,
      blocks: parsed.blocks,
      sourceUrl: page.url,
      sourceTitle: page.title,
      sourceFetchedAt: page.fetchedAt,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("PROV ingest-url error:", err);
    // runAgentLoop 由来の CodedError（認証エラー等）は code を JSON に通す
    return c.json(errorBody(err), 500);
  }
});

// PDF 抽出済みテキストから PROV 構造化ブロックを生成
// PDF パースはクライアント側（pdfjs）で行い、ここでは LLM 呼び出しのみ担当する。
app.post("/ingest-pdf", async (c) => {
  const body = await c.req.json<{
    text: string;
    title?: string;
    language?: string;
    model?: string;
  }>();

  if (!body.text || body.text.trim().length < 50) {
    return c.json(
      { error: "Could not extract enough text from the PDF." },
      400,
    );
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  // 抽出テキスト冒頭に出力言語ヒントを再掲する。長文中で system 末尾の指示が
  // 軽視されるケースに備えた近接リマインダ（wiki ingester の PDF 経路と同方針）。
  const language = body.language || "en";
  const languageHint =
    language === "ja"
      ? "[出力言語: 日本語で書いてください。タイトルも本文もすべて日本語にしてください]"
      : `[Output language: ${language}]`;
  const titleForPrompt = body.title?.trim() || "(untitled PDF)";

  const userMessage = buildProvIngesterUserMessage({
    url: `pdf://${titleForPrompt}`,
    title: titleForPrompt,
    description: undefined,
    text: `${languageHint}\n\n${body.text}`,
  });
  const systemPrompt = buildProvIngesterSystemPrompt(language);

  try {
    const { parsed, result } = await generateProvBlocksWithRetry({
      modelConfig,
      systemPrompt,
      userMessage,
      feature: "prov.from-pdf",
    });

    if (parsed.blocks.length === 0) {
      return c.json(provStructureFailedBody(), 502);
    }

    return c.json({
      title: parsed.title || titleForPrompt,
      blocks: parsed.blocks,
      sourceTitle: titleForPrompt,
      sourceFetchedAt: new Date().toISOString(),
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("PROV ingest-pdf error:", err);
    // runAgentLoop 由来の CodedError（認証エラー等）は code を JSON に通す
    return c.json(errorBody(err), 500);
  }
});

export default app;
