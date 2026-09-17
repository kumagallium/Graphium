// サイドピークの保存で、ピークの外から書き換わる項目を doc キャッシュ側から採る。
//
// SidePeek の doSave は docRef（このピークが最後に読んだ/保存した doc）を spread して
// 書き出す。ピーク自身が編集しない項目でも、ピークを開いている間にアプリ側が
// キャッシュ経由で保存することがあり、そのまま spread すると旧い値で巻き戻る:
//   - chats: チャット run のアプリレベル書き戻し（chat-run-manager）
//   - wikiMeta: 本文下の文脈欄から走る出典照合・世界照合・判定の消去（wiki: のみ）
// キャッシュは reindexNoteFromDoc / handleSaveWikiFile で常に最新化されるので、
// これらはキャッシュ側を優先してよい。キャッシュに無ければ何も上書きしない。

import type { GraphiumDocument } from "../../lib/document-types";

export function pickPeekExternalFields(
  noteId: string,
  cachedDoc: GraphiumDocument | null | undefined,
): Partial<Pick<GraphiumDocument, "chats" | "wikiMeta">> {
  if (!cachedDoc) return {};
  const out: Partial<Pick<GraphiumDocument, "chats" | "wikiMeta">> = {};
  if (cachedDoc.chats) out.chats = cachedDoc.chats;
  if (noteId.startsWith("wiki:") && cachedDoc.wikiMeta) out.wikiMeta = cachedDoc.wikiMeta;
  return out;
}
