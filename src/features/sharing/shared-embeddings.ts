// 共有ナレッジ（type=knowledge）の埋め込みを「手元に」作る
//
// なぜ手元だけか:
//   ベクトルは埋め込みモデルに固有なので、共有フォルダに置いても
//   モデルが違うメンバーとは比較できない（fork 時に他人の埋め込みを捨てる既存方針と同じ）。
//   共有フォルダには一切書かず、各自の IndexedDB（graphium-embeddings）にだけ作る。
//
// 何をするか:
//   - type=knowledge のエントリで `id → hash` が記録と違うものを embedWikiSections で埋め込む。
//     documentId = 共有エントリ id（uuidv7 なので手元の Wiki id と衝突しない）。
//     chunk の粒度は語彙索引側（shared-entry-source の extractWikiSections）と揃うので、
//     retriever の RRF が `documentId:sectionId` で束ねられる
//   - 共有ライブラリから消えた id は embeddingStore.deleteByDocument で掃除する。
//     スイッチ OFF のときは呼び出し側が空配列を渡すので、この掃除だけが走る
//
// 記録は localStorage（`graphium-shared-embedded`）に置く。壊れても作り直せる
// キャッシュの索引でしかないので、IndexedDB を増やすほどのものではない。

import { embeddingStore } from "../../lib/embedding-store";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import { embedWikiSections } from "../wiki/wiki-service";

/** 埋め込み済みの共有ナレッジ: id → そのとき埋め込んだ hash */
const EMBEDDED_KEY = "graphium-shared-embedded";

/** 本文を読む関数（既定は共有ストアの readSharedEntryBody。テストで差し替える） */
export type SharedBodyReader = (entry: SharedEntry) => Promise<{ body: Uint8Array; verified: boolean }>;

export type SharedEmbeddingSyncResult = {
  /** 今回埋め込んだ（または「中身なし」として記録した）id */
  embedded: string[];
  /** 共有から消えたので埋め込みを消した id */
  removed: string[];
  /** 失敗したので次回やり直す id */
  failed: string[];
};

function loadRecord(): Record<string, string> {
  try {
    const raw = localStorage.getItem(EMBEDDED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveRecord(record: Record<string, string>): void {
  try {
    localStorage.setItem(EMBEDDED_KEY, JSON.stringify(record));
  } catch {
    /* localStorage が使えない環境では毎回やり直すだけ（実害なし） */
  }
}

/** 本文（JSON テキスト）を GraphiumDocument として読む。壊れていれば null */
function parseDocument(body: Uint8Array): GraphiumDocument | null {
  try {
    const doc = JSON.parse(new TextDecoder().decode(body)) as GraphiumDocument;
    return doc && typeof doc === "object" && Array.isArray(doc.pages) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * 共有ナレッジの埋め込みを共有ライブラリの現状に合わせる。
 *
 * 例外は投げない（AI チャットの起動導線から呼ばれるので、埋め込み API が落ちていても
 * 止まってはいけない）。embedWikiSections 自体が API 失敗時に text-only へフォールバック
 * するので、ここでは「投げられたら次回やり直す」だけにする。
 */
export async function syncSharedKnowledgeEmbeddings(
  entries: SharedEntry[],
  readBody: SharedBodyReader,
): Promise<SharedEmbeddingSyncResult> {
  const result: SharedEmbeddingSyncResult = { embedded: [], removed: [], failed: [] };
  const record = loadRecord();
  const knowledge = entries.filter((e) => e.type === "knowledge");
  const alive = new Set(knowledge.map((e) => e.id));

  // 1. 共有から消えたもの（unshare / 別ルートに切り替え / スイッチ OFF）を掃除する
  for (const id of Object.keys(record)) {
    if (alive.has(id)) continue;
    try {
      await embeddingStore.deleteByDocument(id);
      delete record[id];
      result.removed.push(id);
    } catch {
      // 消せなかったら記録も残す（次回もう一度試す）
      result.failed.push(id);
    }
  }

  // 2. 未埋め込み / hash が変わったものを埋め込む
  for (const entry of knowledge) {
    if (record[entry.id] === entry.hash) continue;
    try {
      const { body, verified } = await readBody(entry);
      const doc = verified ? parseDocument(body) : null;
      if (!doc) {
        // hash 不一致・壊れた JSON。古いベクトルが残っていると嘘の根拠になるので消し、
        // 「この hash では中身なし」と記録して hash が変わるまで読み直さない
        // （語彙索引側の chunks: [] と同じ扱い）
        await embeddingStore.deleteByDocument(entry.id);
        record[entry.id] = entry.hash;
        result.embedded.push(entry.id);
        continue;
      }
      await embedWikiSections(entry.id, doc);
      record[entry.id] = entry.hash;
      result.embedded.push(entry.id);
    } catch {
      // 読めない / 埋め込みが投げた → 記録しないので次回やり直す
      result.failed.push(entry.id);
    }
  }

  saveRecord(record);
  return result;
}
