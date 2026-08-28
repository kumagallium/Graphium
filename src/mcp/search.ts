// MCP サーバー側の語彙検索。
//
// Graphium 本体の語彙索引（src/features/lexical-search）は MiniSearch のスナップショットを
// **IndexedDB** に持つため、アプリの外からは読めない。そこで MCP では vault のファイルから
// その場でインデックスを組む。全読みは実測で 160ms 程度（116 notes / 390 wiki）なので、
// 初回検索時に遅延構築してプロセス内に持てば十分に速い。
//
// トークナイザだけは本体（lexical-search/tokenizer）をそのまま借りる。import ゼロの純粋関数で
// Node でも動き、これを揃えておかないと「アプリの検索では出るのに MCP では出ない」がおきる。

import MiniSearch from "minisearch";

import { tokenize } from "../features/lexical-search/tokenizer";
import type { NoteIndexEntry } from "../features/navigation/index-file";
import { noteToMarkdown } from "./note-text";
import {
  activeNotes,
  noteIndexMtimeMs,
  readNote,
  readNoteIndex,
  resolveGraphiumRoot,
  scanNotesWithoutIndex,
} from "./vault";

export type NoteKind = "note" | "wiki";

type SearchDoc = {
  id: string;
  title: string;
  /** 本文（Markdown 化したもの） */
  text: string;
  /** PROV ラベルとインラインラベルのテキストを連結したもの */
  labels: string;
  /** 手順名を連結したもの */
  steps: string;
  kind: NoteKind;
};

export type SearchHit = {
  noteId: string;
  title: string;
  kind: NoteKind;
  score: number;
  /** ヒット箇所の周辺テキスト */
  snippet: string;
  /** どのフィールドで当たったか（title / text / labels / steps） */
  matchedIn: string[];
};

/** MiniSearch の設定。本体（miniSearchOptions）と同じ流儀に揃える */
function miniSearchOptions() {
  return {
    idField: "id",
    fields: ["title", "text", "labels", "steps"],
    storeFields: ["title", "kind", "text"],
    tokenize: (s: string) => tokenize(s),
    processTerm: (term: string) => (term ? term : null),
    searchOptions: {
      // 手順名とラベルは「人が意図して付けた語」なので本文より重く見る
      boost: { title: 3, steps: 2, labels: 2 },
      combineWith: "OR" as const,
    },
    autoVacuum: false as const,
  };
}

type IndexCache = {
  root: string;
  mini: MiniSearch<SearchDoc>;
  entries: Map<string, NoteIndexEntry>;
  /** 構築時に見た note-index.json の更新時刻。Graphium 側の変更を検知するために持つ */
  indexMtimeMs: number;
};

let cache: IndexCache | null = null;

function labelsText(entry: NoteIndexEntry): string {
  const parts: string[] = [];
  for (const l of entry.labels ?? []) {
    if (l.preview) parts.push(l.preview);
    if (l.label) parts.push(l.label);
  }
  for (const il of entry.inlineLabels ?? []) {
    if (il.text) parts.push(il.text);
  }
  return parts.join(" ");
}

function stepsText(entry: NoteIndexEntry): string {
  return (entry.steps ?? []).map((s) => s.text).join(" ");
}

/**
 * vault からインデックスを組む（初回検索時に一度だけ）。
 * ノート本体まで読むのでヒット率は本体の全文検索に近い。
 */
function buildIndex(root: string): IndexCache {
  const index = readNoteIndex(root);
  const entries = index ? activeNotes(index) : scanNotesWithoutIndex(root);

  const docs: SearchDoc[] = [];
  const entryMap = new Map<string, NoteIndexEntry>();

  for (const entry of entries) {
    entryMap.set(entry.noteId, entry);
    const doc = readNote(entry.noteId, root);
    docs.push({
      id: entry.noteId,
      title: entry.title ?? "",
      text: doc ? noteToMarkdown(doc) : "",
      labels: labelsText(entry),
      steps: stepsText(entry),
      kind: entry.source === "ai" ? "wiki" : "note",
    });
  }

  const mini = new MiniSearch<SearchDoc>(miniSearchOptions());
  mini.addAll(docs);

  return { root, mini, entries: entryMap, indexMtimeMs: noteIndexMtimeMs(root) };
}

/**
 * インデックスを返す。
 *
 * stdio のプロセスはクライアントが生きている間ずっと残るので、その間に Graphium 本体が
 * ノートを足すとキャッシュが古くなる。note-index.json の更新時刻を見て、変わっていれば
 * 組み直す（Graphium は保存のたびにこのファイルを書き直す）。
 */
function getIndex(root: string): IndexCache {
  if (cache && cache.root === root && cache.indexMtimeMs === noteIndexMtimeMs(root)) {
    return cache;
  }
  cache = buildIndex(root);
  return cache;
}

/**
 * MCP 経由で作ったノートをインデックスに足す。
 *
 * 自分で書いたノートを直後に検索できないと「保存して」→「探して」の流れが崩れる。
 * note-index.json は Graphium が書くもので MCP からは触らないため、その更新を待たずに
 * メモリ上の索引だけ先に追いつかせる。
 */
export function addCreatedNoteToIndex(
  noteId: string,
  title: string,
  body: string,
  root = resolveGraphiumRoot(),
): void {
  // まだ組んでいなければ何もしない（次に組むときファイルから拾われる）
  if (!cache || cache.root !== root) return;
  if (cache.mini.has(noteId)) return;

  cache.mini.add({ id: noteId, title, text: body, labels: "", steps: "", kind: "note" });
  cache.entries.set(noteId, {
    noteId,
    title,
    modifiedAt: "",
    createdAt: "",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "human",
  });
  // 足した分は自分で反映済みなので、この更新で組み直しが走らないようにしておく
  cache.indexMtimeMs = noteIndexMtimeMs(root);
}

/** テスト・再読み込み用にキャッシュを捨てる */
export function resetSearchIndex(): void {
  cache = null;
}

/** ヒット語の周辺を切り出す */
function makeSnippet(text: string, query: string, maxLen = 240): string {
  if (!text) return "";
  const terms = Array.from(new Set(tokenize(query))).filter((t) => t.length > 0);
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return text.slice(0, maxLen).trim();
  const start = Math.max(0, at - maxLen / 3);
  const snippet = text.slice(start, start + maxLen).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + snippet + (start + maxLen < text.length ? "…" : "");
}

export type SearchOptions = {
  limit?: number;
  /** "note" = 人が書いたノート / "wiki" = AI 生成ドキュメント。未指定なら両方 */
  kind?: NoteKind;
};

export function searchNotes(
  query: string,
  options: SearchOptions = {},
  root = resolveGraphiumRoot(),
): SearchHit[] {
  const { limit = 10, kind } = options;
  if (!query.trim()) return [];

  const { mini } = getIndex(root);
  const results = mini.search(query, miniSearchOptions().searchOptions);

  const hits: SearchHit[] = [];
  for (const r of results) {
    const stored = r as unknown as { title: string; kind: NoteKind; text: string };
    if (kind && stored.kind !== kind) continue;
    hits.push({
      noteId: String(r.id),
      title: stored.title,
      kind: stored.kind,
      score: Math.round(r.score * 100) / 100,
      snippet: makeSnippet(stored.text || stored.title, query),
      matchedIn: Object.keys(r.match ?? {}).length
        ? Array.from(new Set(Object.values(r.match ?? {}).flat() as string[]))
        : [],
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** noteId から index エントリを引く（ツール側で labels/links を使うため） */
export function getEntry(noteId: string, root = resolveGraphiumRoot()): NoteIndexEntry | null {
  return getIndex(root).entries.get(noteId) ?? null;
}

/** 全エントリ（検索以外のツールが横断に使う） */
export function allEntries(root = resolveGraphiumRoot()): NoteIndexEntry[] {
  return Array.from(getIndex(root).entries.values());
}
