// 知見の取り込み（ingest）と書き直し（rewrite）のプロンプト組み立て。
// /api/wiki/ingest・/api/wiki/rewrite のルートと、MCP の課題配布（claim-tools）の両方から使う純関数。
// 組み立てを 1 か所にして、アプリの経路と MCP の経路でプロンプトがずれないようにする。

import { buildKnowledgeSchemaPromptSection } from "../../features/skill/skill-service.js";
import { estimateTokens } from "../../lib/context-estimate.js";
import { buildExistingClaimIndex, INGEST_INPUT_BUDGET_TOKENS, type ExistingClaimIndex } from "./ingest-existing-index.js";
import { formatProvSummaryForPrompt } from "./prov-prompt-injection.js";
import { buildRewriterSystemPrompt, buildRewriterUserMessage, type RewriteSection } from "./wiki-rewriter.js";
import { buildIngesterSystemPrompt, type ExistingWikiInfo } from "./wiki-ingester.js";

export type IngestPromptInput = {
  noteId: string;
  noteTitle: string;
  noteContent: string;
  existingWikiTitles: ExistingWikiInfo[];
  language: string;
  /** ノートの PROV 構造サマリ（summarizeNoteProv の結果。無くてもよい） */
  provSummary?: unknown;
  skills?: { title: string; prompt: string }[];
  /** 保存済みのナレッジスキーマ（空でないこと。検査は呼び出し側） */
  knowledgeSchema: string;
  /**
   * 既存の知見の一覧に使ってよい目安トークンの上限（省略時は入力の予算の残り全部。アプリの経路はこれ）。
   * MCP の課題は会話に残って積み上がるので、小さい値を渡して関係の深い上位だけに絞る
   */
  existingBudgetTokens?: number;
};

export type IngestPrompt = {
  systemPrompt: string;
  userMessage: string;
  /** 予算で絞った既存の知見一覧。応答の番号（c12 など）を id に戻すのに parseIngesterOutput へ渡す */
  existingIndex: ExistingClaimIndex;
};

/** 知見抽出のシステムプロンプト・ユーザーメッセージ・既存の知見一覧を組む */
export function buildIngestPrompt(input: IngestPromptInput): IngestPrompt {
  // 取り込んだ外部文書（PDF / Word / URL / チャット）は noteId に prefix が付く
  // （pdf: / document: / url: / chat:、external-source.ts の規約）。これらは複数の
  // 転用可能な知見を持つので ingester を「文書モード」に切り替え、過少抽出を防ぐ。
  const isDocument = /^(pdf|document|url|chat):/.test(input.noteId ?? "");
  // メモ（memo: prefix）は逆に「1 断片 ≈ 1 着想」の走り書き。通常ノートの保守的な
  // Claim 基準だと引用・エピソード型の断片が Claim 0 件に倒れやすいため、
  // 「短くても着想 1 件の抽出を試みる」memo モードに切り替える。
  const isMemo = /^memo:/.test(input.noteId ?? "");

  // PROV 構造があれば user message の先頭にコンパクトに添える。
  // 中身が空（activities も results も plan も無い）なら添えても情報がないので省略。
  const provBlock = formatProvSummaryForPrompt(input.provSummary);
  const provPrefix = provBlock ? `${provBlock}\n\n` : "";

  const userMessage = `${provPrefix}Source note title: "${input.noteTitle}"\nUse this exact title for inline citations (e.g., "Based on [${input.noteTitle}], ...").\n\n# ${input.noteTitle}\n\n${input.noteContent}`;

  // 既存の知見一覧は、指示文と本文を除いた残りの予算に収まる分だけ載せる
  // （一覧が増えるとそれだけでコンテキストを使い切るため。ingest-existing-index.ts）
  const existingWikis = input.existingWikiTitles || [];
  const buildPrompt = (existingIndex: ExistingClaimIndex) =>
    buildIngesterSystemPrompt(input.language || "en", existingWikis, input.skills, { isDocument, isMemo, existingIndex })
    + buildKnowledgeSchemaPromptSection(input.knowledgeSchema);
  const emptyIndex = buildExistingClaimIndex([], "");
  const fixedTokens = estimateTokens(buildPrompt(emptyIndex)) + estimateTokens(userMessage);
  const existingIndex = buildExistingClaimIndex(
    existingWikis,
    `${input.noteTitle ?? ""}\n${input.noteContent}`,
    Math.min(INGEST_INPUT_BUDGET_TOKENS - fixedTokens, input.existingBudgetTokens ?? Number.POSITIVE_INFINITY),
  );
  return { systemPrompt: buildPrompt(existingIndex), userMessage, existingIndex };
}

export type RewritePromptInput = {
  existingSections: RewriteSection[];
  newSections: RewriteSection[];
  editedSectionHeadings: string[];
  language: string;
  skills?: { title: string; prompt: string }[];
  knowledgeSchema: string;
};

/** 書き直し（既存ページへの統合）のシステムプロンプトとユーザーメッセージを組む */
export function buildRewritePrompt(input: RewritePromptInput): { systemPrompt: string; userMessage: string } {
  let systemPrompt = buildRewriterSystemPrompt(input.language || "en", input.skills);
  systemPrompt += buildKnowledgeSchemaPromptSection(input.knowledgeSchema);
  const userMessage = buildRewriterUserMessage({
    existingSections: input.existingSections,
    newSections: input.newSections,
    editedSectionHeadings: input.editedSectionHeadings || [],
  });
  return { systemPrompt, userMessage };
}
