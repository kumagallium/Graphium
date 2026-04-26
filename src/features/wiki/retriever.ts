// Wiki Retriever
// AI チャット送信前に embedding 検索を行い、関連する Wiki セクションを
// システムプロンプトに注入するコンテキスト文字列として返す

import { embeddingStore, type SearchResult } from "../../lib/embedding-store";
import { getEmbeddingModel, getEmbeddingLLMModel } from "../settings/store";
import { apiBase, isTauri } from "../../lib/platform";

const TOP_K = 5;
const MIN_SCORE = 0.3;
const MAX_CONTEXT_CHARS = 2000;

/**
 * ユーザーメッセージに関連する Wiki コンテキストを検索して注入用文字列を返す
 *
 * embedding が利用不可能な場合（IndexedDB が空など）は null を返す
 */
export async function retrieveWikiContext(
  userMessage: string,
): Promise<string | null> {
  // まず embedding ベースの検索を試みる
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

    if (res.ok) {
      const data = await res.json() as {
        embeddings: { vector: number[] }[];
      };

      if (data.embeddings?.[0]?.vector) {
        const queryVector = data.embeddings[0].vector;
        const results = await embeddingStore.searchByVector(queryVector, TOP_K);
        const relevant = results.filter((r) => r.score >= MIN_SCORE);
        if (relevant.length > 0) {
          return formatWikiContext(relevant, _wikiIndexText || undefined);
        }
      }
    }
  } catch {
    // embedding 失敗 → フォールバックへ
  }

  // フォールバック: テキストマッチベースの検索
  return retrieveWikiContextFallback(userMessage);
}

/**
 * フォールバック Retriever: embedding が使えない場合にタイトル・テキストマッチで検索
 */
export async function retrieveWikiContextFallback(
  userMessage: string,
): Promise<string | null> {
  try {
    // IndexedDB から全 embedding のテキストを取得して文字列マッチ
    const allRecords = await getAllEmbeddingTexts();
    if (allRecords.length === 0) return null;

    const query = userMessage.toLowerCase();
    const matched = allRecords
      .map((r) => ({
        ...r,
        score: calculateTextRelevance(query, r.text.toLowerCase()),
      }))
      .filter((r) => r.score > 0)
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
  // EmbeddingStore の searchByVector にダミーベクトルを渡すのではなく、
  // 全件取得して文字列マッチするために直接 IndexedDB を読む
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("graphium-embeddings", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction("embeddings", "readonly");
    const store = tx.objectStore("embeddings");
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result.map((r: any) => ({
        documentId: r.documentId,
        sectionId: r.sectionId,
        score: 0,
        text: r.text,
      }));
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
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

/** 検索結果をシステムプロンプト注入用フォーマットに変換 */
function formatWikiContext(results: SearchResult[], wikiIndexText?: string): string {
  let context = "";
  for (const r of results) {
    // メタ情報付きで注入（引用元の特定に使う）
    const title = _wikiTitleMap.get(r.documentId) ?? r.documentId;
    const entry = `[id: ${r.documentId}, title: "${title}"]\n${r.text}\n\n`;
    if (context.length + entry.length > MAX_CONTEXT_CHARS) break;
    context += entry;
  }

  if (!context && !wikiIndexText) return null as any;

  let output = `The following is the user's accumulated knowledge from their Wiki. Use it when relevant to provide informed responses.
When you use information from the knowledge sections below, cite the source using [Source: "page title"] format.`;

  if (wikiIndexText) {
    output += `\n\n<wiki-index>\n${wikiIndexText}\n</wiki-index>`;
  }

  if (context) {
    output += `\n\n<knowledge>\n${context.trim()}\n</knowledge>`;
  }

  return output;
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
