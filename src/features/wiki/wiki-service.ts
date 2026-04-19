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

// ── 追加 Ingest ソース ──

/**
 * URL からテキストを取得して Wiki を生成する
 */
export async function ingestFromUrl(
  url: string,
  existingWikis: ExistingWikiInfo[],
  language: string,
): Promise<IngestResult> {
  // サーバーサイドで HTML 取得・パース
  const fetchRes = await fetch(`${API_BASE}/fetch-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!fetchRes.ok) {
    const err = await fetchRes.json().catch(() => ({ error: "Fetch failed" }));
    throw new Error(err.error || `URL fetch failed (${fetchRes.status})`);
  }

  const urlData = await fetchRes.json() as {
    title: string;
    description: string;
    text: string;
    url: string;
  };

  const noteContent = [
    urlData.description && `> ${urlData.description}`,
    "",
    urlData.text,
  ].filter(Boolean).join("\n");

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      noteId: `url:${url}`,
      noteContent,
      noteTitle: urlData.title || url,
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
 * AI チャットの会話履歴から Wiki を生成する
 */
export async function ingestFromChat(
  chatMessages: { role: string; content: string }[],
  chatTitle: string,
  existingWikis: ExistingWikiInfo[],
  language: string,
): Promise<IngestResult> {
  // チャットメッセージをテキスト化
  const chatContent = chatMessages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      noteId: `chat:${Date.now()}`,
      noteContent: chatContent,
      noteTitle: `Chat: ${chatTitle}`,
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

// ── 横断更新（Cross-Update） ──

import type { CrossUpdateProposal, ExistingWikiDetail } from "../../server/services/wiki-cross-updater";

type CrossUpdateInput = {
  newNoteTitle: string;
  newNoteContent: string;
  newWikiTitles: string[];
  existingWikis: ExistingWikiDetail[];
  language: string;
};

type CrossUpdateResult = {
  proposals: CrossUpdateProposal[];
};

/**
 * 横断更新の提案を取得する
 */
export async function fetchCrossUpdateProposals(
  input: CrossUpdateInput,
): Promise<CrossUpdateResult> {
  const res = await fetch(`${API_BASE}/cross-update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    console.error("Cross-update API failed:", res.status);
    return { proposals: [] };
  }

  return res.json();
}

/**
 * CrossUpdateProposal を既存の Wiki ドキュメントに適用する
 */
export function applyCrossUpdate(
  existingDoc: GraphiumDocument,
  proposal: CrossUpdateProposal,
  sourceNoteId: string,
  model: string | null,
): GraphiumDocument {
  const now = new Date().toISOString();
  const page = existingDoc.pages[0];
  if (!page) return existingDoc;

  let updatedBlocks = [...page.blocks];
  const updatedKnowledgeLinks = [...(page.knowledgeLinks ?? [])];

  if (proposal.updateType === "add_section" && proposal.section) {
    // 新しいセクションを References の前に挿入
    const refIndex = updatedBlocks.findIndex(
      (b) => b.type === "heading" && extractInlineText(b.content).toLowerCase().includes("reference"),
    );
    const newBlocks = convertSectionsToBlocks([proposal.section]);
    if (refIndex >= 0) {
      updatedBlocks = [
        ...updatedBlocks.slice(0, refIndex),
        ...newBlocks,
        ...updatedBlocks.slice(refIndex),
      ];
    } else {
      updatedBlocks.push(...newBlocks);
    }
  } else if (proposal.updateType === "revise_section" && proposal.section) {
    // 既存セクションの末尾にコンテンツを追加
    const headingIdx = updatedBlocks.findIndex(
      (b) => b.type === "heading" && extractInlineText(b.content) === proposal.section!.heading,
    );
    if (headingIdx >= 0) {
      // 次の H2 見出しまでのブロックの末尾に追加
      let insertIdx = headingIdx + 1;
      while (insertIdx < updatedBlocks.length) {
        if (updatedBlocks[insertIdx].type === "heading" && updatedBlocks[insertIdx].props?.level === 2) break;
        insertIdx++;
      }
      const updateParagraph = {
        id: crypto.randomUUID(),
        type: "paragraph",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [{ type: "text", text: proposal.section.content, styles: {} }],
        children: [],
      };
      updatedBlocks = [
        ...updatedBlocks.slice(0, insertIdx),
        updateParagraph,
        ...updatedBlocks.slice(insertIdx),
      ];
    } else {
      // セクション見出しが見つからない場合は add_section として処理
      const newBlocks = convertSectionsToBlocks([proposal.section]);
      updatedBlocks.push(...newBlocks);
    }
  } else if (proposal.updateType === "add_reference" && proposal.reference) {
    // Reference セクションに新しいリンクを追加
    const blockId = crypto.randomUUID();
    const refBlock = {
      id: blockId,
      type: "bulletListItem",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [
        { type: "text", text: "Related: ", styles: { bold: true } },
        { type: "text", text: `@${proposal.reference.noteTitle}`, styles: { textColor: "blue" } },
      ],
      children: [],
    };

    // References セクション内に追加
    const refHeadingIdx = updatedBlocks.findIndex(
      (b) => b.type === "heading" && extractInlineText(b.content).toLowerCase().includes("reference"),
    );
    if (refHeadingIdx >= 0) {
      // Reference セクションの末尾に追加
      let insertIdx = refHeadingIdx + 1;
      while (insertIdx < updatedBlocks.length) {
        if (updatedBlocks[insertIdx].type === "heading" && updatedBlocks[insertIdx].props?.level === 2) break;
        insertIdx++;
      }
      updatedBlocks = [
        ...updatedBlocks.slice(0, insertIdx),
        refBlock,
        ...updatedBlocks.slice(insertIdx),
      ];
    } else {
      updatedBlocks.push(refBlock);
    }

    if (proposal.reference.noteId) {
      updatedKnowledgeLinks.push({
        id: crypto.randomUUID(),
        sourceBlockId: blockId,
        targetBlockId: "",
        targetNoteId: proposal.reference.noteId,
        type: "reference",
        layer: "knowledge",
        createdBy: "ai",
      });
    }
  }

  // derivedFromNotes に追加
  const derivedFromNotes = [
    ...new Set([...(existingDoc.wikiMeta?.derivedFromNotes ?? []), sourceNoteId]),
  ];

  return {
    ...existingDoc,
    pages: [{
      ...page,
      blocks: updatedBlocks,
      knowledgeLinks: updatedKnowledgeLinks,
    }],
    wikiMeta: {
      ...existingDoc.wikiMeta!,
      derivedFromNotes,
      lastIngestedAt: now,
    },
    modifiedAt: now,
  };
}

/**
 * 既存の Wiki からセクション見出し・プレビューを抽出する（横断更新の入力用）
 */
export function extractWikiDetail(
  id: string,
  doc: GraphiumDocument,
): ExistingWikiDetail | null {
  if (!doc.wikiMeta || doc.wikiMeta.kind !== "concept") return null;

  const page = doc.pages[0];
  if (!page) return null;

  const sectionHeadings: string[] = [];
  const sectionPreviews: string[] = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  const flushSection = () => {
    if (currentHeading) {
      sectionHeadings.push(currentHeading);
      sectionPreviews.push(currentContent.join(" ").slice(0, 200));
    }
    currentContent = [];
  };

  for (const block of page.blocks) {
    if (block.type === "heading" && block.props?.level === 2) {
      flushSection();
      currentHeading = extractInlineText(block.content);
    } else if (currentHeading) {
      const text = extractInlineText(block.content);
      if (text) currentContent.push(text);
    }
  }
  flushSection();

  return {
    id,
    title: doc.title,
    kind: doc.wikiMeta.kind,
    sectionHeadings,
    sectionPreviews,
  };
}

// ── Lint（整合性チェック） ──

import type { LintReport, WikiSnapshot } from "../../server/services/wiki-linter";

/**
 * Wiki の整合性チェックを実行する
 */
export async function lintWikis(
  wikis: WikiSnapshot[],
  language: string,
  localOnly: boolean = false,
): Promise<LintReport> {
  const res = await fetch(`${API_BASE}/lint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wikis, language, localOnly }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Lint failed (${res.status})`);
  }

  return res.json();
}

/**
 * Wiki ドキュメント一覧から Lint 用のスナップショットを構築する
 */
export function buildWikiSnapshots(
  wikiFiles: { id: string; modifiedTime: string }[],
  wikiMetas: Map<string, { title: string; kind: WikiKind; status: string; headings: string[] }>,
  getCachedDoc: (id: string) => GraphiumDocument | null | undefined,
): WikiSnapshot[] {
  const snapshots: WikiSnapshot[] = [];

  for (const file of wikiFiles) {
    const meta = wikiMetas.get(file.id);
    if (!meta) continue;

    const doc = getCachedDoc(`wiki:${file.id}`);
    const wikiMeta = doc?.wikiMeta;

    snapshots.push({
      id: file.id,
      title: meta.title,
      kind: meta.kind,
      status: meta.status as "draft" | "published",
      derivedFromNotes: wikiMeta?.derivedFromNotes ?? [],
      relatedConcepts: extractRelatedConcepts(doc),
      sections: meta.headings,
      lastIngestedAt: wikiMeta?.lastIngestedAt,
      modifiedAt: file.modifiedTime,
    });
  }

  return snapshots;
}

/**
 * Wiki ドキュメントから関連 Concept タイトルを抽出する
 */
function extractRelatedConcepts(doc: GraphiumDocument | null | undefined): string[] {
  if (!doc) return [];
  const page = doc.pages[0];
  if (!page) return [];

  const concepts: string[] = [];
  for (const link of page.knowledgeLinks ?? []) {
    if (link.targetNoteId && link.type === "reference") {
      concepts.push(link.targetNoteId);
    }
  }
  return concepts;
}

// ── 構造化インデックス ──

export type WikiIndexEntry = {
  id: string;
  title: string;
  kind: WikiKind;
  status: string;
  sections: string[];
  derivedFromNotes: string[];
  relatedConcepts: string[];
  modifiedAt: string;
};

/**
 * LLM が参照可能な構造化 Wiki インデックスを構築する
 * Retriever のコンテキストに注入して、LLM が Wiki 全体像を把握できるようにする
 */
export function buildWikiIndex(
  wikiFiles: { id: string; modifiedTime: string }[],
  wikiMetas: Map<string, { title: string; kind: WikiKind; status: string; headings: string[] }>,
  getCachedDoc: (id: string) => GraphiumDocument | null | undefined,
): WikiIndexEntry[] {
  const entries: WikiIndexEntry[] = [];

  for (const file of wikiFiles) {
    const meta = wikiMetas.get(file.id);
    if (!meta) continue;

    const doc = getCachedDoc(`wiki:${file.id}`);

    entries.push({
      id: file.id,
      title: meta.title,
      kind: meta.kind,
      status: meta.status,
      sections: meta.headings,
      derivedFromNotes: doc?.wikiMeta?.derivedFromNotes ?? [],
      relatedConcepts: extractRelatedConcepts(doc),
      modifiedAt: file.modifiedTime,
    });
  }

  return entries;
}

/**
 * Wiki インデックスを LLM 向けテキストにフォーマットする
 */
export function formatWikiIndexForLLM(entries: WikiIndexEntry[]): string {
  if (entries.length === 0) return "";

  const summaries = entries.filter((e) => e.kind === "summary");
  const concepts = entries.filter((e) => e.kind === "concept");

  let text = `## Wiki Index (${entries.length} pages)\n\n`;

  if (concepts.length > 0) {
    text += `### Concepts (${concepts.length})\n`;
    for (const c of concepts) {
      text += `- **${c.title}** [${c.status}]: ${c.sections.join(", ")}\n`;
    }
    text += "\n";
  }

  if (summaries.length > 0) {
    text += `### Summaries (${summaries.length})\n`;
    for (const s of summaries) {
      text += `- **${s.title}** [${s.status}]: ${s.sections.join(", ")}\n`;
    }
  }

  return text;
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
