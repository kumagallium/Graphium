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
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildProvIngesterSystemPrompt,
  buildProvIngesterUserMessage,
  parseProvIngesterOutput,
  type ProvIngesterOutput,
} from "../services/prov-ingester.js";
import {
  buildMaterialScienceSystemPrompt,
  buildMaterialScienceUserMessage,
  parseMatProvOutput,
  matProvToProvIngester,
  type MatProvOutput,
  type ProvProfile,
} from "../services/prov-ingester-profiles/index.js";
import { fetchPageAsText, type FetchPageError } from "../services/url-fetcher.js";

const app = new Hono();

const SUPPORTED_PROFILES: ProvProfile[] = ["material-science"];

function isProfile(v: unknown): v is ProvProfile {
  return typeof v === "string" && (SUPPORTED_PROFILES as string[]).includes(v);
}

/**
 * material-science profile の LLM 出力をパース → MatPROV procedures に正規化し、
 * 同時に Graphium ProvIngesterOutput の配列に翻訳して返す。
 */
function processMatProvResponse(raw: string): {
  procedures: MatProvOutput;
  procedureOutputs: ProvIngesterOutput[];
} {
  const procedures = parseMatProvOutput(raw);
  const procedureOutputs = procedures.map((p) => matProvToProvIngester(p));
  return { procedures, procedureOutputs };
}

// URL から PROV 構造化ブロックを生成
app.post("/ingest-url", async (c) => {
  const body = await c.req.json<{
    url: string;
    language?: string;
    model?: string;
    /**
     * Phase 5a: ドメインプロファイル指定。`material-science` を指定すると
     * MatPROV 形式 prompt を使い、複数 procedure を返す形に切り替わる。
     * 未指定なら従来の汎用 prov-ingester prompt。
     */
    profile?: string;
  }>();

  if (!body.url) {
    return c.json({ error: "url は必須です" }, 400);
  }

  if (body.profile && !isProfile(body.profile)) {
    return c.json({ error: `unsupported profile: ${body.profile}` }, 400);
  }

  // モデル解決: ヘッダー → body.model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
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
    const message = err instanceof Error ? err.message : "不明なエラー";
    return c.json({ error: message }, 500);
  }

  if (!page.text || page.text.length < 50) {
    return c.json(
      { error: "ページから十分なテキストを取得できませんでした。" },
      400,
    );
  }

  const language = body.language || "en";
  const useMaterialScience = body.profile === "material-science";

  // LLM 呼び出し（profile に応じて prompt を切り替える）
  const systemPrompt = useMaterialScience
    ? buildMaterialScienceSystemPrompt(language)
    : buildProvIngesterSystemPrompt(language);
  const userMessage = useMaterialScience
    ? buildMaterialScienceUserMessage({
        url: page.url,
        title: page.title || body.url,
        description: page.description,
        text: page.text,
      })
    : buildProvIngesterUserMessage({
        url: page.url,
        title: page.title || body.url,
        description: page.description,
        text: page.text,
      });

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
    });

    if (useMaterialScience) {
      const { procedures, procedureOutputs } = processMatProvResponse(result.message);
      if (procedures.length === 0) {
        return c.json(
          { error: "LLM が有効な MatPROV 構造を生成できませんでした。" },
          502,
        );
      }
      return c.json({
        profile: "material-science" as const,
        procedures: procedureOutputs,
        matprov: procedures,
        paperTitle: page.title || body.url,
        sourceUrl: page.url,
        sourceTitle: page.title,
        sourceFetchedAt: page.fetchedAt,
        tokenUsage: result.tokenUsage,
        model: result.model,
      });
    }

    const parsed: ProvIngesterOutput = parseProvIngesterOutput(result.message);

    if (parsed.blocks.length === 0) {
      return c.json(
        { error: "LLM が有効な PROV 構造を生成できませんでした。" },
        502,
      );
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
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("PROV ingest-url error:", err);
    return c.json({ error: message }, 500);
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
    /** Phase 5a: material-science など。未指定なら従来の generic prompt */
    profile?: string;
  }>();

  if (!body.text || body.text.trim().length < 50) {
    return c.json(
      { error: "PDF から十分なテキストを取得できませんでした。" },
      400,
    );
  }

  if (body.profile && !isProfile(body.profile)) {
    return c.json({ error: `unsupported profile: ${body.profile}` }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
  }

  // 抽出テキスト冒頭に出力言語ヒントを再掲する。長文中で system 末尾の指示が
  // 軽視されるケースに備えた近接リマインダ（wiki ingester の PDF 経路と同方針）。
  const language = body.language || "en";
  const languageHint =
    language === "ja"
      ? "[出力言語: 日本語で書いてください。タイトルも本文もすべて日本語にしてください]"
      : `[Output language: ${language}]`;
  const titleForPrompt = body.title?.trim() || "(untitled PDF)";
  const useMaterialScience = body.profile === "material-science";

  const userMessage = useMaterialScience
    ? buildMaterialScienceUserMessage({
        url: `pdf://${titleForPrompt}`,
        title: titleForPrompt,
        description: undefined,
        text: `${languageHint}\n\n${body.text}`,
      })
    : buildProvIngesterUserMessage({
        url: `pdf://${titleForPrompt}`,
        title: titleForPrompt,
        description: undefined,
        text: `${languageHint}\n\n${body.text}`,
      });
  const systemPrompt = useMaterialScience
    ? buildMaterialScienceSystemPrompt(language)
    : buildProvIngesterSystemPrompt(language);

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
    });

    if (useMaterialScience) {
      const { procedures, procedureOutputs } = processMatProvResponse(result.message);
      if (procedures.length === 0) {
        return c.json(
          { error: "LLM が有効な MatPROV 構造を生成できませんでした。" },
          502,
        );
      }
      return c.json({
        profile: "material-science" as const,
        procedures: procedureOutputs,
        matprov: procedures,
        paperTitle: titleForPrompt,
        sourceTitle: titleForPrompt,
        sourceFetchedAt: new Date().toISOString(),
        tokenUsage: result.tokenUsage,
        model: result.model,
      });
    }

    const parsed: ProvIngesterOutput = parseProvIngesterOutput(result.message);

    if (parsed.blocks.length === 0) {
      return c.json(
        { error: "LLM が有効な PROV 構造を生成できませんでした。" },
        502,
      );
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
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("PROV ingest-pdf error:", err);
    return c.json({ error: message }, 500);
  }
});

export default app;
