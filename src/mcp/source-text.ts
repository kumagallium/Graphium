// get_source_text の本体: 資料（PDF / Word / URL / ノート）の本文を窓に切って返す。
//
// 原文の解決は出典照合と同じ resolveSourceText を Node 用の deps で呼ぶ（取り込みが LLM に
// 渡したのと同じ抽出になる）。PDF は pdf-text-node.ts、Word は mammoth（buffer 渡し）、
// URL は素材インデックスに登録されたものだけを url-reader で取り直す（任意の URL は受けない）。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveSourceText, type ResolveSourceTextDeps } from "../features/source-check/resolve-source-text";
import { parseExternalSource } from "../features/network-graph/external-source";
import { WINDOW_OVERLAP, splitIntoWindows } from "../features/wiki/source-windows";
import { extractPdfTextNode } from "./pdf-text-node";
import { readMediaIndex } from "./sources";
import { notesDir, readNote, readNoteIndex, resolveGraphiumRoot, wikiDir } from "./vault";
import { extractDocxText } from "../lib/docx-text";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 窓の大きさの既定と下限（文字数） */
export const DEFAULT_WINDOW_CHARS = 4000;
export const MIN_WINDOW_CHARS = 1000;

export type SourceTextInput = {
  sourceId: string;
  /** 窓の番号（0 始まり。既定 0） */
  window?: number;
  /** PDF のページ（1 始まり）。window より優先 */
  page?: number;
  windowChars?: number;
};

type Extracted = { title: string; text: string; pageStarts?: number[] };

// ── 抽出結果のキャッシュ（sourceId + ファイルの mtime。上限 20 件） ──
const CACHE_LIMIT = 20;
const cache = new Map<string, Extracted>();

function cacheGet(key: string): Extracted | undefined {
  const hit = cache.get(key);
  if (hit) {
    // 使った順に並べ直す（古いものから捨てるため）
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: Extracted): void {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** テスト用: キャッシュを捨てる */
export function resetSourceTextCache(): void {
  cache.clear();
}

/** URL の取り直し結果を持つ時間（窓を送るたびにネットワークへ行かない） */
const URL_CACHE_MS = 10 * 60 * 1000;

/** `<root>/media/` から fileId の実体を探す（`.meta.json` / `.txt` は除く。拡張子なしも許す） */
export function findMediaFile(fileId: string, root: string): string | null {
  if (!fileId || /[\\/]/.test(fileId) || fileId.includes("..")) return null;
  const dir = join(root, "media");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names.find(
    (n) =>
      (n === fileId || n.startsWith(`${fileId}.`)) && !n.endsWith(".meta.json") && !n.endsWith(".txt"),
  );
  return hit ? join(dir, hit) : null;
}

function mtimeOf(path: string | null): number {
  if (!path) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function noteFilePath(id: string, root: string): string | null {
  for (const dir of [notesDir(root), wikiDir(root)]) {
    const p = join(dir, `${id}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** 断る文（先頭の語で判定できるようにする） */
function refuse(code: string, message: string): string {
  return `${code}: ${message}`;
}

/** Node 用の deps を組む */
function buildDeps(root: string): ResolveSourceTextDeps {
  const index = readNoteIndex(root);
  const entries = new Map((index?.notes ?? []).map((n) => [n.noteId, n]));
  return {
    findNote: (id) => {
      const entry = entries.get(id);
      if (entry) return { deletedAt: entry.deletedAt };
      // 索引に載っていないノート（作ったばかりなど）はファイルの有無で見る
      return existsSync(join(notesDir(root), `${id}.json`)) ? {} : undefined;
    },
    isWikiId: (id) =>
      !existsSync(join(notesDir(root), `${id}.json`)) && existsSync(join(wikiDir(root), `${id}.json`)),
    loadNoteDoc: async (id) => readNote(id, root),
    loadMediaBytes: async (fileId) => {
      const path = findMediaFile(fileId, root);
      return path ? new Uint8Array(readFileSync(path)) : undefined;
    },
    findMediaName: (fileId) => readMediaIndex(root).get(fileId)?.name,
    extractPdfText: async (blob) => extractPdfTextNode(new Uint8Array(await blob.arrayBuffer())),
    extractDocxText: async (blob) => {
      // mammoth は Node では { buffer } を受ける（{ arrayBuffer } は失敗する）。bundle の
      // external に入れて動的 import で読む
      return extractDocxText(await import("mammoth"), { buffer: Buffer.from(await blob.arrayBuffer()) });
    },
    loadStoredUrlText: undefined,
    fetchUrlText: async (url) => {
      const { fetchAsReaderArticle } = await import("../server/services/url-reader");
      const article = await fetchAsReaderArticle(url);
      return { title: article.title, text: article.textContent };
    },
    findCaptureText: () => undefined,
  };
}

const REASON_TEXT: Record<string, string> = {
  deleted: "実体が見つかりません（削除されたか、ゴミ箱にあります）",
  empty: "本文が空です（画像だけのページなど）",
  unreadable: "読み取れませんでした（壊れているか、取得に失敗しました）",
  "unsupported-kind": "この種類の資料は文字起こしできません",
  "no-reference": "元の資料への参照が無いため辿れません",
};

/** ページ番号（1 始まり）を文字オフセットから引く */
function pageOfOffset(pageStarts: number[], offset: number): number {
  let page = 1;
  for (let i = 0; i < pageStarts.length; i++) {
    if (pageStarts[i] <= offset) page = i + 1;
    else break;
  }
  return page;
}

function pageRange(pageStarts: number[] | undefined, start: number, end: number): string {
  if (!pageStarts || pageStarts.length === 0) return "";
  const a = pageOfOffset(pageStarts, start);
  const b = pageOfOffset(pageStarts, Math.max(start, end - 1));
  return a === b ? `ページ ${a}` : `ページ ${a}〜${b}`;
}

/** 資料の本文を解決して窓で返す。断る場合は先頭に安定した語（UNKNOWN_SOURCE など）を置く */
export async function getSourceText(
  input: SourceTextInput,
  root = resolveGraphiumRoot(),
): Promise<string> {
  const { sourceId } = input;
  const size = Math.max(MIN_WINDOW_CHARS, Math.floor(input.windowChars ?? DEFAULT_WINDOW_CHARS));
  const parsed = parseExternalSource(sourceId);

  // 種類ごとの事前確認と、キャッシュの鍵（ファイルの mtime）
  let stamp = 0;
  if (parsed?.kind === "pdf" || parsed?.kind === "document") {
    const media = readMediaIndex(root).get(parsed.key);
    const file = findMediaFile(parsed.key, root);
    if (!media && !file) return refuse("UNKNOWN_SOURCE", `資料が見つかりません: ${sourceId}`);
    if (parsed.kind === "document" && media?.mimeType !== DOCX_MIME) {
      return refuse(
        "UNSUPPORTED_FORMAT",
        `この形式（${media?.mimeType ?? "不明"}）は文字起こしできません。Word（.docx）だけに対応しています。`,
      );
    }
    stamp = mtimeOf(file);
  } else if (parsed?.kind === "url") {
    const registered = [...readMediaIndex(root).values()].some((m) => m.type === "url" && m.url === parsed.key);
    if (!registered) {
      return refuse(
        "UNKNOWN_SOURCE",
        `Graphium に登録された Web ページ（素材）ではありません: ${parsed.key}（search_media で登録済みの URL を探せます）`,
      );
    }
    stamp = Math.floor(Date.now() / URL_CACHE_MS);
  } else if (parsed) {
    return refuse("UNSUPPORTED_FORMAT", `この種類の資料（${parsed.kind}:）は文字起こしできません。`);
  } else {
    const path = noteFilePath(sourceId, root);
    if (!path) return refuse("UNKNOWN_SOURCE", `ノートまたは資料が見つかりません: ${sourceId}`);
    stamp = mtimeOf(path);
  }

  const key = `${sourceId}@${stamp}`;
  let extracted = cacheGet(key);
  if (!extracted) {
    let result;
    try {
      result = await resolveSourceText(sourceId, buildDeps(root));
    } catch (err) {
      return refuse("EXTRACT_FAILED", err instanceof Error ? err.message : String(err));
    }
    if (!result.ok) {
      const reason = REASON_TEXT[result.reason] ?? result.reason;
      // 資料が実在するのに無いと言われたら、素材インデックスや索引の食い違い
      return refuse(result.reason === "deleted" ? "UNKNOWN_SOURCE" : "EXTRACT_FAILED", `${sourceId}: ${reason}`);
    }
    extracted = { title: result.title ?? sourceId, text: result.text, pageStarts: result.pageStarts };
    cacheSet(key, extracted);
  }

  const { title, text, pageStarts } = extracted;
  const windows = splitIntoWindows(text, { size, overlap: WINDOW_OVERLAP });
  const notes: string[] = [];

  let windowIndex = Math.floor(input.window ?? 0);
  if (input.page !== undefined) {
    if (!pageStarts || pageStarts.length === 0) {
      notes.push("（この資料にはページ番号が無いため、page は無視しました）");
    } else if (input.page < 1 || input.page > pageStarts.length) {
      return refuse("OUT_OF_RANGE", `ページは 1〜${pageStarts.length} で指定してください（指定: ${input.page}）`);
    } else {
      const offset = pageStarts[input.page - 1];
      // 窓は重なるので、そのページの先頭を含む最後の窓を選ぶ（先頭に近い窓のほうが読みやすい）
      let found = 0;
      for (const w of windows) if (w.start <= offset && offset < w.end) found = w.index;
      windowIndex = found;
    }
  }
  if (windowIndex < 0 || windowIndex >= windows.length) {
    return refuse("OUT_OF_RANGE", `窓は 0〜${windows.length - 1} で指定してください（指定: ${windowIndex}）`);
  }

  const current = windows[windowIndex];
  const label = (w: { start: number; end: number }) => pageRange(pageStarts, w.start, w.end);
  const here = label(current);
  const next = windows[windowIndex + 1];

  return [
    `# ${title}`,
    `sourceId: ${sourceId}`,
    `全体 ${text.length.toLocaleString("en-US")} 字・窓 ${windows.length} 枚（1 枚 ${size.toLocaleString("en-US")} 字・重なり ${WINDOW_OVERLAP} 字・window は 0 始まり）` +
      (pageStarts && pageStarts.length > 0 ? `・全 ${pageStarts.length} ページ` : ""),
    `今の窓: ${windowIndex}${here ? `（${here}）` : ""}`,
    ...notes,
    "",
    "---",
    current.text,
    "---",
    "",
    next
      ? `次の窓: window: ${windowIndex + 1}${label(next) ? `（${label(next)}）` : ""} で続きを読めます。`
      : "ここが最後の窓です。",
  ].join("\n");
}
