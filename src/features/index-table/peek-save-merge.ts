// サイドピークの保存で docRef と保存する doc をどう突き合わせるか。
//
// SidePeek の doSave は docRef（このピークが最後に読んだ/保存した doc）を spread して
// 書き出し、保存が終わると docRef を更新する。ここではその前後の 2 つを扱う:
//   - pickPeekExternalFields: 書き出す前に、ピークの外から書き換わる項目をキャッシュ側から採る
//   - applySavedToPeekDoc: 保存が終わったとき、保存を待つ間に docRef へ入った書き換えを残す

import type { GraphiumDocument } from "../../lib/document-types";

// ピーク自身が編集しない項目でも、ピークを開いている間にアプリ側が
// キャッシュ経由で保存することがあり、そのまま spread すると旧い値で巻き戻る:
//   - chats: チャット run のアプリレベル書き戻し（chat-run-manager）
//   - wikiMeta: 本文下の文脈欄から走る出典照合・世界照合・判定の消去（wiki: のみ）
// キャッシュは reindexNoteFromDoc / handleSaveWikiFile で常に最新化されるので、
// これらはキャッシュ側を優先してよい。キャッシュに無ければ何も上書きしない。
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

/**
 * 保存が終わったときに docRef へ入れる doc を作る。
 *
 * 保存する doc は、保存を始めた時点の docRef（base）から組む。書き込みを待つ間
 * （ローカル・サーバーで数 ms、Google Drive で数百 ms〜数秒）に docRef へ入った書き換え
 * （タイトル・文脈ラベル・引用素材・noteLinks）はその doc に載っていないので、保存した doc で
 * docRef を置き換えると消え、次の保存にも乗らない。
 *
 * そこで、この保存が作った項目（base から変わった項目: 本文の pages・modifiedAt・
 * キャッシュ側から採った chats / wikiMeta）だけを、いまの docRef（current）に重ねる。
 * 書き換える側が何を触ったかは見ないので、ピークに書き換え口を足してもここは変えなくてよい
 * （書き換えは `{ ...cur, 項目: 新しい値 }` で docRef を作り直す約束）。
 * 前の保存が終わる前に次の保存が doc を組んでも、どちらも自分の持ち分だけを重ねるので、
 * 書き換えは消えない。本文の写し（pages・modifiedAt）は最後に終わった保存のものになる —
 * 保存が始めた順に終わる前提で、後から始めた保存が先に終わると 1 つ前の写しに戻る
 * （次の保存はエディタから本文を組み直す。順番は保存を並べる側で守る）。
 * ピークが保存を待つ間に保存側と同じ項目を書き換えていたら保存側が勝つ
 * （本文の正はエディタ、chats / wikiMeta はピークでは書き換えない）。
 */
export function applySavedToPeekDoc(
  current: GraphiumDocument | null,
  base: GraphiumDocument,
  saved: GraphiumDocument,
): GraphiumDocument {
  // 保存を待つ間に何も書き換わっていなければ、保存した doc そのもの
  if (!current || current === base) return saved;
  const merged: Record<string, unknown> = { ...current };
  const baseFields = base as unknown as Record<string, unknown>;
  const savedFields = saved as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(base), ...Object.keys(saved)])) {
    if (savedFields[key] !== baseFields[key]) merged[key] = savedFields[key];
  }
  return merged as unknown as GraphiumDocument;
}
