// AI 回答から派生ノートの GraphiumDocument を組み立てる

import type { GraphiumDocument } from "../../lib/google-drive";
import type { AgentRunResponse } from "./api";
import { extractLabelMarkersFromBlocks } from "./label-markers";

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
 * AI 回答を含む派生ノートの GraphiumDocument を生成する
 */
export function buildAiDerivedDocument(params: BuildParams): GraphiumDocument {
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
  const parsedBlocks = parseMarkdown(combinedMarkdown);

  // [[label:xxx]] マーカーを剥がして labels マップを組み立てる。
  // path → block.id の解決は parseMarkdown 後の blocks ツリーをたどる。
  const { blocks, labels: extracted } = extractLabelMarkersFromBlocks(parsedBlocks);
  const labelsMap: Record<string, string> = {};
  const procedureHeadingIds: string[] = [];
  const resolveByPath = (path: number[]): any | null => {
    let nodes: any[] = blocks as any[];
    let node: any = null;
    for (const idx of path) {
      node = nodes?.[idx];
      if (!node) return null;
      nodes = node.children ?? [];
    }
    return node;
  };
  for (const { path, label } of extracted) {
    const block = resolveByPath(path);
    if (!block?.id) continue;
    labelsMap[block.id] = label;
    if (label === "procedure" && block.type === "heading" && (block.props?.level ?? 0) >= 2) {
      procedureHeadingIds.push(block.id);
    }
  }
  // 連続 procedure 見出しを informed_by で連結（onInsertToScope と同じ意図）
  const provLinks = procedureHeadingIds.slice(1).map((id, i) => ({
    id: crypto.randomUUID(),
    sourceBlockId: id,
    targetBlockId: procedureHeadingIds[i],
    type: "informed_by" as const,
    layer: "prov" as const,
    createdBy: "ai" as const,
  }));

  const noteTitle = `🤖 ${title}`;

  return {
    version: 2,
    title: noteTitle,
    pages: [
      {
        id: "main",
        title: noteTitle,
        blocks,
        labels: labelsMap,
        provLinks,
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
  } as GraphiumDocument;
}
