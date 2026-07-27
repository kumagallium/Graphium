// AI 回答から派生ノートの GraphiumDocument を組み立てる

import type { GraphiumDocument } from "../../lib/document-types";
import type { AgentRunResponse } from "./api";
import { extractLabelMarkersFromBlocks, convertExtractedProcedureBlocksToSteps } from "./label-markers";
import { t } from "../../i18n";

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
    `## ${t("aiDerived.quoteHeading")}`,
    "",
    quotedMarkdown
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "",
    `## ${t("aiDerived.questionHeading")}`,
    "",
    question,
    "",
    `## ${t("aiDerived.answerHeading")}`,
    "",
    agentResponse.message,
  ].join("\n");

  // マークダウンを BlockNote ブロックに変換
  const parsedBlocks = parseMarkdown(combinedMarkdown);

  // [[label:xxx]] マーカーを剥がし、procedure 見出しを step ブロックへ変換する
  // （工程は step が正。旧語彙のまま保存すると、生成直後に開いたノートが
  //   旧形式で表示される — 読込マイグレーションは次回ロードまで走らない）。
  const extractedRaw = extractLabelMarkersFromBlocks(parsedBlocks);
  const { blocks, labels: remaining } = convertExtractedProcedureBlocksToSteps(
    extractedRaw.blocks,
    extractedRaw.labels,
  );
  const labelsMap: Record<string, string> = {};
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
  for (const { path, label } of remaining) {
    const block = resolveByPath(path);
    if (block?.id) labelsMap[block.id] = label;
  }
  // 兄弟 step を文書順に informed_by で連結（applyExtractedLabels と同じ意図。
  // 入れ子 step は「含む」関係なので繋がない）
  const stepIds: string[] = [];
  const collectSiblingSteps = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "step" && b.id) stepIds.push(b.id);
      if (Array.isArray(b?.children)) collectSiblingSteps(b.children);
    }
  };
  collectSiblingSteps(blocks);
  const provLinks = stepIds.slice(1).map((id, i) => ({
    id: crypto.randomUUID(),
    sourceBlockId: id,
    targetBlockId: stepIds[i],
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
    // `agent` は表示用のフォールバック識別子（model が無いときに使われる）。
    // 旧 crucible-agent 連携は廃止されたので、ブランドに紐付かない "ai" を使う。
    generatedBy: {
      agent: "ai",
      sessionId: agentResponse.session_id,
      model: agentResponse.model ?? undefined,
      tokenUsage: agentResponse.token_usage,
    },
    createdAt: now,
    modifiedAt: now,
  } as GraphiumDocument;
}
