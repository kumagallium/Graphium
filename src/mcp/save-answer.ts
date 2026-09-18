// MCP 経由で AI チャットの回答をナレッジ層の「回答」ページ（answer）として書き込む。
//
// アプリ内チャットの「ナレッジに残す」（note-app.tsx の handleSaveChatAsAnswer /
// #989, #990）と同じ形のページを作る。本文の組み立ては
// buildSourceBackedWikiDocument（トピックと共通の出典つきページビルダー）をそのまま
// 再利用する — MCP は Node で動くが、この関数の呼び出し経路は window / fetch に
// 依存しないため import してよい（apiBase() 等はモジュール最上位で呼ばれるが、
// window 未定義時は安全にフォールバックする。実行確認済み）。
//
// ノート（create_note, notes/ 配下, 人が保守）とは違い、回答ページは wiki/ 配下に置き、
// Graphium 側で取り込みのたびに改訂・点検・出典照合の対象になる（ノートは一切自動で
// 変更されない）。

import { mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { GraphiumDocument } from "../lib/document-types";
import { recordRevision } from "../features/document-provenance/tracker";
import { buildNoteIndex, buildSourceBackedWikiDocument, type TopicSourceRef } from "../features/wiki/wiki-service";
import { readNote, readNoteIndex, resolveGraphiumRoot, wikiDir } from "./vault";

/** 回答が引いた Graphium 内のノート・ページの参照。create_note の CitationInput と同じ形 */
export type AnswerCitationInput = {
  id: string;
  title?: string;
};

export type SaveAnswerInput = {
  /** 問い（回答ページのタイトルになる） */
  question: string;
  /** 回答本文（Markdown）。[[source:<id>]] で citations を引用できる */
  answer: string;
  /** 呼び出し側のセッション識別子（あれば） */
  sessionId?: string;
  /** 回答を書いた LLM のモデル ID */
  model?: string;
  /** MCP クライアント名（claude-desktop / claude-code など） */
  client?: string;
  /** 回答が引いた Graphium 内のノート・ページの参照 */
  citations?: AnswerCitationInput[];
};

export type SaveAnswerResult = {
  noteId: string;
  filePath: string;
  title: string;
};

/**
 * 誰が保存したかを解決する（create-note.ts と同じ規則）。
 * username は識別のため常に記録し、email は明示的な opt-in があるときだけ入れる。
 */
function resolveAuthor(): { username: string; email?: string } {
  const user: { username: string; email?: string } = { username: userInfo().username };
  const email = process.env.GRAPHIUM_USER_EMAIL?.trim();
  if (email) user.email = email;
  return user;
}

/**
 * citations から TopicSourceRef[] を組む。タイトルは実在するノート/ページのタイトルを
 * 優先し、次に呼び出し側が渡した title、最後に id そのものにフォールバックする
 * （resolveSourceCitations は必ずタイトルを持つ前提のため、フォールバックを切らさない）。
 */
function resolveSources(citations: AnswerCitationInput[], root: string): TopicSourceRef[] {
  return citations.map((c) => {
    const note = readNote(c.id, root);
    const title = note?.title?.trim() || c.title?.trim() || c.id;
    return { id: c.id, title };
  });
}

/**
 * buildSourceBackedWikiDocument が作る References ブロックは、渡した sources を
 * 無条件に @リンクとして描画する（トピックの通常フローでは sources が必ず実在する前提のため）。
 * MCP の citations は呼び出し側の自己申告で実在しない id を含みうるので、create_note の
 * buildCitationReferenceBlocks と同じ規則（実在する id だけ @リンク・knowledgeLink を持ち、
 * 実在しない id は文字のまま残す）に揃えて末尾の References ブロックを描き直す。
 * 本文中の [[source:id]] 引用（pushCitation 経由）は noteIndex 参照で既に正しく振り分けられている
 * ため、ここでは触らない。
 */
function fixReferenceBlockExistence(
  doc: GraphiumDocument,
  sources: TopicSourceRef[],
  root: string,
): GraphiumDocument {
  if (sources.length === 0) return doc;
  const page = doc.pages[0] as any;
  const refBlockCount = sources.length + 1; // heading + 資料ごとの bulletListItem
  const blocks: any[] = page.blocks;
  const refBlocks = blocks.slice(blocks.length - refBlockCount);
  const headingBlock = refBlocks[0];
  const bulletBlocks = refBlocks.slice(1);
  if (headingBlock?.type !== "heading" || bulletBlocks.length !== sources.length) return doc;

  const missingSourceIds = new Set<string>();
  bulletBlocks.forEach((bullet: any, i: number) => {
    const source = sources[i];
    if (readNote(source.id, root)) return; // 実在するので @リンクのまま
    missingSourceIds.add(source.id);
    bullet.content = [{ type: "text", text: source.title }];
  });

  const knowledgeLinks = (page.knowledgeLinks as any[]).filter(
    (l) => !(l.type === "reference" && l.layer === "knowledge" && missingSourceIds.has(l.targetNoteId)),
  );

  return {
    ...doc,
    pages: [{ ...page, knowledgeLinks }],
  };
}

/**
 * 回答ページの GraphiumDocument を組み立てる（保存はしない。テストで組み立てだけ検証できるように分離）。
 */
export function buildAnswerDocument(
  input: SaveAnswerInput,
  root = resolveGraphiumRoot(),
): GraphiumDocument {
  if (!input.question?.trim()) throw new Error("question is required");
  if (typeof input.answer !== "string" || !input.answer.trim()) throw new Error("answer is required");

  const sources = resolveSources(input.citations ?? [], root);
  const noteIndex = buildNoteIndex(readNoteIndex(root));
  const model = input.model?.trim() || "unknown";

  let doc = buildSourceBackedWikiDocument("answer", input.question, input.answer, sources, model, noteIndex);
  doc = fixReferenceBlockExistence(doc, sources, root);

  // wikiMeta.generatedBy（AI モデルの記録。lint・改訂の対象判定に使われる）はそのまま残し、
  // 文書トップレベルの generatedBy だけ、どの経路（MCP クライアント）で作られたかが
  // 後から分かるよう create_note と同じ形に上書きする。
  doc.generatedBy = {
    agent: input.client ? `graphium-mcp (${input.client})` : "graphium-mcp",
    sessionId: input.sessionId ?? "unknown",
    user: resolveAuthor(),
    ...(model !== "unknown" ? { model } : {}),
  };

  return doc;
}

/**
 * 回答ページを wiki/ に書き込む。来歴（PROV）は handleCreateWikiFile と同じ作法
 * （recordRevision, activityType: "wiki_ingest"）で残す。
 */
export async function saveAnswer(
  input: SaveAnswerInput,
  root = resolveGraphiumRoot(),
): Promise<SaveAnswerResult> {
  const built = buildAnswerDocument(input, root);
  const sources = built.wikiMeta?.derivedFromNotes ?? [];
  const agentLabel =
    built.wikiMeta?.generatedBy?.model ?? built.generatedBy?.model ?? built.generatedBy?.agent ?? "ai";

  const doc = await recordRevision(built, null, "wiki_ingest", {
    agentLabel,
    force: true,
    sources,
  });

  const dir = wikiDir(root);
  mkdirSync(dir, { recursive: true });

  const noteId = randomUUID();
  const filePath = join(dir, `${noteId}.json`);
  writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf8");

  return { noteId, filePath, title: doc.title };
}
