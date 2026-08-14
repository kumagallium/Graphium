// 同じファイルを二度素材にしないための照合（画像 / 動画 / 音声 / PDF / Word など）
//
// 画像は `IMG_0001.jpg` のように「同名で別物」も「別名で同一」も普通にあるので、
// 名前では判定できない。かといって毎回すべての素材の実体を読んで比べるのは、
// 枚数・容量的に成立しない。そこでアップロード時に中身の SHA-256 を素材へ持たせ、
// 次からはインデックス内の突き合わせだけで済ませる。
//
// 素材インデックスに付加情報を持たせられるのは、`ensureMediaIndex` の再構築が
// 走査後の最新インデックスを土台にするようになったため（それ以前は、アップロード
// 直後に書いた情報が再構築との競合で落ちていた）。
//
// 区切りテキストの取り込み（`features/data-import/dedupe.ts`）は、ハッシュを
// 持たない時代の方式（同名候補の実体を都度読んで比較）のまま別に存在する。

import { computeBlobHash } from "../../lib/storage/shared/hash";
import {
  getLatestMediaIndex,
  readMediaIndex,
  saveMediaIndex,
  MEDIA_INDEX_CHANGED_EVENT,
  type MediaIndex,
  type MediaIndexEntry,
} from "./media-index";

/**
 * ハッシュを計算する上限（バイト）。
 *
 * SHA-256 は全体をメモリに載せないと計算できない。プロバイダによっては
 * アップロード自体はバイト列を読まない（local は Blob をそのまま IndexedDB に
 * 入れる）ので、ハッシュ計算は丸ごと一度の追加読み込みになる。大きな動画で
 * 数百 MB を抱えるくらいなら、重複判定を諦めて従来どおり登録する方がよい。
 *
 * 128 MiB は画像・PDF・Word・音声と短い動画をほぼ全て含む。
 */
export const MAX_HASH_BYTES = 128 * 1024 * 1024;

/** 実体を持たない（= ハッシュで比べようがない）素材タイプ */
function hasNoBytes(entry: Pick<MediaIndexEntry, "type">): boolean {
  return entry.type === "url" || entry.type === "memo";
}

/**
 * 同じ中身の素材が既にあればそのエントリを返す。
 *
 * ハッシュを持たない素材（後追い付与がまだ届いていない既存素材・URL ブックマーク・
 * 大きすぎてハッシュ計算を見送ったもの）は「判定できない」として候補にしない。
 * 判定できないものは従来どおり新しい素材として登録される。
 *
 * アーカイブ済みの素材も使い回さない。ユーザーが一覧から外した素材を黙って
 * 復活させると、アーカイブしたはずのものがノートに戻ってくる。
 */
export function findSameAsset(
  index: MediaIndex | null | undefined,
  contentHash: string | undefined,
): MediaIndexEntry | undefined {
  if (!contentHash) return undefined;
  return (index?.media ?? []).find(
    (m) => m.contentHash === contentHash && !m.archivedAt && !hasNoBytes(m),
  );
}

/**
 * アップロードするファイルの一次キー（SHA-256）を計算する。
 * 上限超過・読み込み失敗のときは undefined（＝重複判定をしない）。
 */
export async function computeAssetContentHash(file: File): Promise<string | undefined> {
  if (file.size > MAX_HASH_BYTES) return undefined;
  try {
    return await computeBlobHash(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    console.warn("素材のハッシュ計算に失敗（重複判定をスキップ）:", err);
    return undefined;
  }
}

/**
 * この仕組みより前に登録された素材へ、後追いで `contentHash` を付ける。
 *
 * これが無いと重複判定は「これからアップロードする素材どうし」でしか効かず、
 * 手元のライブラリに既にあるファイルを入れ直しても素材が増えてしまう。
 *
 * 進め方:
 *   - 1 件ずつ順に読む。並列にすると素材の実体を同時に何本もメモリに載せる
 *   - 上限を超える素材は読まずに飛ばす（`readMediaBytes` が undefined を返す）
 *   - 1 件ごとに保存する。途中でアプリを閉じてもそこまでは残り、次回は
 *     ハッシュを持つ素材を飛ばすので続きから進む
 *   - 書き戻しは毎回「その時点の最新インデックス」に対して行う。走査中の
 *     アップロード・削除・アーカイブを巻き戻さないため
 *
 * @param readBytes 素材の実体を読む関数（プロバイダ依存なので注入する）
 * @param signal    中断用（サインアウト・アンマウント時に止める）
 * @returns 新たにハッシュを付けた件数
 */
export async function backfillContentHashes(
  readBytes: (fileId: string, maxBytes: number) => Promise<Uint8Array | undefined>,
  signal?: { aborted: boolean },
): Promise<number> {
  const start = getLatestMediaIndex() ?? (await readMediaIndex());
  if (!start) return 0;

  // 対象は開始時点のスナップショットから決める。走査中に増えた素材は
  // アップロード時にハッシュが付くので、ここで面倒を見る必要はない。
  const targets = start.media
    .filter((m) => !m.contentHash && !hasNoBytes(m))
    .map((m) => m.fileId);
  if (targets.length === 0) return 0;

  let filled = 0;
  for (const fileId of targets) {
    if (signal?.aborted) break;

    let hash: string | undefined;
    try {
      const bytes = await readBytes(fileId, MAX_HASH_BYTES);
      if (!bytes) continue; // 上限超過 or 実体が無い
      hash = await computeBlobHash(bytes);
    } catch {
      // 読めない素材（消えた・権限が無い等）は飛ばすだけにする
      continue;
    }

    const current = getLatestMediaIndex();
    // 走査中に消えた／既に誰かが付けた素材は触らない
    const target = current?.media.find((m) => m.fileId === fileId);
    if (!current || !target || target.contentHash) continue;

    const next: MediaIndex = {
      ...current,
      updatedAt: new Date().toISOString(),
      media: current.media.map((m) => (m.fileId === fileId ? { ...m, contentHash: hash } : m)),
    };
    try {
      await saveMediaIndex(next);
      filled += 1;
    } catch (err) {
      console.warn("ハッシュの後追い付与に失敗:", fileId, err);
    }
  }

  // in-memory の useFileManager.mediaIndex を disk に揃える（urlMeta / OCR パッチと同じ流儀）
  if (filled > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail: { reason: "content-hash-backfill", filled } }),
    );
  }
  return filled;
}
