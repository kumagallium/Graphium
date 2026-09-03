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
//
// 共有ライブラリ（第 3 レーン kind: "shared"）も設定 ON のとき同じ土俵に載せる。
// 共有ナレッジ（type=knowledge）だけは手元に埋め込みを作ってあるので Wiki と同じく
// <knowledge> 側へ、それ以外（共有ノート・URL・素材メタ）は <notes> 側へ振り分ける。

import { embeddingStore, type SearchResult } from "../../lib/embedding-store";
import { aiErrorFromResponse, notifyEmbeddingFailure } from "../../lib/ai-error";
import { getEmbeddingModel, getEmbeddingLLMModel } from "../settings/store";
import { apiBase, isTauri } from "../../lib/platform";
import { lexicalSearch, reciprocalRankFusion, type LexicalHit, type LexicalSourceKind } from "../lexical-search";
// 共有ストアは実ファイル指定で読む（sharing の barrel は View まで引き込むので循環を避ける）
import { getSharedLibrarySnapshot } from "../sharing/shared-library-store";
// 設定も config を直に読む（storage/shared の barrel は Tauri のダイアログまで連れてくる）
import { getSharedAiEnabled } from "../../lib/storage/shared/config";

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
/**
 * 埋め込み検索に渡すクエリの上限文字数。
 * 埋め込みモデルには入力上限がある（multilingual-e5-large は 512 トークン。日本語は
 * おおむね 1 文字 ≒ 1 トークン強）。呼び出し側は質問文だけを渡す約束だが、長い引用や
 * 貼り付けが混ざったときに 400 で検索ごと落ちないよう、ここでも切っておく。
 * 検索クエリの意味は先頭に集まるので、先頭を残して切れば十分。
 */
export const MAX_EMBED_QUERY_CHARS = 1000;

/** 埋め込みクエリを上限で切る（前後の空白も落とす） */
export function clampEmbedQuery(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_EMBED_QUERY_CHARS ? trimmed.slice(0, MAX_EMBED_QUERY_CHARS) : trimmed;
}

/** 注入する断片の共通形（Wiki セクション / ノート本文 / 素材 / 共有エントリ） */
export type RetrievedPassage = {
  kind: "wiki" | "note" | "asset" | "shared";
  /** Wiki id / ノート id / 素材 fileId / 共有エントリ id */
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
 * ときは空配列を返す（例外にしない）。API 失敗は notifyEmbeddingFailure で可視化する。
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
    const query = clampEmbedQuery(userMessage);
    if (!query) return [];
    const res = await fetch(`${apiBase()}/wiki/embed`, {
      method: "POST",
      headers: embedHeaders,
      body: JSON.stringify({
        texts: [{ documentId: "_query", sectionId: "_query", text: query }],
        ...(embModel ? { embedding_model: embModel } : {}),
      }),
    });
    if (!res.ok) {
      // 空配列（語彙検索へ委譲）は維持しつつ、埋め込み検索が効いていないことを可視化する
      notifyEmbeddingFailure(await aiErrorFromResponse(res, "Embedding request failed"));
      return [];
    }
    const data = await res.json() as { embeddings: { vector: number[] }[] };
    const queryVector = data.embeddings?.[0]?.vector;
    if (!queryVector) return [];
    // 除外分を見込んで多めに取り、@引用・派生知識と重複するものを落とす
    const results = await embeddingStore.searchByVector(queryVector, TOP_K + LEXICAL_CANDIDATES + (excludeIds?.size ?? 0));
    return results.filter((r) => r.score >= MIN_SCORE && !excludeIds?.has(r.documentId));
  } catch (err) {
    notifyEmbeddingFailure(err);
    return [];
  }
}

/**
 * 共有レーンの文脈（この検索で使う分だけスナップショットから切り出す）。
 * enabled が false のときは kinds に "shared" を足さないので、索引に共有文書が
 * 残っていても混ざらない。
 */
type SharedLane = {
  enabled: boolean;
  /** 共有エントリが type=knowledge か（＝ <knowledge> 側に載せるか） */
  isKnowledge: (sourceId: string) => boolean;
  /** 共有エントリ id → 題名（引用表示と参照解決用） */
  titles: Map<string, string>;
};

function sharedLaneContext(): SharedLane {
  const snapshot = getSharedLibrarySnapshot();
  // 共有ルート未設定（＝デスクトップ以外も含む）／スイッチ OFF なら丸ごと使わない
  if (!snapshot.root || !getSharedAiEnabled()) {
    return { enabled: false, isKnowledge: () => false, titles: new Map() };
  }
  const knowledge = new Set<string>();
  const titles = new Map<string, string>();
  for (const e of snapshot.entries) {
    if (e.type === "knowledge") knowledge.add(e.id);
    const title = (e.extra as Record<string, unknown> | undefined)?.title;
    if (typeof title === "string" && title.trim()) titles.set(e.id, title.trim());
  }
  return { enabled: true, isKnowledge: (id) => knowledge.has(id), titles };
}

/** 語彙ヒットの kind を <notes> 側の断片 kind に写す（wiki は <notes> には来ない） */
function passageKind(kind: LexicalSourceKind): RetrievedPassage["kind"] {
  return kind === "asset" || kind === "shared" ? kind : "note";
}

/** 語彙インデックスで引く（未ロードなら空） */
function lexicalHits(userMessage: string, kinds: LexicalSourceKind[], excludeIds?: Set<string>, perSourceLimit?: number): LexicalHit[] {
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
  // 0. 共有レーンの有無を決め、題名マップを差し替える。
  //    dense 側にも共有ナレッジの documentId が混ざる（手元で埋め込んでいる）ので、
  //    タイトル解決にはこのマップが要る
  const shared = sharedLaneContext();
  setSharedTitleMap(shared.titles);

  // 1. Wiki: 埋め込み（意味）と語彙（BM25）を並行して引き、RRF で束ねる。
  //    共有ナレッジは同じ扱い（埋め込みも語彙も documentId:sectionId で揃えてある）
  const [dense, lexWikiLane] = await Promise.all([
    denseWikiSearch(userMessage, excludeIds),
    Promise.resolve(lexicalHits(userMessage, shared.enabled ? ["wiki", "shared"] : ["wiki"], excludeIds)),
  ]);
  const lexWiki = lexWikiLane.filter((h) => h.kind !== "shared" || shared.isKnowledge(h.sourceId));
  const wikiSections = fuseWikiSections(dense, lexWiki);

  // 2. ノート本文・素材・共有（ナレッジ以外）: 語彙のみ。同じソースからは最大 2 断片
  const passages = lexicalHits(userMessage, shared.enabled ? ["note", "asset", "shared"] : ["note", "asset"], excludeIds, 2)
    .filter((h) => h.kind !== "shared" || !shared.isKnowledge(h.sourceId))
    .slice(0, TOP_K_PASSAGES)
    .map<RetrievedPassage>((h) => ({ kind: passageKind(h.kind), sourceId: h.sourceId, chunkId: h.chunkId, title: h.title, text: h.text, score: h.score }));

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
    // 共有ナレッジは _wikiTitleMap に居ないので、共有側の題名マップも見る
    // （dense ヒットは title が空で来るため、ここで解決できないと skip されてしまう）
    const title = _wikiTitleMap.get(r.sourceId) || _sharedTitleMap.get(r.sourceId) || r.title;
    if (!title) continue;
    const entry = `[#${n + 1} | "${title}"]\n${r.text}\n\n`;
    if (knowledge.length + entry.length > MAX_CONTEXT_CHARS) break;
    n += 1;
    knowledge += entry;
  }

  let notes = "";
  for (const p of passages) {
    const title = p.title || _noteTitleMap.get(p.sourceId) || _sharedTitleMap.get(p.sourceId) || "";
    if (!title) continue;
    const text = p.text.length > MAX_PASSAGE_CHARS ? `${p.text.slice(0, MAX_PASSAGE_CHARS)}…` : p.text;
    // ラベルと参照の prefix は同じ語（asset / shared / note）で揃えてある
    const label = p.kind === "asset" || p.kind === "shared" ? p.kind : "note";
    const entry = `[#${n + 1} | "${title}"] (${label})\n${text}\n\n`;
    if (notes.length + entry.length > MAX_PASSAGES_CHARS) break;
    n += 1;
    notes += entry;
    _passageTitleRefs.set(title, `${label}:${p.sourceId}`);
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
 * 共有エントリ id → 題名。検索のたびに共有ストアのスナップショットから作り直す。
 * 埋め込み（dense）は documentId しか返さないので、共有ナレッジの題名解決はここが唯一の経路。
 */
let _sharedTitleMap: Map<string, string> = new Map();
export function setSharedTitleMap(map: Map<string, string>): void {
  _sharedTitleMap = map;
}

/**
 * タイトル → 参照先のマップ（[Source: "title"] クリック対応用）。
 * Wiki は wikiId そのまま、ノートは `note:<id>`、素材は `asset:<fileId>`、
 * 共有エントリは `shared:<id>` の値になる。
 * ノート・素材はこのセッションで実際に注入した断片だけ（LLM が引用しうるのはそれだけ）。
 */
export function getSourceTitleToRefMap(): Map<string, string> {
  const map = new Map<string, string>();
  // 共有は Wiki 同様に一覧ごと載せる（<knowledge> 側に入った共有ナレッジは
  // 断片の記録に残らないため）。同名なら実際に注入した断片・Wiki を優先する
  for (const [id, title] of _sharedTitleMap.entries()) {
    if (title) map.set(title, `shared:${id}`);
  }
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
