// 一括ナレッジ化の「取り込み済みで変わっていない」スキップ判定
//
// 背景: 一括ナレッジ化は AI 由来ノート（source === "ai"）を外すだけで、既にナレッジ化
// されていて内容が変わっていないノートも毎回読ませていた。呼び出し回数だけかかって
// 結果はほぼ変わらない。
//
// 「取り込み済みか」は知見の時刻では判定できない（知見は既定 OFF の拡張で、
// 新規ユーザーには存在しない）。またトピックページの modifiedAt / lastIngestedAt でも
// 判定できない（トピックは複数の資料から改訂されるため、別のノートで改訂されただけで
// 「このノートも取り込み済み」に誤検出する）。
//
// 正しい材料は各ナレッジページの documentProvenance.activities（EditActivity）の
// `used`（この操作が取り込んだソースの id）。対象ノートを used に含む活動の endedAt の
// 最大値が、そのノートを最後に取り込んだ時刻になる。資料ごとに正確で、新しい保存先も要らない。

import type { GraphiumDocument } from "../../lib/document-types";

/**
 * ナレッジページ群の来歴から、指定ソース（ノート等）を最後に取り込んだ時刻を求める。
 * 見つからなければ undefined（= 取り込み記録なし）。
 */
export function lastIngestedAtForSource(
  sourceId: string,
  docs: GraphiumDocument[],
): string | undefined {
  let latest: string | undefined;
  for (const doc of docs) {
    const activities = doc.documentProvenance?.activities;
    if (!activities) continue;
    for (const activity of activities) {
      if (!activity.used?.includes(sourceId)) continue;
      if (!activity.endedAt) continue;
      if (!latest || new Date(activity.endedAt).getTime() > new Date(latest).getTime()) {
        latest = activity.endedAt;
      }
    }
  }
  return latest;
}

/**
 * 資料が最後の取り込み以降に変わっていないかを判定する。
 * - lastIngestedAt が無ければ外さない（false）
 * - 時刻が壊れていて比較できないときも外さない側に倒す（false）
 * - sourceModifiedAt <= lastIngestedAt のときだけ true（外してよい）
 */
export function shouldSkipUnchangedSource(
  sourceModifiedAt: string,
  lastIngestedAt: string | undefined,
): boolean {
  if (!lastIngestedAt) return false;
  const modifiedTime = new Date(sourceModifiedAt).getTime();
  const ingestedTime = new Date(lastIngestedAt).getTime();
  if (Number.isNaN(modifiedTime) || Number.isNaN(ingestedTime)) return false;
  return modifiedTime <= ingestedTime;
}

/** Word (.docx) の MIME。素材からのナレッジ化は .docx だけが対象（.doc / Excel / PowerPoint は対象外） */
const WORD_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * 素材からナレッジ化するときの出どころ id（ナレッジページの derivedFromNotes と
 * 来歴の `used` に入る id）。取り込みの対象外（画像・.doc・Excel・PowerPoint など）は undefined。
 *
 * 取り込み（note-app の ingestMediaEntry）と「取り込み済みか」の判定の両方がこれを使う。
 * 片方だけ書き換えると、判定が別の id を探して一度も効かなくなる。
 */
export function mediaKnowledgeSourceId(entry: {
  type: string;
  fileId?: string;
  url?: string;
  mimeType?: string;
}): string | undefined {
  if (entry.type === "url") return entry.url ? `url:${entry.url}` : undefined;
  if (!entry.fileId) return undefined;
  if (entry.type === "pdf") return `pdf:${entry.fileId}`;
  if (entry.type === "document" && entry.mimeType === WORD_DOCX_MIME) return `document:${entry.fileId}`;
  return undefined;
}

/**
 * ナレッジページを来歴ごと読む関数を作る（1 回の一括処理の間だけ使うキャッシュ付き）。
 * インデックスの noteId は wiki でも接頭辞なしだが、ドキュメントのキャッシュと読み込みは
 * `wiki:<id>` で引く。付け忘れると常に null になり、来歴が取れず判定が一度も効かない。
 */
export function createKnowledgeDocLoader(
  getCachedDoc: (key: string) => GraphiumDocument | null | undefined,
  loadDoc: (key: string) => Promise<GraphiumDocument | null | undefined>,
): (pageId: string) => Promise<GraphiumDocument | null> {
  const cache = new Map<string, GraphiumDocument | null>();
  return async (pageId) => {
    if (cache.has(pageId)) return cache.get(pageId) ?? null;
    const key = `wiki:${pageId}`;
    const doc = getCachedDoc(key) ?? await loadDoc(key);
    cache.set(pageId, doc ?? null);
    return doc ?? null;
  };
}

/**
 * 一括ナレッジ化で外してよいか（取り込み済みで、その後資料が変わっていないか）。
 * knowledgePages はこの資料から作られたナレッジページ。アーカイブ・ゴミ箱のページも
 * 含めて渡してよい（ここで現役だけに絞る）。現役のページが無ければ外さない。
 */
export async function isUnchangedSinceLastIngest(
  sourceId: string,
  sourceModifiedAt: string,
  knowledgePages: { noteId: string; archivedAt?: string | null; deletedAt?: string | null }[] | undefined,
  loadKnowledgeDoc: (pageId: string) => Promise<GraphiumDocument | null>,
): Promise<boolean> {
  const activePages = (knowledgePages ?? []).filter((p) => !p.archivedAt && !p.deletedAt);
  if (activePages.length === 0) return false;
  const docs: GraphiumDocument[] = [];
  for (const page of activePages) {
    const doc = await loadKnowledgeDoc(page.noteId);
    if (doc) docs.push(doc);
  }
  return shouldSkipUnchangedSource(sourceModifiedAt, lastIngestedAtForSource(sourceId, docs));
}
