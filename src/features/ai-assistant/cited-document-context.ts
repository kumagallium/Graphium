// 引用文書（@で引用した論文PDF・docx・URL 由来のノート）を AI コンテキストへ
// 組み立てるモジュール。
//
// 設計（2026-06 合意）:
//   ノート本文の @ 引用は knowledge層 reference リンクを張り、collectCitedNotes() が
//   それを拾って AI 文脈にノート本文を載せる経路が既にある。本モジュールは「引用先が
//   文書ノートの場合」に、本文（PROV 抽出済みの薄い内容）ではなく、その文書から派生した
//   1ホップの咀嚼済み知識を優先して組み立てる。
//
//   優先度（予算内・上から）:
//     1. 派生メモ（CaptureEntry.sourceAsset.fileId が文書のメディアと一致 / sourceNote が当ノート）
//     2. 派生 Claim / 洞察（noteIndex の AI ノートで derivedFromNotes に当ノートを含む）
//     3. 原文/本文（PDF は extractPdfText の全文、URL/docx はノート本文）
//        — 派生知識が無い時のフォールバック＋余剰予算を埋める
//
//   差別化の要点: 「PDF をそのまま LLM に渡す」だけなら他ツールでもできる。Graphium は
//   ユーザーが文書から切り出した・咀嚼した理解（メモ・洞察）をプロヴェナンス付きで束ねて
//   渡せることに価値がある。

import type { GraphiumDocument } from "../../lib/document-types";
import type { GroundingScope } from "../../lib/grounding-scope";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture/capture-store";

// grounding スコープ（overview/primary）の型は lib/grounding-scope.ts に一元化（Composer と共有）。
// 後方互換のためこのモジュールからも re-export する。
// 派生メモは両スコープで載せる: ハイライト由来の抜書き＝ユーザーが選んだ原文断片で原典寄りのため。
export type { GroundingScope };

/** 1引用文書あたりに割り当てるデフォルト文字数予算（概ね 4-5K トークン相当） */
const DEFAULT_BUDGET_CHARS = 20_000;
/** 派生知識を載せた後、これ以上余れば原文抜粋でフィラーする閾値 */
const FILLER_THRESHOLD_CHARS = 1_500;

/** 抽出済み PDF 全文の非永続キャッシュ（同一セッション中の再抽出を避ける） */
const pdfTextCache = new Map<string, string>();

/** テスト用にキャッシュを空にする */
export function __clearPdfTextCacheForTest(): void {
  pdfTextCache.clear();
}

/** 文書ノート（外部素材由来）かどうか */
export function isDocumentNote(doc: GraphiumDocument): boolean {
  return Boolean(doc.sourcePdfFileId || doc.sourceDocumentFileId || doc.sourceUrl);
}

/** 文書のメディア fileId（メモ照合用）。URL 由来ノートは持たない */
export function docMediaFileId(doc: GraphiumDocument): string | undefined {
  return doc.sourcePdfFileId ?? doc.sourceDocumentFileId;
}

/** ノート本文（先頭ページのブロック）からプレーンテキストを抽出する */
export function blocksToPlainText(doc: GraphiumDocument): string {
  const blocks = doc.pages?.[0]?.blocks ?? [];
  return blocks
    .map((b: any) => {
      const prefix = b.type === "heading" ? "#".repeat(b.props?.level ?? 2) + " " : "";
      const c = b.content;
      if (!c) return "";
      if (typeof c === "string") return prefix + c;
      if (Array.isArray(c)) return prefix + c.map((x: any) => x.text ?? "").join("");
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * 文書から派生した 1ホップのメモを集める。
 * - sourceAsset.fileId が文書のメディア fileId と一致（Quote→Memo でハイライトした抜書き）
 * - sourceNote.fileId が当ノート（ノート右パネルの Memos タブで書いたメモ）
 * 後方互換のため両経路を OR で拾う。
 */
export function gatherDerivedMemos(
  captureIndex: CaptureIndex | null,
  mediaFileId: string | undefined,
  noteId: string,
): CaptureEntry[] {
  if (!captureIndex) return [];
  return captureIndex.captures.filter((c) => {
    const byAsset = mediaFileId != null && c.sourceAsset?.fileId === mediaFileId;
    const byNote = c.sourceNote?.fileId === noteId;
    return byAsset || byNote;
  });
}

/**
 * 文書から派生した Claim / 洞察（AI Knowledge ノート）を集める。
 * wikiMeta.derivedFromNotes に当ノート ID を含む AI ノートが対象。
 */
export function gatherDerivedKnowledge(
  noteIndex: GraphiumIndex | null,
  noteId: string,
): NoteIndexEntry[] {
  if (!noteIndex) return [];
  return noteIndex.notes.filter(
    (n) => n.source === "ai" && (n.derivedFromNotes?.includes(noteId) ?? false),
  );
}

/** 組み立て用パーツ */
export type CitedDocParts = {
  title: string;
  /** 媒体種別の表示ラベル（"PDF" 等） */
  mediumLabel: string;
  /** 派生メモのテキスト一覧 */
  memos: string[];
  /** 派生知識（タイトルと本文） */
  knowledge: { title: string; text: string }[];
  /** 原文/本文の全文（フォールバック・フィラー用） */
  fullText?: string;
};

/**
 * パーツを Markdown に組み立てる（純関数）。予算超過分はトリムする。
 * 派生知識が無い場合は原文を予算いっぱいまで載せ、ある場合は余剰予算ぶんだけ原文を抜粋する。
 */
export function formatCitedDocument(
  parts: CitedDocParts,
  budgetChars = DEFAULT_BUDGET_CHARS,
  scope: GroundingScope = "overview",
): string {
  const out: string[] = [];
  out.push(`## 引用文書: ${parts.title}（${parts.mediumLabel}）`);
  let used = out[0].length;

  const hasMemos = parts.memos.length > 0;
  // 原典スコープでは派生知識（二次的な索引）を出さず、原文に絞る
  const showKnowledge = scope !== "primary" && parts.knowledge.length > 0;

  if (hasMemos) {
    const lines = [`### あなたの派生メモ（${parts.memos.length}件）`];
    for (const m of parts.memos) {
      const text = m.trim();
      if (!text) continue;
      if (used + text.length > budgetChars) break;
      lines.push(`- ${text}`);
      used += text.length + 3;
    }
    if (lines.length > 1) {
      out.push(lines.join("\n"));
    }
  }

  if (showKnowledge) {
    const lines = [`### この文書から導いた知見・洞察（${parts.knowledge.length}件）`];
    for (const k of parts.knowledge) {
      const text = k.text.trim();
      if (!text) continue;
      const entry = `- **${k.title}**: ${text}`;
      if (used + entry.length > budgetChars) break;
      lines.push(entry);
      used += entry.length;
    }
    if (lines.length > 1) {
      out.push(lines.join("\n"));
    }
  }

  // 原文/本文: 派生知識が無ければ予算いっぱい、あれば余剰ぶんを抜粋
  const full = parts.fullText?.trim();
  if (full) {
    const remaining = budgetChars - used;
    const hasDerived = hasMemos || showKnowledge;
    if (!hasDerived || remaining > FILLER_THRESHOLD_CHARS) {
      const slice = full.slice(0, Math.max(0, remaining));
      if (slice) {
        const truncated = slice.length < full.length;
        out.push(
          `### 原文${truncated ? "（抜粋）" : ""}\n${slice}${truncated ? "\n…（以下省略）" : ""}`,
        );
      }
    }
  }

  return out.join("\n\n");
}

/** assembleCitedDocumentContext の依存（テスト時に差し替え可能） */
export type CitedDocDeps = {
  noteIndex: GraphiumIndex | null;
  captureIndex: CaptureIndex | null;
  provider: {
    loadWikiFile?(id: string): Promise<GraphiumDocument>;
    loadFile(id: string): Promise<GraphiumDocument>;
    getMediaBlobUrl(id: string): Promise<string>;
  };
  /** PDF テキスト抽出。未指定なら pdf-text-extractor を動的 import する */
  extractPdfText?: (blob: Blob) => Promise<{ text: string }>;
  /** メディア fileId から Blob を取得。未指定なら getMediaBlobUrl + fetch */
  loadBlob?: (fileId: string) => Promise<Blob>;
  budgetChars?: number;
  /** grounding スコープ（未指定なら "overview"） */
  scope?: GroundingScope;
  /** URL ノートの原語原文を取得（Reader 経由）。未指定 or 失敗時はノート本文にフォールバック。
   *  収束スコープで URL の原文（LLM 加工前）を grounding に載せるため。 */
  loadUrlText?: (url: string) => Promise<string | undefined>;
};

/** PDF 全文抽出に必要な最小依存（ノート経路・素材経路の双方から使う） */
type PdfLoadDeps = {
  provider: { getMediaBlobUrl(id: string): Promise<string> };
  extractPdfText?: (blob: Blob) => Promise<{ text: string }>;
  loadBlob?: (fileId: string) => Promise<Blob>;
};

/** メディア fileId から PDF 全文を抽出（キャッシュ付き）。失敗時は undefined */
async function loadPdfFullText(
  mediaFileId: string,
  deps: PdfLoadDeps,
): Promise<string | undefined> {
  const cached = pdfTextCache.get(mediaFileId);
  if (cached != null) return cached;
  try {
    const blob = deps.loadBlob
      ? await deps.loadBlob(mediaFileId)
      : await deps.provider.getMediaBlobUrl(mediaFileId).then((url) => fetch(url).then((r) => r.blob()));
    const extract = deps.extractPdfText
      ?? (await import("../wiki/pdf-text-extractor")).extractPdfText;
    const { text } = await extract(blob);
    pdfTextCache.set(mediaFileId, text);
    return text;
  } catch {
    return undefined;
  }
}

/**
 * 引用文書ノートを AI コンテキスト用の Markdown に組み立てる。
 * 文書ノートでなければ null（呼び出し側は従来の本文抽出にフォールバックする）。
 */
export async function assembleCitedDocumentContext(
  noteId: string,
  doc: GraphiumDocument,
  deps: CitedDocDeps,
): Promise<string | null> {
  if (!isDocumentNote(doc)) return null;

  const scope = deps.scope ?? "overview";
  const mediaFileId = docMediaFileId(doc);
  const title = doc.title || doc.sourceTitle || doc.sourcePdfName || doc.sourceDocumentName || noteId;
  const mediumLabel = doc.sourcePdfFileId
    ? "PDF"
    : doc.sourceDocumentFileId
      ? "ドキュメント"
      : "URL";

  // 1ホップ派生メモ
  const memos = gatherDerivedMemos(deps.captureIndex, mediaFileId, noteId).map((m) => m.text);

  // 1ホップ派生知識（本文をロード）。原典スコープでは二次的なため収集自体をスキップ
  const knowledge: { title: string; text: string }[] = [];
  if (scope !== "primary") {
    const knowledgeEntries = gatherDerivedKnowledge(deps.noteIndex, noteId);
    for (const entry of knowledgeEntries) {
      try {
        const loader = deps.provider.loadWikiFile ?? deps.provider.loadFile;
        const wikiDoc = await loader.call(deps.provider, entry.noteId);
        const text = blocksToPlainText(wikiDoc);
        if (text) knowledge.push({ title: entry.title, text });
      } catch {
        // ロード失敗は無視
      }
    }
  }

  // 原文/本文: PDF は全文抽出、URL は Reader 経由の原語原文（LLM 加工前）を優先、docx はノート本文
  let fullText: string | undefined;
  if (doc.sourcePdfFileId) {
    fullText = await loadPdfFullText(doc.sourcePdfFileId, deps);
  } else if (doc.sourceUrl && deps.loadUrlText) {
    // URL は原語原文を優先（収束での正確な引用のため）。取得できなければノート本文にフォールバック
    fullText = (await deps.loadUrlText(doc.sourceUrl)) || blocksToPlainText(doc) || undefined;
  } else {
    fullText = blocksToPlainText(doc) || undefined;
  }

  // 何も無ければ null（呼び出し側が従来経路へ）
  if (memos.length === 0 && knowledge.length === 0 && !fullText) return null;

  return formatCitedDocument(
    { title, mediumLabel, memos, knowledge, fullText },
    deps.budgetChars ?? DEFAULT_BUDGET_CHARS,
    scope,
  );
}

/** 引用したドキュメント素材（メディアインデックスのエントリ）の最小情報 */
export type CitedAsset = {
  fileId: string;
  name: string;
  /** MediaType（"pdf" | "document" 等） */
  type: string;
};

/** assembleCitedAssetContext の依存 */
export type CitedAssetDeps = {
  captureIndex: CaptureIndex | null;
  provider: { getMediaBlobUrl(id: string): Promise<string> };
  extractPdfText?: (blob: Blob) => Promise<{ text: string }>;
  loadBlob?: (fileId: string) => Promise<Blob>;
  budgetChars?: number;
  /** grounding スコープ（未指定なら "overview"）。素材は知識を持たないため主に呼び出しの一貫性のため */
  scope?: GroundingScope;
};

/**
 * @ で引用したドキュメント素材（ノートではなく素材本体）を AI コンテキスト用
 * Markdown に組み立てる。素材は知識ノードを持たないため派生 Claim/洞察は無く、
 * 「その素材へのハイライトメモ（派生メモ）＋全文（PDF）」で構成する。
 * 何も得られなければ null。
 */
export async function assembleCitedAssetContext(
  asset: CitedAsset,
  deps: CitedAssetDeps,
): Promise<string | null> {
  // 素材へのハイライト/抜書きメモ（sourceAsset.fileId 一致）。noteId 経路は使わない。
  const memos = gatherDerivedMemos(deps.captureIndex, asset.fileId, "").map((m) => m.text);

  // 全文: PDF のみ抽出（docx 等はここでは抽出せずメモのみ）
  let fullText: string | undefined;
  if (asset.type === "pdf") {
    fullText = await loadPdfFullText(asset.fileId, {
      provider: deps.provider,
      extractPdfText: deps.extractPdfText,
      loadBlob: deps.loadBlob,
    });
  }

  if (memos.length === 0 && !fullText) return null;

  const mediumLabel = asset.type === "pdf" ? "PDF" : "ドキュメント";
  return formatCitedDocument(
    { title: asset.name, mediumLabel, memos, knowledge: [], fullText },
    deps.budgetChars ?? DEFAULT_BUDGET_CHARS,
    deps.scope ?? "overview",
  );
}
