// 出典照合（Source check, v1） — 知見の claimHash 計算。
//
// title + 本文テキストのハッシュ。照合時点の値を SourceCheckProfile.claimHash に刻んでおき、
// 現在の本文から再計算した値と食い違えば「本文が変わった（照合結果が古い）」と UI で出せる。
//
// 既存のハッシュユーティリティ（src/lib/storage/shared/hash.ts の computeBlobHash、
// team-shared-storage で使っている SHA-256）を再利用する。区切りに 0x1F（Unit Separator）を
// 挟むのは、team-shared-storage の hash.ts が meta/body 境界に使っているのと同じ手法
// （"" と "x" のような境界のずれを防ぐ）。

import { computeBlobHash } from "../../lib/storage/shared/hash";

const UNIT_SEPARATOR = "";

/** title + 本文から claimHash（"sha256:<hex>"）を計算する */
export async function computeClaimHash(title: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}${UNIT_SEPARATOR}${body}`);
  return computeBlobHash(bytes);
}
