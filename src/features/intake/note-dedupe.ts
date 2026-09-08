// 投入口の「同じファイルを入れ直したときにノートを増やさない」判定（純関数）。
//
// 規則: 中身が同じファイルは入れない。中身が変わっていれば新しいノートとして
// 入れる（Graphium 側で編集したノートは上書きしない）。ファイル名が変わって
// いても中身が同じなら重複として扱う（リネームは規則から除外しない）。
//
// 素材の重複判定（asset-browser/dedupe.ts の computeAssetContentHash /
// findSameAsset）と考え方を揃える: 中身の SHA-256 で照合する。ノートの場合は
// index（NoteIndexEntry.importSourceHash, v26 で追加）にハッシュを mirror
// しているので、doc を読まずに index を舐めるだけで判定できる
// （かつてはファイル名一致で候補を絞ってから doc を読んでいたが、リネームされた
// ファイルを重複と判定できない・doc の逐次読み込みが要るという 2 つの問題が
// あったため、ハッシュを index に持たせて直接照合する方式に変えた）。

import type { NoteIndexEntry } from "../navigation/index-file";

/**
 * index の中から、投入口で取り込まれ、かつ中身のハッシュが一致するノートを
 * 探す。見つかれば noteId、無ければ null。
 *
 * `importSourceHash` を持たないノート（手で作った・投入口以外の経路で作った）
 * は判定できないので対象にしない。削除済み（deletedAt）・アーカイブ済み
 * （archivedAt）のノートも対象にしない（ユーザーが一覧から外したノートを
 * 黙って復活させない）。
 */
export function findExistingImportId(
  index: Pick<NoteIndexEntry, "noteId" | "importSourceHash" | "deletedAt" | "archivedAt">[],
  contentHash: string,
): string | null {
  const match = index.find(
    (entry) => !entry.deletedAt && !entry.archivedAt && entry.importSourceHash === contentHash,
  );
  return match ? match.noteId : null;
}
