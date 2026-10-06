// search_media の本体: 素材インデックス（media-index.json）を名前・OCR の文字・URL の説明で探す。
//
// 索引は search.ts と同じトークナイザ（本体の語彙索引と同じ）で MiniSearch に載せる。
// media-index.json の更新時刻が変われば組み直す（アプリが素材を足したら次の検索で追いつく）。

import { statSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";

import type { MediaIndexEntry, MediaType } from "../features/asset-browser/media-index";
import { tokenize } from "../features/lexical-search/tokenizer";
import { allEntries } from "./search";
import { readMediaIndex } from "./sources";
import { appDataDir, resolveGraphiumRoot } from "./vault";

export const MEDIA_TYPES = ["image", "video", "audio", "pdf", "url", "document", "data", "memo", "other"] as const satisfies readonly MediaType[];

type MediaDoc = {
  id: string;
  name: string;
  ocrText: string;
  description: string;
  excerpt: string;
  domain: string;
};

export type MediaHit = {
  /** get_source_text にそのまま渡せる形（pdf:<fileId> / document:<fileId> / url:<url> / <type>:<fileId>） */
  id: string;
  name: string;
  type: MediaType;
  uploadedAt: string;
  usedIn: { noteId: string; title: string }[];
  score: number;
};

/** 素材を資料 ID の形にする */
export function mediaSourceId(m: Pick<MediaIndexEntry, "type" | "fileId" | "url">): string {
  if (m.type === "url") return `url:${m.url}`;
  return `${m.type}:${m.fileId}`;
}

type Cache = { root: string; mtimeMs: number; mini: MiniSearch<MediaDoc>; byId: Map<string, MediaIndexEntry> };
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
    fields: ["name", "ocrText", "description", "excerpt", "domain"],
    tokenize: (s: string) => tokenize(s),
    processTerm: (term: string) => (term ? term : null),
    searchOptions: { boost: { name: 3, domain: 1.5 }, combineWith: "OR" as const },
    autoVacuum: false as const,
  });
  const byId = new Map<string, MediaIndexEntry>();
  const docs: MediaDoc[] = [];
  for (const m of readMediaIndex(root).values()) {
    // アーカイブ済みの素材はギャラリーと同じく探す対象から外す
    if (m.archivedAt) continue;
    const id = mediaSourceId(m);
    if (byId.has(id)) continue;
    byId.set(id, m);
    docs.push({
      id,
      name: m.name ?? "",
      ocrText: m.ocrText ?? "",
      description: m.urlMeta?.description ?? "",
      excerpt: m.urlMeta?.excerpt ?? "",
      domain: m.urlMeta?.domain ?? "",
    });
  }
  mini.addAll(docs);
  cache = { root, mtimeMs, mini, byId };
  return cache;
}

export function searchMedia(
  query: string,
  options: { type?: MediaType; limit?: number } = {},
  root = resolveGraphiumRoot(),
): MediaHit[] {
  if (!query.trim()) return [];
  const limit = options.limit ?? 20;
  const { mini, byId } = getIndex(root);
  const titles = new Map(allEntries(root).map((e) => [e.noteId, e.title]));

  const hits: MediaHit[] = [];
  for (const r of mini.search(query)) {
    const m = byId.get(String(r.id));
    if (!m) continue;
    if (options.type && m.type !== options.type) continue;
    // 同じノートに何度も貼られていても 1 行にまとめる
    const seen = new Set<string>();
    const usedIn: MediaHit["usedIn"] = [];
    for (const u of m.usedIn ?? []) {
      if (seen.has(u.noteId)) continue;
      seen.add(u.noteId);
      usedIn.push({ noteId: u.noteId, title: titles.get(u.noteId) ?? u.noteTitle ?? u.noteId });
    }
    hits.push({
      id: String(r.id),
      name: m.name,
      type: m.type,
      uploadedAt: m.uploadedAt,
      usedIn,
      score: Math.round(r.score * 100) / 100,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
