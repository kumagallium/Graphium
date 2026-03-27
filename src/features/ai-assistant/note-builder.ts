// AI 回答から派生ノートの ProvNoteDocument を組み立てる

import type { ProvNoteDocument } from "../../lib/google-drive";
import type { AgentRunResponse } from "./api";

type BuildParams = {
  /** AI が生成した要約タイトル */
  title: string;
  /** 引用元ブロックの Markdown テキスト */
  quotedMarkdown: string;
  /** ユーザーの質問 */
  question: string;
  /** crucible-agent のレスポンス */
  agentResponse: AgentRunResponse;
  /** 派生元ノートの ID */
  sourceNoteId: string;
  /** 引用元ブロックIDリスト */
  sourceBlockIds: string[];
  /** AI 回答をブロック配列に変換する関数（editor.tryParseMarkdownToBlocks） */
  parseMarkdown: (md: string) => any[];
};

/**
 * AI 回答を含む派生ノートの ProvNoteDocument を生成する
 */
export function buildAiDerivedDocument(params: BuildParams): ProvNoteDocument {
  const {
    title,
    quotedMarkdown,
    question,
    agentResponse,
    sourceNoteId,
    sourceBlockIds,
    parseMarkdown,
  } = params;

  const now = new Date().toISOString();

  // 引用 + 質問 + 回答をまとめたマークダウンを構築
  const combinedMarkdown = [
    "## 引用",
    "",
    quotedMarkdown
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "",
    "## 質問",
    "",
    question,
    "",
    "## 回答",
    "",
    agentResponse.message,
  ].join("\n");

  // マークダウンを BlockNote ブロックに変換
  const blocks = parseMarkdown(combinedMarkdown);

  const noteTitle = `🤖 ${title}`;

  return {
    version: 2,
    title: noteTitle,
    pages: [
      {
        id: "main",
        title: noteTitle,
        blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    derivedFromNoteId: sourceNoteId,
    derivedFromBlockId: sourceBlockIds[0],
    // AI 生成メタデータ
    generatedBy: {
      agent: "crucible-agent",
      sessionId: agentResponse.session_id,
      model: agentResponse.model ?? undefined,
      tokenUsage: agentResponse.token_usage,
    },
    createdAt: now,
    modifiedAt: now,
  } as ProvNoteDocument;
}
