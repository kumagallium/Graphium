// Wiki Retriever（横断検索）
// AI チャット送信前に、ユーザーの蓄積（Wiki セクション + ノート本文 + 素材テキスト）から
// 関連する断片を検索し、システムプロンプトに注入するコンテキスト文字列として返す。
//
// 検索は 2 系統を RRF（順位融合）で束ねる:
// - 埋め込み（意味的近さ）: Wiki セクションのみ（graphium-embeddings）。埋め込みモデルが
//   無い / 失敗したときは空リストになるだけで、下の語彙側がそのまま効く
// - 語彙（BM25・lexical-search）: Wiki セクション + ノート本文 + 素材テキスト。モデル非依存・完全ローカル
// Wiki は両系統を融合して <knowledge> に、ノート本文・素材は語彙側だけで <notes> に入れる。
// どちらの断片も [#N | "title"] の番号ハンドルで引用させる（citation-normalize が [#N] を
// [Source: "title"] に正規化し、パネルがタイトル → 参照先に解決してジャンプする）。

import { embeddingStore, type SearchResult } from "../../lib/embedding-store";
import { getEmbeddingModel, getEmbeddingLLMModel } from "../settings/store";
import { apiBase, isTauri } from "../../lib/platform";
import { lexicalSearch, reciprocalRankFusion, type LexicalHit } from "../lexical-search";

const TOP_K = 5;
const MIN_SCORE = 0.3;
const MAX_CONTEXT_CHARS = 2000;
/** ノート本文・素材の断片: 上位いくつまで入れるか（Wiki より少なめ） */
const TOP_K_PASSAGES = 4;
/** ノート本文・素材の断片の合計文字数上限（Wiki の 2000 より低い予算） */
const MAX_PASSAGES_CHARS = 1600;
/** 1 断片あたりの上限（チャンクは ~600 字だが、長いものは切る） */
const MAX_PASSAGE_CHARS = 700;
/** 語彙側から拾う候補数（融合・除外の前） */
const LEXICAL_CANDIDATES = 20;

/** 注入する断片の共通形（Wiki セクション / ノート本文 / 素材） */
export type RetrievedPassage = {
  kind: "wiki" | "note" | "asset";
  /** Wiki id / ノート id / 素材 fileId */
  sourceId: string;
  /** セクション id / チャンク id */
  chunkId: string;
  /** 表示・引用に使うタイトル（Wiki は titleMap、ノート・素材は索引の title） */
  title: string;
  text: string;
  score: number;
};

/**
 * 埋め込みで Wiki セクションを引く。埋め込みが使えない（モデル未設定・API 失敗・索引空）
 * ときは空配列を返す（例外にしない）。
 */
async function denseWikiSearch(userMessage: string, excludeIds?: Set<string>): Promise<SearchResult[]> {
  try {
    const embModel = getEmbeddingModel();
    const embedHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (!isTauri()) {
      // Embedding 用の認証情報を送る（resolveModelConfig がヘッダーを最優先するため、
      // ここで chat モデルを送ると body.embedding_model が無視されてしまう）
      const model = getEmbeddingLLMModel();
      if (model) {
        embedHeaders["X-LLM-API-Key"] = JSON.stringify({
          provider: model.provider, modelId: model.modelId,
          apiKey: model.apiKey, apiBase: model.apiBase, name: model.name,
          rate: model.rate,
        });
      }
    }
    const res = await fetch(`${apiBase()}/wiki/embed`, {
      method: "POST",
      headers: embedHeaders,
      body: JSON.stringify({
        texts: [{ documentId: "_query", sectionId: "_query", text: userMessage }],
        ...(embModel ? { embedding_model: embModel } : {}),
      }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { embeddings: { vector: number[] }[] };
    const queryVector = data.embeddings?.[0]?.vector;
    if (!queryVector) return [];
    // 除外分を見込んで多めに取り、@引用・派生知識と重複するものを落とす
    const results = await embeddingStore.searchByVector(queryVector, TOP_K + LEXICAL_CANDIDATES + (excludeIds?.size ?? 0));
    return results.filter((r) => r.score >= MIN_SCORE && !excludeIds?.has(r.documentId));
  } catch {
    return [];
  }
}

/** 語彙インデックスで引く（未ロードなら空） */
function lexicalHits(userMessage: string, kinds: ("wiki" | "note" | "asset")[], excludeIds?: Set<string>, perSourceLimit?: number): LexicalHit[] {
  try {
    return lexicalSearch.search(userMessage, {
      kinds,
      limit: LEXICAL_CANDIDATES,
      excludeSourceIds: excludeIds,
      perSourceLimit,
      // 質問文は完成した文なので前方一致は不要（打鍵中の Cmd-K とは違う）
      prefixLastTerm: false,
      // 「時間」「条件」のような 1 語だけで当たる弱い候補を落とす（2 語以上当たったものだけ）
      minTermMatches: 2,
    });
  } catch {
    return [];
  }
}

/**
 * Wiki セクション: 埋め込みと語彙を RRF で融合して上位 TOP_K を選ぶ。
 * 同じセクションは `${documentId}:${sectionId}` で同一視する（embedding store と語彙索引で id 規約が揃っている）。
 */
export function fuseWikiSections(dense: SearchResult[], lexical: LexicalHit[], topK = TOP_K): RetrievedPassage[] {
  const byId = new Map<string, RetrievedPassage>();
  for (const r of dense) {
    const id = `${r.documentId}:${r.sectionId}`;
    if (!byId.has(id)) byId.set(id, { kind: "wiki", sourceId: r.documentId, chunkId: r.sectionId, title: "", text: r.text, score: r.score });
  }
  for (const h of lexical) {
    const id = `${h.sourceId}:${h.chunkId}`;
    if (!byId.has(id)) byId.set(id, { kind: "wiki", sourceId: h.sourceId, chunkId: h.chunkId, title: h.title, text: h.text, score: h.score });
  }
  const fused = reciprocalRankFusion([
    { name: "dense", items: dense.map((r) => ({ id: `${r.documentId}:${r.sectionId}`, score: r.score })) },
    { name: "lexical", items: lexical.map((h) => ({ id: `${h.sourceId}:${h.chunkId}`, score: h.score })) },
  ]);
  const out: RetrievedPassage[] = [];
  for (const f of fused) {
    const p = byId.get(f.id);
    if (!p) continue;
    out.push({ ...p, score: f.score });
    if (out.length >= topK) break;
  }
  return out;
}

/**
 * ユーザーメッセージに関連するコンテキスト（Wiki セクション + ノート本文・素材の断片）を
 * 検索して注入用文字列を返す。何も無ければ null。
 */
export async function retrieveWikiContext(
  userMessage: string,
  excludeIds?: Set<string>,
): Promise<string | null> {
  // 1. Wiki: 埋め込み（意味）と語彙（BM25）を並行して引き、RRF で束ねる
  const [dense, lexWiki] = await Promise.all([
    denseWikiSearch(userMessage, excludeIds),
    Promise.resolve(lexicalHits(userMessage, ["wiki"], excludeIds)),
  ]);
  const wikiSections = fuseWikiSections(dense, lexWiki);

  // 2. ノート本文・素材: 語彙のみ（埋め込みは Wiki にしか無い）。同じソースからは最大 2 断片
  const passages = lexicalHits(userMessage, ["note", "asset"], excludeIds, 2)
    .slice(0, TOP_K_PASSAGES)
    .map<RetrievedPassage>((h) => ({ kind: h.kind === "asset" ? "asset" : "note", sourceId: h.sourceId, chunkId: h.chunkId, title: h.title, text: h.text, score: h.score }));

  if (wikiSections.length > 0 || passages.length > 0) {
    return formatRetrievedContext(wikiSections, passages, _wikiIndexText || undefined);
  }

  // 3. どちらも空（埋め込み不可 + 語彙索引がまだ無い / ヒット無し）→ 従来のテキストマッチにフォールバック
  return retrieveWikiContextFallback(userMessage, excludeIds);
}

/**
 * フォールバック Retriever: embedding が使えない場合にタイトル・テキストマッチで検索
 */
export async function retrieveWikiContextFallback(
  userMessage: string,
  excludeIds?: Set<string>,
): Promise<string | null> {
  try {
    // IndexedDB から全 embedding のテキストを取得して文字列マッチ
    const allRecords = await getAllEmbeddingTexts();
    if (allRecords.length === 0) {
      // embedding 未登録でも wiki インデックス（タイトル一覧）だけは LLM に渡す。
      // 既存ユーザーの wiki が再 embed 前でも、LLM がタイトルから推測引用できるようにするため。
      if (_wikiIndexText) return formatWikiContext([], _wikiIndexText);
      return null;
    }

    const query = userMessage.toLowerCase();
    const matched = allRecords
      .map((r) => ({
        ...r,
        score: calculateTextRelevance(query, r.text.toLowerCase()),
      }))
      .filter((r) => r.score > 0 && !excludeIds?.has(r.documentId))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    if (matched.length === 0) {
      // 検索結果なしでもインデックスがあれば注入
      if (_wikiIndexText) return formatWikiContext([], _wikiIndexText);
      return null;
    }
    return formatWikiContext(matched, _wikiIndexText || undefined);
  } catch {
    return null;
  }
}

/** embedding テキストを全件取得（フォールバック用） */
async function getAllEmbeddingTexts(): Promise<SearchResult[]> {
  // searchByVector にダミーベクトルを渡すのではなく、全件をそのまま取って文字列マッチする。
  // IndexedDB は embedding-store 経由でのみ開く。以前はここで DB 名とバージョンを
  // ハードコードして直接 open していたため、embedding-store 側の DB_VERSION が上がった
  // 途端に VersionError で常に reject し、フォールバックが事実上死んでいた。
  const records = await embeddingStore.getAllRecords();
  return records.map((r) => ({
    documentId: r.documentId,
    sectionId: r.sectionId,
    score: 0,
    text: r.text,
  }));
}

/** テキスト関連度スコアを計算（単語一致ベース） */
function calculateTextRelevance(query: string, text: string): number {
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return 0;
  const matched = words.filter((w) => text.includes(w));
  return matched.length / words.length;
}

/** Wiki ドキュメントのタイトルマップを設定する（引用用） */
let _wikiTitleMap: Map<string, string> = new Map();
export function setWikiTitleMap(map: Map<string, string>): void {
  _wikiTitleMap = map;
}

/** タイトル → wikiId の逆引きマップ（[Source: "title"] クリック対応用） */
export function getWikiTitleToIdMap(): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [id, title] of _wikiTitleMap.entries()) {
    if (title) reverse.set(title, id);
  }
  return reverse;
}

/** 検索結果（埋め込みのみの旧形）をシステムプロンプト注入用フォーマットに変換（フォールバック用） */
function formatWikiContext(results: SearchResult[], wikiIndexText?: string): string {
  const sections: RetrievedPassage[] = results.map((r) => ({
    kind: "wiki",
    sourceId: r.documentId,
    chunkId: r.sectionId,
    title: "",
    text: r.text,
    score: r.score,
  }));
  return formatRetrievedContext(sections, [], wikiIndexText);
}

/** チャットで引用されたノート・素材のタイトル → 参照先（`note:<id>` / `asset:<fileId>`）。パネルのジャンプ用に蓄積する */
const _passageTitleRefs = new Map<string, string>();

/**
 * 検索結果をシステムプロンプト注入用フォーマットに変換する。
 * - Wiki セクションは <knowledge>、ノート本文・素材の断片は <notes> に入れる
 * - 通し番号 [#N | "title"] は両ブロックで連続させる（LLM にはこの番号で引用させる。
 *   番号は言い換えが効かないので、引用 → 元の突き合わせが堅牢になる）。タイトル引用も
 *   後方互換で許可し、post-processing 側で [#N] を [Source: "title"] に正規化する
 */
export function formatRetrievedContext(
  wikiSections: RetrievedPassage[],
  passages: RetrievedPassage[],
  wikiIndexText?: string,
): string {
  let n = 0;
  let knowledge = "";
  for (const r of wikiSections) {
    // titleMap に無い documentId は orphan embedding（削除済み wiki の残骸）。
    // UUID をそのまま title として LLM に渡すと、応答に `[Source: "uuid..."]` が
    // 残って "Knowledge referenced" に意味不明な行が出るため、ここで skip する。
    const title = _wikiTitleMap.get(r.sourceId) ?? r.title;
    if (!title) continue;
    const entry = `[#${n + 1} | "${title}"]\n${r.text}\n\n`;
    if (knowledge.length + entry.length > MAX_CONTEXT_CHARS) break;
    n += 1;
    knowledge += entry;
  }

  let notes = "";
  for (const p of passages) {
    const title = p.title || _noteTitleMap.get(p.sourceId) || "";
    if (!title) continue;
    const text = p.text.length > MAX_PASSAGE_CHARS ? `${p.text.slice(0, MAX_PASSAGE_CHARS)}…` : p.text;
    const label = p.kind === "asset" ? "asset" : "note";
    const entry = `[#${n + 1} | "${title}"] (${label})\n${text}\n\n`;
    if (notes.length + entry.length > MAX_PASSAGES_CHARS) break;
    n += 1;
    notes += entry;
    _passageTitleRefs.set(title, `${p.kind === "asset" ? "asset" : "note"}:${p.sourceId}`);
  }

  if (!knowledge && !notes && !wikiIndexText) return null as any;

  let output = `The following is the user's accumulated knowledge from their Wiki. Use it when relevant to provide informed responses.

The Wiki contains four kinds of pages, all equally valid as citation sources:
- **Concept**: generalized principles / findings / bridges (abstracted insight)
- **Synthesis**: integrated insights across multiple concepts (use these when the user asks open-ended questions or wants new ideas / connections)
- **Atom**: concrete observations / data fragments from notes (use these as primary-source evidence)
- **Summary**: per-note summaries

When the user asks an open-ended question (e.g. "what can we say from this?", "any ideas?"), actively draw on **Synthesis** and **Atom** pages in addition to Concepts — they often hold the most actionable evidence and the most generative connections.

CITATION FORMAT (STRICT):
- Each knowledge section below is prefixed with a number marker like [#1 | "title"]. When you use information from a section, immediately follow that statement with its number marker, e.g. [#1].
- Numbers are stable handles — prefer them. Do NOT paraphrase, translate, or invent titles.
- If you cite a page that only appears in the <wiki-index> (no number), use [Source: "exact title"] with ASCII brackets and straight double quotes — copy the title exactly, no @ prefix, no full-width 【】.
- Do NOT cite a number or title that is not shown below. Do not fabricate citations.
- Example: ...lowers thermal conductivity [#2].`;

  if (wikiIndexText) {
    output += `\n\n<wiki-index>\n${wikiIndexText}\n</wiki-index>`;
  }

  if (knowledge) {
    output += `\n\n<knowledge>\n${knowledge.trim()}\n</knowledge>`;
  }

  if (notes) {
    output += `\n\n<notes>
Passages from the user's own notes and assets (raw material, matched by keyword — not distilled knowledge). Each is prefixed with the same kind of number marker; cite them the same way, e.g. [#4]. Prefer them for concrete details (numbers, conditions, procedures) and say so when a statement rests on a raw note rather than distilled knowledge.
${notes.trim()}
</notes>`;
  }

  return output;
}

/** ノート id → タイトル（ノート本文の断片の引用表示用。索引の title が空のときの補完） */
let _noteTitleMap: Map<string, string> = new Map();
export function setNoteTitleMap(map: Map<string, string>): void {
  _noteTitleMap = map;
}

/**
 * タイトル → 参照先のマップ（[Source: "title"] クリック対応用）。
 * Wiki は wikiId そのまま、ノートは `note:<id>`、素材は `asset:<fileId>` の値になる。
 * ノート・素材はこのセッションで実際に注入した断片だけ（LLM が引用しうるのはそれだけ）。
 */
export function getSourceTitleToRefMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [title, ref] of _passageTitleRefs.entries()) map.set(title, ref);
  // Wiki が同名なら Wiki を優先（結晶化した知識の方が引用先として自然）
  for (const [id, title] of _wikiTitleMap.entries()) {
    if (title) map.set(title, id);
  }
  return map;
}

/** Wiki インデックステキストを設定する（外部から注入） */
let _wikiIndexText: string = "";
export function setWikiIndexForRetriever(text: string): void {
  _wikiIndexText = text;
}

/** 現在の Wiki インデックステキストを取得 */
export function getWikiIndexText(): string {
  return _wikiIndexText;
}
