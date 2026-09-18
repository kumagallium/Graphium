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
  buildAtomizerSystemPrompt,
  buildAtomizerUserMessage,
  parseAtomizerOutput,
  detectRung1Tokens,
  buildReliftSystemPrompt,
  buildReliftUserMessage,
  parseReliftOutput,
  buildTransferJudgeSystemPrompt,
  buildTransferJudgeUserMessage,
  parseTransferJudgeOutput,
  buildFoldJudgeSystemPrompt,
  buildFoldJudgeUserMessage,
  parseFoldJudgeOutput,
  resolveFoldVerdict,
  buildAtomDuplicateJudgeSystemPrompt,
  buildAtomDuplicateJudgeUserMessage,
  parseAtomDuplicateJudgeOutput,
  type AtomDuplicateJudgePair,
} from "../services/wiki-atomizer.js";
import {
  buildRewriterSystemPrompt,
  buildRewriterUserMessage,
  parseRewriterOutput,
  type RewriteSection,
} from "../services/wiki-rewriter.js";
import {
  buildTopicConsolidatorSystemPrompt,
  buildTopicConsolidatorUserMessage,
  parseTopicConsolidatorOutput,
  type TopicConsolidatorExistingRef,
  buildTopicRouterSystemPrompt,
  buildTopicRouterUserMessage,
  parseTopicRouterOutput,
  type TopicRouterSource,
  type TopicRouterExistingRef,
  buildSourceTopicReviserSystemPrompt,
  buildSourceTopicReviserUserMessage,
  parseSourceTopicReviserOutput,
  buildTopicMergerSystemPrompt,
  buildTopicMergerUserMessage,
  parseTopicMergerOutput,
  buildSourceSurveySystemPrompt,
  buildSourceSurveyUserMessage,
  parseSourceSurveyOutput,
} from "../services/wiki-topic-writer.js";
import { generateEmbeddings } from "../services/embedding.js";
import { fetchPageAsText, type FetchPageError } from "../services/url-fetcher.js";
import type { ClaimSnapshot } from "../services/wiki-types.js";
import { noModelRegisteredBody, errorBody } from "../../lib/ai-error-codes.js";
import {
  buildSourceCheckSystemPrompt,
  buildSourceCheckUserMessage,
  parseSourceCheckOutput,
  applyQuoteVerification,
  type SourceCheckClaimInput,
  type SourceCheckSourceInput,
} from "../services/source-check.js";
import { buildKnowledgeSchemaPromptSection } from "../../features/skill/skill-service.js";

const app = new Hono();

function requiredTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
    knowledgeSchema?: string;
  }>();

  if (!body.noteContent) {
    return c.json({ error: "noteContent is required" }, 400);
  }
  const knowledgeSchema = requiredTrimmedString(body.knowledgeSchema);
  if (!knowledgeSchema) {
    return c.json({ error: "knowledgeSchema is required" }, 400);
  }

  // モデル解決: ヘッダー → body.model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  // 取り込んだ外部文書（PDF / Word / URL / チャット）は noteId に prefix が付く
  // （pdf: / document: / url: / chat:、external-source.ts の規約）。これらは複数の
  // 転用可能な知見を持つので ingester を「文書モード」に切り替え、過少抽出を防ぐ。
  const isDocument = /^(pdf|document|url|chat):/.test(body.noteId ?? "");
  // メモ（memo: prefix）は逆に「1 断片 ≈ 1 着想」の走り書き。通常ノートの保守的な
  // Claim 基準だと引用・エピソード型の断片が Claim 0 件に倒れやすいため、
  // 「短くても着想 1 件の抽出を試みる」memo モードに切り替える。
  const isMemo = /^memo:/.test(body.noteId ?? "");

  let systemPrompt = buildIngesterSystemPrompt(
    body.language || "en",
    body.existingWikiTitles || [],
    body.skills,
    { isDocument, isMemo },
  );
  systemPrompt += buildKnowledgeSchemaPromptSection(knowledgeSchema);

  // PROV 構造があれば user message の先頭にコンパクトに添える。
  // 中身が空（activities も results も plan も無い）なら添えても情報がないので省略。
  const provBlock = formatProvSummaryForPrompt(body.provSummary);
  const provPrefix = provBlock ? `${provBlock}\n\n` : "";

  const userMessage = `${provPrefix}Source note title: "${body.noteTitle}"\nUse this exact title for inline citations (e.g., "Based on [${body.noteTitle}], ...").\n\n# ${body.noteTitle}\n\n${body.noteContent}`;

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.ingest",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const wikis = parseIngesterOutput(result.message);

    return c.json({
      wikis,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki ingest error:", err);
    // runAgentLoop 由来の CodedError（認証エラー等）は code を JSON に通す
    return c.json(errorBody(err), 500);
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
    return c.json({ error: "texts is required" }, 400);
  }

  // Embedding 用モデルを解決: ヘッダー → embedding_model → model → デフォルト
  const modelConfig = resolveModelConfig(c, { modelName: body.embedding_model || body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
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
    console.error("Wiki embed error:", err);
    // generateEmbeddings 由来の CodedError（EMBEDDING_MODEL_UNSUPPORTED 等）は code を JSON に通す
    return c.json(errorBody(err), 500);
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
    return c.json({ error: "wikis is required" }, 400);
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
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.lint",
      modelConfig,
      abortSignal: c.req.raw.signal,
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
    console.error("Wiki lint error:", err);
    // LLM 失敗時はローカル結果のみ返す（degrade）。lintError に英語メッセージを添える。
    const report: LintReport = {
      issues: localIssues,
      summary: buildSummary(localIssues),
      analyzedAt: new Date().toISOString(),
    };
    return c.json({ ...report, lintError: errorBody(err).error });
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
    missingSource: issues.filter((i) => i.type === "missing-source").length,
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
    knowledgeSchema?: string;
  }>();

  if (!body.existingSections || !body.newSections) {
    return c.json({ error: "existingSections and newSections are required" }, 400);
  }
  const knowledgeSchema = requiredTrimmedString(body.knowledgeSchema);
  if (!knowledgeSchema) {
    return c.json({ error: "knowledgeSchema is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  let systemPrompt = buildRewriterSystemPrompt(body.language || "en", body.skills);
  systemPrompt += buildKnowledgeSchemaPromptSection(knowledgeSchema);
  const userMessage = buildRewriterUserMessage({
    existingSections: body.existingSections,
    newSections: body.newSections,
    editedSectionHeadings: body.editedSectionHeadings || [],
  });

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.rewrite",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const rewritten = parseRewriterOutput(result.message);

    return c.json({
      sections: rewritten.sections,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki rewrite error:", err);
    return c.json(errorBody(err), 500);
  }
});

// 話題（topic）名の統合（名寄せの後段）。
//   資料ごとの振り分け（Topic Router）は資料 1 本ずつしか見ないため全体を見渡せず、
//   表記ゆれ・助詞の有無・語順違い・粒度違いの近縁話題が別々に残る
//   （実測: 34 話題の大半がメンバー 1 件）。このエンドポイントは既存話題タイトルを
//   まとめて 1 回渡し、「どの話題をどの正式名に寄せるか」の対応表だけを返す。本文は書かない・
//   話題ページの統合は呼び出し側（topic-stage / note-app）が対応表を見て行う。
app.post("/consolidate-topics", async (c) => {
  const body = await c.req.json<{
    language: string;
    existingTopics: TopicConsolidatorExistingRef[];
    proposedTitles: string[];
    model?: string;
    knowledgeSchema?: string;
  }>();

  if (!Array.isArray(body.proposedTitles) || body.proposedTitles.length === 0) {
    return c.json({ error: "proposedTitles are required" }, 400);
  }
  const knowledgeSchema = requiredTrimmedString(body.knowledgeSchema);
  if (!knowledgeSchema) {
    return c.json({ error: "knowledgeSchema is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  let systemPrompt = buildTopicConsolidatorSystemPrompt(body.language || "en");
  systemPrompt += buildKnowledgeSchemaPromptSection(knowledgeSchema);
  const userMessage = buildTopicConsolidatorUserMessage(body.existingTopics ?? [], body.proposedTitles);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.consolidate-topics",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const parsed = parseTopicConsolidatorOutput(result.message);
    if (!parsed) {
      // 壊れた JSON: 統合は最適化であって必須ではないので、空の mapping で 200 を返す
      // （呼び出し側は「統合なし」で続行できる）。
      console.warn("Wiki consolidate-topics: パース失敗のため空の mapping を返します");
      return c.json({ mapping: {}, tokenUsage: result.tokenUsage, model: result.model });
    }

    return c.json({
      mapping: parsed,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki consolidate-topics error:", err);
    return c.json(errorBody(err), 500);
  }
});

// 新形式トピックの振り分け（資料 1 本 → 改訂する既存トピック / 新規に作るトピック名）。
//   埋め込み類似度・正規化タイトル一致による機械的な名寄せは撤去し、資料全文と既存トピックの
//   index を LLM に渡して自分で判断させる。件数の上限・しきい値は置かない。
app.post("/route-topics", async (c) => {
  const body = await c.req.json<{
    language: string;
    source: TopicRouterSource;
    existingTopics: TopicRouterExistingRef[];
    model?: string;
    knowledgeSchema?: string;
  }>();

  if (!body.source || typeof body.source.text !== "string" || !body.source.text.trim()) {
    return c.json({ error: "source is required" }, 400);
  }
  const knowledgeSchema = requiredTrimmedString(body.knowledgeSchema);
  if (!knowledgeSchema) {
    return c.json({ error: "knowledgeSchema is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  let systemPrompt = buildTopicRouterSystemPrompt(body.language || "en");
  systemPrompt += buildKnowledgeSchemaPromptSection(knowledgeSchema);
  const userMessage = buildTopicRouterUserMessage(body.source, body.existingTopics ?? []);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.route-topics",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const parsed = parseTopicRouterOutput(result.message);
    if (!parsed) {
      return c.json({ error: "Failed to parse topic router output" }, 500);
    }

    return c.json({
      update: parsed.update,
      create: parsed.create,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki route-topics error:", err);
    return c.json(errorBody(err), 500);
  }
});

// 新形式トピックの改訂（前の本文 + 資料 1 本 → 次の版の本文）。
//   前の本文は member claims からではなく、そのトピック自身の wikiMeta.topicMarkdown を
//   呼び出し側が渡す。新規作成時は currentBody を空文字列で渡す。
app.post("/revise-topic", async (c) => {
  const body = await c.req.json<{
    title: string;
    language: string;
    currentBody: string;
    source: { id: string; title: string; text: string };
    model?: string;
    /** この資料が以前の版から既に [[source:<id>]] で引用済みか（再取り込み時の見直し指示に使う） */
    previouslyCited?: boolean;
    /** このページが回答ページ（answer）か。true のとき「問いに答え続ける」規則を追加する */
    isAnswer?: boolean;
    knowledgeSchema?: string;
  }>();

  if (!body.title || !body.source || typeof body.source.text !== "string" || !body.source.text.trim()) {
    return c.json({ error: "title and source are required" }, 400);
  }
  const knowledgeSchema = requiredTrimmedString(body.knowledgeSchema);
  if (!knowledgeSchema) {
    return c.json({ error: "knowledgeSchema is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  let systemPrompt = buildSourceTopicReviserSystemPrompt(body.language || "en", body.isAnswer);
  systemPrompt += buildKnowledgeSchemaPromptSection(knowledgeSchema);
  const userMessage = buildSourceTopicReviserUserMessage(body.title, body.currentBody || "", body.source, body.previouslyCited);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.revise-topic",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const parsed = parseSourceTopicReviserOutput(result.message);
    if (!parsed) {
      return c.json({ error: "Failed to parse source topic reviser output" }, 500);
    }

    return c.json({
      body: parsed.body,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki revise-topic error:", err);
    return c.json(errorBody(err), 500);
  }
});

// 資料の見取り図を作る（窓分割で読むとき、資料冒頭の窓 1 枚だけから 1 回だけ生成する）。
//   /revise-topic と同じ作り。maxSteps 1・モデル未登録は同じ degrade。
app.post("/survey-source", async (c) => {
  const body = await c.req.json<{
    title: string;
    text: string;
    language?: string;
    model?: string;
  }>();

  if (!body.title || typeof body.text !== "string" || !body.text.trim()) {
    return c.json({ error: "title and text are required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  const systemPrompt = buildSourceSurveySystemPrompt(body.language || "en");
  const userMessage = buildSourceSurveyUserMessage(body.title, body.text);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.survey-source",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const parsed = parseSourceSurveyOutput(result.message);
    if (!parsed) {
      return c.json({ error: "Failed to parse source survey output" }, 500);
    }

    return c.json({
      survey: parsed.survey,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki survey-source error:", err);
    return c.json(errorBody(err), 500);
  }
});

// 新形式トピックどうしの本文統合（話題の統合を「本文の統合」に置き換える）。
//   知見（claim）を経由せず、統合対象の本文（すでに [[source:<id>]] 引用済み）を
//   そのまま 2 本以上渡し、1 本の本文にまとめさせる。
app.post("/merge-topics", async (c) => {
  const body = await c.req.json<{
    title: string;
    language: string;
    bodies: string[];
    model?: string;
    knowledgeSchema?: string;
  }>();

  if (!body.title || !Array.isArray(body.bodies) || body.bodies.length < 2) {
    return c.json({ error: "title and at least 2 bodies are required" }, 400);
  }
  const knowledgeSchema = requiredTrimmedString(body.knowledgeSchema);
  if (!knowledgeSchema) {
    return c.json({ error: "knowledgeSchema is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });

  if (!modelConfig) {
    return c.json(noModelRegisteredBody(), 400);
  }

  let systemPrompt = buildTopicMergerSystemPrompt(body.language || "en");
  systemPrompt += buildKnowledgeSchemaPromptSection(knowledgeSchema);
  const userMessage = buildTopicMergerUserMessage(body.title, body.bodies);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.merge-topics",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });

    const parsed = parseTopicMergerOutput(result.message);
    if (!parsed) {
      return c.json({ error: "Failed to parse topic merger output" }, 500);
    }

    return c.json({
      body: parsed.body,
      tokenUsage: result.tokenUsage,
      model: result.model,
    });
  } catch (err) {
    console.error("Wiki merge-topics error:", err);
    return c.json(errorBody(err), 500);
  }
});

// Atomize（複数 Concept にまたがる共通抽象を発見する discovery）
//   experimental.atomLayer 有効時にクライアントから呼ばれる。
//   Concept[] を入力し、可搬性テストを通った Atom 候補 0〜N 件を返す（1 件の Concept からでも可）。
//   既存 Atom のタイトル一覧を渡すと重複提案を抑える。
app.post("/atomize", async (c) => {
  const body = await c.req.json<{
    concepts: ClaimSnapshot[];
    existingAtomTitles?: string[];
    language: string;
    model?: string;
  }>();

  // 1 件の Concept からでも可搬な規則なら Atom 化する（2 件必須は撤廃）。
  if (!body.concepts || body.concepts.length < 1) {
    return c.json({ atoms: [] });
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) return c.json({ atoms: [] });

  const systemPrompt = buildAtomizerSystemPrompt(body.language || "en");
  const userMessage = buildAtomizerUserMessage(body.concepts, body.existingAtomTitles ?? []);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.atomize",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });
    const idToTitle = new Map<string, string>(body.concepts.map((c) => [c.id, c.title]));
    // フォール検証ジャッジ用: id → ClaimSnapshot（title + bodyPreview を判定に渡す）。
    const idToSnapshot = new Map<string, ClaimSnapshot>(body.concepts.map((c) => [c.id, c]));
    // Phase η: source Claim の epistemicStatus も parser に渡し、lowest-status inheritance を強制する。
    const idToEpistemic = new Map(
      body.concepts.map((c) => [c.id, c.epistemicStatus]),
    );
    // Phase γ: source Claim の rebuttalConditions を parser に渡し、共通 rebuttal 伝播ガードを強制する
    // （2+ Claim が rebuttal を持つ場合のみ Atom に propagate）。
    const idToRebuttals = new Map(
      body.concepts.map((c) => [c.id, c.rebuttalConditions]),
    );
    let atoms = parseAtomizerOutput(result.message, idToTitle, idToEpistemic, idToRebuttals);
    // PR-B4.5: procedureContext は Atom に持たせない（砂時計のくびれ）。
    // fallback ロジックは削除した。

    // 越境転移の敵対的ジャッジ: atomizer が出した transfer 候補（別分野の類推）の構造一致を
    // 厳格に判定し、こじつけ（valid=false）の transfer は外す。principle(洞察) 自体は常に残す。
    // 検証では opus で 88-96%、弱モデル生成でも transfer の劣化をここで吸収できる。
    const withTransfer: { i: number; field: string; example: string }[] = [];
    atoms.forEach((a, i) => {
      if (a.transfer) withTransfer.push({ i, field: a.transfer.field, example: a.transfer.example });
    });
    if (withTransfer.length > 0) {
      try {
        const judgeRes = await runAgentLoop({
          model,
          modelId: modelConfig.modelId,
          systemPrompt: buildTransferJudgeSystemPrompt(body.language || "en"),
          messages: [
            {
              role: "user" as const,
              content: buildTransferJudgeUserMessage(
                withTransfer.map((w) => ({
                  title: atoms[w.i].title,
                  shape: atoms[w.i].shape,
                  field: w.field,
                  example: w.example,
                })),
              ),
            },
          ],
          maxSteps: 1,
          feature: "wiki.transfer-judge",
          modelConfig,
          abortSignal: c.req.raw.signal,
        });
        const verdicts = parseTransferJudgeOutput(judgeRes.message);
        atoms = atoms.map((a) => ({ ...a }));
        withTransfer.forEach((w, k) => {
          const v = verdicts.find((r) => r.index === k + 1) ?? verdicts[k];
          // 妥当と確認できないものは外す（判定が取れない場合も保守的に外す）。
          if (!v || !v.valid) atoms[w.i] = { ...atoms[w.i], transfer: undefined };
        });
      } catch (err) {
        // ジャッジ失敗時は保守的に全 transfer を外す（こじつけを残すより安全）。
        console.error("Wiki transfer-judge error:", err);
        atoms = atoms.map((a) => (a.transfer ? { ...a, transfer: undefined } : a));
      }
    }

    // ── フォール検証（co-structure）の敵対的ジャッジ ──────────────────────────
    // derivedFromClaims が 2+ の Atom（= N 個の Claim を「同じ shape を共有する」と束ねた
    // フォール）だけを対象に、本当に同じ shape・role 構造を instantiate している Claim の
    // 部分集合を懐疑的に選び直す。confirm された subset に derivedFromClaims を絞り込み、
    // 落とした Claim 数を foldDroppedClaims に記録する（洞察=principle 自体は常に残す。
    // transfer judge と同じ「原理は残し、行き過ぎだけ削る」哲学）。
    // ジャッジ失敗時は fail-open で Atom をそのまま返す（検証できないフォールを黙って
    // 削るより、atomizer の誠実な当て推量を残すほうが安全。transfer judge が fail-closed
    // なのと意図的に逆）。relift の前に走らせ、元の atomizer 文言に対して fold を検証する。
    const withFold: { i: number; ids: string[] }[] = [];
    atoms.forEach((a, i) => {
      if (a.derivedFromClaims.length >= 2) withFold.push({ i, ids: [...a.derivedFromClaims] });
    });
    if (withFold.length > 0) {
      try {
        const foldRes = await runAgentLoop({
          model,
          modelId: modelConfig.modelId,
          systemPrompt: buildFoldJudgeSystemPrompt(body.language || "en"),
          messages: [
            {
              role: "user" as const,
              content: buildFoldJudgeUserMessage(
                withFold.map((w) => ({
                  title: atoms[w.i].title,
                  shape: atoms[w.i].shape,
                  claims: w.ids.map((id, pos) => {
                    const snap = idToSnapshot.get(id);
                    return {
                      id,
                      title: snap?.title ?? atoms[w.i].derivedFromConceptTitles[pos] ?? id,
                      preview: snap?.bodyPreview ?? "",
                    };
                  }),
                })),
              ),
            },
          ],
          maxSteps: 1,
          feature: "wiki.fold-judge",
          modelConfig,
          abortSignal: c.req.raw.signal,
        });
        const verdicts = parseFoldJudgeOutput(foldRes.message);
        atoms = atoms.map((a) => ({ ...a }));
        withFold.forEach((w, k) => {
          const v = verdicts.find((r) => r.index === k + 1) ?? verdicts[k];
          // 判定が取れない Atom は fail-open で as-is（何も削らない）。
          if (!v) return;
          const { confirmed, dropped, changed } = resolveFoldVerdict(w.ids, v.coherentClaimIds);
          if (!changed) return;
          const atom = atoms[w.i];
          // derivedFromConceptTitles を id と同じ並びで作り直す（位置対応の維持は必須。
          // グラフ描画 / @リンク解決 / regenerate がこの 2 配列を zip して読む）。
          const titles = confirmed.map((id) => {
            const idx = atom.derivedFromClaims.indexOf(id);
            return idx >= 0
              ? atom.derivedFromConceptTitles[idx]
              : (idToSnapshot.get(id)?.title ?? id);
          });
          atoms[w.i] = {
            ...atom,
            derivedFromClaims: confirmed,
            derivedFromConceptTitles: titles,
            foldDroppedClaims: dropped > 0 ? dropped : undefined,
          };
        });
      } catch (err) {
        // fail-open: ジャッジ失敗時は Atom をそのまま返す（検証できないフォールを黙って
        // 削るより、atomizer の誠実な当て推量を残すほうが安全）。
        console.error("Wiki fold-judge error:", err);
      }
    }

    // パイプライン C+D（平易化 / readability）— 分野非依存。
    //   pass 1: D を「全 Atom」に 1 回かける。LLM が任意分野のジャーゴンを判断して自然な
    //           文に整える（regex の検出範囲＝化学式/略語 に依存しない。生物/経済/人文も可）。
    //   pass 2: C（detectRung1Tokens, コード）で式/略語の取りこぼしを検出し、残っていれば
    //           該当 Atom だけ D を再適用（安いダブルチェック）。
    // silent drop はしない。relift が失敗しても B の Atom はそのまま返す。
    const runRelift = async (targets: { i: number; jargon: string[] }[]) => {
      if (targets.length === 0) return;
      const reliftRes = await runAgentLoop({
        model,
        modelId: modelConfig.modelId,
        systemPrompt: buildReliftSystemPrompt(body.language || "en"),
        messages: [
          {
            role: "user" as const,
            content: buildReliftUserMessage(
              targets.map((t) => ({ title: atoms[t.i].title, body: atoms[t.i].body, jargon: t.jargon })),
            ),
          },
        ],
        maxSteps: 1,
        feature: "wiki.relift",
        modelConfig,
        abortSignal: c.req.raw.signal,
      });
      const rewrites = parseReliftOutput(reliftRes.message);
      atoms = atoms.map((a) => ({ ...a }));
      targets.forEach((t, k) => {
        const rw = rewrites.find((r) => r.index === k + 1) ?? rewrites[k];
        if (rw && rw.title && rw.body) {
          atoms[t.i] = { ...atoms[t.i], title: rw.title, body: rw.body };
        }
      });
    };
    try {
      // pass 1: 全 Atom（jargon 指定なし＝LLM が自分で判断・分野非依存）
      await runRelift(atoms.map((_, i) => ({ i, jargon: [] as string[] })));
      // pass 2: regex で式/略語の残りを検出 → 該当だけ再適用
      const residual = atoms
        .map((a, i) => ({ i, jargon: detectRung1Tokens(a.title, a.body) }))
        .filter((x) => x.jargon.length > 0);
      await runRelift(residual);
    } catch (err) {
      // relift 失敗時も B の Atom を消さずそのまま返す。
      console.error("Wiki relift error:", err);
    }

    return c.json({ atoms, model: result.model, tokenUsage: result.tokenUsage });
  } catch (err) {
    console.error("Wiki atomize error:", err);
    // degrade（200 + 空 atoms）だが code は添えておく（クライアントで i18n 変換される）
    return c.json({ atoms: [], ...errorBody(err) });
  }
});

// 洞察（Atom）discovery の重複候補を LLM で判定する。
// embedding（partitionCandidatesByEmbedding）は「候補探し」止まり — 同じ/矛盾/別物の
// 最終判定はここで行う（越境転移(transfer)判定と同じ流儀）。
app.post("/judge-atom-duplicates", async (c) => {
  const body = await c.req.json<{
    language: string;
    pairs: AtomDuplicateJudgePair[];
    model?: string;
  }>();

  if (!Array.isArray(body.pairs) || body.pairs.length === 0) {
    return c.json({ verdicts: [] });
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    // fail-closed: モデル未設定でも「different」に倒す（route を呼ぶ側が埋める）
    return c.json({ verdicts: [] });
  }

  const systemPrompt = buildAtomDuplicateJudgeSystemPrompt(body.language || "en");
  const userMessage = buildAtomDuplicateJudgeUserMessage(body.pairs);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.judge-atom-duplicates",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });
    const verdicts = parseAtomDuplicateJudgeOutput(result.message);
    return c.json({ verdicts, model: result.model, tokenUsage: result.tokenUsage });
  } catch (err) {
    console.error("Wiki judge-atom-duplicates error:", err);
    // fail-closed（黙って統合しない側に倒す）: 呼び出し側が verdicts 欠落を "different" として扱う
    return c.json({ verdicts: [], ...errorBody(err) });
  }
});

// 出典照合（Source check, v1）— 出典 1 件 + それに依拠する知見群をまとめて判定する。
// 世界照合（/api/world-grounding/check）とは別レーン。1 呼び出し = 出典 1 件。
app.post("/check-sources", async (c) => {
  const body = await c.req.json<{
    source: SourceCheckSourceInput;
    claims: SourceCheckClaimInput[];
    language?: string;
    model?: string;
  }>();

  if (!body.source || typeof body.source.text !== "string" || !body.source.text.trim()) {
    return c.json({ result: null, error: "source.text is required" }, 400);
  }
  if (!Array.isArray(body.claims) || body.claims.length === 0) {
    return c.json({ result: null, error: "claims is required" }, 400);
  }

  const modelConfig = resolveModelConfig(c, { modelName: body.model });
  if (!modelConfig) {
    // モデル未登録 → degrade（world-grounding の /check と同じ流儀）。エラーにはしない。
    return c.json({ result: null, error: "no model registered", code: "NO_MODEL_REGISTERED" });
  }

  const language = body.language || "en";
  const systemPrompt = buildSourceCheckSystemPrompt(language);
  const userMessage = buildSourceCheckUserMessage(body.source, body.claims);

  try {
    const model = await createModel(modelConfig);
    const result = await runAgentLoop({
      model,
      modelId: modelConfig.modelId,
      systemPrompt,
      messages: [{ role: "user" as const, content: userMessage }],
      maxSteps: 1,
      feature: "wiki.check-sources",
      modelConfig,
      abortSignal: c.req.raw.signal,
    });
    const parsed = parseSourceCheckOutput(result.message, body.claims, language);
    // 不変条件 3: quote は原文に実在すると照合できたものだけ残す（サーバー側で照合）。
    const verified = applyQuoteVerification(parsed, body.source.text, language);
    return c.json({
      result: { results: verified, model: result.model },
      tokenUsage: result.tokenUsage,
    });
  } catch (err) {
    console.error("Wiki check-sources error:", err);
    // LLM 呼び出し失敗 → degrade（world-grounding と同じ精神）
    return c.json({ result: null, ...errorBody(err) });
  }
});

// URL からテキストコンテンツを取得（CORS 回避用サーバーサイドプロキシ）
app.post("/fetch-url", async (c) => {
  const body = await c.req.json<{ url: string }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
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
    return c.json(errorBody(err), 500);
  }
});

export default app;
