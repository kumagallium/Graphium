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

import type { GraphiumDocument } from "../lib/document-types";
import { tokenize } from "../features/lexical-search/tokenizer";
import type { NoteIndexEntry } from "../features/navigation/index-file";
import { noteToMarkdown } from "./note-text";
import {
  activeNotes,
  noteIndexMtimeMs,
  readNote,
  readNoteIndex,
  resolveGraphiumRoot,
  scanUnlistedDocuments,
  vaultFileCounts,
} from "./vault";

/**
 * ノートの種別。
 * - note    : 人が書いたノート（PROV 層）
 * - topic   : 知見(claim)を概念ごとに束ねたトピック
 * - answer  : AI チャットの良い回答をナレッジ層に書き戻したページ（WikiKind の "answer"）
 * - claim   : ノートから抽出された出典つきの知見
 * - insight : 複数の知見にまたがる構造的パターン（WikiKind の "atom"）
 * - summary : 生成停止済みの旧「1 ノート要約」（WikiKind の "summary" / "synthesis" を含む）
 */
export type DetailedKind = "note" | "topic" | "answer" | "claim" | "insight" | "summary";

/**
 * search_notes / list_entities 系フィルタが受け付ける種別。
 * "wiki" は DetailedKind のうち "note" 以外すべて（ナレッジ全種）を指す後方互換の値。
 */
export type NoteKind = "note" | "wiki" | "topic" | "answer" | "claim" | "insight";

/** NoteIndexEntry から DetailedKind を導く */
function detailedKindOf(entry: NoteIndexEntry): DetailedKind {
  if (entry.source !== "ai") return "note";
  switch (entry.wikiKind) {
    case "topic":
      return "topic";
    case "answer":
      return "answer";
    case "claim":
      return "claim";
    case "atom":
      return "insight";
    default:
      // summary / synthesis（撤退済み） / 未設定はまとめて summary 扱い
      return "summary";
  }
}

type SearchDoc = {
  id: string;
  title: string;
  /** 本文（Markdown 化したもの） */
  text: string;
  /** PROV ラベルとインラインラベルのテキストを連結したもの */
  labels: string;
  /** 手順名を連結したもの */
  steps: string;
  kind: DetailedKind;
};

export type SearchHit = {
  noteId: string;
  title: string;
  kind: DetailedKind;
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
  /** 構築時に見た notes/ 直下の *.json の件数。Skill など外部書き込みの検知に使う */
  notesCount: number;
  /** 構築時に見た wiki/ 直下の *.json の件数。同上 */
  wikiCount: number;
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

/** 索引に本文を入れるドキュメント（タイトルとページだけ使う） */
type IndexedDocument = Pick<GraphiumDocument, "title" | "pages">;

/**
 * 索引に入れる本文。ファイルから組むとき（buildIndex）も、作った直後に足すとき
 * （addCreated*ToIndex）も必ずここを通す。別々に作ると、同じノートが作った直後と
 * 組み直した後で違う語に当たる。
 *
 * 平文（上付き・下付きのタグを入れない）にするのは本体の語彙索引と揃え、"sup" が語として
 * 当たらないようにするため。「10⁵」は NFKC で「105」として引ける
 */
function indexText(doc: IndexedDocument | null): string {
  return doc ? noteToMarkdown(doc, { scripts: false }) : "";
}

/**
 * vault からインデックスを組む（初回の検索時と、note-index.json が書き直された後の検索時）。
 * ノート本体まで読むのでヒット率は本体の全文検索に近い。
 *
 * 対象は note-index.json に載っているもの（ゴミ箱・アーカイブ・Skill を除く）と、まだ載って
 * いないファイル。アプリは一覧を取り直す（起動時など）まで新しいファイルを載せないので、
 * create_note / save_answer で作ったばかりのものは後者で拾う（セッションの最初の呼び出しが
 * 保存だったとき・アプリが別のノートを保存して note-index.json を書き直したとき・MCP サーバーを
 * 立て直したときも落ちない）。載った後はゴミ箱・アーカイブを含めてアプリの見え方に従う。
 */
function buildIndex(root: string): IndexCache {
  const index = readNoteIndex(root);
  const listed = new Set(index?.notes.map((n) => n.noteId));
  const entries = [...(index ? activeNotes(index) : []), ...scanUnlistedDocuments(listed, root)];

  const docs: SearchDoc[] = [];
  const entryMap = new Map<string, NoteIndexEntry>();

  for (const entry of entries) {
    entryMap.set(entry.noteId, entry);
    const doc = readNote(entry.noteId, root);
    docs.push({
      id: entry.noteId,
      title: entry.title ?? "",
      text: indexText(doc),
      labels: labelsText(entry),
      steps: stepsText(entry),
      kind: detailedKindOf(entry),
    });
  }

  const mini = new MiniSearch<SearchDoc>(miniSearchOptions());
  mini.addAll(docs);

  const counts = vaultFileCounts(root);
  return {
    root,
    mini,
    entries: entryMap,
    indexMtimeMs: noteIndexMtimeMs(root),
    notesCount: counts.notes,
    wikiCount: counts.wiki,
  };
}

/**
 * インデックスを返す。
 *
 * stdio のプロセスはクライアントが生きている間ずっと残るので、その間に Graphium 本体が
 * ノートを足すとキャッシュが古くなる。note-index.json の更新時刻に加えて、notes/ と wiki/
 * 直下の *.json の件数も見る。Claude Code の Skill（save.mjs）など、note-index.json を
 * 意図的に書き換えずに notes/・wiki/ へファイルを足す経路があるため、更新時刻だけでは
 * それを検知できない。3 つのうちどれかが構築時と違えば組み直す
 * （Graphium 本体はノート保存のたびに note-index.json を書き直す）。
 *
 * ファイルの中身だけを書き換えた場合（件数は変わらない）は検知できず、次に note-index.json
 * が書き直されるまで古い内容のまま——これは今回の変更でも直らない制限。
 */
function getIndex(root: string): IndexCache {
  if (cache && cache.root === root && cache.indexMtimeMs === noteIndexMtimeMs(root)) {
    const counts = vaultFileCounts(root);
    if (cache.notesCount === counts.notes && cache.wikiCount === counts.wiki) {
      return cache;
    }
  }
  cache = buildIndex(root);
  return cache;
}

/**
 * MCP 経由で作ったノートをインデックスに足す。
 *
 * 自分で書いたノートを直後に検索できないと「保存して」→「探して」の流れが崩れる。
 * note-index.json は Graphium が書くもので MCP からは触らないため、その更新を待たずに
 * メモリ上の索引だけ先に追いつかせる。組み直しても、アプリが載せるまでは note-index.json に
 * まだ無いファイルとして拾い直される（buildIndex）ので、組み直しを止める必要は無い
 * （note-index.json の更新時刻を覚え直すと、その間にアプリが足したノートを取りこぼす）。
 *
 * 本文は受け取った Markdown ではなく、保存したドキュメントから組む。Markdown には
 * <sup> などのタグが残り、citations から足した References 節が無いので、そのまま入れると
 * 組み直した後（ファイルから読む）と当たる語が食い違う。
 */
export function addCreatedNoteToIndex(
  noteId: string,
  doc: IndexedDocument,
  root = resolveGraphiumRoot(),
): void {
  // まだ組んでいなければ何もしない（組むときに、note-index.json にまだ無いファイルとして拾われる）
  if (!cache || cache.root !== root) return;
  if (cache.mini.has(noteId)) return;

  cache.mini.add({ id: noteId, title: doc.title, text: indexText(doc), labels: "", steps: "", kind: "note" });
  cache.entries.set(noteId, {
    noteId,
    title: doc.title,
    modifiedAt: "",
    createdAt: "",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "human",
  });
}

/**
 * MCP 経由で作った回答ページ（wiki/answer）をインデックスに足す。
 * addCreatedNoteToIndex と同じ理由（保存直後に検索できないと流れが崩れる）で、
 * kind だけ "answer" にして同じことをする。本文も同じく保存したドキュメントから組む
 * （回答の Markdown に残る [[source:<id>]] の印は、保存時に @リンクへ置き換わる）。
 */
export function addCreatedWikiToIndex(
  noteId: string,
  doc: IndexedDocument,
  kind: DetailedKind,
  root = resolveGraphiumRoot(),
): void {
  if (!cache || cache.root !== root) return;
  if (cache.mini.has(noteId)) return;

  cache.mini.add({ id: noteId, title: doc.title, text: indexText(doc), labels: "", steps: "", kind });
  cache.entries.set(noteId, {
    noteId,
    title: doc.title,
    modifiedAt: "",
    createdAt: "",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "ai",
    wikiKind: kind === "answer" ? "answer" : undefined,
  } as NoteIndexEntry);
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
  /** 種別で絞る。"wiki" は note 以外すべて（ナレッジ全種）。未指定なら全種別 */
  kind?: NoteKind;
};

/** kind フィルタが hit の種別を通すか */
function matchesKindFilter(hitKind: DetailedKind, filter?: NoteKind): boolean {
  if (!filter) return true;
  if (filter === "wiki") return hitKind !== "note";
  return hitKind === filter;
}

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
    const stored = r as unknown as { title: string; kind: DetailedKind; text: string };
    if (!matchesKindFilter(stored.kind, kind)) continue;
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
