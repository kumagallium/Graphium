// 投入口の「同じファイルを入れ直したときにノートを増やさない」判定（純関数）。
//
// 規則: 中身が同じファイルは入れない。中身が変わっていれば新しいノートとして
// 入れる（Graphium 側で編集したノートは上書きしない）。
//
// 素材の重複判定（asset-browser/dedupe.ts の computeAssetContentHash /
// findSameAsset）と考え方を揃える: 中身の SHA-256 で照合する。ノートは全文
// 検索インデックスを毎回総当たりするコストが高いので、まずタイトル一致で
// 候補を絞ってから、候補だけ doc を読んでハッシュを突き合わせる 2 段構え。

import type { NoteIndexEntry } from "../navigation/index-file";
import type { GraphiumDocument } from "../../lib/document-types";

/**
 * ファイル名（拡張子除去済みの base title）から、タイトルが一致するノート ID の
 * 候補を絞り込む。NFC 正規化・大文字小文字無視で比較する（macOS のファイル名は
 * NFD になり得るため。#650 と同じ理由）。削除済み（deletedAt）・アーカイブ済み
 * （archivedAt）のノートは候補にしない（ユーザーが一覧から外したノートを
 * 黙って復活させない）。
 */
export function candidateNoteIds(index: NoteIndexEntry[], title: string): string[] {
  const normalizedTitle = title.normalize("NFC").toLowerCase();
  return index
    .filter((entry) => !entry.deletedAt && !entry.archivedAt)
    .filter((entry) => entry.title.normalize("NFC").toLowerCase() === normalizedTitle)
    .map((entry) => entry.noteId);
}

/**
 * 候補ノートの中から、投入口で取り込まれ、かつ中身のハッシュが一致するノートを
 * 探す。見つかれば noteId、無ければ null。
 *
 * `importSource` を持たないノート（手で作った・投入口以外の経路で作った）は
 * 判定できないので候補にしない。
 */
export function findExistingImport(
  candidates: { noteId: string; importSource?: GraphiumDocument["importSource"] }[],
  contentHash: string,
): string | null {
  const match = candidates.find((c) => c.importSource?.contentHash === contentHash);
  return match ? match.noteId : null;
}
