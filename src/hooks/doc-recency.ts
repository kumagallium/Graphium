import type { GraphiumDocument } from "../lib/document-types";

/**
 * 呼び出し元から渡されたドキュメントスナップショットが、既にキャッシュ済みの
 * ドキュメントより「確実に新しい」ときだけ true を返す。
 *
 * 背景: サイドピーク等は「開いた時点のスナップショット」を保持し、本格的に開く際に
 * onNavigate(noteId, savedDoc) でそれを渡してくる。一方、本文エディタの自動保存は
 * docCacheRef を常に最新化している。古いスナップショットでキャッシュを上書きすると、
 * エディタ再マウント時に古い内容へ巻き戻り、書いた文章が消える（データ消失）。
 * そのため「より新しいことが modifiedAt で証明できる場合」だけ採用する。
 * 判定不能（modifiedAt 欠落・同値・過去）のときは既存キャッシュ（=最新の可能性が高い）を守る。
 */
export function isIncomingDocNewer(
  incoming: GraphiumDocument,
  existing: GraphiumDocument | undefined,
): boolean {
  if (!existing) return true; // キャッシュ未登録なら受け入れる
  const inT = Date.parse(incoming.modifiedAt ?? "");
  const exT = Date.parse(existing.modifiedAt ?? "");
  if (Number.isNaN(inT)) return false; // incoming の時刻が不明なら採用しない
  if (Number.isNaN(exT)) return true; // 既存の時刻が不明なら incoming を優先
  return inT > exT;
}
