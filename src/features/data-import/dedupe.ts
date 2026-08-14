// 同じデータファイルを二度素材にしないための照合
//
// 装置は同じファイルを何度も出すし、取り込みをやり直すことも多い。そのたびに
// 素材が増えると一覧が使い物にならなくなる。
//
// 素材インデックスにハッシュを持たせる案は捨てた。ノート保存をきっかけに
// インデックス再構築が走ると、ディスク上の index を正として作り直すため、
// 書き込みと再構築が競って付加情報が落ちる。ここでは何も保存せず、
// 「同じ名前の既存素材だけ中身を読んで突き合わせる」ことで判定する。
// 候補は通常 0〜1 件なので、読み込みは実質 1 回で済む。

import { computeBlobHash } from "../../lib/storage/shared/hash";
import type { MediaIndex } from "../asset-browser/media-index";

/**
 * 同じ中身のデータ素材があればその fileId を返す。
 *
 * 名前で候補を絞ってから中身を比べる。名前だけで同一とみなさないのは、
 * 装置が同じ名前で別の測定結果を上書き出力するため。
 *
 * @param readBytes 素材の実体を読む関数（プロバイダ依存なので注入する）
 */
export async function findSameDataAsset(
  index: MediaIndex | null | undefined,
  file: { name: string; bytes: Uint8Array },
  readBytes: (fileId: string) => Promise<Uint8Array>,
): Promise<string | undefined> {
  const candidates = (index?.media ?? []).filter(
    (m) => m.type === "data" && !m.archivedAt && m.name === file.name,
  );
  if (candidates.length === 0) return undefined;

  const targetHash = await computeBlobHash(file.bytes);
  for (const candidate of candidates) {
    try {
      const bytes = await readBytes(candidate.fileId);
      if ((await computeBlobHash(bytes)) === targetHash) return candidate.fileId;
    } catch {
      // 読めない素材（消えた・権限が無い等）は候補から外すだけにする
    }
  }
  return undefined;
}
