// 出典照合（Source check, v1） — 出典 ID から原文テキストを取り出すクライアント側の解決層。
//
// derivedFromNotes に入る ID（"pdf:<fileId>" / "url:<url>" / "document:<fileId>" /
// "memo:<captureId>" / "chat:<timestamp>" / プレフィックス無しの通常ノート ID）を種別ごとに
// 解決し、取り込み（ingest）が LLM に渡したときと同じ原文テキストを取り出す。
// "claim:<wikiId>"（v1.1、derivedFromNotes には現れない合成プレフィックス）はトピックが
// 引く知見を出典として解決するときに使う（build-statements.ts が付与する）。
//
// 依存（provider・media 読み込み・fetch）はすべて引数で注入する（テストでモックできるように）。
// 先例: src/features/ai-assistant/cited-document-context.ts（引用文書の文脈組み立て）が
// 同じ「pdf は抽出・url は Reader・docx はノート本文」という区別を持つ。

import type { GraphiumDocument, SourceCheckSourceKind, SourceMissingReason } from "../../lib/document-types";
import { parseExternalSource } from "../network-graph/external-source";
import { parseClaimSourceId } from "./claim-source-id";
import { extractBlockText, extractPlainTextFromDoc } from "../wiki/wiki-service";

/** 1 ブロック分のプレーンテキスト（blockId 対応の quote 照合に使う） */
export type SourceTextBlock = {
  id: string;
  text: string;
};

export type ResolvedSourceText = {
  ok: true;
  kind: SourceCheckSourceKind;
  title?: string;
  text: string;
  origin: "stored" | "refetched" | "extracted";
  /** ノート出典のときだけブロック単位のテキストも返す（blockId 対応のため） */
  blocks?: SourceTextBlock[];
  /** PDF 出典のときだけ（quote-match.ts の resolveQuoteLocation がページ番号を解くのに使う） */
  pageStarts?: number[];
};

export type UnresolvedSourceText = {
  ok: false;
  kind: SourceCheckSourceKind;
  reason: SourceMissingReason;
};

export type ResolveSourceTextResult = ResolvedSourceText | UnresolvedSourceText;

/**
 * resolveSourceText の依存。すべて注入式（テストでモックできるように）。
 * 実際の配線（note-app.tsx 側）は本タスクのスコープ外 — UI からの呼び出しは次の担当に委ねる。
 */
export type ResolveSourceTextDeps = {
  /** 通常ノートの存在・ゴミ箱判定。NoteIndexEntry から必要最小限だけ渡せばよい */
  findNote: (noteId: string) => { deletedAt?: string } | undefined;
  /**
   * プレフィックス無しの ID が「実は Wiki（Knowledge）ページの ID」かどうか。
   * true なら出典として扱えない（wikiMeta.derivedFromNotes に wiki 自身の ID が
   * 混入する既知の不具合パターンへの防御 — regenerate 経路の自己参照スキップと同種）。
   */
  isWikiId?: (id: string) => boolean;
  /** ノート本文を読む（キャッシュ優先。取り込みが渡すのと同じ入口） */
  loadNoteDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  /**
   * pdf/document 素材の実体バイト列を読む。素材が無ければ undefined。
   * 出典照合としては独自の上限を足さない — PDF は取り込みと同じ抽出器の打ち切り
   * （MAX_TEXT_CHARS）をそのまま受ける。
   */
  loadMediaBytes: (fileId: string) => Promise<Uint8Array | undefined>;
  /** メディア名（pdf/document のタイトルフォールバック用）。未指定なら undefined のまま */
  findMediaName?: (fileId: string) => string | undefined;
  /** PDF 抽出。未指定なら pdf-text-extractor を動的 import する（取り込みと同じ抽出器） */
  extractPdfText?: (blob: Blob) => Promise<{ title: string; text: string; pageStarts?: number[] }>;
  /** DOCX 抽出。未指定なら mammoth.extractRawText を動的 import する（取り込みと同じ抽出器） */
  extractDocxText?: (blob: Blob) => Promise<{ value: string }>;
  /** URL の保存済み原文（sourceTextFileId 等）があれば返す。未指定 / undefined ならスキップ */
  loadStoredUrlText?: (url: string) => Promise<string | undefined>;
  /** URL の再取得（既存の /api/wiki/fetch-url 系）。未指定なら常に unreadable 扱い */
  fetchUrlText?: (url: string) => Promise<{ title?: string; description?: string; text: string } | null>;
  /** メモ（capture）本文の検索。無ければ undefined */
  findCaptureText: (captureId: string) => string | undefined;
  /**
   * "claim:" 出典（トピックが引く知見）の存在・ゴミ箱・アーカイブ判定（v1.1）。
   * 通常ノートと同じインデックスを引く想定だが、意味論が異なる（Wiki ページ）ため
   * findNote とは別関数として注入する。未指定なら claim 出典は常に unreadable。
   */
  findClaim?: (claimId: string) => { deletedAt?: string; archivedAt?: string } | undefined;
  /** "claim:" 出典の本文を読む（知見の照合で使う本文テキストと同じ入口）。未指定なら常に unreadable */
  loadClaimDoc?: (claimId: string) => Promise<GraphiumDocument | null>;
};

/** 素材の読み込みと抽出。素材が無ければ deleted、抽出に失敗したら unreadable */
async function extractMediaText(
  fileId: string,
  kind: "pdf" | "document",
  deps: ResolveSourceTextDeps,
): Promise<ResolveSourceTextResult> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await deps.loadMediaBytes(fileId);
  } catch {
    bytes = undefined;
  }
  if (!bytes) return { ok: false, kind, reason: "deleted" };

  const mimeType =
    kind === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const fallbackTitle = deps.findMediaName?.(fileId);

  try {
    if (kind === "pdf") {
      const extract =
        deps.extractPdfText ?? (await import("../wiki/pdf-text-extractor")).extractPdfText;
      const extracted = await extract(blob);
      const rawText = extracted.text ?? "";
      const text = rawText.trim();
      if (!text) return { ok: false, kind, reason: "empty" };
      // ここでの .trim() が extracted.text の先頭を削った分だけ、pageStarts を補正する
      // （extractPdfText は自前で trim 済みのため通常は 0 ずれだが、二重に trim しても
      // 壊れないよう防御的に補正する）。
      const leadingTrimmed = rawText.length - rawText.trimStart().length;
      const pageStarts = extracted.pageStarts?.map((s) => Math.max(0, s - leadingTrimmed));
      return { ok: true, kind, title: extracted.title || fallbackTitle, text, origin: "extracted", pageStarts };
    }
    const extract =
      deps.extractDocxText ??
      (async (b: Blob) => {
        const mammoth = await import("mammoth");
        return mammoth.extractRawText({ arrayBuffer: await b.arrayBuffer() });
      });
    const extracted = await extract(blob);
    const text = (extracted.value ?? "").trim();
    if (!text) return { ok: false, kind, reason: "empty" };
    return { ok: true, kind, title: fallbackTitle, text, origin: "extracted" };
  } catch {
    // 破損ファイル等の抽出失敗（テキストが空なのではなく、読めなかった）。
    return { ok: false, kind, reason: "unreadable" };
  }
}

/**
 * ノート本文を「取り込みが LLM に渡したときと同じ形」で行単位に分解する。
 * extractPlainTextFromDoc（wiki-service.ts）と同じ「トップレベルブロック 1 つ＝1 行」を
 * 踏襲しつつ、行ごとに block.id を持たせる（quote → blockId 対応のため）。
 * 内部ヘルパー（extractBlockText 等）は wiki-service.ts で export されていないためここに複製する
 * （external-source.ts が同じ理由でプレフィックス列挙を複製しているのと同種のバンドル境界事情）。
 */
function extractNoteBlocks(doc: GraphiumDocument): SourceTextBlock[] {
  const page = doc.pages[0];
  if (!page) return [];
  const out: SourceTextBlock[] = [];
  for (const block of page.blocks ?? []) {
    const text = extractBlockText(block);
    if (text) out.push({ id: block.id, text });
  }
  return out;
}

/**
 * 出典 ID から原文テキストを解決する。
 *
 * - プレフィックス無し: 通常ノート（ゴミ箱・存在しない → deleted、Wiki ページの ID なら
 *   unsupported-kind）
 * - "pdf:" / "document:": 素材のバイト列から取り込みと同じ抽出器で再実行
 * - "url:": 保存済み原文があればそれ、無ければ再取得
 * - "memo:": capture 本文
 * - "chat:": 元チャットへの参照キーを持たないため常に no-reference
 * - それ以外（shared: / data: / image: 等）: 出典として扱えないので unsupported-kind
 */
export async function resolveSourceText(
  sourceId: string,
  deps: ResolveSourceTextDeps,
): Promise<ResolveSourceTextResult> {
  // トピックが引く知見（出典照合の中だけで使う "claim:" ID）
  const claimId = parseClaimSourceId(sourceId);
  if (claimId !== null) {
    if (!deps.findClaim || !deps.loadClaimDoc) return { ok: false, kind: "claim", reason: "unreadable" };
    const meta = deps.findClaim(claimId);
    if (!meta || meta.deletedAt || meta.archivedAt) return { ok: false, kind: "claim", reason: "deleted" };
    const doc = await deps.loadClaimDoc(claimId);
    if (!doc) return { ok: false, kind: "claim", reason: "deleted" };
    // 知見の照合で使う本文テキストと同じ関数（title + 本文）。
    const body = extractPlainTextFromDoc(doc);
    const text = doc.title ? `${doc.title}\n${body}` : body;
    if (!text.trim()) return { ok: false, kind: "claim", reason: "empty" };
    return { ok: true, kind: "claim", title: doc.title, text, origin: "stored" };
  }

  const parsed = parseExternalSource(sourceId);

  if (!parsed) {
    if (deps.isWikiId?.(sourceId)) {
      return { ok: false, kind: "unknown", reason: "unsupported-kind" };
    }
    const noteMeta = deps.findNote(sourceId);
    if (!noteMeta || noteMeta.deletedAt) {
      return { ok: false, kind: "note", reason: "deleted" };
    }
    const doc = await deps.loadNoteDoc(sourceId);
    if (!doc) return { ok: false, kind: "note", reason: "deleted" };
    const blocks = extractNoteBlocks(doc);
    const text = blocks.map((b) => b.text).join("\n");
    if (!text.trim()) return { ok: false, kind: "note", reason: "empty" };
    return { ok: true, kind: "note", title: doc.title, text, origin: "stored", blocks };
  }

  switch (parsed.kind) {
    case "pdf":
      return extractMediaText(parsed.key, "pdf", deps);
    case "document":
      return extractMediaText(parsed.key, "document", deps);
    case "url": {
      const url = parsed.key;
      let text: string | undefined;
      let title: string | undefined;
      let origin: "stored" | "refetched" = "stored";
      if (deps.loadStoredUrlText) {
        try {
          text = await deps.loadStoredUrlText(url);
        } catch {
          text = undefined;
        }
      }
      if (!text) {
        if (!deps.fetchUrlText) return { ok: false, kind: "url", reason: "unreadable" };
        try {
          const fetched = await deps.fetchUrlText(url);
          if (!fetched?.text) return { ok: false, kind: "url", reason: "unreadable" };
          text = fetched.text;
          title = fetched.title;
          origin = "refetched";
        } catch {
          return { ok: false, kind: "url", reason: "unreadable" };
        }
      }
      if (!text.trim()) return { ok: false, kind: "url", reason: "empty" };
      return { ok: true, kind: "url", title: title ?? url, text, origin };
    }
    case "memo": {
      const capId = parsed.key;
      const raw = deps.findCaptureText(capId);
      if (raw === undefined) return { ok: false, kind: "memo", reason: "deleted" };
      const text = raw.trim();
      if (!text) return { ok: false, kind: "memo", reason: "empty" };
      const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
      return { ok: true, kind: "memo", title: firstLine?.slice(0, 40), text, origin: "stored" };
    }
    case "chat":
      // chat:<timestamp> は元チャットへの参照キーを持たない（推測で探し当てない）。
      return { ok: false, kind: "chat", reason: "no-reference" };
    default:
      // shared: / data: / image: など、Knowledge 化の出典として扱えない ID。
      return { ok: false, kind: "unknown", reason: "unsupported-kind" };
  }
}

