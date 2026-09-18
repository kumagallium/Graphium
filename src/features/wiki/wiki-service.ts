// Wiki サービス（フロントエンド側）
// Ingest フロー・Wiki ドキュメント構築・Embedding 保存のオーケストレーション

import type { GraphiumDocument, WikiKind, WikiMeta, WikiMetaSummary } from "../../lib/document-types";
import type { ClaimSnapshot } from "../../server/services/wiki-types";
import { embeddingStore } from "../../lib/embedding-store";
import { extractWikiSections, flattenColumns } from "./section-extract";
import type { IngesterOutput } from "../../server/services/wiki-ingester";
import { summarizeNoteProv } from "../prov-extractor";
import { getEmbeddingModel, getDefaultLLMModel, getChatSynthesisLLMModel, getEmbeddingLLMModel, getSelectedModel, getChatSynthesisModelName, getInsightLLMModel, getInsightModelName } from "../settings/store";
import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse, notifyEmbeddingFailure } from "../../lib/ai-error";
import { t } from "../../i18n";
import { attachSourceCheck } from "../source-check/attach";

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
 * - "chatSynthesis": Chat 用モデル（未設定なら default）
 * - "insight":       洞察（atomize / transfer 判定 / relift）用モデル（未設定なら chatSynthesis → default）
 * - "embedding":     Embedding 用モデル（未設定なら default）
 */
/**
 * body.model を解決する。Tauri モードではヘッダー経由のモデル指定が無いため、
 * これを送らないとサーバー側 resolveModelConfig が `models[0]` にフォールバックする
 * （Web モードはヘッダー優先のため body.model は無視されるが、付けても害は無い）。
 *
 * - "default":       Default モデル（ingest / lint / rewrite / cross-update / URL→PROV）
 * - "chatSynthesis": Chat モデル（未設定時は Default）
 * - "insight":       洞察用モデル（未設定時は Chat → Default）
 * - "embedding":     Embedding 用途は body.embedding_model を別途使うので空
 */
function wikiBodyModel(mode: "default" | "chatSynthesis" | "insight" | "embedding" = "default"): { model?: string } {
  if (mode === "embedding") return {};
  const name =
    mode === "chatSynthesis" ? getChatSynthesisModelName()
    : mode === "insight" ? getInsightModelName()
    : getSelectedModel();
  return name ? { model: name } : {};
}

function wikiHeaders(mode: "default" | "chatSynthesis" | "insight" | "embedding" = "default"): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model =
      mode === "chatSynthesis" ? getChatSynthesisLLMModel()
      : mode === "insight" ? getInsightLLMModel()
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
  /** 中断シグナル。fetch を切るとサーバー側の LLM 呼び出しも止まる */
  signal?: AbortSignal,
  /** 知見（Claims）抽出を行うかどうか（既定 true）。features.claims が OFF のとき
   *  呼び出し側が false を渡す。false のときは /api/wiki/ingest を呼ばず、
   *  知見 0 件の結果を返す（トピック段は呼び出し側で資料本文から別途走らせる）。 */
  extractClaims: boolean = true,
): Promise<IngestResult> {
  const noteContent = extractPlainTextFromDoc(doc);

  if (!extractClaims) {
    return { wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: null };
  }

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
    ...(signal ? { signal } : {}),
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
  /** 再生成（regenerate）時、この Wiki 自身のファイル ID。relatedClaims が自 ID に
   *  解決されても knowledgeLink 化しない（自己参照の生成抑止） */
  selfId?: string,
): GraphiumDocument | null {
  // 要約(summary)の新規生成は停止済み（PR3）。話題(topic)が役割を引き継ぐ。
  // サーバー側の parseIngesterOutput で summary は既に除去される想定だが、
  // 直接呼び出す経路（テスト・将来の呼び出し元）に備えてここでも二重に防ぐ。
  // 呼び出し側は null を自然に無視する（保存をスキップする）。
  if (ingesterOutput.kind === "summary") return null;

  const now = new Date().toISOString();
  const converted = convertSectionsToBlocks(ingesterOutput.sections, noteIndex, ingesterOutput.title);

  // 関連セクションを追加（派生元ノート + 関連 Concept）
  // selfTitle には生成中の Wiki 自身のタイトル（ingesterOutput.title）を渡す。
  // parseInlineCitations と同じ selfTitle ガードを relatedClaims にも適用する。
  const relations = buildRelationBlocks(
    sourceNoteId,
    sourceNoteTitle,
    ingesterOutput.relatedClaims,
    existingWikiTitles,
    ingesterOutput.externalReferences,
    ingesterOutput.title,
    selfId,
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

  // 本文（pages[0].blocks）を書き換えるため、古い出典照合の判定は引き継がない
  // （仕様: 本文を作り直す merge/regenerate 系は sourceCheck を引き継がない）。
  return attachSourceCheck({
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
  }, undefined);
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

    // References セクションは既存のものを保持。
    // カラム透過した flat 列で探す（References がカラム内に移されていても
    // 拾える。rewrite 経路は元々フラットな再構成なのでレイアウトは失われる）
    const flatPageBlocks = flattenColumns(page.blocks);
    const refIndex = flatPageBlocks.findIndex(
      (b: any) => b.type === "heading" && extractInlineText(b.content).toLowerCase().includes("reference"),
    );
    const refBlocks = refIndex >= 0 ? flatPageBlocks.slice(refIndex) : [];

    const finalBlocks = [...converted.blocks, ...refBlocks];

    // 既存の knowledgeLinks から References セクション以外のものを除去し、新しいものを追加
    const existingRefLinks = (page.knowledgeLinks ?? []).filter((link) => {
      if (refIndex < 0) return true;
      const refBlockIds = new Set(refBlocks.map((b: any) => b.id));
      return refBlockIds.has(link.sourceBlockId);
    });

    const now = new Date().toISOString();
    const derivedFromNotes = [
      ...new Set([...(existingDoc.wikiMeta?.derivedFromNotes ?? []), sourceNoteId]),
    ];

    // 本文（pages[0].blocks）を書き換えるため、古い出典照合の判定は引き継がない
    // （仕様: 本文を作り直す merge/regenerate 系は sourceCheck を引き継がない）。
    return attachSourceCheck({
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
    }, undefined);
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

  // カラム透過: 手編集でカラム化された wiki の本文を見失うと、
  // rewriteAndMerge がページ全体を再構成するときにカラム内の本文が
  // 保存されず消える（サイレントデータ損失）
  for (const block of flattenColumns(blocks)) {
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
export type NoteIndex = { id: string; title: string; isWiki?: boolean }[];

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

/** 1 行が markdown の箇条書き（`- ` / `* `）かを判定し、中身のテキストを返す。 */
function parseMarkdownBullet(line: string): string | null {
  const m = /^[-*]\s+(.+)$/.exec(line);
  return m ? m[1].trim() : null;
}

/** 1 行が markdown の番号付きリスト（`1. ` など）かを判定し、中身のテキストを返す。 */
function parseMarkdownNumbered(line: string): string | null {
  const m = /^\d+\.\s+(.+)$/.exec(line);
  return m ? m[1].trim() : null;
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
      // 箇条書き / 番号付きリストは bulletListItem / numberedListItem ブロックに変換する
      // （素のテキストとして表示されるのを防ぐ）。inline は通常の段落と同じく
      // parseInlineCitations を通す。
      const bullet = parseMarkdownBullet(para);
      const numbered = bullet === null ? parseMarkdownNumbered(para) : null;
      if (bullet !== null || numbered !== null) {
        const itemText = bullet !== null ? bullet : (numbered as string);
        const parsedItem = parseInlineCitations(itemText, noteIndex, selfTitle);
        blocks.push({
          id: parsedItem.blockId,
          type: bullet !== null ? "bulletListItem" : "numberedListItem",
          props: {
            textColor: "default",
            backgroundColor: "default",
            textAlignment: "left",
          },
          content: parsedItem.inlineContent,
          children: [],
        });
        knowledgeLinks.push(...parsedItem.knowledgeLinks);
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
  /** 生成中／再生成中の Wiki 自身のタイトル。parseInlineCitations の selfTitle ガードと
   *  同じ理由で、relatedClaims が自分自身と同じタイトルに解決された場合はリンク化しない */
  selfTitle?: string,
  /** 生成中／再生成中の Wiki 自身のファイル ID（判明していれば）。自 ID への解決も除外する */
  selfId?: string,
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
      let wiki = existingWikiTitles.find((w) => w.title === concept.title);
      // 自己参照の生成抑止: 解決結果が自ノート（自 ID / 自タイトル）と一致する場合は
      // knowledgeLink を作らない。pushCitation の selfTitle ガードと同じ理由
      // （LLM が自分自身を根拠として引用してくることがある）。
      if (wiki && ((selfId && wiki.id === selfId) || (selfTitle && wiki.title.trim() === selfTitle.trim()))) {
        wiki = undefined;
      }
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

  const h2BlockIds = flattenColumns(page.blocks)
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
  const sections = extractWikiSections(wikiDocId, doc);
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
    } else {
      // エラーレスポンスを読まずに捨てると失敗がサーバーログにしか残らない。
      // フォールバック保存は続けるが、原因はトーストで可視化する
      notifyEmbeddingFailure(await aiErrorFromResponse(res, "Embedding request failed"));
    }
  } catch (err) {
    // Embedding API 失敗（ネットワーク断・プロバイダー非対応など）
    notifyEmbeddingFailure(err);
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

export function extractBlockText(block: any): string {
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
  /** 知見（Claims）抽出を行うかどうか（既定 true）。false のときは HTML 取得・本文抽出
   *  だけ行い、/api/wiki/ingest は呼ばない（トピック段は呼び出し側が sourceText で走らせる）。 */
  extractClaims: boolean = true,
): Promise<IngestResult & { sourceText: string; sourceTitle: string }> {
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

  if (!extractClaims) {
    return {
      wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: null,
      sourceText: noteContent, sourceTitle: urlData.title || url,
    };
  }

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

  const data = (await res.json()) as IngestResult;
  // トピックの段（新形式）が資料の全文を再取得せずに使えるよう、取り込みで
  // 既に持っているテキストをそのまま返す。
  return { ...data, sourceText: noteContent, sourceTitle: urlData.title || url };
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
  /** 知見（Claims）抽出を行うかどうか（既定 true）。false のときは PDF テキスト抽出
   *  だけ行い、/api/wiki/ingest は呼ばない。 */
  extractClaims: boolean = true,
): Promise<IngestResult & { pageCount: number; sourceText: string; sourceTitle: string }> {
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

  if (!extractClaims) {
    return {
      wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: null,
      pageCount: extracted.pageCount, sourceText: extracted.text, sourceTitle: noteTitle,
    };
  }

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
  return { ...data, pageCount: extracted.pageCount, sourceText: extracted.text, sourceTitle: noteTitle };
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
  /** 知見（Claims）抽出を行うかどうか（既定 true）。false のときは Word 本文抽出
   *  だけ行い、/api/wiki/ingest は呼ばない。 */
  extractClaims: boolean = true,
): Promise<IngestResult & { sourceText: string; sourceTitle: string }> {
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = await import("mammoth");
  const extracted = await mammoth.extractRawText({ arrayBuffer });
  const text = (extracted.value ?? "").trim();

  if (!text || text.length < 50) {
    throw new Error(t("ingest.docxNoText"));
  }

  const noteTitle = fileName.replace(/\.(docx|doc)$/i, "");

  if (!extractClaims) {
    return {
      wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: null,
      sourceText: text, sourceTitle: noteTitle,
    };
  }

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

  const data = (await res.json()) as IngestResult;
  return { ...data, sourceText: text, sourceTitle: noteTitle };
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
  /** 知見（Claims）抽出を行うかどうか（既定 true）。false のときはメッセージの
   *  テキスト化だけ行い、/api/wiki/ingest は呼ばない。 */
  extractClaims: boolean = true,
): Promise<IngestResult & { sourceText: string }> {
  // チャットメッセージをテキスト化
  const chatContent = chatMessages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  if (!extractClaims) {
    return {
      wikis: [], tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, model: null,
      sourceText: chatContent,
    };
  }

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

  const data = (await res.json()) as IngestResult;
  return { ...data, sourceText: chatContent };
}

// ── Lint（整合性チェック） ──

import type { LintReport, WikiSnapshot } from "../../server/services/wiki-linter";
// 機械的な自動アーカイブ判定は LLM 不要な純関数なので、サーバー往復せずクライアントで直接使う
// （detectLocalIssues は LLM lint と同じ /lint エンドポイント経由のまま。こちらは副作用
//  ＝アーカイブが client の fm フック / IndexedDB(wikiLog) にしかないため呼び出し元も client）。
export { detectAutoArchivable, type AutoArchiveCandidate } from "../../server/services/wiki-linter";
// 資料の一部欠落（missing-source）も同じ理由（LLM 不要な純関数）でクライアント直呼び。
// /lint エンドポイントは noteIndex を持たないため、この判定だけは client 側で行い、
// クイック点検の結果に mergeMissingSourceIssues で合流させる。
export { detectMissingSourceIssues } from "../../server/services/wiki-linter";

/**
 * Wiki の整合性チェックを実行する
 */
export async function lintWikis(
  wikis: WikiSnapshot[],
  language: string,
  localOnly: boolean = false,
  signal?: AbortSignal,
): Promise<LintReport> {
  const res = await fetch(`${API_BASE}/lint`, {
    method: "POST",
    // フル点検（LLM 解析）はチャットモデルで判断する（localOnly のときは未使用なので害は無い）
    headers: wikiHeaders("chatSynthesis"),
    body: JSON.stringify({ wikis, language, localOnly, ...wikiBodyModel("chatSynthesis") }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    throw await aiErrorFromResponse(res, `Lint failed (${res.status})`);
  }

  return res.json();
}

/**
 * detectMissingSourceIssues（client 側の機械判定）を LintReport に合流させる。
 * /lint（サーバー）は noteIndex を持たないためこの判定を行えない — 呼び出し側が
 * client で検出した結果をここで issues/summary に足し込む。missingIssues が空なら
 * report をそのまま返す（冪等）。
 */
export function mergeMissingSourceIssues(report: LintReport, missingIssues: import("../../server/services/wiki-linter").LintIssue[]): LintReport {
  if (missingIssues.length === 0) return report;
  return {
    ...report,
    issues: [...report.issues, ...missingIssues],
    summary: {
      ...report.summary,
      total: report.summary.total + missingIssues.length,
      missingSource: report.summary.missingSource + missingIssues.length,
    },
  };
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
    // answer（AI チャットの回答をナレッジ層に書き戻したページ）もトピックと同じ規則で
    // 保守（改訂・点検）の対象にする（決定事項）。

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
      // topic / answer のメンバー知見・資料数（orphan＝0 件判定用）。それ以外では意味を持たないので省略。
      derivedFromClaims: (meta.kind === "topic" || meta.kind === "answer") ? (wikiMeta?.derivedFromClaims ?? []) : undefined,
      // 矛盾する既存洞察（atom のみ意味を持つ）。detectLocalIssues の contradiction 判定に使う。
      conflictsWith: meta.kind === "atom" ? wikiMeta?.conflictsWith : undefined,
      // Atom の構造（shape）。redundant 判定（LLM lint）に「同じ構造か」のヒントとして渡す。
      shape: meta.kind === "atom" ? meta.shape : undefined,
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
  const topics = entries.filter((e) => e.kind === "topic");

  let text = `## Wiki Index (${entries.length} pages)\n\n`;

  // 話題（topic）は知見を概念ごとに束ねたページ。Concepts より先に出すことで、
  // LLM が「まずどの話題群があるか」を把握してから個々の Claim を見られるようにする。
  if (topics.length > 0) {
    text += `### Topics (${topics.length})\n`;
    for (const t of topics) {
      text += `- **${t.title}**: ${t.bodyPreview}\n`;
    }
    text += "\n";
  }

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
 * 「新規（kept）」と「重複『候補』（duplicates + 一致先 ID）」に分割する。
 * LLM プロンプトベースの "Existing titles" 重複防止に対する安全網。
 *
 * **これは候補探しであって、同じかどうかの判定ではない。** embedding は否定・方向の
 * 違い（「下がる」vs「上がる」）に鈍く、閾値超えを機械的に「重複」扱いすると矛盾する
 * 洞察が支持として統合され、矛盾が合意に見える事故が起きる。ここで拾った duplicates は
 * 必ず judgeAtomDuplicates / resolveAtomDuplicates（LLM 判定: same / contradiction /
 * different）を通してから振り分けること — reinforceAtomWithClaims に直接渡さない。
 *
 * 設計の意図:
 *   - embedding モデル必須にはしない。設定が無い / API が失敗したら **全て kept**（fail-open）。
 *   - 既存が空 / 候補が空のときは即返す（embedding API を叩かない）。
 *   - 類似度はセクション単位で計算され、同 kind の任意のセクションと閾値超えしたら候補。
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
    if (!res.ok) {
      // fail-open は維持しつつ、重複判定が素通しになっていることを可視化する
      notifyEmbeddingFailure(await aiErrorFromResponse(res, "Embedding request failed"));
      return { kept: candidates, duplicates: [] };
    }

    const data = await res.json() as {
      embeddings: { documentId: string; sectionId: string; vector: number[] }[];
      modelVersion?: string;
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
      // modelVersion は今回の embed 呼び出しでサーバーが実際に使ったモデル版
      // （data.modelVersion）を渡す。取れなければ既存索引と一致しない安全側の空文字列。
      const results = await embeddingStore.searchByVector(emb.vector, TOP_K, data.modelVersion ?? "");
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
    notifyEmbeddingFailure(err);
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

/** 洞察（Atom）重複判定 1 件の判定結果（サーバー /judge-atom-duplicates と対応） */
export type AtomDuplicateVerdict = "same" | "contradiction" | "different";
export type AtomDuplicateJudgeVerdict = {
  index: number;
  existingId: string;
  verdict: AtomDuplicateVerdict;
  reason: string;
};

/**
 * embedding で見つかった Atom 重複「候補」を LLM に判定させる（同じ / 矛盾 / 別物）。
 * embedding は候補探しに過ぎない — 否定・方向の違いに鈍く、矛盾を統合してしまう
 * 事故があったため、最終判定はここで行う（越境転移(transfer)判定と同じ流儀）。
 *
 * fail-closed: API 失敗・壊れた出力・判定が返らなかった対は呼び出し側で "different" 扱いに
 * 倒す（このヘルパー自体は空配列を返すだけ — 「統合しない」判断は呼び出し側の責務）。
 */
export async function judgeAtomDuplicates(
  pairs: { candidate: { title: string; body: string }; existing: { id: string; title: string; body: string } }[],
  language: string,
  options?: { model?: string; signal?: AbortSignal },
): Promise<AtomDuplicateJudgeVerdict[]> {
  if (pairs.length === 0) return [];
  try {
    const res = await fetch(`${API_BASE}/judge-atom-duplicates`, {
      method: "POST",
      headers: wikiHeaders("insight"),
      body: JSON.stringify({
        pairs,
        language,
        ...(options?.model ? { model: options.model } : wikiBodyModel("insight")),
      }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) {
      console.warn("judgeAtomDuplicates failed (fail-closed: different 扱い):", res.status);
      return [];
    }
    const data = (await res.json()) as { verdicts?: AtomDuplicateJudgeVerdict[] };
    return data.verdicts ?? [];
  } catch (err) {
    console.warn("judgeAtomDuplicates failed (fail-closed: different 扱い):", err);
    return [];
  }
}

/** resolveAtomDuplicates の戻り値 */
export type AtomDuplicateResolution<T> = {
  /** "different" 判定（新規作成に回す候補） */
  different: T[];
  /** "same" 判定（既存 Atom への支持追加に回す） */
  same: { candidate: T; matchedDocId: string; score: number }[];
  /**
   * "contradiction" 判定（新しい Atom を別に作った上で、双方の conflictsWith に
   * 互いの ID を書く必要がある候補）。newAtomId は呼び出し側が新規作成後に埋める。
   */
  contradiction: { candidate: T; matchedDocId: string; score: number }[];
};

/**
 * partitionCandidatesByEmbedding の duplicates（embedding が見つけた「候補」）を、
 * LLM 判定（judgeAtomDuplicates）で same / contradiction / different に振り分ける
 * 共通ヘルパー。3 箇所の discovery 呼び出しがこれを通す。
 *
 * loadExisting は既存 Atom の title/body を取得するコールバック（呼び出し側の
 * loadDoc を渡す）。取得できない候補は安全側の "different" に倒す。
 */
export async function resolveAtomDuplicates<T extends { title: string; body: string }>(
  duplicates: { candidate: T; matchedDocId: string; score: number }[],
  loadExisting: (docId: string) => Promise<{ title: string; body: string } | null>,
  language: string,
  options?: { model?: string; signal?: AbortSignal },
): Promise<AtomDuplicateResolution<T>> {
  if (duplicates.length === 0) return { different: [], same: [], contradiction: [] };

  // 既存 Atom の title/body を取得できた対だけをジャッジに送る。取得できない対は
  // 判定不能として fail-closed で "different" に回す（統合しない側に倒す）。
  const withExisting: { dup: (typeof duplicates)[number]; existing: { title: string; body: string } }[] = [];
  const unresolvable: T[] = [];
  for (const dup of duplicates) {
    const existing = await loadExisting(dup.matchedDocId);
    if (existing) {
      withExisting.push({ dup, existing });
    } else {
      unresolvable.push(dup.candidate);
    }
  }

  if (withExisting.length === 0) {
    return { different: unresolvable, same: [], contradiction: [] };
  }

  const pairs = withExisting.map(({ dup, existing }) => ({
    candidate: { title: dup.candidate.title, body: dup.candidate.body },
    existing: { id: dup.matchedDocId, title: existing.title, body: existing.body },
  }));
  const verdicts = await judgeAtomDuplicates(pairs, language, options);

  const different: T[] = [...unresolvable];
  const same: AtomDuplicateResolution<T>["same"] = [];
  const contradiction: AtomDuplicateResolution<T>["contradiction"] = [];
  withExisting.forEach(({ dup }, i) => {
    const v = verdicts.find((r) => r.index === i + 1) ?? verdicts[i];
    // 判定が取れない対は fail-closed で "different"（黙って統合しない側に倒す）
    if (!v || v.verdict === "different") {
      different.push(dup.candidate);
    } else if (v.verdict === "same") {
      same.push(dup);
    } else {
      contradiction.push(dup);
    }
  });
  return { different, same, contradiction };
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
  options?: { existingAtomTitles?: string[]; model?: string; signal?: AbortSignal },
): Promise<AtomizeResult> {
  // 単一ソース Atom は #459 で許可済み（route は concepts >= 1 を受ける）。
  // ここで < 2 を弾くと regenerate の単一ソース re-lift が無言で失敗するため、空のときだけ弾く。
  if (concepts.length < 1) return { atoms: [] };
  const res = await fetch(`${API_BASE}/atomize`, {
    method: "POST",
    headers: wikiHeaders("insight"),
    body: JSON.stringify({
      concepts,
      ...(options?.existingAtomTitles ? { existingAtomTitles: options.existingAtomTitles } : {}),
      language,
      ...(options?.model ? { model: options.model } : wikiBodyModel("insight")),
    }),
    // 中断シグナル。fetch を切るとサーバー側の c.req.raw.signal も発火し、
    // LLM 呼び出しごと止まる（wiki.ts の /atomize が abortSignal を配線済み）。
    ...(options?.signal ? { signal: options.signal } : {}),
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
 * derivedFromClaims から自己参照 ID を除外する。
 * note-app.tsx の Atom re-lift 経路（既存 derivedFromClaims を温存しつつ
 * 再生成する処理）が使う。過去バグ由来で自 ID が紛れ込んでいても、
 * 再生成のたびに引き継がないための共通フィルタ。
 */
export function filterSelfFromDerivedFromClaims(claimIds: string[], selfNoteId: string): string[] {
  return claimIds.filter((id) => id !== selfNoteId);
}

/**
 * AtomCandidate から GraphiumDocument を構築する。
 * Atom は Zettel 1 アイデアなので、本文は短い段落のみ。見出しは付けない。
 */
export function buildAtomDocument(
  candidate: AtomCandidate,
  model: string | null,
  language?: string,
  /** 再生成（re-lift）時、この Atom 自身のファイル ID。derivedFromClaims に
   *  自 ID が紛れていても knowledgeLinks 化しない（自己参照の生成抑止） */
  selfId?: string,
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
      // 自己参照の生成抑止: derivedFromClaims に自 ID（re-lift 時の温存漏れ等）が
      // 紛れていても、自分自身を引用する knowledgeLink は作らない
      if (selfId && conceptId === selfId) continue;
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

// ── Topic（話題）──
// 話題 = 知見(claim)を概念ごとに束ねたページ。出典は 話題 → 知見 → ノート の 2 ホップ。
// 砂時計（ノート→知見→洞察）には参加しない。本文はメンバー知見の集合から作られる
// 純関数（前の本文は入力に渡さない）— composeTopicBody / buildTopicDocument を参照。

/** 話題の割り当て判定に使う既存話題の最小情報 */
export type ExistingTopicRef = {
  id: string;
  title: string;
  /** 定義節の先頭文（Karpathy の index.md と同じ「タイトル + 1 行」のための情報。無ければ空） */
  oneLiner?: string;
  /**
   * 新形式トピックの derivedFromNotes（資料 id の一覧）。runSourceTopicStage が
   * 「今回の資料を既に引用済みのトピック」を機械的に見つけるために使う（LLM の
   * 振り分け結果に無くても改訂対象に含める）。旧形式・未取得のときは省略してよい。
   */
  sourceIds?: string[];
  /** answer（回答ページ）を混ぜて渡すときの種別。省略時は topic とみなす。 */
  kind?: "topic" | "answer";
};

/**
 * Wiki ドキュメントから「1 行」の概要を取り出す（index 用）。
 * 話題ページの "## 定義 / Definition" 節の先頭文を優先し、無ければ本文最初の非空段落の
 * 先頭文を使う。見つからなければ空文字列（数値上限は設けない — 文の区切りまでをそのまま返す）。
 */
export function extractTopicOneLiner(doc: GraphiumDocument): string {
  const page = doc.pages[0];
  if (!page) return "";
  const blocks = flattenColumns(page.blocks);

  const firstSentence = (text: string): string => {
    const idx = text.search(/[。.!?！？]/);
    return idx === -1 ? text : text.slice(0, idx + 1);
  };

  // "定義" / "Definition" 見出し直後の最初の段落を優先する
  let inDefinition = false;
  for (const block of blocks) {
    if (block.type === "heading") {
      const headingText = extractInlineText(block.content).trim();
      if (inDefinition) break; // 定義節の終わり（次の見出しに入った）
      if (/^(定義|Definition)$/i.test(headingText)) inDefinition = true;
      continue;
    }
    if (!inDefinition) continue;
    const t = extractInlineText(block.content).trim();
    if (t) return firstSentence(t);
  }

  // 定義節が見つからなければ、見出しを除いた最初の非空段落を使う
  for (const block of blocks) {
    if (block.type === "heading") continue;
    const t = extractInlineText(block.content).trim();
    if (t) return firstSentence(t);
  }
  return "";
}

/**
 * 話題名の正規化（一致判定専用）。NFKC 正規化・空白（全角含む）全除去・小文字化。
 * 「AI3V合金」と「AI3V 合金」のような内部の空白差だけの表記ゆれも同一視する。
 * 表示用タイトルは常に元の文字列を使う（正規化結果を保存しない）。
 */
export function normalizeTopicTitle(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/**
 * 知見の削除時、所属していた話題群の derivedFromClaims から外す。
 * 本文は書き直さない（次の compose / 手動再生成で追従する）。0 件になった話題は
 * そのまま残す（wiki-linter の orphan topic 検出が拾う）。
 */
export function unlinkClaimFromTopic(topicMeta: WikiMeta, claimId: string): WikiMeta {
  const memberIds = topicMeta.derivedFromClaims ?? [];
  if (!memberIds.includes(claimId)) return topicMeta;
  return { ...topicMeta, derivedFromClaims: memberIds.filter((id) => id !== claimId) };
}

/**
 * 話題どうしの統合（既存話題の吸収合併）で、claim 側の topicIds を
 * 旧話題 ID → 新話題 ID に付け替える。旧 ID が無ければ何もしない（冪等）。
 * 新 ID が既に含まれていれば旧 ID を外すだけ（重複させない）。件数に上限は無い。
 */
export function retargetClaimTopicId(claimMeta: WikiMeta, oldTopicId: string, newTopicId: string): WikiMeta {
  const topicIds = claimMeta.topicIds ?? [];
  if (!topicIds.includes(oldTopicId)) return claimMeta;
  const withoutOld = topicIds.filter((id) => id !== oldTopicId);
  const nextTopicIds = withoutOld.includes(newTopicId) ? withoutOld : [...withoutOld, newTopicId];
  return { ...claimMeta, topicIds: nextTopicIds };
}

/**
 * 提案された話題名（と既存話題タイトル）をサーバー（/api/wiki/consolidate-topics）へ渡し、
 * 「提案名 → 正式名」の対応表を得る（名寄せ＝タイトル一致・embedding 類似度の後段）。
 * 統合は最適化であって必須ではない — 失敗時（パース不能・LLM/ネットワークエラー）は
 * 例外を投げず空の対応表を返し、呼び出し側は「統合なし」で続行できるようにする
 * （composeTopicBody と同じ fail-open の方針。nameTopicsForClaims と違い throw しない）。
 */
export async function consolidateTopics(
  proposedTitles: string[],
  existingTopics: ExistingTopicRef[],
  language: string,
  model?: string,
): Promise<Record<string, string>> {
  if (proposedTitles.length === 0) return {};
  try {
    const res = await fetch(`${API_BASE}/consolidate-topics`, {
      method: "POST",
      // テーマの統合可否はチャットモデルで判断する
      headers: wikiHeaders("chatSynthesis"),
      body: JSON.stringify({
        language,
        existingTopics: existingTopics.map((t) => ({ id: t.id, title: t.title, oneLiner: t.oneLiner })),
        proposedTitles,
        ...(model ? { model } : wikiBodyModel("chatSynthesis")),
      }),
    });
    if (!res.ok) {
      console.warn("consolidateTopics failed:", await aiErrorFromResponse(res, `consolidate-topics failed (${res.status})`));
      return {};
    }
    const data = await res.json() as { mapping?: Record<string, string> };
    return data.mapping ?? {};
  } catch (err) {
    console.warn("consolidateTopics failed:", err);
    return {};
  }
}

/** 話題ページの本文・References 構築に渡すメンバー知見の最小情報 */
export type TopicMemberRef = { id: string; title: string };

/** `[[claim:<id>]]` を検出する正規表現（id は空白・`]` を含まない） */
const CLAIM_CITATION_RE = /\[\[claim:([^\]]+?)\]\]/g;

/**
 * Topic Writer が `[[claim:<id>]]` 形式で出した引用を、メンバー知見の現在のタイトルへ
 * 解決してから `[[<title>]]`（既存の parseInlineCitations が解釈する形式）に書き換える。
 * LLM がタイトルを転記ミスする問題を、id ベースの引用にすることで避ける。
 *
 * id が memberClaims に無い（LLM の幻覚・削除後の残骸）場合でも引用ごと落とさない —
 * id を含む文字列として残し、目に見える形にする（プレーンテキストとして表示される）。
 * 旧形式 `[[title]]`（Topic Writer の旧プロンプト出力・過去の保存済み本文）はこの関数の
 * 対象外で、そのまま parseInlineCitations に渡り従来どおりタイトル一致で解決される。
 */
export function resolveTopicClaimCitations(body: string, memberClaims: TopicMemberRef[]): string {
  if (!body) return body;
  const titleById = new Map(memberClaims.map((c) => [c.id, c.title]));
  return body.replace(CLAIM_CITATION_RE, (_match, rawId: string) => {
    const id = rawId.trim();
    const title = titleById.get(id);
    if (title) return `[[${title}]]`;
    // 未知の id: タイトルは分からないが、引用が存在したこと自体を消さずに残す。
    return `[[claim:${id}]]`;
  });
}

// ── 新形式トピック（2026-09〜。資料 id を直接引用。取り込み・再生成・作り直しの全経路で使用） ──

/** 話題ページの本文・References 構築に渡す資料の最小情報（ノート id / "pdf:" 等の外部プレフィックス付き id） */
export type TopicSourceRef = { id: string; title: string };

/** `[[source:<id>]]` を検出する正規表現（id は空白・`]` を含まない） */
const SOURCE_CITATION_RE = /\[\[source:([^\]]+?)\]\]/g;

/**
 * 新形式 Topic Writer が `[[source:<id>]]` 形式で出した引用を、資料の現在のタイトルへ
 * 解決してから `[[<title>]]`（既存の parseInlineCitations が解釈する形式）に書き換える。
 * resolveTopicClaimCitations（旧形式）と同じ理由 — LLM のタイトル転記ミスを id ベースの
 * 引用にすることで避ける。
 *
 * id が sources に無い（LLM の幻覚・削除後の残骸）場合でも引用ごと落とさない —
 * id を含む文字列として残し、目に見える形にする。
 */
export function resolveSourceCitations(body: string, sources: TopicSourceRef[]): string {
  if (!body) return body;
  const titleById = new Map(sources.map((s) => [s.id, s.title]));
  return body.replace(SOURCE_CITATION_RE, (_match, rawId: string) => {
    const id = rawId.trim();
    const title = titleById.get(id);
    if (title) return `[[${title}]]`;
    return `[[source:${id}]]`;
  });
}

/**
 * markdown の空の `##` 見出し（次の見出しまで本文が無い見出し）を機械的に除去する純関数。
 * 改訂のたびに LLM が「このトピックには食い違いが無い」等の空見出しを残すことがあり、
 * 保存前にここで畳んでおく。見出し以外の本文（前置き）はそのまま残す。
 */
export function stripEmptyMarkdownSections(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  const headingIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s+\S/.test(lines[i])) headingIdx.push(i);
  }
  if (headingIdx.length === 0) return markdown;

  const removeRanges: [number, number][] = [];
  for (let h = 0; h < headingIdx.length; h++) {
    const start = headingIdx[h];
    const end = h + 1 < headingIdx.length ? headingIdx[h + 1] : lines.length;
    const body = lines.slice(start + 1, end);
    const hasContent = body.some((l) => l.trim().length > 0);
    if (!hasContent) removeRanges.push([start, end]);
  }
  if (removeRanges.length === 0) return markdown;

  const removed = new Set<number>();
  for (const [s, e] of removeRanges) {
    for (let i = s; i < e; i++) removed.add(i);
  }
  const kept = lines.filter((_, i) => !removed.has(i));

  // 見出し除去で空行が積み重なるのを畳む
  const collapsed: string[] = [];
  for (const line of kept) {
    if (line.trim() === "" && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") continue;
    collapsed.push(line);
  }
  while (collapsed.length > 0 && collapsed[0].trim() === "") collapsed.shift();
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") collapsed.pop();
  return collapsed.join("\n");
}

/**
 * 新形式トピック末尾の References ブロックを構築する。資料 1 件につき 1 行、
 * buildTopicReferenceBlocks（旧形式）と同じ見た目の @リンクにする。
 * 資料は必ずしも AI 生成 wiki ページではない（通常ノート・pdf・url 等）ため、
 * buildTopicReferenceBlocks と違い 🤖 プレフィックスは固定しない。
 */
function buildSourceReferenceBlocks(sources: TopicSourceRef[]): RelationBlocksResult {
  const blocks: any[] = [];
  const knowledgeLinks: any[] = [];
  if (sources.length === 0) return { blocks, knowledgeLinks };

  blocks.push({
    id: crypto.randomUUID(),
    type: "heading",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
    content: [{ type: "text", text: "References", styles: {} }],
    children: [],
  });

  for (const source of sources) {
    const blockId = crypto.randomUUID();
    blocks.push({
      id: blockId,
      type: "bulletListItem",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: `@${source.title}`, styles: { textColor: "blue" } }],
      children: [],
    });
    knowledgeLinks.push({
      id: crypto.randomUUID(),
      sourceBlockId: blockId,
      targetBlockId: "",
      targetNoteId: source.id,
      type: "reference",
      layer: "knowledge",
      createdBy: "ai",
    });
  }

  return { blocks, knowledgeLinks };
}

/**
 * 出典つき（[[source:<id>]] 引用）ナレッジページの GraphiumDocument を新規に組み立てる。
 * トピック（話題）・回答（answer）など、資料を直接読んで本文を作る種別すべてに共通する
 * 組み立て。markdown は保存前に stripEmptyMarkdownSections で空見出しを除去し、そのまま
 * wikiMeta.topicMarkdown に正本として保存する（次回改訂の入力・出典照合の要点抽出の元。
 * topicMarkdown という名前だが、トピックに限らず「AI が保守する本文の正本」を指す）。
 * derivedFromNotes に資料 id を積む（claim と同じ意味論・prefix）。derivedFromClaims は
 * この形式では使わないため空配列にする。
 */
export function buildSourceBackedWikiDocument(
  kind: WikiKind,
  title: string,
  markdown: string,
  sources: TopicSourceRef[],
  model: string | null,
  noteIndex?: NoteIndex,
  language?: string,
): GraphiumDocument {
  const now = new Date().toISOString();
  const stripped = stripEmptyMarkdownSections(markdown);
  const resolvedBody = resolveSourceCitations(stripped, sources);
  const converted = convertSectionsToBlocks([{ heading: "", content: resolvedBody }], noteIndex, title);
  const refs = buildSourceReferenceBlocks(sources);

  const wikiMeta: WikiMeta = {
    kind,
    derivedFromNotes: sources.map((s) => s.id),
    derivedFromChats: [],
    derivedFromClaims: [],
    topicMarkdown: stripped,
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
    title,
    pages: [{
      id: "main",
      title,
      blocks: [...converted.blocks, ...refs.blocks],
      labels: {},
      provLinks: [],
      knowledgeLinks: [...converted.knowledgeLinks, ...refs.knowledgeLinks],
    }],
    source: "ai",
    wikiMeta,
    generatedBy: {
      agent: "ai",
      sessionId: `wiki-${kind}-${now}`,
      model: model ?? undefined,
    },
    createdAt: now,
    modifiedAt: now,
  };
}

/** 互換のためのトピック専用ラッパー（既定 kind: "topic"）。呼び出しは新規には増やさない。 */
export function buildSourceTopicDocument(
  title: string,
  markdown: string,
  sources: TopicSourceRef[],
  model: string | null,
  noteIndex?: NoteIndex,
  language?: string,
): GraphiumDocument {
  return buildSourceBackedWikiDocument("topic", title, markdown, sources, model, noteIndex, language);
}

/**
 * 既存の出典つきナレッジドキュメントの本文を書き直して更新する（改訂・統合・作り直し共通）。
 * rebuildTopicDocument（旧形式トピック）と同じく、書き直しのたびに References を作り直すので
 * 重複しない。出典照合の判定は引き継がない（本文を作り直す系の既存仕様と揃える）。
 * kind は既存 wikiMeta.kind を引き継ぐ（呼び出し側が明示すればそれを優先）。
 */
export function rebuildSourceBackedWikiDocument(
  existingDoc: GraphiumDocument,
  markdown: string,
  sources: TopicSourceRef[],
  model: string | null,
  noteIndex?: NoteIndex,
  kind?: WikiKind,
): GraphiumDocument {
  const now = new Date().toISOString();
  const stripped = stripEmptyMarkdownSections(markdown);
  const resolvedBody = resolveSourceCitations(stripped, sources);
  const converted = convertSectionsToBlocks(
    [{ heading: "", content: resolvedBody }],
    noteIndex,
    existingDoc.title,
  );
  const refs = buildSourceReferenceBlocks(sources);
  const page = existingDoc.pages[0];

  return attachSourceCheck({
    ...existingDoc,
    pages: [{
      ...(page ?? { id: "main", title: existingDoc.title, labels: {}, provLinks: [], knowledgeLinks: [] }),
      blocks: [...converted.blocks, ...refs.blocks],
      knowledgeLinks: [...converted.knowledgeLinks, ...refs.knowledgeLinks],
    }],
    wikiMeta: {
      ...existingDoc.wikiMeta!,
      kind: kind ?? existingDoc.wikiMeta?.kind ?? "topic",
      derivedFromNotes: sources.map((s) => s.id),
      derivedFromClaims: [],
      topicMarkdown: stripped,
      lastIngestedAt: now,
      generatedBy: {
        model: model ?? existingDoc.wikiMeta?.generatedBy?.model ?? "unknown",
        version: "1.0.0",
      },
    },
    generatedBy: {
      agent: "ai",
      sessionId: existingDoc.generatedBy?.sessionId ?? `wiki-topic-${now}`,
      model: model ?? existingDoc.generatedBy?.model ?? undefined,
    },
    modifiedAt: now,
  }, undefined);
}

/** 互換のためのトピック専用ラッパー。既存呼び出し元は変更しない。 */
export function rebuildSourceTopicDocument(
  existingDoc: GraphiumDocument,
  markdown: string,
  sources: TopicSourceRef[],
  model: string | null,
  noteIndex?: NoteIndex,
): GraphiumDocument {
  return rebuildSourceBackedWikiDocument(existingDoc, markdown, sources, model, noteIndex, "topic");
}

/** route-topics API に渡す資料 1 本分（本文は全文でよい。長さの上限は置かない） */
export type TopicRouteSource = { id: string; title: string; text: string };

/** route-topics API に渡す既存トピックの index（タイトル + 定義の先頭文）。
 *  kind: "answer" のときは回答ページ（問いに答えるページ）であることをルーターに伝える。 */
export type TopicRouteExistingRef = { id: string; title: string; oneLiner?: string; kind?: "topic" | "answer" };

/**
 * 資料 1 本をサーバー（/api/wiki/route-topics）へ渡し、「改訂する既存トピック id」
 * 「新しく作るトピック名」を LLM に判断させる。存在しない既存トピック id（LLM の幻覚）は
 * ここで捨てる — 呼び出し側（runSourceTopicStage）が渡した existingTopics の id 集合と
 * 突き合わせる。失敗時（パース不能・LLM/ネットワークエラー）は例外を投げる
 * （呼び出し側が failed として数えられるように）。
 */
export async function routeTopicsForSource(
  source: TopicRouteSource,
  existingTopics: TopicRouteExistingRef[],
  language: string,
  model?: string,
): Promise<{ update: string[]; create: string[] }> {
  const res = await fetch(`${API_BASE}/route-topics`, {
    method: "POST",
    headers: wikiHeaders(),
    body: JSON.stringify({ language, source, existingTopics, ...(model ? { model } : {}) }),
  });
  if (!res.ok) {
    throw await aiErrorFromResponse(res, `route-topics failed (${res.status})`);
  }
  const data = await res.json() as { update?: string[]; create?: string[] };
  const existingIds = new Set(existingTopics.map((t) => t.id));
  const update = (data.update ?? []).filter((id) => existingIds.has(id));
  const create = data.create ?? [];
  return { update, create };
}

/**
 * トピックの前の本文（新規なら空文字列）と資料 1 本の全文から、サーバー
 * （/api/wiki/revise-topic）で次の版の本文を作る。失敗時（パース不能・LLM エラー）は
 * null を返す — 呼び出し側は「今回は改訂しない」を選べる（既存本文を温存できる）。
 */
export async function reviseTopicFromSource(
  title: string,
  currentBody: string,
  source: { id: string; title: string; text: string },
  language: string,
  model?: string,
  /** この資料が以前の版から既に [[source:<id>]] で引用済みか（サーバーに見直し指示を出させる） */
  previouslyCited?: boolean,
  /** このページが回答ページ（answer）か。true のとき「問いに答え続ける」規則を追加する */
  isAnswer?: boolean,
): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/revise-topic`, {
      method: "POST",
      headers: wikiHeaders(),
      body: JSON.stringify({
        title, language, currentBody, source,
        ...(model ? { model } : {}),
        ...(previouslyCited ? { previouslyCited } : {}),
        ...(isAnswer ? { isAnswer } : {}),
      }),
    });
    if (!res.ok) {
      console.warn("reviseTopicFromSource failed:", await aiErrorFromResponse(res, `revise-topic failed (${res.status})`));
      return null;
    }
    const data = await res.json() as { body?: string };
    return typeof data.body === "string" && data.body.trim() ? data.body : null;
  } catch (err) {
    console.warn("reviseTopicFromSource failed:", err);
    return null;
  }
}

/**
 * 統合対象の新形式トピック本文どうしを、サーバー（/api/wiki/merge-topics）で 1 本の本文に
 * 統合する。知見（claim）は経由しない — 各本文にすでに埋め込まれた [[source:<id>]] 引用を
 * そのまま保つ。bodies は 2 件以上必須。失敗時（パース不能・LLM エラー）は null を返す
 * （reviseTopicFromSource と同じ fail-open の方針。呼び出し側は「今回は統合しない」を選べる）。
 */
export async function mergeTopicBodies(
  title: string,
  bodies: string[],
  language: string,
  model?: string,
): Promise<string | null> {
  if (bodies.length < 2) return null;
  try {
    const res = await fetch(`${API_BASE}/merge-topics`, {
      method: "POST",
      headers: wikiHeaders(),
      body: JSON.stringify({ title, language, bodies, ...(model ? { model } : {}) }),
    });
    if (!res.ok) {
      console.warn("mergeTopicBodies failed:", await aiErrorFromResponse(res, `merge-topics failed (${res.status})`));
      return null;
    }
    const data = await res.json() as { body?: string };
    return typeof data.body === "string" && data.body.trim() ? data.body : null;
  } catch (err) {
    console.warn("mergeTopicBodies failed:", err);
    return null;
  }
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
  // カラム透過（flattenColumns）: しないと手編集でカラム化した wiki の本文が
  // preview から消え、Linter / Synthesizer / 一覧が「本文なし」として扱う。
  for (const block of flattenColumns(page.blocks)) {
    if (block.type === "heading") continue; // H1/H2/H3 はスキップ — タイトルや節見出しは preview に入れない
    const t = extractInlineText(block.content);
    if (t) lines.push(t);
    if (lines.join(" ").length >= maxLen) break;
  }
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
