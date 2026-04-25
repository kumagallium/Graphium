// Wiki サービス（フロントエンド側）
// Ingest フロー・Wiki ドキュメント構築・Embedding 保存のオーケストレーション

import type { GraphiumDocument, WikiKind, WikiMeta } from "../../lib/document-types";
import { embeddingStore } from "../../lib/embedding-store";
import type { IngesterOutput } from "../../server/services/wiki-ingester";
import { getEmbeddingModel, getDefaultLLMModel } from "../settings/store";
import { apiBase, isTauri } from "../../lib/platform";

import type { GraphiumIndex } from "../navigation";

/** サーバー API の URL ベース（Tauri: http://localhost:3001/api/wiki, Web: /api/wiki） */
const API_BASE = `${apiBase()}/wiki`;

/**
 * GraphiumIndex から NoteIndex を構築する（インライン引用リンク解決用）
 */
export function buildNoteIndex(index: GraphiumIndex | null | undefined): NoteIndex {
  if (!index?.notes) return [];
  return index.notes.map((n) => ({
    id: n.noteId,
    title: n.title,
    isWiki: n.source === "ai",
  }));
}

/** Web モード用: X-LLM-API-Key ヘッダーを含む共通ヘッダー */
function wikiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getDefaultLLMModel();
    if (model) {
      h["X-LLM-API-Key"] = JSON.stringify({
        provider: model.provider,
        modelId: model.modelId,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        name: model.name,
      });
    }
  }
  return h;
}

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
  /** 使用するモデル名（省略時はサーバーデフォルト） */
  model?: string,
  /** Ingest 時に適用する Skill（プロンプトテンプレート） */
  skills?: { title: string; prompt: string }[],
): Promise<IngestResult> {
  const noteContent = extractPlainTextFromDoc(doc);

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({
      noteId,
      noteContent,
      noteTitle: doc.title,
      existingWikiTitles: existingWikis,
      language,
      ...(model ? { model } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
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
  language?: string,
  /** ノート/Wiki のタイトル→ID マッピング（インライン引用リンク解決用） */
  noteIndex?: NoteIndex,
): GraphiumDocument {
  const now = new Date().toISOString();
  const converted = convertSectionsToBlocks(ingesterOutput.sections, noteIndex);

  // 関連セクションを追加（派生元ノート + 関連 Concept）
  const relations = buildRelationBlocks(
    sourceNoteId,
    sourceNoteTitle,
    ingesterOutput.relatedConcepts,
    existingWikiTitles,
    ingesterOutput.externalReferences,
  );
  converted.blocks.push(...relations.blocks);

  const wikiMeta: WikiMeta = {
    kind: ingesterOutput.kind,
    derivedFromNotes: [sourceNoteId],
    derivedFromChats: [],
    generatedAt: now,
    generatedBy: {
      model: model ?? "unknown",
      version: "1.0.0",
    },
    lastIngestedAt: now,
    language: language ?? undefined,
    // Concept のみ level/evidenceSpan を持つ。新規生成時の status は常に "candidate"
    // （Cross-Update で別ノートも依拠した時点で "verified" に昇格させる想定）
    level: ingesterOutput.kind === "concept" ? ingesterOutput.level : undefined,
    status: ingesterOutput.kind === "concept" ? "candidate" : undefined,
    evidenceSpan: ingesterOutput.evidenceSpan,
  };

  return {
    version: 2,
    title: ingesterOutput.title,
    pages: [{
      id: "main",
      title: ingesterOutput.title,
      blocks: converted.blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks: [...converted.knowledgeLinks, ...relations.knowledgeLinks],
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
  noteIndex?: NoteIndex,
): GraphiumDocument {
  const now = new Date().toISOString();
  const converted = convertSectionsToBlocks(ingesterOutput.sections, noteIndex);
  const page = existingDoc.pages[0];

  // 新しいセクションを既存ブロックの末尾に追加
  const mergedBlocks = [...(page?.blocks ?? []), ...converted.blocks];

  // derivedFromNotes に追加（重複除去）
  const derivedFromNotes = [
    ...new Set([...(existingDoc.wikiMeta?.derivedFromNotes ?? []), sourceNoteId]),
  ];

  return {
    ...existingDoc,
    pages: [{
      ...(page ?? { id: "main", title: existingDoc.title, labels: {}, provLinks: [], knowledgeLinks: [] }),
      blocks: mergedBlocks,
      knowledgeLinks: [...(page?.knowledgeLinks ?? []), ...converted.knowledgeLinks],
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
 * 既存 Wiki に新情報を統合して再構成する（LLM rewrite 版）
 * editedSections はユーザーの手動編集を保護する
 * rewrite API が失敗した場合は従来の mergeIntoWikiDocument にフォールバック
 */
export async function rewriteAndMerge(
  existingDoc: GraphiumDocument,
  ingesterOutput: IngesterOutput,
  sourceNoteId: string,
  model: string | null,
  /** 言語オーバーライド（既存 Wiki の wikiMeta.language が未設定の場合に使う） */
  language?: string,
  noteIndex?: NoteIndex,
): Promise<GraphiumDocument> {
  const page = existingDoc.pages[0];
  if (!page) return mergeIntoWikiDocument(existingDoc, ingesterOutput, sourceNoteId, model, noteIndex);

  // 既存ページのセクションをテキストとして抽出
  const existingSections = extractSectionsFromBlocks(page.blocks);
  const editedSectionHeadings = existingDoc.wikiMeta?.editedSections ?? [];

  // 新しいセクション
  const newSections = ingesterOutput.sections.map((s) => ({
    heading: s.heading,
    content: s.content,
  }));

  // セクションが少なすぎる場合は rewrite 不要（従来のマージ）
  if (existingSections.length === 0) {
    return mergeIntoWikiDocument(existingDoc, ingesterOutput, sourceNoteId, model, noteIndex);
  }

  try {
    const res = await fetch(`${API_BASE}/rewrite`, {
      method: "POST",
      headers: wikiHeaders(),
      body: JSON.stringify({
        existingSections,
        newSections,
        editedSectionHeadings,
        language: existingDoc.wikiMeta?.language ?? language ?? "en",
      }),
    });

    if (!res.ok) {
      console.warn("Rewrite API failed, falling back to append merge");
      return mergeIntoWikiDocument(existingDoc, ingesterOutput, sourceNoteId, model, noteIndex);
    }

    const data = await res.json() as {
      sections: { heading: string; content: string }[];
    };

    if (!data.sections || data.sections.length === 0) {
      return mergeIntoWikiDocument(existingDoc, ingesterOutput, sourceNoteId, model, noteIndex);
    }

    // 再構成されたセクションをブロックに変換（[[...]] → @リンク）
    const converted = convertSectionsToBlocks(data.sections, noteIndex);

    // References セクションは既存のものを保持
    const refIndex = page.blocks.findIndex(
      (b: any) => b.type === "heading" && extractInlineText(b.content).toLowerCase().includes("reference"),
    );
    const refBlocks = refIndex >= 0 ? page.blocks.slice(refIndex) : [];

    const finalBlocks = [...converted.blocks, ...refBlocks];

    // 既存の knowledgeLinks から References セクション以外のものを除去し、新しいものを追加
    const existingRefLinks = (page.knowledgeLinks ?? []).filter((link: any) => {
      if (refIndex < 0) return true;
      const refBlockIds = new Set(refBlocks.map((b: any) => b.id));
      return refBlockIds.has(link.sourceBlockId);
    });

    const now = new Date().toISOString();
    const derivedFromNotes = [
      ...new Set([...(existingDoc.wikiMeta?.derivedFromNotes ?? []), sourceNoteId]),
    ];

    return {
      ...existingDoc,
      pages: [{
        ...page,
        blocks: finalBlocks,
        knowledgeLinks: [...existingRefLinks, ...converted.knowledgeLinks],
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
  } catch (err) {
    console.warn("Rewrite failed:", err);
    return mergeIntoWikiDocument(existingDoc, ingesterOutput, sourceNoteId, model, noteIndex);
  }
}

/**
 * インラインコンテンツからテキストを抽出する
 * @リンク（青テキスト）は [[タイトル]] 形式に復元する（Rewriter に渡す際に引用を保持するため）
 */
function extractInlineTextWithCitations(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => {
      // @リンク（青テキスト）を [[タイトル]] に復元
      if (c.type === "text" && c.styles?.textColor === "blue" && typeof c.text === "string" && c.text.startsWith("@")) {
        let title = c.text.slice(1); // '@' を除去
        // Wiki の 🤖 プレフィックスを除去
        if (title.startsWith("🤖 ")) title = title.slice(3);
        return `[[${title}]]`;
      }
      return c.text ?? c.content ?? "";
    }).join("");
  }
  return extractInlineText(content);
}

/**
 * BlockNote ブロック配列から H2 セクション単位でテキストを抽出する
 * @リンクは [[タイトル]] 形式に復元する
 */
function extractSectionsFromBlocks(
  blocks: any[],
): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const block of blocks) {
    if (block.type === "heading" && block.props?.level === 2) {
      // 前のセクションを保存
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n") });
      }
      currentHeading = extractInlineText(block.content);
      currentContent = [];
      // References セクション以降はスキップ
      if (currentHeading.toLowerCase().includes("reference")) {
        currentHeading = "";
        break;
      }
    } else if (currentHeading) {
      const text = extractInlineTextWithCitations(block.content);
      if (text) currentContent.push(text);
    }
  }

  // 最後のセクション
  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n") });
  }

  return sections;
}

/**
 * ノート/Wiki のタイトル → ID を解決するための情報
 */
type NoteIndex = { id: string; title: string; isWiki?: boolean }[];

type ConvertResult = {
  blocks: any[];
  knowledgeLinks: any[];
};

/**
 * LLM が稀に出す不正フォーマットを正規化する
 * 例: `[Chat: ...]]`（単一の `[`）→ `[[Chat: ...]]`
 */
function normalizeInlineMarkup(text: string): string {
  // 行頭または非 `[` 文字の後に出現する `[Chat: ...]]` を `[[Chat: ...]]` に補正
  return text.replace(/(^|[^\[])\[(Chat:[^\]]*?)\]\]/g, "$1[[$2]]");
}

/**
 * 1 つの `[[...]]` 引用に対応するインライン要素を出力に push する
 */
function pushCitation(
  inlineContent: any[],
  knowledgeLinks: any[],
  blockId: string,
  citedTitle: string,
  noteIndex: NoteIndex,
): void {
  // 外部 URL → BlockNote link
  if (/^https?:\/\//.test(citedTitle)) {
    inlineContent.push({
      type: "link",
      href: citedTitle,
      content: [{ type: "text", text: citedTitle, styles: {} }],
    });
    return;
  }

  // Chat 由来の引用は現状リンク先を解決できない（ScopeChat は note 内に格納されており
  // noteIndex に乗らない）。視覚的にチャット引用と分かるようイタリック+グレーで描画する。
  // クリックでチャットを開く対応は ideas.md `G-CHATCITE-OPEN` を参照。
  if (/^Chat:\s/i.test(citedTitle)) {
    inlineContent.push({
      type: "text",
      text: citedTitle,
      styles: { italic: true, textColor: "gray" } as any,
    });
    return;
  }

  // ノート/Wiki ルックアップ
  const note = noteIndex.find((n) => n.title === citedTitle);
  if (note) {
    const label = note.isWiki ? `🤖 ${citedTitle}` : citedTitle;
    inlineContent.push({
      type: "text",
      text: `@${label}`,
      styles: { textColor: "blue" },
    });
    knowledgeLinks.push({
      id: crypto.randomUUID(),
      sourceBlockId: blockId,
      targetBlockId: "",
      targetNoteId: note.id,
      type: "reference",
      layer: "knowledge",
      createdBy: "ai",
    });
    return;
  }

  // マッチしない → プレーンテキスト
  inlineContent.push({ type: "text", text: citedTitle, styles: {} });
}

/**
 * テキスト中の `[[タイトル]]` 引用と Markdown インライン装飾
 * （`**bold**` / `*italic*` / `` `code` `` / `[text](url)`）を検出し、
 * BlockNote のインラインコンテンツ配列と knowledgeLinks に変換する。
 */
export function parseInlineCitations(
  text: string,
  noteIndex: NoteIndex,
): { inlineContent: any[]; knowledgeLinks: any[]; blockId: string } {
  const blockId = crypto.randomUUID();
  const inlineContent: any[] = [];
  const knowledgeLinks: any[] = [];

  const normalized = normalizeInlineMarkup(text);

  // 優先順: [[...]] > [text](url) > **bold** > *italic* > `code`
  // - italic は単独 `*` の対なので、空白のみを内包しないよう制限する
  // - bold/italic は最短マッチ（lazy）にして、`**foo** **bar**` のような連続パターンに対応
  const TOKEN_RE = /\[\[([^\]]+?)\]\]|\[([^\]]+?)\]\(([^)]+?)\)|\*\*([^*]+?)\*\*|\*([^*\s](?:[^*]*?[^*\s])?)\*|`([^`]+?)`/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      inlineContent.push({
        type: "text",
        text: normalized.slice(lastIndex, match.index),
        styles: {},
      });
    }

    if (match[1] !== undefined) {
      pushCitation(inlineContent, knowledgeLinks, blockId, match[1], noteIndex);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      inlineContent.push({
        type: "link",
        href: match[3],
        content: [{ type: "text", text: match[2], styles: {} }],
      });
    } else if (match[4] !== undefined) {
      inlineContent.push({ type: "text", text: match[4], styles: { bold: true } });
    } else if (match[5] !== undefined) {
      inlineContent.push({ type: "text", text: match[5], styles: { italic: true } });
    } else if (match[6] !== undefined) {
      inlineContent.push({ type: "text", text: match[6], styles: { code: true } as any });
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < normalized.length) {
    inlineContent.push({
      type: "text",
      text: normalized.slice(lastIndex),
      styles: {},
    });
  }

  if (inlineContent.length === 0) {
    inlineContent.push({ type: "text", text: normalized, styles: {} });
  }

  return { inlineContent, knowledgeLinks, blockId };
}

/**
 * Ingester のセクション出力を BlockNote ブロック配列に変換する
 * [[タイトル]] をクリッカブルな @リンクに変換し、knowledgeLinks を生成する
 */
function convertSectionsToBlocks(
  sections: { heading: string; content: string }[],
  noteIndex: NoteIndex = [],
): ConvertResult {
  const blocks: any[] = [];
  const knowledgeLinks: any[] = [];

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
      const parsed = parseInlineCitations(para, noteIndex);
      blocks.push({
        id: parsed.blockId,
        type: "paragraph",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: parsed.inlineContent,
        children: [],
      });
      knowledgeLinks.push(...parsed.knowledgeLinks);
    }
  }

  return { blocks, knowledgeLinks };
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
  relatedConcepts?: { title: string; citation: string }[],
  existingWikiTitles?: { id: string; title: string }[],
  externalReferences?: { url: string; title: string; citation: string }[],
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

  // 関連 Concept への @リンク（引用付き）
  if (relatedConcepts && relatedConcepts.length > 0 && existingWikiTitles) {
    for (const concept of relatedConcepts) {
      const wiki = existingWikiTitles.find((w) => w.title === concept.title);
      const blockId = crypto.randomUUID();
      const label = wiki ? `🤖 ${concept.title}` : concept.title;
      const citationText = concept.citation ? ` — ${concept.citation}` : "";
      blocks.push({
        id: blockId,
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [
          { type: "text", text: "Related: ", styles: { bold: true } },
          { type: "text", text: `@${label}`, styles: { textColor: "blue" } },
          ...(citationText ? [{ type: "text", text: citationText, styles: { italic: true } as any }] : []),
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

  // 外部参照リンク（引用付き）
  if (externalReferences && externalReferences.length > 0) {
    for (const ref of externalReferences) {
      const citationText = ref.citation ? ` — ${ref.citation}` : "";
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
          ...(citationText ? [{ type: "text", text: citationText, styles: { italic: true } as any }] : []),
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
      headers: wikiHeaders(),
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
    headers: wikiHeaders(),
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
    headers: wikiHeaders(),
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
    headers: wikiHeaders(),
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
    headers: wikiHeaders(),
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
 * revise_section は rewrite API で対象セクションを文脈に溶け込ませる
 */
export async function applyCrossUpdate(
  existingDoc: GraphiumDocument,
  proposal: CrossUpdateProposal,
  sourceNoteId: string,
  model: string | null,
  noteIndex?: NoteIndex,
): Promise<GraphiumDocument> {
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
    const converted = convertSectionsToBlocks([proposal.section], noteIndex);
    updatedKnowledgeLinks.push(...converted.knowledgeLinks);
    if (refIndex >= 0) {
      updatedBlocks = [
        ...updatedBlocks.slice(0, refIndex),
        ...converted.blocks,
        ...updatedBlocks.slice(refIndex),
      ];
    } else {
      updatedBlocks.push(...converted.blocks);
    }
  } else if (proposal.updateType === "revise_section" && proposal.section) {
    // rewrite API で対象セクションを書き換え
    const headingIdx = updatedBlocks.findIndex(
      (b) => b.type === "heading" && extractInlineText(b.content) === proposal.section!.heading,
    );
    if (headingIdx >= 0) {
      // 対象セクションのテキストを抽出
      let endIdx = headingIdx + 1;
      while (endIdx < updatedBlocks.length) {
        if (updatedBlocks[endIdx].type === "heading" && updatedBlocks[endIdx].props?.level === 2) break;
        endIdx++;
      }
      const existingContent = updatedBlocks.slice(headingIdx + 1, endIdx)
        .map((b: any) => extractInlineTextWithCitations(b.content))
        .filter(Boolean)
        .join("\n");

      // rewrite API で統合
      let rewrittenConverted: ConvertResult | null = null;
      try {
        const res = await fetch(`${API_BASE}/rewrite`, {
          method: "POST",
          headers: wikiHeaders(),
          body: JSON.stringify({
            existingSections: [{ heading: proposal.section.heading, content: existingContent }],
            newSections: [{ heading: proposal.section.heading, content: proposal.section.content }],
            editedSectionHeadings: existingDoc.wikiMeta?.editedSections ?? [],
            language: existingDoc.wikiMeta?.language ?? "ja",
          }),
        });
        if (res.ok) {
          const data = await res.json() as { sections: { heading: string; content: string }[] };
          if (data.sections?.length > 0) {
            rewrittenConverted = convertSectionsToBlocks(data.sections, noteIndex);
          }
        }
      } catch {
        // rewrite 失敗 → 従来の追記にフォールバック
      }

      if (rewrittenConverted) {
        // 対象セクション全体を書き換え
        updatedBlocks = [
          ...updatedBlocks.slice(0, headingIdx),
          ...rewrittenConverted.blocks,
          ...updatedBlocks.slice(endIdx),
        ];
        updatedKnowledgeLinks.push(...rewrittenConverted.knowledgeLinks);
      } else {
        // フォールバック: 末尾に追記（引用パース付き）
        const parsed = parseInlineCitations(proposal.section.content, noteIndex ?? []);
        const updateParagraph = {
          id: parsed.blockId,
          type: "paragraph",
          props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
          content: parsed.inlineContent,
          children: [],
        };
        updatedBlocks = [
          ...updatedBlocks.slice(0, endIdx),
          updateParagraph,
          ...updatedBlocks.slice(endIdx),
        ];
        updatedKnowledgeLinks.push(...parsed.knowledgeLinks);
      }
    } else {
      // セクション見出しが見つからない場合は add_section として処理
      const converted = convertSectionsToBlocks([proposal.section], noteIndex);
      updatedBlocks.push(...converted.blocks);
      updatedKnowledgeLinks.push(...converted.knowledgeLinks);
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
    headers: wikiHeaders(),
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
  wikiMetas: Map<string, { title: string; kind: WikiKind; headings: string[]; model?: string }>,
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
  wikiMetas: Map<string, { title: string; kind: WikiKind; headings: string[]; model?: string }>,
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
      text += `- **${c.title}**: ${c.sections.join(", ")}\n`;
    }
    text += "\n";
  }

  if (summaries.length > 0) {
    text += `### Summaries (${summaries.length})\n`;
    for (const s of summaries) {
      text += `- **${s.title}**: ${s.sections.join(", ")}\n`;
    }
  }

  return text;
}

// ── Synthesis（複数 Concept の統合） ──

import type { SynthesisCandidate, ConceptSnapshot } from "../../server/services/wiki-synthesizer";

type SynthesisResult = {
  candidates: SynthesisCandidate[];
  model?: string | null;
};

/**
 * Synthesis の候補を取得する
 */
export async function fetchSynthesisCandidates(
  concepts: ConceptSnapshot[],
  existingSynthesisTitles: string[],
  language: string,
): Promise<SynthesisResult> {
  if (concepts.length < 3) return { candidates: [] };

  const res = await fetch(`${API_BASE}/synthesize`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({ concepts, existingSynthesisTitles, language }),
  });

  if (!res.ok) {
    console.error("Synthesis API failed:", res.status);
    return { candidates: [] };
  }

  return res.json();
}

/**
 * SynthesisCandidate から GraphiumDocument を構築する
 */
export function buildSynthesisDocument(
  candidate: SynthesisCandidate,
  model: string | null,
  language?: string,
  noteIndex?: NoteIndex,
): GraphiumDocument {
  const now = new Date().toISOString();
  const converted = convertSectionsToBlocks(candidate.sections, noteIndex);

  // ソース Concept への参照セクション
  const refBlocks: any[] = [];
  const knowledgeLinks: any[] = [...converted.knowledgeLinks];

  refBlocks.push({
    id: crypto.randomUUID(),
    type: "heading",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
    content: [{ type: "text", text: "Source Concepts", styles: {} }],
    children: [],
  });

  for (let i = 0; i < candidate.sourceConceptIds.length; i++) {
    const blockId = crypto.randomUUID();
    const title = candidate.sourceConceptTitles[i] ?? candidate.sourceConceptIds[i];
    refBlocks.push({
      id: blockId,
      type: "bulletListItem",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [
        { type: "text", text: `@🤖 ${title}`, styles: { textColor: "blue" } },
      ],
      children: [],
    });
    knowledgeLinks.push({
      id: crypto.randomUUID(),
      sourceBlockId: blockId,
      targetBlockId: "",
      targetNoteId: candidate.sourceConceptIds[i],
      type: "reference",
      layer: "knowledge",
      createdBy: "ai",
    });
  }

  converted.blocks.push(...refBlocks);

  const wikiMeta: WikiMeta = {
    kind: "synthesis",
    derivedFromNotes: candidate.sourceConceptIds,
    derivedFromChats: [],
    generatedAt: now,
    generatedBy: {
      model: model ?? "unknown",
      version: "1.0.0",
    },
    lastIngestedAt: now,
    language: language ?? undefined,
  };

  return {
    version: 2,
    title: candidate.title,
    pages: [{
      id: "main",
      title: candidate.title,
      blocks: converted.blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks,
    }],
    source: "ai",
    wikiMeta,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * 既存の Concept ページからスナップショットを構築する（Synthesis 入力用）
 */
export function buildConceptSnapshots(
  wikiFiles: { id: string; modifiedTime: string }[],
  wikiMetas: Map<string, { title: string; kind: WikiKind; headings: string[]; model?: string }>,
  getCachedDoc: (id: string) => GraphiumDocument | null | undefined,
): ConceptSnapshot[] {
  const snapshots: ConceptSnapshot[] = [];

  for (const file of wikiFiles) {
    const meta = wikiMetas.get(file.id);
    if (!meta || meta.kind !== "concept") continue;

    const doc = getCachedDoc(`wiki:${file.id}`);
    const detail = doc ? extractWikiDetail(file.id, doc) : null;

    snapshots.push({
      id: file.id,
      title: meta.title,
      sections: detail
        ? detail.sectionHeadings.map((h, i) => ({
            heading: h,
            preview: detail.sectionPreviews[i] ?? "",
          }))
        : meta.headings.map((h) => ({ heading: h, preview: "" })),
      relatedConcepts: doc ? extractRelatedConcepts(doc).map(String) : [],
    });
  }

  return snapshots;
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
