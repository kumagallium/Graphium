// 全文翻訳取り込み（クライアント側）— フル版（PDF / URL）
//
// 素材を「原文の構成のまま目的言語へ全文翻訳した 1 ノート」に変換する。
// 要約・構造化（wiki / prov ingester）とは別経路。
//
// PDF と URL でテキスト抽出の前段だけが異なり、翻訳本体（用語集 + ページ並列翻訳）は
// 共通ヘルパー（fetchGlossary / translatePage / mapWithConcurrency）を使い回す。
//   - PDF : extractPdfPages でページ単位抽出 → 各ページを翻訳（translatePdfToNote）
//   - URL : Reader Mode 本文を段落境界で分割 → 各チャンクを翻訳（translateUrlToNote）
//
// フル版の追加要素:
//   - ページ単位の並列翻訳（高速化）。ページ境界を保つので図の差し込み位置も決まる。
//   - 用語集を先に1回抽出し、各ページ翻訳へ注入して訳語を統一（並列でもブレない）。
//   - PDF 埋め込み画像をページ単位で抽出・アップロードし、各ページ末尾に差し込む。
//
// フロー:
//   1. extractPdfPages でページ単位テキスト抽出
//   2. extractEmbeddedPdfImages で埋め込み画像をページ別に抽出 → アップロード
//   3. /api/translate/glossary で用語集を抽出
//   4. 各ページを /api/translate へ並列投入（用語集つき）。順序は index で保持
//   5. ページごとに [訳文ブロック + そのページの画像ブロック] を組み立て
//   6. GraphiumDocument を返す（保存は呼び出し側）

import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getDefaultLLMModel, getSelectedModel } from "../settings/store";
import { extractPdfPages } from "../wiki/pdf-text-extractor";
import { extractEmbeddedPdfImages, embeddedImageToFile } from "../asset-browser/pdf-image-extractor";
import { saveRemoteImageAsMedia } from "../asset-browser/remote-image";
import { imageBlock, imageOrder, insertImagesAtCaptions } from "./figure-placement";
import { t } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import { chunkTextByParagraph, isSameLanguage } from "./url-chunk";

// 言語判定は呼び出し側（note-app）でも使うので公開窓口をここに揃える
export { isSameLanguage } from "./url-chunk";

// 並列翻訳の同時実行数。レート制限とスループットのバランスで控えめに。
const TRANSLATE_CONCURRENCY = 4;
// 用語集抽出に渡すサンプル文字数（全文だと無駄に高コストなので冒頭中心に絞る）。
const GLOSSARY_SAMPLE_CHARS = 16_000;

export type TranslateProgress = (done: number, total: number) => void;

export type GlossaryEntry = { term: string; translation: string };

export type ExistingImage = { pageNumber: number; url: string; name: string };

export type TranslateOptions = {
  /**
   * 既にこの PDF から抽出済みの画像（derivedFromAssets が PDF を指す画像アセット）。
   * 渡された場合は再抽出・再アップロードせず、これを差し込みに再利用する（重複防止）。
   */
  existingImages?: ExistingImage[];
  /** 画像アップロード経路。existingImages が無いときの初回抽出に使う（未指定なら図はスキップ） */
  uploadImage?: (file: File) => Promise<string>;
  /** 翻訳ページの進捗 */
  onProgress?: TranslateProgress;
  /** フェーズ表示用（"Extracting images" 等のヒント） */
  onPhase?: (label: string) => void;
};

type TokenUsage = { input_tokens: number; output_tokens: number; total_tokens: number };

function translateHeaders(): Record<string, string> {
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
        rate: model.rate,
      });
    }
  }
  return h;
}

/** items を最大 limit 並列で fn にかけ、結果を入力順で返す */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

type TranslateChunkResponse = {
  markdown?: string;
  model?: string | null;
  tokenUsage?: TokenUsage;
  error?: string;
};

async function translatePage(
  text: string,
  language: string,
  partLabel: string,
  glossary: GlossaryEntry[],
): Promise<TranslateChunkResponse> {
  const res = await fetch(`${apiBase()}/translate`, {
    method: "POST",
    headers: translateHeaders(),
    body: JSON.stringify({
      text,
      language,
      partLabel,
      ...(glossary.length > 0 ? { glossary } : {}),
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });
  if (!res.ok) {
    // { error, code } を code 付き Error に変換（localizeAiError が i18n 表示する）
    throw await aiErrorFromResponse(res, `Translate failed (${res.status})`);
  }
  return (await res.json()) as TranslateChunkResponse;
}

async function fetchGlossary(sample: string, language: string): Promise<{ glossary: GlossaryEntry[]; tokenUsage?: TokenUsage }> {
  try {
    const res = await fetch(`${apiBase()}/translate/glossary`, {
      method: "POST",
      headers: translateHeaders(),
      body: JSON.stringify({
        text: sample,
        language,
        ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
      }),
    });
    if (!res.ok) return { glossary: [] };
    const json = await res.json();
    return { glossary: Array.isArray(json.glossary) ? json.glossary : [], tokenUsage: json.tokenUsage };
  } catch {
    return { glossary: [] };
  }
}

/** PDF 埋め込み画像をページ番号(1-origin)→アップロード済み画像情報 にまとめる */
async function extractAndUploadImages(
  blob: Blob,
  fileName: string,
  sourcePdfFileId: string | undefined,
  uploadImage: (file: File) => Promise<string>,
): Promise<Map<number, { url: string; name: string }[]>> {
  const byPage = new Map<number, { url: string; name: string }[]>();
  let images;
  try {
    images = await extractEmbeddedPdfImages(blob);
  } catch {
    return byPage; // 抽出失敗はベストエフォート（図なしで続行）
  }
  for (const img of images) {
    try {
      const file = embeddedImageToFile(img, fileName);
      const url = await uploadImage(file);
      const list = byPage.get(img.pageNumber) ?? [];
      list.push({ url, name: file.name });
      byPage.set(img.pageNumber, list);
    } catch {
      // 1枚の失敗は無視して継続
    }
  }
  return byPage;
}

/** Markdown 冒頭の最初の見出しをノートタイトル候補として取り出す */
function firstHeading(markdown: string): string | null {
  const m = markdown.match(/^#{1,3}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** Markdown → BlockNote ブロック配列（markdown-import と同じ ephemeral editor 方式） */
function markdownToBlocks(markdown: string): any[] {
  const schema = BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    styleSpecs: defaultStyleSpecs,
  });
  const editor = BlockNoteEditor.create({ schema });
  return editor.tryParseMarkdownToBlocks(markdown) as any[];
}

/** 出典表示用の先頭ブロック（PDF ファイル名のテキスト表示） */
function buildSourceHeaderBlock(sourceName: string): any {
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [
      { type: "text", text: "Source: ", styles: { bold: true } },
      { type: "text", text: sourceName, styles: {} },
    ],
    children: [],
  };
}

export type TranslatePdfResult = {
  doc: GraphiumDocument;
  /** 上限で途中打ち切りした場合 true */
  truncated: boolean;
  /** 翻訳したページ数 */
  pageCount: number;
  /** 差し込んだ画像数 */
  imageCount: number;
  /** 用語集の件数 */
  glossarySize: number;
};

/**
 * PDF Blob を「原文構成のまま目的言語へ全文翻訳した GraphiumDocument」に変換する（フル版）。
 *
 * @param blob       PDF の Blob
 * @param fileName   元ファイル名（タイトル・出典表示のフォールバック）
 * @param language   目的言語コード（UI ロケール: "ja" / "en" など）
 * @param sourcePdfFileId メディアインデックス上の PDF fileId（出典リンク用）
 * @param opts       画像アップロード経路・進捗コールバック
 */
export async function translatePdfToNote(
  blob: Blob,
  fileName: string,
  language: string,
  sourcePdfFileId: string | undefined,
  opts: TranslateOptions = {},
): Promise<TranslatePdfResult> {
  const { existingImages, uploadImage, onProgress, onPhase } = opts;

  const extracted = await extractPdfPages(blob);
  // 翻訳対象ページ（空ページは飛ばすが、画像差し込みのため元の index は保持）
  const pageTexts = extracted.pages.map((p) => p.trim());
  const translatable = pageTexts
    .map((text, idx) => ({ text, idx }))
    .filter((p) => p.text.length > 0);

  if (translatable.length === 0) {
    throw new Error(t("ingest.pdfNoText"));
  }

  // 1) 図: 既に抽出済みなら再利用（重複防止）、無ければ初回のみ抽出・アップロード
  let imagesByPage = new Map<number, { url: string; name: string }[]>();
  if (existingImages && existingImages.length > 0) {
    onPhase?.("Reusing extracted figures...");
    for (const img of existingImages) {
      const list = imagesByPage.get(img.pageNumber) ?? [];
      list.push({ url: img.url, name: img.name });
      imagesByPage.set(img.pageNumber, list);
    }
  } else if (uploadImage) {
    onPhase?.("Extracting images...");
    imagesByPage = await extractAndUploadImages(blob, fileName, sourcePdfFileId, uploadImage);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;
  const addUsage = (u?: TokenUsage) => {
    if (!u) return;
    inputTokens += u.input_tokens ?? 0;
    outputTokens += u.output_tokens ?? 0;
  };

  // 2) 用語集を1回抽出（全ページ翻訳に注入して訳語統一）
  onPhase?.("Building glossary...");
  const sample = pageTexts.join("\n\n").slice(0, GLOSSARY_SAMPLE_CHARS);
  const { glossary, tokenUsage: glossaryUsage } = await fetchGlossary(sample, language);
  addUsage(glossaryUsage);

  // 3) ページ単位で並列翻訳（順序は index で保持）
  let done = 0;
  onProgress?.(0, translatable.length);
  const translations = await mapWithConcurrency(translatable, TRANSLATE_CONCURRENCY, async (p, i) => {
    const result = await translatePage(
      p.text,
      language,
      `p${p.idx + 1} (${i + 1}/${translatable.length})`,
      glossary,
    );
    if (result.model) model = result.model;
    addUsage(result.tokenUsage);
    done += 1;
    onProgress?.(done, translatable.length);
    return { idx: p.idx, markdown: (result.markdown ?? "").trim() };
  });

  // 4) ページ順にブロック組み立て（訳文 → そのページの画像）
  const orderedPages = [...translatable]
    .map((p, i) => ({ idx: p.idx, markdown: translations[i].markdown }))
    .sort((a, b) => a.idx - b.idx);

  // 文書全体のブロックと画像をそれぞれ出現順に集める。
  // 図キャプションと画像が別ページにあっても、グローバルな出現順で対応付ける。
  const bodyBlocks: any[] = [];
  const allImages: { url: string; name: string }[] = [];
  let combinedMarkdown = "";
  for (const page of orderedPages) {
    if (page.markdown) {
      combinedMarkdown += (combinedMarkdown ? "\n\n" : "") + page.markdown;
      for (const b of markdownToBlocks(page.markdown)) bodyBlocks.push(b);
    }
    // ページ内の画像は抽出順（image 番号）に並べてから全体列へ追加
    const imgs = [...(imagesByPage.get(page.idx + 1) ?? [])].sort(
      (a, b) => imageOrder(a.name) - imageOrder(b.name),
    );
    allImages.push(...imgs);
  }

  // 図キャプションの直前（上）へ、出現順に画像を差し込む（表は対象外）
  const placed = insertImagesAtCaptions(bodyBlocks, allImages);
  let imageCount = placed.inserted;
  const noteBlocks: any[] = [
    buildSourceHeaderBlock(extracted.title || fileName.replace(/\.pdf$/i, "")),
    ...placed.blocks,
  ];
  // キャプションに割り当てられなかった余り画像は末尾にまとめる
  for (const img of placed.leftover) {
    noteBlocks.push(imageBlock(img.url, img.name));
    imageCount += 1;
  }

  if (combinedMarkdown.trim().length === 0 && imageCount === 0) {
    throw new Error(t("translate.emptyResult"));
  }

  const fallbackTitle = fileName.replace(/\.pdf$/i, "");
  const title = firstHeading(combinedMarkdown) || fallbackTitle;

  const now = new Date().toISOString();
  const doc: GraphiumDocument = {
    version: LATEST_DOCUMENT_VERSION,
    title,
    pages: [
      {
        id: "main",
        title,
        blocks: noteBlocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    sourcePdfFileId,
    sourcePdfName: extracted.title || fallbackTitle,
    sourceTitle: extracted.title || fallbackTitle,
    sourceFetchedAt: now,
    generatedBy: {
      agent: "pdf-translator",
      sessionId: sourcePdfFileId ? `pdf:${sourcePdfFileId}` : `pdf:${fileName}`,
      model: model ?? undefined,
      tokenUsage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    },
    createdAt: now,
    modifiedAt: now,
  };

  return {
    doc,
    truncated: extracted.truncated,
    pageCount: translatable.length,
    imageCount,
    glossarySize: glossary.length,
  };
}

// ───────────────────────────── URL 全文翻訳 ─────────────────────────────
// PDF と違い URL はページ概念が無いため、Reader Mode 本文（段落区切りを保った
// プレーンテキスト）を段落境界でチャンク化してから並列翻訳する。図の埋め込み抽出は
// 行わず、Reader が拾った代表画像（leadImage）だけ先頭に置く。代表画像は取り込み時に
// 一度だけ取得してローカルメディアに保存し、本文にはローカル URL を書く（PDF 経路と
// 同じく、永続コンテンツにリモート URL を残さない）。

// 1 チャンクあたりの目安文字数。PDF の 1 ページ相当（数千字）に揃え、リクエストサイズ
// と並列度のバランスを取る。長すぎる単一段落はそのまま 1 チャンクにする。
const URL_CHUNK_CHARS = 4_500;

/** Reader Mode 抽出結果のうち翻訳に必要な部分だけを持つクライアント型 */
export type ReaderArticleClient = {
  title: string;
  /** 本文プレーンテキスト（段落区切り \n\n を保持） */
  textContent: string;
  /** 本文言語コード（"en" / "ja-JP" など、取れなければ null） */
  lang: string | null;
  /** 記事内の代表画像 URL（先頭に差し込む。無ければ null） */
  leadImage: string | null;
  /** 取得日時（ISO 8601） */
  fetchedAt: string;
};

/**
 * サーバーの `/api/url/reader` を叩いて Readability 抽出結果を取得する。
 * 翻訳の前段（言語判定・本文取得）に使う軽量フェッチ。サーバー側でキャッシュ済み。
 */
export async function fetchReaderArticle(url: string): Promise<ReaderArticleClient> {
  const res = await fetch(`${apiBase()}/url/reader`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw await aiErrorFromResponse(res, `Reader failed (${res.status})`);
  }
  const a = await res.json();
  return {
    title: typeof a.title === "string" ? a.title : "",
    textContent: typeof a.textContent === "string" ? a.textContent : "",
    lang: typeof a.lang === "string" ? a.lang : null,
    leadImage: typeof a.leadImage === "string" ? a.leadImage : null,
    fetchedAt: typeof a.fetchedAt === "string" ? a.fetchedAt : new Date().toISOString(),
  };
}

export type TranslateUrlResult = {
  doc: GraphiumDocument;
  /** 翻訳したチャンク数 */
  pageCount: number;
  /** 用語集の件数 */
  glossarySize: number;
};

/**
 * Reader Mode 本文を「原文構成のまま目的言語へ全文翻訳した GraphiumDocument」に変換する。
 *
 * @param article  fetchReaderArticle で取得済みの Reader 本文
 * @param language 目的言語コード（UI ロケール: "ja" / "en" など）
 * @param url      出典 URL（sourceUrl / プロヴェナンスの sessionId に使う）
 * @param opts     画像アップロード経路・進捗・フェーズ表示コールバック
 */
export async function translateUrlToNote(
  article: ReaderArticleClient,
  language: string,
  url: string,
  opts: {
    /** 代表画像の保存経路。未指定なら代表画像は差し込まない（リモート URL は書かない） */
    uploadImage?: (file: File) => Promise<string>;
    onProgress?: TranslateProgress;
    onPhase?: (label: string) => void;
  } = {},
): Promise<TranslateUrlResult> {
  const { uploadImage, onProgress, onPhase } = opts;

  const text = article.textContent.trim();
  if (text.length < 1) {
    throw new Error(t("translate.noBodyText"));
  }

  const chunks = chunkTextByParagraph(text, URL_CHUNK_CHARS);

  // 代表画像はここで一度だけ取得してローカルメディアに保存する（PDF の図抽出に相当）。
  // article.leadImage は配信元の http(s) URL なので、そのままブロックに書くと
  // ノートを開くたび・PDF 書き出しのたびに配信元へ取りに行くことになる。
  // 失敗したらリモート URL へフォールバックせず、画像ごと諦める。
  let leadImage: { url: string; name: string } | null = null;
  if (article.leadImage && uploadImage) {
    onPhase?.("Saving lead image...");
    leadImage = await saveRemoteImageAsMedia(article.leadImage, uploadImage);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;
  const addUsage = (u?: TokenUsage) => {
    if (!u) return;
    inputTokens += u.input_tokens ?? 0;
    outputTokens += u.output_tokens ?? 0;
  };

  // 用語集を1回抽出して各チャンク翻訳へ注入（訳語統一）
  onPhase?.("Building glossary...");
  const sample = text.slice(0, GLOSSARY_SAMPLE_CHARS);
  const { glossary, tokenUsage: glossaryUsage } = await fetchGlossary(sample, language);
  addUsage(glossaryUsage);

  // チャンク単位で並列翻訳（順序は index で保持）
  let done = 0;
  onProgress?.(0, chunks.length);
  const translations = await mapWithConcurrency(chunks, TRANSLATE_CONCURRENCY, async (chunk, i) => {
    const result = await translatePage(chunk, language, `part ${i + 1}/${chunks.length}`, glossary);
    if (result.model) model = result.model;
    addUsage(result.tokenUsage);
    done += 1;
    onProgress?.(done, chunks.length);
    return (result.markdown ?? "").trim();
  });

  const combinedMarkdown = translations.filter((m) => m.length > 0).join("\n\n");
  if (combinedMarkdown.trim().length === 0) {
    throw new Error(t("translate.emptyResult"));
  }

  const bodyBlocks: any[] = [];
  for (const md of translations) {
    if (md) for (const b of markdownToBlocks(md)) bodyBlocks.push(b);
  }

  const fallbackTitle = article.title || url;
  const noteBlocks: any[] = [buildSourceHeaderBlock(fallbackTitle)];
  // 保存できた代表画像があれば本文の先頭に置く（PDF の図差し込みに相当する最小版）。
  // name は保存したメディア名に揃える（リネーム時にブロック props.name も追従する）。
  if (leadImage) {
    noteBlocks.push(imageBlock(leadImage.url, leadImage.name));
  }
  noteBlocks.push(...bodyBlocks);

  const title = firstHeading(combinedMarkdown) || fallbackTitle;
  const now = new Date().toISOString();
  const doc: GraphiumDocument = {
    version: LATEST_DOCUMENT_VERSION,
    title,
    pages: [
      {
        id: "main",
        title,
        blocks: noteBlocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    sourceUrl: url,
    sourceTitle: article.title || url,
    sourceFetchedAt: article.fetchedAt || now,
    generatedBy: {
      agent: "url-translator",
      // 外部ソース ID 規約に合わせて url:<url> を入れる（lineage / グラフで辿れる）
      sessionId: `url:${url}`,
      model: model ?? undefined,
      tokenUsage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    },
    createdAt: now,
    modifiedAt: now,
  };

  return {
    doc,
    pageCount: chunks.length,
    glossarySize: glossary.length,
  };
}
