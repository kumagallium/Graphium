// search_media の本体: 素材インデックス（media-index.json）を名前・OCR の文字・URL の説明・出どころ情報（著者・年・発行元・DOI）と、
// AI との会話の本文で探す。
//
// 索引は search.ts と同じトークナイザ（本体の語彙索引と同じ）で MiniSearch に載せる。
// media-index.json の更新時刻が変われば組み直す（アプリが素材を足したら次の検索で追いつく）。

import { sanitizeAltText, sanitizeOcrText } from "../lib/ocr-text";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";

import type { MediaIndexEntry, MediaType } from "../features/asset-browser/media-index";
import { conversationSearchChunks, conversationsInSearchBudget } from "../features/lexical-search/conversation-chunks";
import { buildSnippet } from "../features/lexical-search/snippet";
import { tokenize } from "../features/lexical-search/tokenizer";
import { sourceInfoSearchText } from "../features/asset-browser/source-info-text";
import { allEntries } from "./search";
import { conversationTextFile } from "./source-text";
import { readMediaIndex } from "./sources";
import { appDataDir, resolveGraphiumRoot } from "./vault";

export const MEDIA_TYPES = ["image", "video", "audio", "pdf", "url", "document", "data", "memo", "conversation", "other"] as const satisfies readonly MediaType[];

type MediaDoc = {
  id: string;
  name: string;
  ocrText: string;
  /** 検索用の別の読み（macOS の Vision）。探すためだけ。結果には返さない */
  ocrAltText: string;
  description: string;
  excerpt: string;
  domain: string;
  source: string;
  /** AI との会話の本文の断片（断片ごとに 1 文書にする） */
  conversationText: string;
};

export type MediaHit = {
  /** get_source_text にそのまま渡せる形（pdf:<fileId> / document:<fileId> / url:<url> / <type>:<fileId>） */
  id: string;
  name: string;
  type: MediaType;
  uploadedAt: string;
  usedIn: { noteId: string; title: string }[];
  score: number;
  /** AI との会話: 本文で当たった箇所の抜粋 */
  snippet?: string;
  /** AI との会話: 会話の最後の日時（ISO 8601）。uploadedAt は取り込んだ日時 */
  conversationDate?: string;
};

/** 素材を資料 ID の形にする */
export function mediaSourceId(m: Pick<MediaIndexEntry, "type" | "fileId" | "url">): string {
  if (m.type === "url") return `url:${m.url}`;
  return `${m.type}:${m.fileId}`;
}

type ConversationChunk = { sourceId: string; text: string };
type Cache = {
  root: string;
  mtimeMs: number;
  mini: MiniSearch<MediaDoc>;
  byId: Map<string, MediaIndexEntry>;
  /** 会話の本文の断片（文書の id → 属する素材と文字） */
  chunks: Map<string, ConversationChunk>;
};

/** 会話の本文を読む（読めなければ断片を作らない） */
function readConversationBody(fileId: string, root: string): string | null {
  const path = conversationTextFile(fileId, root);
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
let cache: Cache | null = null;

/** テスト用: キャッシュを捨てる */
export function resetMediaSearchIndex(): void {
  cache = null;
}

function mediaIndexMtimeMs(root: string): number {
  try {
    return statSync(join(appDataDir(root), "media-index.json")).mtimeMs;
  } catch {
    return 0;
  }
}

function getIndex(root: string): Cache {
  const mtimeMs = mediaIndexMtimeMs(root);
  if (cache && cache.root === root && cache.mtimeMs === mtimeMs) return cache;

  const mini = new MiniSearch<MediaDoc>({
    idField: "id",
    fields: ["name", "ocrText", "ocrAltText", "description", "excerpt", "domain", "source", "conversationText"],
    tokenize: (s: string) => tokenize(s),
    processTerm: (term: string) => (term ? term : null),
    searchOptions: { boost: { name: 3, domain: 1.5 }, combineWith: "OR" as const },
    autoVacuum: false as const,
  });
  const byId = new Map<string, MediaIndexEntry>();
  const chunks = new Map<string, ConversationChunk>();
  const docs: MediaDoc[] = [];
  const conversationBudget = conversationsInSearchBudget(readMediaIndex(root).values());
  for (const m of readMediaIndex(root).values()) {
    // アーカイブ済みの素材はギャラリーと同じく探す対象から外す
    if (m.archivedAt) continue;
    const id = mediaSourceId(m);
    if (byId.has(id)) continue;
    byId.set(id, m);
    docs.push({
      id,
      name: m.name ?? "",
      ocrText: sanitizeOcrText(m.ocrText) ?? "",
      ocrAltText: sanitizeAltText(m.ocrAltText) ?? "",
      description: m.urlMeta?.description ?? "",
      excerpt: m.urlMeta?.excerpt ?? "",
      domain: m.urlMeta?.domain ?? "",
      source: sourceInfoSearchText(m.sourceInfo),
      conversationText: "",
    });
    if (m.type !== "conversation" || !conversationBudget.has(m.fileId)) continue;
    const body = readConversationBody(m.fileId, root);
    if (body === null) continue;
    for (const c of conversationSearchChunks(body)) {
      const docId = `${id}#${c.chunkId}`;
      chunks.set(docId, { sourceId: id, text: c.text });
      docs.push({ id: docId, name: "", ocrText: "", ocrAltText: "", description: "", excerpt: "", domain: "", source: "", conversationText: c.text });
    }
  }
  mini.addAll(docs);
  cache = { root, mtimeMs, mini, byId, chunks };
  return cache;
}

export function searchMedia(
  query: string,
  options: { type?: MediaType; limit?: number } = {},
  root = resolveGraphiumRoot(),
): MediaHit[] {
  if (!query.trim()) return [];
  const limit = options.limit ?? 20;
  const { mini, byId, chunks } = getIndex(root);
  const titles = new Map(allEntries(root).map((e) => [e.noteId, e.title]));
  const results = mini.search(query);
  const words = query.trim().split(/\s+/).filter(Boolean);

  // 会話の抜粋は、その会話でいちばん点の高い断片から作る（結果は点の高い順）
  const snippets = new Map<string, string>();
  for (const r of results) {
    const chunk = chunks.get(String(r.id));
    if (chunk && !snippets.has(chunk.sourceId)) {
      snippets.set(chunk.sourceId, buildSnippet(chunk.text, [...words, ...r.terms]).text);
    }
  }

  const hits: MediaHit[] = [];
  const seenSources = new Set<string>();
  for (const r of results) {
    // 断片で当たったら、その断片が属する素材 1 件にまとめる
    const sourceId = chunks.get(String(r.id))?.sourceId ?? String(r.id);
    if (seenSources.has(sourceId)) continue;
    const m = byId.get(sourceId);
    if (!m) continue;
    if (options.type && m.type !== options.type) continue;
    seenSources.add(sourceId);
    // 同じノートに何度も貼られていても 1 行にまとめる
    const seen = new Set<string>();
    const usedIn: MediaHit["usedIn"] = [];
    for (const u of m.usedIn ?? []) {
      if (seen.has(u.noteId)) continue;
      seen.add(u.noteId);
      usedIn.push({ noteId: u.noteId, title: titles.get(u.noteId) ?? u.noteTitle ?? u.noteId });
    }
    const snippet = snippets.get(sourceId);
    hits.push({
      id: sourceId,
      name: m.name,
      type: m.type,
      uploadedAt: m.uploadedAt,
      usedIn,
      score: Math.round(r.score * 100) / 100,
      ...(snippet ? { snippet } : {}),
      ...(m.conversation?.endedAt ? { conversationDate: m.conversation.endedAt } : {}),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
