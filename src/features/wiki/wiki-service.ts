// Wiki サービス（フロントエンド側）
// Ingest フロー・Wiki ドキュメント構築・Embedding 保存のオーケストレーション

import type { GraphiumDocument, WikiKind, WikiMeta } from "../../lib/document-types";
import { embeddingStore } from "../../lib/embedding-store";
import type { IngesterOutput } from "../../server/services/wiki-ingester";
import { getEmbeddingModel } from "../settings/store";

/** サーバー API の URL ベース */
const API_BASE = "/api/wiki";

type ExistingWikiInfo = {
  id: string;
  title: string;
  kind: WikiKind;
};

type IngestResult = {
  wikis: IngesterOutput[];
  tokenUsage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string | null;
};

/**
 * ノートから Wiki を生成する（サーバー API 呼び出し）
 */
export async function ingestNote(
  noteId: string,
  doc: GraphiumDocument,
  existingWikis: ExistingWikiInfo[],
  language: string,
): Promise<IngestResult> {
  const noteContent = extractPlainTextFromDoc(doc);

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      noteId,
      noteContent,
      noteTitle: doc.title,
      existingWikiTitles: existingWikis,
      language,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Ingest failed (${res.status})`);
  }

  return res.json();
}

/**
 * Ingester 出力から GraphiumDocument を構築する
 */
export function buildWikiDocument(
  ingesterOutput: IngesterOutput,
  sourceNoteId: string,
  model: string | null,
  sourceNoteTitle?: string,
  existingWikiTitles?: { id: string; title: string }[],
): GraphiumDocument {
  const now = new Date().toISOString();
  const blocks = convertSectionsToBlocks(ingesterOutput.sections);

  // 関連セクションを追加（派生元ノート + 関連 Concept）
  const relations = buildRelationBlocks(
    sourceNoteId,
    sourceNoteTitle,
    ingesterOutput.relatedConcepts,
    existingWikiTitles,
    ingesterOutput.externalReferences,
  );
  blocks.push(...relations.blocks);

  const wikiMeta: WikiMeta = {
    kind: ingesterOutput.kind,
    derivedFromNotes: [sourceNoteId],
    derivedFromChats: [],
    generatedAt: now,
    generatedBy: {
      model: model ?? "unknown",
      version: "1.0.0",
    },
    status: "draft",
    lastIngestedAt: now,
    language: undefined,
  };

  return {
    version: 2,
    title: ingesterOutput.title,
    pages: [{
      id: "main",
      title: ingesterOutput.title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: relations.knowledgeLinks,
    }],
    source: "ai",
    wikiMeta,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * 既存 Wiki ドキュメントに新しいセクションを追記（merge）する
 */
export function mergeIntoWikiDocument(
  existingDoc: GraphiumDocument,
  ingesterOutput: IngesterOutput,
  sourceNoteId: string,
  model: string | null,
): GraphiumDocument {
  const now = new Date().toISOString();
  const newBlocks = convertSectionsToBlocks(ingesterOutput.sections);
  const page = existingDoc.pages[0];

  // 新しいセクションを既存ブロックの末尾に追加
  const mergedBlocks = [...(page?.blocks ?? []), ...newBlocks];

  // derivedFromNotes に追加（重複除去）
  const derivedFromNotes = [
    ...new Set([...(existingDoc.wikiMeta?.derivedFromNotes ?? []), sourceNoteId]),
  ];

  return {
    ...existingDoc,
    pages: [{
      ...(page ?? { id: "main", title: existingDoc.title, labels: {}, provLinks: [], knowledgeLinks: [] }),
      blocks: mergedBlocks,
    }],
    wikiMeta: {
      ...existingDoc.wikiMeta!,
      derivedFromNotes,
      lastIngestedAt: now,
      generatedBy: {
        model: model ?? existingDoc.wikiMeta?.generatedBy?.model ?? "unknown",
        version: "1.0.0",
      },
    },
    modifiedAt: now,
  };
}

/**
 * Ingester のセクション出力を BlockNote ブロック配列に変換する
 */
function convertSectionsToBlocks(
  sections: { heading: string; content: string }[],
): any[] {
  const blocks: any[] = [];

  for (const section of sections) {
    // H2 見出しブロック
    blocks.push({
      id: crypto.randomUUID(),
      type: "heading",
      props: {
        textColor: "default",
        backgroundColor: "default",
        textAlignment: "left",
        level: 2,
      },
      content: [{ type: "text", text: section.heading, styles: {} }],
      children: [],
    });

    // コンテンツを段落ブロックに分割
    const paragraphs = section.content.split("\n").filter(Boolean);
    for (const para of paragraphs) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "paragraph",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: para, styles: {} }],
        children: [],
      });
    }
  }

  return blocks;
}

/**
 * 関連セクションのブロックを構築する
 * 派生元ノートへのリンクと関連 Concept を含む
 */
type RelationBlocksResult = {
  blocks: any[];
  knowledgeLinks: any[];
};

function buildRelationBlocks(
  sourceNoteId: string,
  sourceNoteTitle?: string,
  relatedConcepts?: string[],
  existingWikiTitles?: { id: string; title: string }[],
  externalReferences?: { url: string; title: string }[],
): RelationBlocksResult {
  const blocks: any[] = [];
  const knowledgeLinks: any[] = [];

  // 「関連」見出し
  blocks.push({
    id: crypto.randomUUID(),
    type: "heading",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
    content: [{ type: "text", text: "References", styles: {} }],
    children: [],
  });

  // 派生元ノートへの @リンク（青テキスト + knowledgeLinks）
  const sourceLabel = sourceNoteTitle ?? sourceNoteId;
  const sourceBlockId = crypto.randomUUID();
  blocks.push({
    id: sourceBlockId,
    type: "bulletListItem",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [
      { type: "text", text: "Source: ", styles: { bold: true } },
      { type: "text", text: `@${sourceLabel}`, styles: { textColor: "blue" } },
    ],
    children: [],
  });
  knowledgeLinks.push({
    id: crypto.randomUUID(),
    sourceBlockId,
    targetBlockId: "",
    targetNoteId: sourceNoteId,
    type: "reference",
    layer: "knowledge",
    createdBy: "ai",
  });

  // 関連 Concept への @リンク
  if (relatedConcepts && relatedConcepts.length > 0 && existingWikiTitles) {
    for (const conceptTitle of relatedConcepts) {
      const wiki = existingWikiTitles.find((w) => w.title === conceptTitle);
      const blockId = crypto.randomUUID();
      const label = wiki ? `🤖 ${conceptTitle}` : conceptTitle;
      blocks.push({
        id: blockId,
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [
          { type: "text", text: "Related: ", styles: { bold: true } },
          { type: "text", text: `@${label}`, styles: { textColor: "blue" } },
        ],
        children: [],
      });
      if (wiki) {
        knowledgeLinks.push({
          id: crypto.randomUUID(),
          sourceBlockId: blockId,
          targetBlockId: "",
          targetNoteId: wiki.id,
          type: "reference",
          layer: "knowledge",
          createdBy: "ai",
        });
      }
    }
  }

  // 外部参照リンク
  if (externalReferences && externalReferences.length > 0) {
    for (const ref of externalReferences) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [
          { type: "text", text: "Evidence: ", styles: { bold: true } },
          {
            type: "link",
            href: ref.url,
            content: [{ type: "text", text: ref.title, styles: {} }],
          },
        ],
        children: [],
      });
    }
  }

  return { blocks, knowledgeLinks };
}

/**
 * Wiki ドキュメントの editedSections を更新する
 * 保存前に呼び出し、元のブロック構成と比較して変更があったセクションを記録する
 * 簡易実装: 保存時点の全 H2 ブロック ID を editedSections として記録
 */
export function markEditedSections(doc: GraphiumDocument): GraphiumDocument {
  if (doc.source !== "ai" || !doc.wikiMeta) return doc;

  const page = doc.pages[0];
  if (!page) return doc;

  const h2BlockIds = page.blocks
    .filter((b: any) => b.type === "heading" && b.props?.level === 2)
    .map((b: any) => b.id);

  return {
    ...doc,
    wikiMeta: {
      ...doc.wikiMeta,
      editedSections: h2BlockIds,
    },
  };
}

/**
 * Wiki ドキュメントの H2 セクションを抽出して embedding を生成・保存する
 */
export async function embedWikiSections(
  wikiDocId: string,
  doc: GraphiumDocument,
): Promise<void> {
  const sections = extractSectionsForEmbedding(wikiDocId, doc);
  if (sections.length === 0) return;

  // 既存データを削除
  await embeddingStore.deleteByDocument(wikiDocId);

  // Embedding API を試みる
  let embeddingSuccess = false;
  try {
    const embModel = getEmbeddingModel();
    const res = await fetch(`${API_BASE}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: sections,
        ...(embModel ? { embedding_model: embModel } : {}),
      }),
    });

    if (res.ok) {
      const data = await res.json() as {
        embeddings: { documentId: string; sectionId: string; vector: number[] }[];
        modelVersion: string;
      };

      for (const emb of data.embeddings) {
        const section = sections.find((s) => s.sectionId === emb.sectionId);
        await embeddingStore.setEmbedding(
          emb.documentId,
          emb.sectionId,
          emb.vector,
          data.modelVersion,
          section?.text ?? "",
        );
      }
      embeddingSuccess = true;
    }
  } catch {
    // Embedding API 失敗（プロバイダー非対応など）
  }

  // Embedding が使えなくてもテキストだけ保存（フォールバック Retriever 用）
  if (!embeddingSuccess) {
    for (const section of sections) {
      await embeddingStore.setEmbedding(
        section.documentId,
        section.sectionId,
        [], // 空ベクトル（テキストマッチ用）
        "text-only",
        section.text,
      );
    }
  }
}

/**
 * Wiki ドキュメントから embedding 対象のセクションを抽出する
 * 階層コンテキスト付き: "{WikiKind}: {タイトル} > {セクション見出し}: {本文}"
 */
function extractSectionsForEmbedding(
  documentId: string,
  doc: GraphiumDocument,
): { documentId: string; sectionId: string; text: string }[] {
  const page = doc.pages[0];
  if (!page) return [];

  const kind = doc.wikiMeta?.kind ?? "concept";
  const docTitle = doc.title;
  const sections: { documentId: string; sectionId: string; text: string }[] = [];

  let currentHeading: { id: string; text: string } | null = null;
  let currentContent: string[] = [];

  const flushSection = () => {
    if (currentHeading && currentContent.length > 0) {
      const content = currentContent.join(" ").trim();
      if (content) {
        sections.push({
          documentId,
          sectionId: currentHeading.id,
          text: `${kind}: ${docTitle} > ${currentHeading.text}: ${content}`,
        });
      }
    }
    currentContent = [];
  };

  for (const block of page.blocks) {
    if (block.type === "heading" && block.props?.level === 2) {
      flushSection();
      const headingText = extractInlineText(block.content);
      currentHeading = { id: block.id, text: headingText };
    } else if (currentHeading) {
      const text = extractInlineText(block.content);
      if (text) currentContent.push(text);
    }
  }
  flushSection();

  return sections;
}

/**
 * GraphiumDocument からプレーンテキストを抽出する
 */
function extractPlainTextFromDoc(doc: GraphiumDocument): string {
  const page = doc.pages[0];
  if (!page) return "";

  const lines: string[] = [];
  for (const block of page.blocks || []) {
    const text = extractBlockText(block);
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

function extractBlockText(block: any): string {
  let text = extractInlineText(block.content);
  if (text) return text;

  if (block.props?.text) return block.props.text;

  if (block.children?.length) {
    text = block.children
      .map((child: any) => extractBlockText(child))
      .filter(Boolean)
      .join(", ");
    if (text) return text;
  }

  return "";
}

function extractInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  if (content.type === "tableContent" && Array.isArray(content.rows)) {
    return content.rows
      .map((row: any) =>
        (row.cells ?? [])
          .map((cell: any) => extractInlineText(cell))
          .join(" ")
      )
      .join(" ")
      .trim();
  }
  return "";
}
