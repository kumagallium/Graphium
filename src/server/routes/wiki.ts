// Wiki API ルート
// POST /api/wiki/ingest — ノートから Wiki ドキュメントを生成
// POST /api/wiki/embed — テキストの embedding を生成

import { Hono } from "hono";
import { createModel } from "../services/llm.js";
import { resolveModelConfig } from "../services/header-model.js";
import { runAgentLoop } from "../services/agent-loop.js";
import {
  buildIngesterSystemPrompt,
  parseIngesterOutput,
  type ExistingWikiInfo,
} from "../services/wiki-ingester.js";
import { formatProvSummaryForPrompt } from "../services/prov-prompt-injection.js";
import {
  buildLinterSystemPrompt,
  buildLinterUserMessage,
  parseLinterOutput,
  detectLocalIssues,
  type WikiSnapshot,
  type LintReport,
  type LintIssue,
} from "../services/wiki-linter.js";
import {
  buildCrossUpdateSystemPrompt,
  buildCrossUpdateUserMessage,
  parseCrossUpdateOutput,
  type ExistingWikiDetail,
} from "../services/wiki-cross-updater.js";
import {
  buildAtomizerSystemPrompt,
  buildAtomizerUserMessage,
  parseAtomizerOutput,
} from "../services/wiki-atomizer.js";
import {
  buildRewriterSystemPrompt,
  buildRewriterUserMessage,
  parseRewriterOutput,
  type RewriteSection,
} from "../services/wiki-rewriter.js";
import { generateEmbeddings } from "../services/embedding.js";
import { fetchPageAsText, type FetchPageError } from "../services/url-fetcher.js";
import type { ClaimSnapshot } from "../services/wiki-types.js";

const app = new Hono();

// ノートから Wiki を生成
app.post("/ingest", async (c) => {
  const body = await c.req.json<{
    noteId: string;
    noteContent: string;
    noteTitle: string;
    existingWikiTitles: ExistingWikiInfo[];
    language: string;
    /**
     * 提案 v4 Phase 2.2: ノートから抽出した PROV 構造サマリ（任意）。
     * クライアントが summarizeNoteProv() で生成して送る。手順条件付きの
     * 知識抽出（procedureContext）を促すためにプロンプトへ注入する。
     */
    provSummary?: unknown;
    model?: string;
    skills?: { title: string; prompt: string }[];
  }>();

  if (!body.noteContent) {
    return c.json({ error: "noteContent は必須です" }, 400);
  }

  // モデル解決: ヘッダー → body.model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。Settings → AI Setup からモデルを追加してください。" },
      400,
    );
  }

  const systemPrompt = buildIngesterSystemPrompt(
    body.language || "en",
    body.existingWikiTitles || [],
    body.skills,
  );

  // PROV 構造があれば user message の先頭にコンパクトに添える。
  // 中身が空（activities も results も plan も無い）なら添えても情報がないので省略。
  const provBlock = formatProvSummaryForPrompt(body.provSummary);
  const provPrefix = provBlock ? `${provBlock}\n\n` : "";

  const userMessage = `${provPrefix}Source note title: "${body.noteTitle}"\nUse this exact title for inline citations (e.g., "Based on [${body.noteTitle}], ...").\n\n# ${body.noteTitle}\n\n${body.noteContent}`;

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.ingest",
      modelConfig,
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

  // Embedding 用モデルを解決: ヘッダー → embedding_model → model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.embedding_model || body.model });

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

// Wiki の整合性チェック（Lint）
app.post("/lint", async (c) => {
  const body = await c.req.json<{
    wikis: WikiSnapshot[];
    language: string;
    model?: string;
    /** true: ローカル検出のみ（LLM 不使用）。デフォルト false */
    localOnly?: boolean;
  }>();

  if (!body.wikis || body.wikis.length === 0) {
    return c.json({ error: "wikis は必須です" }, 400);
  }

  // ローカル検出（LLM 不要）
  const localIssues = detectLocalIssues(body.wikis);

  if (body.localOnly) {
    const report: LintReport = {
      issues: localIssues,
      summary: buildSummary(localIssues),
      analyzedAt: new Date().toISOString(),
    };
    return c.json(report);
  }

  // LLM による深い分析
  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    // モデルなしの場合、ローカル結果のみ返す
    const report: LintReport = {
      issues: localIssues,
      summary: buildSummary(localIssues),
      analyzedAt: new Date().toISOString(),
    };
    return c.json(report);
  }

  const systemPrompt = buildLinterSystemPrompt(body.language || "en");
  const userMessage = buildLinterUserMessage(body.wikis);

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.lint",
      modelConfig,
    });

    const llmIssues = parseLinterOutput(result.message);

    // ローカル検出 + LLM 分析をマージ（重複排除）
    const allIssues = mergeIssues(localIssues, llmIssues);

    const report: LintReport = {
      issues: allIssues,
      summary: buildSummary(allIssues),
      analyzedAt: new Date().toISOString(),
    };

    return c.json({
      ...report,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Wiki lint error:", err);
    // LLM 失敗時はローカル結果のみ返す
    const report: LintReport = {
      issues: localIssues,
      summary: buildSummary(localIssues),
      analyzedAt: new Date().toISOString(),
    };
    return c.json({ ...report, lintError: message });
  }
});

function buildSummary(issues: { type: string }[]) {
  return {
    total: issues.length,
    contradictions: issues.filter((i) => i.type === "contradiction").length,
    orphans: issues.filter((i) => i.type === "orphan").length,
    gaps: issues.filter((i) => i.type === "gap").length,
    stale: issues.filter((i) => i.type === "stale").length,
    redundant: issues.filter((i) => i.type === "redundant").length,
  };
}

function mergeIssues(
  localIssues: LintIssue[],
  llmIssues: LintIssue[],
): LintIssue[] {
  const merged = [...localIssues];
  for (const llmIssue of llmIssues) {
    // ローカル検出と重複するタイプ+対象 Wiki の組み合わせはスキップ
    const isDuplicate = localIssues.some(
      (li) =>
        li.type === llmIssue.type &&
        li.affectedWikiIds.some((id) => llmIssue.affectedWikiIds.includes(id)),
    );
    if (!isDuplicate) merged.push(llmIssue);
  }
  return merged;
}

// Wiki ページの再構成（既存 + 新情報を統合してページ全体を書き直す）
app.post("/rewrite", async (c) => {
  const body = await c.req.json<{
    existingSections: RewriteSection[];
    newSections: RewriteSection[];
    editedSectionHeadings: string[];
    language: string;
    model?: string;
    skills?: { title: string; prompt: string }[];
  }>();

  if (!body.existingSections || !body.newSections) {
    return c.json({ error: "existingSections と newSections は必須です" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(
      { error: "モデルが登録されていません。" },
      400,
    );
  }

  const systemPrompt = buildRewriterSystemPrompt(body.language || "en", body.skills);
  const userMessage = buildRewriterUserMessage({
    existingSections: body.existingSections,
    newSections: body.newSections,
    editedSectionHeadings: body.editedSectionHeadings || [],
  });

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.rewrite",
      modelConfig,
    });

    const rewritten = parseRewriterOutput(result.message);

    return c.json({
      sections: rewritten.sections,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Wiki rewrite error:", err);
    return c.json({ error: message }, 500);
  }
});

// 横断更新（Ingest 後に既存 Wiki の更新提案を生成）
app.post("/cross-update", async (c) => {
  const body = await c.req.json<{
    newNoteTitle: string;
    newNoteContent: string;
    newWikiTitles: string[];
    existingWikis: ExistingWikiDetail[];
    language: string;
    model?: string;
    skills?: { title: string; prompt: string }[];
  }>();

  if (!body.existingWikis || body.existingWikis.length === 0) {
    return c.json({ proposals: [] });
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json({ proposals: [] });
  }

  const systemPrompt = buildCrossUpdateSystemPrompt(body.language || "en", body.skills);
  const userMessage = buildCrossUpdateUserMessage(
    body.newNoteTitle,
    body.newNoteContent,
    body.newWikiTitles,
    body.existingWikis,
  );

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.cross-update",
      modelConfig,
    });

    const proposals = parseCrossUpdateOutput(result.message);

    return c.json({
      proposals,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Wiki cross-update error:", err);
    return c.json({ proposals: [], error: message });
  }
});

// Atomize（複数 Concept にまたがる共通抽象を発見する discovery）
//   experimental.atomLayer 有効時にクライアントから呼ばれる。
//   Concept[] を入力し、2 件以上の Concept にまたがる Atom 候補 0〜N 件を返す。
//   既存 Atom のタイトル一覧を渡すと重複提案を抑える。
app.post("/atomize", async (c) => {
  const body = await c.req.json<{
    concepts: ClaimSnapshot[];
    existingAtomTitles?: string[];
    language: string;
    model?: string;
  }>();

  if (!body.concepts || body.concepts.length < 2) {
    return c.json({ atoms: [] });
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) return c.json({ atoms: [] });

  const systemPrompt = buildAtomizerSystemPrompt(body.language || "en");
  const userMessage = buildAtomizerUserMessage(body.concepts, body.existingAtomTitles ?? []);

  try {
    const model = createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.atomize",
      modelConfig,
    });
    const idToTitle = new Map<string, string>(body.concepts.map((c) => [c.id, c.title]));
    // Phase η: source Claim の epistemicStatus も parser に渡し、lowest-status inheritance を強制する。
    const idToEpistemic = new Map(
      body.concepts.map((c) => [c.id, c.epistemicStatus]),
    );
    // Phase γ: source Claim の rebuttalConditions を parser に渡し、共通 rebuttal 伝播ガードを強制する
    // （2+ Claim が rebuttal を持つ場合のみ Atom に propagate）。
    const idToRebuttals = new Map(
      body.concepts.map((c) => [c.id, c.rebuttalConditions]),
    );
    const atoms = parseAtomizerOutput(result.message, idToTitle, idToEpistemic, idToRebuttals);
    // PR-B4.5: procedureContext は Atom に持たせない（砂時計のくびれ）。
    // fallback ロジックは削除した。
    return c.json({ atoms, model: result.model, tokenUsage: result.tokenUsage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    console.error("Wiki atomize error:", err);
    return c.json({ atoms: [], error: message });
  }
});

// URL からテキストコンテンツを取得（CORS 回避用サーバーサイドプロキシ）
app.post("/fetch-url", async (c) => {
  const body = await c.req.json<{ url: string }>();

  if (!body.url) {
    return c.json({ error: "url は必須です" }, 400);
  }

  try {
    const page = await fetchPageAsText(body.url);
    return c.json({
      title: page.title,
      description: page.description,
      text: page.text,
      url: page.url,
    });
  } catch (err) {
    const e = err as FetchPageError;
    if (typeof e?.status === "number" && typeof e?.message === "string") {
      return c.json({ error: e.message }, e.status as 400 | 500);
    }
    const message = err instanceof Error ? err.message : "不明なエラー";
    return c.json({ error: message }, 500);
  }
});

export default app;
