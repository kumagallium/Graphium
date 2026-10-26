// start_claim_task / submit_claims が読む「知見の元」の解決。
// 対象は通常のノート（notes/）に加え、素材（pdf: / document: / url:）とメモ（memo:）。
// 本文の作り方はアプリの取り込みと同じ関数を使う（features/wiki/source-ingest-input.ts・memo-note-doc.ts）:
//   - ノート: extractPlainTextFromDoc（アプリの ingestNote）
//   - メモ:   buildMemoNoteDoc で一時 doc を作って同じ（アプリの「メモのナレッジ化」）
//   - PDF / Word: 抽出（Node 版）→ buildPdfIngestInput / buildDocxIngestInput（ingestFromPdf / ingestFromDocx）
//   - URL:    fetchPageAsText（アプリの /fetch-url と同じ関数）→ buildUrlIngestInput（ingestFromUrl）

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GraphiumDocument } from "../lib/document-types";
import { isBlankText } from "../lib/blank-text";
import { extractDocxText } from "../lib/docx-text";
import { syncLocale, t } from "../i18n";
import { parseExternalSource } from "../features/network-graph/external-source";
import { buildMemoNoteDoc } from "../features/wiki/memo-note-doc";
import { buildDocxIngestInput, buildPdfIngestInput, buildUrlIngestInput } from "../features/wiki/source-ingest-input";
import { extractPlainTextFromDoc } from "../features/wiki/wiki-service";
import type { CaptureIndex } from "../features/mobile-capture/capture-store";
import { extractPdfTextNode } from "./pdf-text-node";
import { findMediaFile } from "./source-text";
import { readMediaIndex } from "./sources";
import { getFlags } from "./upkeep/index-store";
import { appDataDir, notesDir, wikiDir } from "./vault";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ClaimSourceKind = "note" | "memo" | "pdf" | "document" | "url";

/** 知見の元。ingester に渡す入力と、保存・照合に使う情報 */
export type ClaimSource = {
  kind: ClaimSourceKind;
  /** ingester に渡すタイトル */
  noteTitle: string;
  /** ingester に渡す本文（PDF / Word は先頭に出力言語ヒントが付く）。frame の原文照合もこれに対して行う */
  noteContent: string;
  /** buildWikiDocument に渡す出どころのタイトル（素材は素材の名前。アプリの ingestMediaEntry と同じ） */
  sourceTitle: string;
  /** TASK_STALE 判定の指紋の元 */
  hashBasis: string;
  /** ノート・メモの一時 doc（PROV 要約に使う）。素材は無い */
  doc?: GraphiumDocument;
  /** 取り込みに Skill（Voice など）・既存知見のタイトル表・PROV 要約を渡す経路か（ノート・メモ。素材は渡さない） */
  noteLike: boolean;
  /** メモの captureId */
  captureId?: string;
};

export type LoadedClaimSource = { ok: true; src: ClaimSource } | { ok: false; message: string };

/** 外部の取得部分を差し替えるための口（テストが URL の取得を差し替える） */
export const claimSourceDeps: {
  fetchUrl: (url: string) => Promise<{ title?: string; description?: string; text: string }>;
} = {
  // アプリの /api/wiki/fetch-url と同じ関数・同じ既定（本文は 5000 字まで）
  fetchUrl: async (url) => {
    const { fetchPageAsText } = await import("../server/services/url-fetcher");
    return fetchPageAsText(url);
  },
};

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function claimSourceKindOf(noteId: string): ClaimSourceKind | "unsupported" {
  const ext = parseExternalSource(noteId);
  if (!ext) return "note";
  if (ext.kind === "pdf" || ext.kind === "document" || ext.kind === "url" || ext.kind === "memo") return ext.kind;
  return "unsupported";
}

const notFound = (what: string, id: string): LoadedClaimSource => ({
  ok: false,
  message: `NOT_FOUND: ${what}が見つかりません: ${id}`,
});

/** 知見の元を読む。language は PDF / Word の出力言語ヒントとメモの既定タイトルに使う */
export async function loadClaimSource(root: string, noteId: string, language: "ja" | "en"): Promise<LoadedClaimSource> {
  const kind = claimSourceKindOf(noteId);
  if (kind === "unsupported") {
    return {
      ok: false,
      message: `NOT_A_NOTE: この種類の資料は対象外です（対象: ノート・PDF・Word・URL 素材・メモ）: ${noteId}`,
    };
  }
  if (kind === "note") return loadNote(root, noteId);
  if (kind === "memo") return loadMemo(root, noteId, language);
  if (kind === "url") return loadUrl(root, noteId);
  return loadFileSource(root, noteId, kind, language);
}

function loadNote(root: string, noteId: string): LoadedClaimSource {
  if (!noteId || /[\\/]/.test(noteId) || noteId.includes("..")) return notFound("ノート", noteId);
  const path = join(notesDir(root), `${noteId}.json`);
  if (!existsSync(path)) {
    if (existsSync(join(wikiDir(root), `${noteId}.json`))) {
      return { ok: false, message: `NOT_A_NOTE: ナレッジのページは対象外です（通常のノートだけが対象です）: ${noteId}` };
    }
    return notFound("ノート", noteId);
  }
  let doc: GraphiumDocument;
  try {
    doc = JSON.parse(readFileSync(path, "utf8")) as GraphiumDocument;
  } catch {
    return { ok: false, message: `NOT_FOUND: ノートを読めません: ${noteId}` };
  }
  if (doc.source === "ai" || doc.source === "skill") {
    return { ok: false, message: `NOT_A_NOTE: AI 派生のページ・Skill は対象外です（通常のノートだけが対象です）: ${noteId}` };
  }
  if (getFlags(root, noteId)?.deletedAt) {
    return { ok: false, message: `NOT_FOUND: ノートはゴミ箱にあります: ${noteId}` };
  }
  const noteContent = extractPlainTextFromDoc(doc);
  if (isBlankText(noteContent)) return { ok: false, message: `EMPTY_NOTE: ノートの本文が空です: ${noteId}` };
  return {
    ok: true,
    src: {
      kind: "note",
      noteTitle: doc.title,
      noteContent,
      sourceTitle: doc.title,
      hashBasis: `${doc.title}\n${noteContent}`,
      doc,
      noteLike: true,
    },
  };
}

function loadMemo(root: string, noteId: string, language: "ja" | "en"): LoadedClaimSource {
  const captureId = noteId.slice("memo:".length);
  const path = join(appDataDir(root), "captures.json");
  let index: CaptureIndex | null = null;
  try {
    index = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as CaptureIndex) : null;
  } catch {
    return { ok: false, message: "NOT_FOUND: メモの一覧（captures.json）を読めません" };
  }
  const entry = index?.captures?.find((c) => c.id === captureId);
  if (!entry || entry.deletedAt || entry.archivedAt) return notFound("メモ", noteId);
  // アプリは text.trim() が空のメモを飛ばす。一時 doc も trim した本文から作る
  const text = entry.text?.trim();
  if (!text) return { ok: false, message: `EMPTY_NOTE: メモの本文が空です: ${noteId}` };
  syncLocale(language);
  const doc = buildMemoNoteDoc(text, t("memo.title"));
  const noteContent = extractPlainTextFromDoc(doc);
  if (isBlankText(noteContent)) return { ok: false, message: `EMPTY_NOTE: メモの本文が空です: ${noteId}` };
  return {
    ok: true,
    src: {
      kind: "memo",
      noteTitle: doc.title,
      noteContent,
      sourceTitle: doc.title,
      hashBasis: `${doc.title}\n${noteContent}`,
      doc,
      noteLike: true,
      captureId,
    },
  };
}

function loadUrl(root: string, noteId: string): Promise<LoadedClaimSource> | LoadedClaimSource {
  const url = noteId.slice("url:".length);
  const entry = [...readMediaIndex(root).values()].find((m) => m.type === "url" && m.url === url);
  if (!entry || entry.archivedAt) return notFound("URL 素材", noteId);
  return (async (): Promise<LoadedClaimSource> => {
    let page: Awaited<ReturnType<typeof claimSourceDeps.fetchUrl>>;
    try {
      page = await claimSourceDeps.fetchUrl(url);
    } catch (e) {
      const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      return { ok: false, message: `SOURCE_UNAVAILABLE: URL を取得できませんでした（ネットワークが必要です）: ${m}` };
    }
    const input = buildUrlIngestInput(page, url);
    if (input.blank) return { ok: false, message: `EMPTY_NOTE: ページから本文を取り出せませんでした: ${noteId}` };
    return {
      ok: true,
      src: {
        kind: "url",
        noteTitle: input.noteTitle,
        noteContent: input.noteContent,
        sourceTitle: entry.name || entry.url,
        hashBasis: `${input.noteTitle}\n${input.noteContent}`,
        noteLike: false,
      },
    };
  })();
}

async function loadFileSource(
  root: string,
  noteId: string,
  kind: "pdf" | "document",
  language: "ja" | "en",
): Promise<LoadedClaimSource> {
  const fileId = noteId.slice(noteId.indexOf(":") + 1);
  const entry = readMediaIndex(root).get(fileId);
  if (!entry || entry.archivedAt) return notFound("素材", noteId);
  if (kind === "pdf" ? entry.type !== "pdf" : entry.type !== "document" || entry.mimeType !== DOCX_MIME) {
    return {
      ok: false,
      message: `NOT_A_NOTE: この種類の素材は対象外です（PDF と Word（.docx）だけが対象です）: ${noteId}`,
    };
  }
  const path = findMediaFile(fileId, root);
  if (!path) return { ok: false, message: `SOURCE_UNAVAILABLE: 素材のファイルが見つかりません: ${noteId}` };
  const bytes = new Uint8Array(readFileSync(path));
  try {
    if (kind === "pdf") {
      const input = buildPdfIngestInput(await extractPdfTextNode(bytes), entry.name || "document.pdf", language);
      if (!input.ok) return { ok: false, message: `EMPTY_NOTE: PDF から本文を取り出せませんでした（画像だけの PDF など）: ${noteId}` };
      return {
        ok: true,
        src: {
          kind,
          noteTitle: input.noteTitle,
          noteContent: input.noteContent,
          sourceTitle: entry.name || "PDF",
          hashBasis: `${input.noteTitle}\n${input.sourceText}`,
          noteLike: false,
        },
      };
    }
    const extracted = await extractDocxText(await import("mammoth"), { buffer: Buffer.from(bytes) });
    const input = buildDocxIngestInput(extracted.value ?? "", entry.name || "document.docx", language);
    if (!input.ok) return { ok: false, message: `EMPTY_NOTE: Word から本文を取り出せませんでした: ${noteId}` };
    return {
      ok: true,
      src: {
        kind,
        noteTitle: input.noteTitle,
        noteContent: input.noteContent,
        sourceTitle: entry.name || "Word",
        hashBasis: `${input.noteTitle}\n${input.sourceText}`,
        noteLike: false,
      },
    };
  } catch (e) {
    return {
      ok: false,
      message: `SOURCE_UNAVAILABLE: 素材の本文を読み取れませんでした: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
