// Wiki サービス（フロントエンド側）
// Ingest フロー・Wiki ドキュメント構築・Embedding 保存のオーケストレーション

import type { GraphiumDocument, WikiKind, WikiMeta, WikiMetaSummary } from "../../lib/document-types";
import type { ClaimSnapshot } from "../../server/services/wiki-types";
import { embeddingStore } from "../../lib/embedding-store";
import type { IngesterOutput } from "../../server/services/wiki-ingester";
import { summarizeNoteProv } from "../prov-extractor";
import { getEmbeddingModel, getDefaultLLMModel, getChatSynthesisLLMModel, getEmbeddingLLMModel, getSelectedModel, getChatSynthesisModelName } from "../settings/store";
import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { t } from "../../i18n";

import type { GraphiumIndex } from "../navigation";

/** サーバー API の URL ベース（Tauri: http://127.0.0.1:3001/api/wiki, Web: /api/wiki） */
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

/**
 * Web モード用: X-LLM-API-Key ヘッダーを含む共通ヘッダー。
 *
 * resolveModelConfig (server) はヘッダーを最優先するため、別モデルを使いたい工程では
 * モード別に適切な認証情報を送る必要がある。
 * - "default":       Default モデル（ingest / lint / rewrite / cross-update）
 * - "chatSynthesis": Chat & Synthesis 用モデル（未設定なら default）
 * - "embedding":     Embedding 用モデル（未設定なら default）
 */
/**
 * body.model を解決する。Tauri モードではヘッダー経由のモデル指定が無いため、
 * これを送らないとサーバー側 resolveModelConfig が `models[0]` にフォールバックする
 * （Web モードはヘッダー優先のため body.model は無視されるが、付けても害は無い）。
 *
 * - "default":       Default モデル（ingest / lint / rewrite / cross-update / URL→PROV）
 * - "chatSynthesis": Chat & Synthesis モデル（未設定時は Default）
 * - "embedding":     Embedding 用途は body.embedding_model を別途使うので空
 */
function wikiBodyModel(mode: "default" | "chatSynthesis" | "embedding" = "default"): { model?: string } {
  if (mode === "embedding") return {};
  const name = mode === "chatSynthesis" ? getChatSynthesisModelName() : getSelectedModel();
  return name ? { model: name } : {};
}

function wikiHeaders(mode: "default" | "chatSynthesis" | "embedding" = "default"): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model =
      mode === "chatSynthesis" ? getChatSynthesisLLMModel()
      : mode === "embedding" ? getEmbeddingLLMModel()
      : getDefaultLLMModel();
    if (model) {
      h["X-LLM-API-Key"] = JSON.stringify({
        provider: model.provider,
        modelId: model.modelId,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        name: model.name,
        rate: model.rate,
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

  // 提案 v4 Phase 2.2: ノートの PROV 構造をプロンプトに流すための要約。
  // ラベル不十分なノートでも部分情報を返すので、常に呼んで構わない。
  // Wiki ノート（source: "ai"）は再帰呼び出しなので PROV 構造を持たないが、
  // summarizeNoteProv は activities=[] / results=[] を返すだけで安全に動く。
  const provSummary = summarizeNoteProv(doc, { noteId });

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({
      noteId,
      noteContent,
      noteTitle: doc.title,
      existingWikiTitles: existingWikis,
      language,
      provSummary,
      ...(model ? { model } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（クライアントで i18n 表示するため）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
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
  const converted = convertSectionsToBlocks(ingesterOutput.sections, noteIndex, ingesterOutput.title);

  // 関連セクションを追加（派生元ノート + 関連 Concept）
  const relations = buildRelationBlocks(
    sourceNoteId,
    sourceNoteTitle,
    ingesterOutput.relatedClaims,
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
    level: ingesterOutput.kind === "claim" ? ingesterOutput.level : undefined,
    status: ingesterOutput.kind === "claim" ? "candidate" : undefined,
    evidenceSpan: ingesterOutput.evidenceSpan,
    // Phase 1.1: LLM が推定した research-process role を保存（claim のみ意味を持つ）
    claimRole: ingesterOutput.kind === "claim" ? ingesterOutput.claimRole : undefined,
    // Phase η: epistemicStatus を保存（claim のみ。index-file が一覧 UI にミラーする）
    epistemicStatus: ingesterOutput.kind === "claim" ? ingesterOutput.epistemicStatus : undefined,
    // Phase 2.3: LLM が推定した手順条件（PROV-AI ブリッジ）
    procedureContext: ingesterOutput.kind === "claim" ? ingesterOutput.procedureContext : undefined,
    // Phase γ: Toulmin Rebuttal / Backing / Modal qualifier（claim のみ意味を持つ）
    rebuttalConditions:
      ingesterOutput.kind === "claim" ? ingesterOutput.rebuttalConditions : undefined,
    backing: ingesterOutput.kind === "claim" ? ingesterOutput.backing : undefined,
    modalQualifier: ingesterOutput.kind === "claim" ? ingesterOutput.modalQualifier : undefined,
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
    // ドキュメント origin として AI による生成を明示する。
    // documentProvenance の各リビジョン attribution とは別概念
    // （origin は一度きり、attribution は保存毎）。
    generatedBy: {
      agent: "ai",
      sessionId: `wiki-ingest-${now}`,
      model: model ?? undefined,
    },
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * 既存 Wiki ドキュメントに新しいセクションを追記（merge）する
 */
/**
 * Claim の corroboration 昇格（candidate → verified）。
 *
 * DATA_MODEL.md §3.2 の約束（candidate = 1 ソース依拠 / verified = 独立した
 * 2 ソース以上が依拠）の実装。呼び出しは保存チョークポイント
 * （use-file-manager の handleSaveWikiFile / handleCreateWikiFile）に一本化する。
 * 成長関数ごとに散らばらせると、orphan 自動リンクが混入させる wiki ID や
 * 自己参照 ID（過去の regenerate バグ由来）を「独立ノート」と誤認して
 * 誤昇格する穴が生まれるため。
 * claim 以外・candidate 以外・独立ソース 1 件以下なら何もしない（冪等・降格なし）。
 */
export type PromoteClaimOptions = {
  /** この wiki 自身のファイル ID。自己参照混入（過去バグ由来）を数えない */
  selfId?: string;
  /** id を独立ソースとして数えるかの判定。他の wiki ページの ID を
   *  corroboration に数えないためのフィルタ。未指定なら全 id を数える */
  isIndependentSource?: (id: string) => boolean;
};

export function promoteClaimStatusIfCorroborated<T extends GraphiumDocument["wikiMeta"]>(
  meta: T,
  options?: PromoteClaimOptions,
): T {
  if (!meta || meta.kind !== "claim" || meta.status !== "candidate") return meta;
  const { selfId, isIndependentSource } = options ?? {};
  const distinctSources = new Set(
    (meta.derivedFromNotes ?? [])
      .filter(Boolean)
      .filter((id) => id !== selfId)
      .filter((id) => (isIndependentSource ? isIndependentSource(id) : true)),
  );
  if (distinctSources.size < 2) return meta;
  return { ...meta, status: "verified" as const };
}

export function mergeIntoWikiDocument(
  existingDoc: GraphiumDocument,
  ingesterOutput: IngesterOutput,
  sourceNoteId: string,
  model: string | null,
  noteIndex?: NoteIndex,
): GraphiumDocument {
  const now = new Date().toISOString();
  const converted = convertSectionsToBlocks(
    ingesterOutput.sections,
    noteIndex,
    existingDoc.title,
  );
  const page = existingDoc.pages[0];
  const existingBlocks = page?.blocks ?? [];

  // 既存 References セクション（"References" / "関連" 等の H2 以降）の位置を探し、
  // 新セクションは References の **前** に挿入する。
  // 末尾追加だと References が本文の途中に埋もれ、リーダー視点で導線が崩れるため。
  const refIdx = existingBlocks.findIndex(
    (b: any) =>
      b?.type === "heading" &&
      isReferencesHeading(extractInlineText(b.content)),
  );
  const mergedBlocks =
    refIdx >= 0
      ? [
          ...existingBlocks.slice(0, refIdx),
          ...converted.blocks,
          ...existingBlocks.slice(refIdx),
        ]
      : [...existingBlocks, ...converted.blocks];

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
    generatedBy: {
      agent: "ai",
      sessionId: existingDoc.generatedBy?.sessionId ?? `wiki-ingest-${now}`,
      model: model ?? existingDoc.generatedBy?.model ?? undefined,
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
  skills?: { title: string; prompt: string }[],
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
        ...(model ? { model } : wikiBodyModel()),
        ...(skills && skills.length > 0 ? { skills } : {}),
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
    const converted = convertSectionsToBlocks(data.sections, noteIndex, existingDoc.title);

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
      generatedBy: {
        agent: "ai",
        sessionId: existingDoc.generatedBy?.sessionId ?? `wiki-ingest-${now}`,
        model: model ?? existingDoc.generatedBy?.model ?? undefined,
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
  /** 生成中／再生成中の Wiki 自身のタイトル。これと一致する引用は自己参照なのでリンク化しない。 */
  selfTitle?: string,
): void {
  // 自己引用ガード: LLM がまれに「この知見こそが観測の根拠だ」と自分のタイトルを
  // [[...]] で引用してくることがある。再生成時は自分自身も noteIndex に乗るため、
  // そのまま resolve すると「自分が自分の根拠」という循環リンクになる。
  // リンク化せずプレーンテキストに落とす（knowledgeLink も作らない）。
  if (selfTitle && citedTitle.trim() === selfTitle.trim()) {
    inlineContent.push({ type: "text", text: citedTitle, styles: {} });
    return;
  }

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
  /** 生成中／再生成中の Wiki 自身のタイトル（自己引用ガード用） */
  selfTitle?: string,
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
      pushCitation(inlineContent, knowledgeLinks, blockId, match[1], noteIndex, selfTitle);
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
/** 「References / 関連 / 参考文献」など、buildRelationBlocks 側が自動生成する
 * セクションと衝突する見出しを判定する。LLM が誤ってこの種のセクションを
 * 出力したときに二重 References になるのを防ぐ。 */
function isReferencesHeading(heading: string): boolean {
  const h = heading.trim().toLowerCase();
  if (!h) return false;
  return (
    h === "references" ||
    h === "reference" ||
    h === "related" ||
    h === "see also" ||
    h === "関連" ||
    h === "参考" ||
    h === "参考文献" ||
    h === "出典"
  );
}

/** 1 行が markdown の ATX 見出し（`## xxx` / `### xxx`）かを判定し、レベルとテキストを返す。
 * LLM が section.content 内に見出し記法を埋め込んでくる事故への防御。 */
function parseMarkdownHeading(line: string): { level: number; text: string } | null {
  const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!m) return null;
  return { level: Math.min(m[1].length, 3), text: m[2].trim() };
}

function convertSectionsToBlocks(
  sections: { heading: string; content: string }[],
  noteIndex: NoteIndex = [],
  /** 生成中／再生成中の Wiki 自身のタイトル（自己引用ガード用） */
  selfTitle?: string,
): ConvertResult {
  const blocks: any[] = [];
  const knowledgeLinks: any[] = [];

  for (const section of sections) {
    const trimmedHeading = (section.heading ?? "").trim();

    // References 系の見出しは buildRelationBlocks 側で生成されるため、
    // セクションごと丸ごとスキップして二重生成を防ぐ。
    if (isReferencesHeading(trimmedHeading)) continue;

    // H2 見出しブロック（heading が空文字の場合はスキップ。短い Concept で
    // セクション分けが不要な場合に LLM が `heading: ""` を返すことがあるため）
    if (trimmedHeading) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "heading",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
          level: 2,
        },
        content: [{ type: "text", text: trimmedHeading, styles: {} }],
        children: [],
      });
    }

    // コンテンツを行ごとに分割し、`## ...` 形式の markdown 見出しは
    // 生テキスト段落ではなく proper な heading ブロックに変換する。
    const paragraphs = section.content.split("\n").filter(Boolean);
    for (const para of paragraphs) {
      const md = parseMarkdownHeading(para);
      if (md) {
        // References 系の埋め込み見出しもここでドロップする。
        if (isReferencesHeading(md.text)) continue;
        blocks.push({
          id: crypto.randomUUID(),
          type: "heading",
          props: {
            textColor: "default",
            backgroundColor: "default",
            textAlignment: "left",
            level: md.level,
          },
          content: [{ type: "text", text: md.text, styles: {} }],
          children: [],
        });
        continue;
      }
      const parsed = parseInlineCitations(para, noteIndex, selfTitle);
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
  relatedClaims?: { title: string; citation: string }[],
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
  if (relatedClaims && relatedClaims.length > 0 && existingWikiTitles) {
    for (const concept of relatedClaims) {
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
      headers: wikiHeaders("embedding"),
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

  const kind = doc.wikiMeta?.kind ?? "claim";
  const docTitle = doc.title;
  const sections: { documentId: string; sectionId: string; text: string }[] = [];

  let currentHeading: { id: string; text: string } | null = null;
  let currentContent: string[] = [];
  // 最初の H2 より前の本文（lead）。Atom は洞察の本文がここに来るため、
  // H2 セクションだけを embed すると重複判定・Retriever が「Source Claims」
  // （Claim タイトルの列挙）頼みになり、本文の主張で照合できない。
  const leadContent: string[] = [];

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

  // マルチカラム（columnList / column）はレイアウト用ラッパーなので透過して
  // 文書順の flat 列として走査する。透過しないとカラム内の本文が embedding から
  // 漏れ、Retriever・重複判定に不可視になる。
  const flattenColumns = (blocks: any[]): any[] =>
    (blocks ?? []).flatMap((block) =>
      block.type === "columnList" || block.type === "column"
        ? flattenColumns(block.children)
        : [block],
    );

  for (const block of flattenColumns(page.blocks)) {
    if (block.type === "heading" && block.props?.level === 2) {
      flushSection();
      const headingText = extractInlineText(block.content);
      currentHeading = { id: block.id, text: headingText };
    } else if (currentHeading) {
      const text = extractInlineText(block.content);
      if (text) currentContent.push(text);
    } else {
      const text = extractInlineText(block.content);
      if (text) leadContent.push(text);
    }
  }
  flushSection();

  // lead は先頭に置く（本文の主張が照合の主役になるように）。
  // sectionId "lead" は擬似 ID — embedding store の複合キー要素と検索結果の
  // スニペット表示にしか使われず、block ID として逆引きされることはない。
  const lead = leadContent.join(" ").trim();
  if (lead) {
    sections.unshift({
      documentId,
      sectionId: "lead",
      text: `${kind}: ${docTitle}: ${lead}`,
    });
  }

  return sections;
}

/**
 * GraphiumDocument からプレーンテキストを抽出する
 */
export function extractPlainTextFromDoc(doc: GraphiumDocument): string {
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
    throw await aiErrorFromResponse(fetchRes, `URL fetch failed (${fetchRes.status})`);
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
      ...wikiBodyModel(),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（クライアントで i18n 表示するため）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  return res.json();
}

/**
 * PDF Blob からテキスト抽出 → Wiki を生成する
 *
 * PDF パースはクライアント側で react-pdf の pdfjs を流用する。
 * サーバーには抽出済みテキストを通常の /ingest と同じ形で投げる。
 */
export async function ingestFromPdf(
  blob: Blob,
  fileName: string,
  sourceNoteId: string,
  existingWikis: ExistingWikiInfo[],
  language: string,
): Promise<IngestResult & { pageCount: number }> {
  const { extractPdfText } = await import("./pdf-text-extractor");
  const extracted = await extractPdfText(blob);

  if (!extracted.text || extracted.text.length < 50) {
    throw new Error(t("ingest.pdfNoText"));
  }

  // 本文に CJK 文字が一定比率含まれていれば、PDF メタデータ Title が ASCII のみ
  // （LaTeX 等が埋める英語タイトル）の場合は捨ててファイル名を使う。
  // メタデータの英語 Title が LLM の出力言語に引きずられる原因になるため。
  const bodyHasCJK = /[぀-ヿ一-鿿]/.test(extracted.text);
  const titleIsAsciiOnly = extracted.title.length > 0 && /^[\x00-\x7F]+$/.test(extracted.title);
  const fallbackTitle = fileName.replace(/\.pdf$/i, "");
  const noteTitle =
    bodyHasCJK && titleIsAsciiOnly
      ? fallbackTitle
      : extracted.title || fallbackTitle;

  // 抽出テキスト冒頭に出力言語ヒントを再掲する。システムプロンプト末尾の
  // "Output in: ..." 指示が長文中で軽視されるケースに備えた近接リマインダ。
  const languageHint =
    language === "ja"
      ? "[出力言語: 日本語で書いてください。Summary も Claim もすべて日本語にしてください]"
      : `[Output language: ${language}]`;
  const noteContent = `${languageHint}\n\n${extracted.text}`;

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({
      noteId: sourceNoteId,
      noteContent,
      noteTitle,
      existingWikiTitles: existingWikis,
      language,
      ...wikiBodyModel(),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（クライアントで i18n 表示するため）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  const data = (await res.json()) as IngestResult;
  return { ...data, pageCount: extracted.pageCount };
}

/**
 * Word (.docx) 素材から Wiki を ingest する。
 * mammoth で extractRawText を呼んでプレーンテキストを取り出し、
 * PDF と同じ /ingest API に流す。Excel/PowerPoint は未対応（呼ばないこと）。
 */
export async function ingestFromDocx(
  blob: Blob,
  fileName: string,
  sourceNoteId: string,
  existingWikis: ExistingWikiInfo[],
  language: string,
): Promise<IngestResult> {
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = await import("mammoth");
  const extracted = await mammoth.extractRawText({ arrayBuffer });
  const text = (extracted.value ?? "").trim();

  if (!text || text.length < 50) {
    throw new Error(t("ingest.docxNoText"));
  }

  const noteTitle = fileName.replace(/\.(docx|doc)$/i, "");

  // PDF と同じく、本文冒頭に出力言語ヒントを再掲する
  const languageHint =
    language === "ja"
      ? "[出力言語: 日本語で書いてください。Summary も Claim もすべて日本語にしてください]"
      : `[Output language: ${language}]`;
  const noteContent = `${languageHint}\n\n${text}`;

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({
      noteId: sourceNoteId,
      noteContent,
      noteTitle,
      existingWikiTitles: existingWikis,
      language,
      ...wikiBodyModel(),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（クライアントで i18n 表示するため）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  return (await res.json()) as IngestResult;
}

// ── マルチソース Ingest（regenerate 用） ──

/** 1 つの再生成対象につき複数のソース（note / pdf / url）から抽出したテキスト塊。
 * caller が事前に各ソースを解決して text 化しておく前提。 */
export type MultiSourcePart = {
  /** 元のソース ID（`<uuid>` / `pdf:<id>` / `url:<url>` / `memo:<captureId>` 形式そのまま） */
  sourceNoteId: string;
  /** ヘッダ表示・LLM への手がかりとなる人間可読タイトル */
  title: string;
  /** プレーンテキスト本文 */
  text: string;
  kind: "note" | "pdf" | "url" | "memo";
};

/**
 * 複数のソース（note + pdf + url）を 1 度の ingest 呼び出しに束ねて渡し、
 * Wiki を再生成する。merge ingest で育ったマルチソース Concept の regenerate に使う。
 *
 * 各ソースは `## Source N: <title>` ブロックで区切って LLM に渡し、すべてを
 * 横断した synthesis を 1 つの Concept として返してもらう想定。
 */
export async function ingestFromMultiSource(
  parts: MultiSourcePart[],
  /** 再生成対象の Wiki タイトル（LLM がフォーカスすべき既存の主題） */
  wikiTitle: string,
  /** 再生成対象の Wiki ID（noteId として渡す。derivedFromNotes 解決には使わない） */
  wikiId: string,
  existingWikis: ExistingWikiInfo[],
  language: string,
  model?: string,
  skills?: { title: string; prompt: string }[],
): Promise<IngestResult> {
  if (parts.length === 0) {
    throw new Error(t("ingest.noSources"));
  }

  const languageHint =
    language === "ja"
      ? "[出力言語: 日本語で書いてください。Summary も Claim もすべて日本語にしてください]"
      : `[Output language: ${language}]`;

  const sourceBlocks = parts
    .map((p, i) => {
      const kindLabel = p.kind === "pdf" ? "PDF" : p.kind === "url" ? "URL" : p.kind === "memo" ? "Memo" : "Note";
      return `## Source ${i + 1} [${kindLabel}]: ${p.title}\n\n${p.text}`;
    })
    .join("\n\n---\n\n");

  // 単一ソース ingest と同じ /ingest エンドポイントに投げるが、Wiki タイトルを
  // noteTitle として渡すことで「この Concept を作り直す」というフォーカスを
  // LLM に与える。System prompt 側の Summary/Concept 構造はそのまま流用する。
  const noteContent = `${languageHint}\n\n${sourceBlocks}`;

  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({
      noteId: wikiId,
      noteContent,
      noteTitle: wikiTitle,
      existingWikiTitles: existingWikis,
      language,
      ...(model ? { model } : wikiBodyModel()),
      ...(skills && skills.length > 0 ? { skills } : {}),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（クライアントで i18n 表示するため）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  return res.json() as Promise<IngestResult>;
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
      ...wikiBodyModel(),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（クライアントで i18n 表示するため）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
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
  skills?: { title: string; prompt: string }[];
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
    body: JSON.stringify({ ...input, ...wikiBodyModel() }),
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
  skills?: { title: string; prompt: string }[],
  language?: string,
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
    const converted = convertSectionsToBlocks([proposal.section], noteIndex, existingDoc.title);
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
            language: existingDoc.wikiMeta?.language ?? language ?? "en",
            ...(model ? { model } : wikiBodyModel()),
            ...(skills && skills.length > 0 ? { skills } : {}),
          }),
        });
        if (res.ok) {
          const data = await res.json() as { sections: { heading: string; content: string }[] };
          if (data.sections?.length > 0) {
            rewrittenConverted = convertSectionsToBlocks(data.sections, noteIndex, existingDoc.title);
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
        const parsed = parseInlineCitations(proposal.section.content, noteIndex ?? [], existingDoc.title);
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
      const converted = convertSectionsToBlocks([proposal.section], noteIndex, existingDoc.title);
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
    generatedBy: {
      agent: "ai",
      sessionId: existingDoc.generatedBy?.sessionId ?? `wiki-cross-update-${now}`,
      model: model ?? existingDoc.generatedBy?.model ?? undefined,
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
  if (!doc.wikiMeta || doc.wikiMeta.kind !== "claim") return null;

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
    body: JSON.stringify({ wikis, language, localOnly, ...wikiBodyModel() }),
  });

  if (!res.ok) {
    throw await aiErrorFromResponse(res, `Lint failed (${res.status})`);
  }

  return res.json();
}

/**
 * Wiki ドキュメント一覧から Lint 用のスナップショットを構築する
 */
export function buildWikiSnapshots(
  wikiFiles: { id: string; modifiedTime: string }[],
  wikiMetas: Map<string, WikiMetaSummary>,
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
      relatedClaims: extractRelatedClaims(doc),
      bodyPreview: doc ? extractBodyPreview(doc, 240) : "",
      level: meta.kind === "claim" ? meta.level : undefined,
      lastIngestedAt: wikiMeta?.lastIngestedAt,
      modifiedAt: file.modifiedTime,
    });
  }

  return snapshots;
}

/**
 * Wiki ドキュメントから関連 Concept タイトルを抽出する
 */
function extractRelatedClaims(doc: GraphiumDocument | null | undefined): string[] {
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
  /** 本文先頭のプレビュー（1ノート1知見前提で sections は廃止） */
  bodyPreview: string;
  /** Concept のとき principle / finding / bridge */
  level?: "principle" | "finding" | "bridge";
  derivedFromNotes: string[];
  relatedClaims: string[];
  modifiedAt: string;
};

/**
 * LLM が参照可能な構造化 Wiki インデックスを構築する
 * Retriever のコンテキストに注入して、LLM が Wiki 全体像を把握できるようにする
 */
export function buildWikiIndex(
  wikiFiles: { id: string; modifiedTime: string }[],
  wikiMetas: Map<string, WikiMetaSummary>,
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
      bodyPreview: doc ? extractBodyPreview(doc, 200) : "",
      level: meta.kind === "claim" ? meta.level : undefined,
      derivedFromNotes: doc?.wikiMeta?.derivedFromNotes ?? [],
      relatedClaims: extractRelatedClaims(doc),
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
  const concepts = entries.filter((e) => e.kind === "claim");
  const syntheses = entries.filter((e) => e.kind === "synthesis");
  const atoms = entries.filter((e) => e.kind === "atom");

  let text = `## Wiki Index (${entries.length} pages)\n\n`;

  if (concepts.length > 0) {
    text += `### Concepts (${concepts.length})\n`;
    for (const c of concepts) {
      const tag = c.level ? ` [${c.level}]` : "";
      text += `- **${c.title}**${tag}: ${c.bodyPreview}\n`;
    }
    text += "\n";
  }

  if (summaries.length > 0) {
    text += `### Summaries (${summaries.length})\n`;
    for (const s of summaries) {
      text += `- **${s.title}**: ${s.bodyPreview}\n`;
    }
    text += "\n";
  }

  if (syntheses.length > 0) {
    text += `### Syntheses (${syntheses.length})\n`;
    for (const s of syntheses) {
      text += `- **${s.title}**: ${s.bodyPreview}\n`;
    }
    text += "\n";
  }

  // Atom はノート由来の具体的な観察・データ断片。
  // Concept/Synthesis と並べて LLM が選べるようにする（質問によっては
  // atom が一次ソースとして最も適切な引用元になる）。
  if (atoms.length > 0) {
    text += `### Atoms (${atoms.length})\n`;
    for (const a of atoms) {
      text += `- **${a.title}**: ${a.bodyPreview}\n`;
    }
  }

  return text;
}

// ── Discovery 共通: embedding ベースの post-filter（重複検出の safety net） ──

/** partitionCandidatesByEmbedding の戻り値 */
export type CandidatePartition<T> = {
  /** 重複と判定されなかった候補（新規作成に回す） */
  kept: T[];
  /** 既存同 kind ドキュメントとの重複と判定された候補。
   *  matchedDocId は最も類似度が高かった既存ドキュメントの ID —
   *  Atom なら reinforceAtomWithClaims でその Atom の支持 Claim として取り込める。 */
  duplicates: { candidate: T; matchedDocId: string; score: number }[];
};

/**
 * Atom / Synthesis の discovery 候補を、既存同 kind ドキュメントとの embedding 類似度で
 * 「新規（kept）」と「既存との重複（duplicates + 一致先 ID）」に分割する。
 * LLM プロンプトベースの "Existing titles" 重複防止に対する安全網。
 *
 * 設計の意図:
 *   - embedding モデル必須にはしない。設定が無い / API が失敗したら **全て kept**（fail-open）。
 *   - 既存が空 / 候補が空のときは即返す（embedding API を叩かない）。
 *   - 類似度はセクション単位で計算され、同 kind の任意のセクションと閾値超えしたら duplicate。
 */
export async function partitionCandidatesByEmbedding<T extends { title: string; body: string }>(
  candidates: T[],
  existingSameKindDocIds: Set<string>,
  threshold = 0.9,
): Promise<CandidatePartition<T>> {
  if (candidates.length === 0 || existingSameKindDocIds.size === 0) {
    return { kept: candidates, duplicates: [] };
  }

  // embedding モデルが未設定なら fail-open（プロンプトベース dedup に任せる）
  const embModel = getEmbeddingLLMModel();
  if (!embModel) return { kept: candidates, duplicates: [] };

  try {
    // 各候補の title + body を embed
    const texts = candidates.map((c, i) => ({
      documentId: `__candidate_${i}__`,
      sectionId: "main",
      text: `${c.title}\n\n${c.body}`,
    }));
    const res = await fetch(`${API_BASE}/embed`, {
      method: "POST",
      headers: wikiHeaders("embedding"),
      body: JSON.stringify({
        texts,
        embedding_model: getEmbeddingModel() || undefined,
      }),
    });
    if (!res.ok) return { kept: candidates, duplicates: [] }; // fail-open

    const data = await res.json() as {
      embeddings: { documentId: string; sectionId: string; vector: number[] }[];
    };

    // 既存同 kind ドキュメントの中で類似度 > threshold のものがあれば duplicate
    const TOP_K = 3;
    const kept: T[] = [];
    const duplicates: CandidatePartition<T>["duplicates"] = [];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const emb = data.embeddings.find((e) => e.documentId === `__candidate_${i}__`);
      if (!emb || emb.vector.length === 0) {
        kept.push(candidate); // ベクトル取れず → 素通し
        continue;
      }
      const results = await embeddingStore.searchByVector(emb.vector, TOP_K);
      const best = results
        .filter((r) => existingSameKindDocIds.has(r.documentId) && r.score > threshold)
        .sort((a, b) => b.score - a.score)[0];
      if (best) {
        duplicates.push({ candidate, matchedDocId: best.documentId, score: best.score });
      } else {
        kept.push(candidate);
      }
    }
    return { kept, duplicates };
  } catch (err) {
    console.warn("partitionCandidatesByEmbedding failed, falling through:", err);
    return { kept: candidates, duplicates: [] }; // fail-open
  }
}

/**
 * @deprecated 呼び出し側が重複の一致先を使わない場合の互換ラッパ。
 * 新規コードは partitionCandidatesByEmbedding を使う。
 */
export async function dedupCandidatesByEmbedding<T extends { title: string; body: string }>(
  candidates: T[],
  existingSameKindDocIds: Set<string>,
  threshold = 0.9,
): Promise<T[]> {
  const { kept } = await partitionCandidatesByEmbedding(candidates, existingSameKindDocIds, threshold);
  return kept;
}

// ── Atom（実験的レイヤ）──

export type AtomCandidate = {
  title: string;
  body: string;
  derivedFromClaims: string[];
  /** 上流 Concept のタイトル（id と同じ並びで対応）。@リンク描画用。 */
  derivedFromConceptTitles: string[];
  confidence: number;
  /** 推論的役割（提案 v4 Phase 1.2）。LLM 推定。undefined でも従来通り。 */
  atomType?: import("../../lib/document-types").AtomType;
  /** 関係の形（form＝構造写像の軸のリーフ、decompose→shape→abstract） */
  shape?: import("../../lib/document-types").AtomShape;
  /** 関係の形の上位軸（family）。form を真実源に決定論導出（route 側で補正済み）。 */
  shapeFamily?: import("../../lib/document-types").ShapeFamily;
  /** 越境転移（ジャッジ検証済みのみ。妥当な転移が無ければ undefined） */
  transfer?: import("../../lib/document-types").AtomTransfer;
  /**
   * フォール検証で derivedFromClaims から外された Claim 数（transport-only、非永続）。
   * >0 = 束ねた Claim の一部が同じ shape でないと判定され除外された。
   */
  foldDroppedClaims?: number;
  /** Phase η: 入力 Claim の最低 status を継承した epistemicStatus */
  epistemicStatus?: import("../../lib/document-types").EpistemicStatus;
  /** Phase γ: 2+ Claim 共通の Toulmin Rebuttal が Atom 層に伝播したもの */
  rebuttalConditions?: string[];
  /** Phase δ: Atom 間 dimensional 関係（axial coding）。0-3 件、parser 側で fixed vocabulary を検証済み。 */
  relatedAtoms?: import("../../lib/document-types").AtomRelation[];
  // PR-B4.5: procedureContext は Atom には持たない（砂時計のくびれ）
  // Toulmin の backing / modalQualifier も Atom には持たない（Claim 層のみ）
};

export type AtomizeResult = { atoms: AtomCandidate[]; model?: string };

/**
 * 複数の Concept を入力し、Concept をまたいで現れる共通抽象（Atom）の候補を 0〜N 件返す。
 * 既存 Atom のタイトル一覧を渡すと重複提案を抑える。
 * experimental.atomLayer 有効時にクライアントから呼ぶ。
 */
export async function atomizeConcepts(
  concepts: ClaimSnapshot[],
  language: string,
  options?: { existingAtomTitles?: string[]; model?: string },
): Promise<AtomizeResult> {
  // 単一ソース Atom は #459 で許可済み（route は concepts >= 1 を受ける）。
  // ここで < 2 を弾くと regenerate の単一ソース re-lift が無言で失敗するため、空のときだけ弾く。
  if (concepts.length < 1) return { atoms: [] };
  const res = await fetch(`${API_BASE}/atomize`, {
    method: "POST",
    headers: wikiHeaders("chatSynthesis"),
    body: JSON.stringify({
      concepts,
      ...(options?.existingAtomTitles ? { existingAtomTitles: options.existingAtomTitles } : {}),
      language,
      ...(options?.model ? { model: options.model } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Atomize API failed (${res.status}): ${detail.slice(0, 200) || "no body"}`);
  }
  // サーバーは内部例外時 200 + { atoms: [], error: "...", code? } を返すため、ここでも検出する
  const data = await res.json() as AtomizeResult & { error?: string; code?: string };
  if (data.error) {
    const err = new Error(`Atomize failed on server: ${data.error}`);
    // code があれば Error に載せる（localizeAiError が i18n 文言に変換する）
    if (typeof data.code === "string") (err as Error & { code?: string }).code = data.code;
    throw err;
  }
  return data;
}

/**
 * AtomCandidate から GraphiumDocument を構築する。
 * Atom は Zettel 1 アイデアなので、本文は短い段落のみ。見出しは付けない。
 */
export function buildAtomDocument(
  candidate: AtomCandidate,
  model: string | null,
  language?: string,
): GraphiumDocument {
  const now = new Date().toISOString();
  const blocks: any[] = candidate.body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map((para) => ({
      id: crypto.randomUUID(),
      type: "paragraph",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: para, styles: {} }],
      children: [],
    }));

  // Source Claims セクション
  const knowledgeLinks: any[] = [];
  if (candidate.derivedFromClaims.length > 0) {
    blocks.push({
      id: crypto.randomUUID(),
      type: "heading",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
      content: [{ type: "text", text: "Source Claims", styles: {} }],
      children: [],
    });
    for (let i = 0; i < candidate.derivedFromClaims.length; i++) {
      const conceptId = candidate.derivedFromClaims[i];
      // タイトルが取れない場合は ID にフォールバックするが、これは index 不整合のサインなので
      // 実運用ではほぼ起きない想定
      const conceptTitle = candidate.derivedFromConceptTitles?.[i] ?? conceptId;
      const blockId = crypto.randomUUID();
      blocks.push({
        id: blockId,
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [
          { type: "text", text: `@🤖 ${conceptTitle}`, styles: { textColor: "blue" } },
        ],
        children: [],
      });
      knowledgeLinks.push({
        id: crypto.randomUUID(),
        sourceBlockId: blockId,
        targetBlockId: "",
        targetNoteId: conceptId,
        type: "reference",
        layer: "knowledge",
        createdBy: "ai",
      });
    }
  }

  const wikiMeta: WikiMeta = {
    kind: "atom",
    derivedFromNotes: [],
    derivedFromChats: [],
    derivedFromClaims: candidate.derivedFromClaims,
    generatedAt: now,
    generatedBy: { model: model ?? "unknown", version: "1.0.0" },
    lastIngestedAt: now,
    language: language ?? undefined,
    confidence: candidate.confidence,
    // Phase 1.2: Atom の推論的役割（LLM 推定。undefined でも従来通り動作）
    atomType: candidate.atomType,
    // 構造的抽象: 関係の形（form=shape / 上位軸=shapeFamily）と越境転移（ジャッジ検証済みのみ）
    // shapeFamily は form から決定論導出できるが、明示保存して読み出しコストを省く。
    // 注: foldDroppedClaims は transport-only（診断用カウント）なので永続化しない。
    shape: candidate.shape,
    shapeFamily: candidate.shapeFamily,
    transfer: candidate.transfer,
    // Phase η: source Claim から継承した最低 status（lowest-status inheritance, parser 側で強制）
    epistemicStatus: candidate.epistemicStatus,
    // Phase γ: 2+ Claim 共通の Rebuttal を Atom 層に伝播したもの。Atom には backing / modalQualifier は持たない。
    rebuttalConditions:
      candidate.rebuttalConditions && candidate.rebuttalConditions.length > 0
        ? candidate.rebuttalConditions
        : undefined,
    // Phase δ: Atom 間 dimensional 関係（axial coding）。Atomizer parser でサニタイズ + 上限 3 済み。
    // 後段の cross-update 等で title → 正式 atomId 解決が行われる前提で、ここではそのまま保存する。
    relatedAtoms:
      candidate.relatedAtoms && candidate.relatedAtoms.length > 0
        ? candidate.relatedAtoms
        : undefined,
    // PR-B4.5: procedureContext は Atom に持たない（context-stripped）
  };

  return {
    version: 2,
    title: candidate.title,
    pages: [{
      id: "main",
      title: candidate.title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks,
    }],
    source: "ai",
    wikiMeta,
    generatedBy: {
      agent: "ai",
      sessionId: `wiki-atomize-${now}`,
      model: model ?? undefined,
    },
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Atom の「支持追加（reinforcement）」— Atom の成長経路。
 *
 * discovery が既存 Atom と重複する候補を出したとき、従来は候補ごと捨てていた
 * （新しい Claim 群と既存 Atom の対応が失われる）。代わりに、候補が依拠していた
 * Claim のうち既存 Atom がまだ知らないものを derivedFromClaims に取り込む。
 *
 * 本文には触れない — 「保存より再生成優先」の設計に合わせて、育った支持集合は
 * 次の re-lift / regenerate（derivedFromClaims を温存して使う）で本文に反映される。
 * 新しい支持 Claim が無ければ null（保存不要）。
 */
export function reinforceAtomWithClaims(
  existingDoc: GraphiumDocument,
  candidate: Pick<AtomCandidate, "derivedFromClaims">,
): { doc: GraphiumDocument; addedClaimIds: string[] } | null {
  if (existingDoc.wikiMeta?.kind !== "atom") return null;
  const known = new Set(existingDoc.wikiMeta.derivedFromClaims ?? []);
  // LLM 出力の sourceConceptIds は同一 ID を重複列挙し得るので候補側も dedupe する
  const fresh = [
    ...new Set((candidate.derivedFromClaims ?? []).filter((id) => id && !known.has(id))),
  ];
  if (fresh.length === 0) return null;
  const now = new Date().toISOString();
  return {
    doc: {
      ...existingDoc,
      wikiMeta: {
        ...existingDoc.wikiMeta,
        derivedFromClaims: [...(existingDoc.wikiMeta.derivedFromClaims ?? []), ...fresh],
        lastIngestedAt: now,
      },
      modifiedAt: now,
    },
    addedClaimIds: fresh,
  };
}

/**
 * 既存の Concept ページからスナップショットを構築する（Synthesis 入力用）
 *
 * 誤差伝搬対策として、Concept の `derivedFromNotes` と一致する Summary を
 * 引いて先頭セクションのプレビューを併記する。Synthesizer が Concept だけでなく
 * 上流の Summary にも触れることで、独立な誤差を集約・矛盾検出しやすくする。
 */
/**
 * Atomize/Synthesize の 1 リクエストに含める Concept/Atom の最大件数。
 * 際限なく投入すると LLM のコンテキスト長を超えてサイレント失敗する。
 * 直近更新分から優先して採用する。
 */
export const MAX_SNAPSHOTS_PER_RUN = 50;

export function buildClaimSnapshots(
  wikiFiles: { id: string; modifiedTime: string }[],
  wikiMetas: Map<string, WikiMetaSummary>,
  getCachedDoc: (id: string) => GraphiumDocument | null | undefined,
  /**
   * Synthesizer に渡すソースの kind。
   * Atom レイヤを有効にした構成では "atom" を渡し、Atom 同士の結晶化として Synthesis を生成する。
   * 既定の "claim" は legacy 経路（実験フラグ OFF 時には呼ばれない想定）。
   */
  sourceKind: "claim" | "atom" = "claim",
  /** 件数上限（既定: MAX_SNAPSHOTS_PER_RUN）。直近更新優先で切り詰める */
  limit: number = MAX_SNAPSHOTS_PER_RUN,
): ClaimSnapshot[] {
  // Summary 索引: 派生元 noteId → { title, preview }
  const summaryByNote = new Map<string, { title: string; preview: string }>();
  for (const file of wikiFiles) {
    const meta = wikiMetas.get(file.id);
    if (!meta || meta.kind !== "summary") continue;
    const doc = getCachedDoc(`wiki:${file.id}`);
    if (!doc) continue;
    const preview = extractBodyPreview(doc, 240);
    for (const noteId of doc.wikiMeta?.derivedFromNotes ?? []) {
      if (!summaryByNote.has(noteId)) {
        summaryByNote.set(noteId, { title: meta.title, preview });
      }
    }
  }

  const snapshots: ClaimSnapshot[] = [];

  // 直近更新を優先したいので modifiedTime 降順で見る。
  const orderedFiles = [...wikiFiles].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));

  for (const file of orderedFiles) {
    if (snapshots.length >= limit) break;
    const meta = wikiMetas.get(file.id);
    if (!meta || meta.kind !== sourceKind) continue;

    const doc = getCachedDoc(`wiki:${file.id}`);

    // この Concept が依拠している Summary を集める（重複除去）
    const summarySet = new Map<string, string>();
    for (const noteId of doc?.wikiMeta?.derivedFromNotes ?? []) {
      const s = summaryByNote.get(noteId);
      if (s && !summarySet.has(s.title)) summarySet.set(s.title, s.preview);
    }
    const sourceSummaryPreviews = Array.from(summarySet.entries()).map(([title, preview]) => ({ title, preview }));

    snapshots.push({
      id: file.id,
      title: meta.title,
      bodyPreview: doc ? extractBodyPreview(doc, 240) : "",
      level: meta.level,
      relatedClaims: doc ? extractRelatedClaims(doc).map(String) : [],
      sourceSummaryPreviews,
      // PR-B4.5: procedureContext は ClaimSnapshot に含めない（Atom/Synthesis
      // 層へは流さない）。reproducibility は wikiMeta の derivedFromNotes 経由で
      // on-demand に source Claim を引く設計。
      // PR-B5: Atom source の場合は atomType を伝搬し、サーバー側 synthesis-router で
      // モード候補の推定に使う（"claim" source では undefined のまま）。
      atomType: sourceKind === "atom" ? meta.atomType : undefined,
    });
  }

  return snapshots;
}

/**
 * Wiki ドキュメントから本文の先頭プレビューを抽出する。
 * 1ノート1知見前提のため H2 を区切りに使わず、本文（heading 以外）から
 * 最初の `maxLen` 文字を集める。Synthesizer / Linter / 一覧で共通利用する。
 */
export function extractBodyPreview(doc: GraphiumDocument, maxLen: number): string {
  const page = doc.pages[0];
  if (!page) return "";
  const lines: string[] = [];
  // マルチカラム（columnList / column）はレイアウト用ラッパーなので透過する。
  // 透過しないと、手編集でカラム化した wiki の本文が preview から消え、
  // Linter / Synthesizer / 一覧が「本文なし」として扱ってしまう。
  const visit = (blocks: any[]): boolean => {
    for (const block of blocks ?? []) {
      if (block.type === "columnList" || block.type === "column") {
        if (block.children?.length && !visit(block.children)) return false;
        continue;
      }
      if (block.type === "heading") continue; // H1/H2/H3 はスキップ — タイトルや節見出しは preview に入れない
      const t = extractInlineText(block.content);
      if (t) lines.push(t);
      if (lines.join(" ").length >= maxLen) return false;
    }
    return true;
  };
  visit(page.blocks);
  return lines.join(" ").slice(0, maxLen);
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
