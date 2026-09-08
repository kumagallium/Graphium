// shared エントリを tombstone 化する（誤共有リカバリ、Phase 2c）。
//
// 設計:
// - author 本人にしか実行できない（provider 側で email 一致チェック）
// - tombstone 後も body は残らないが、`status="unshared"` として _meta/tombstones に保管
// - `extra.blobs` を持つ entry（素材 manifest だけでなく、auto-blob でメディアを
//   持ち出したノート・テンプレートも該当）は、参照していた blob を
//   **reference-counted GC** で削除する。他の active な entry が同じ hash を
//   参照していなければ blob 本体も消す。
//   なぜ type で絞らないか: blob は content-addressed なので、同じ画像を
//   ノートとテンプレートで共有すると hash が一致する。片方の type だけ数えると
//   「まだ使われている blob を消す」か「永久に残す」かのどちらかになる。
// - ローカル側の sharedRef 削除は呼び出し側で行う（ノート編集状態を直接触らないため）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Unshare

import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  type SharedEntry,
  type SharedEntryType,
  type BlobRef,
} from "../../lib/storage/shared";

/**
 * blob を参照しうる entry type。GC の参照数え上げはこの範囲を全部見る。
 * - data-manifest: 素材共有（share-media）
 * - note: ノート共有の auto-blob（share-note）
 * - template: テンプレート共有の auto-blob（share-template）
 * - proposal: 変更の提案（share-proposal）。auto-blob の extra.blobs に加えて
 *   基準版の本文を置いた extra.baseRef も blob を指す
 * 他の type（reference / knowledge / report）は現状 extra.blobs を書かない。
 * 書くようになったらここに足すこと（漏れると参照中の blob を消す事故になる）。
 */
const BLOB_REFERENCING_TYPES: SharedEntryType[] = [
  "data-manifest",
  "note",
  "template",
  "proposal",
];

export type UnshareEntryOptions = {
  /** Settings の shared root */
  root: string;
  /** Settings 登録済みの AuthorIdentity（必須） */
  author: AuthorIdentity;
  /** blob GC を行うための blob root（任意。未設定なら GC しない） */
  blobRoot?: string;
};

export type UnshareEntryResult =
  | {
      ok: true;
      /** GC で削除した blob hash 群（blob を持たない entry では空） */
      deletedBlobs: string[];
      /** 他 entry からまだ参照されているため残した blob hash 群 */
      retainedBlobs: string[];
    }
  | { ok: false; error: string };

function blobHashOf(value: unknown): string | null {
  if (value && typeof value === "object" && typeof (value as BlobRef).hash === "string") {
    return (value as BlobRef).hash;
  }
  return null;
}

/**
 * entry が指している blob の hash を全部集める。
 *
 * 数える側と消す側で同じ関数を使うのが要点。片方だけに新しい参照フィールドを
 * 足すと「まだ使われている blob を消す」事故になるので、参照は必ずここに集約する。
 * - extra.blobs: 素材共有と auto-blob（ノート / テンプレート / 提案）
 * - extra.baseRef: 提案の基準版本文（content-addressed なので、同じ基準版から
 *   出た複数の提案が同じ hash を指す。数え漏らすと他人の提案の基準版が消える）
 */
function extractBlobHashes(entry: SharedEntry): string[] {
  const extra = (entry.extra ?? {}) as Record<string, unknown>;
  const hashes: string[] = [];
  if (Array.isArray(extra.blobs)) {
    for (const b of extra.blobs) {
      const hash = blobHashOf(b);
      if (hash) hashes.push(hash);
    }
  }
  const baseHash = blobHashOf(extra.baseRef);
  if (baseHash) hashes.push(baseHash);
  return hashes;
}

/**
 * 指定 entry を tombstone 化し、参照されなくなった blob も GC する。
 */
export async function unshareEntry(
  sharedId: string,
  options: UnshareEntryOptions,
): Promise<UnshareEntryResult> {
  try {
    const provider = new LocalFolderSharedProvider(options.root, {
      email: options.author.email,
    });

    // 削除前にエントリを読み、blob を参照していれば hash を控えておく。
    // type では絞らない（ノート・テンプレートも auto-blob で extra.blobs を持つ）
    let blobHashesToCheck: string[] = [];
    try {
      const { entry } = await provider.read(sharedId);
      // 同じ hash を 2 通り（blobs と baseRef）で指していることがあるので畳む
      blobHashesToCheck = [...new Set(extractBlobHashes(entry))];
    } catch {
      // 読み出せない（既に消えている等）場合は GC せず削除のみ試行
    }

    await provider.delete(sharedId);

    const deletedBlobs: string[] = [];
    const retainedBlobs: string[] = [];

    if (blobHashesToCheck.length > 0 && options.blobRoot) {
      // 残存している entry を全件読んで参照中の hash を集める。
      // 1 type でも読めなかったら GC そのものを諦める（数え漏れたまま消すと、
      // まだ使われている blob を落として他人の共有を壊す。残す方が安全）
      const stillReferenced = new Set<string>();
      let listComplete = true;
      for (const type of BLOB_REFERENCING_TYPES) {
        try {
          for (const e of await provider.list(type)) {
            for (const h of extractBlobHashes(e)) stillReferenced.add(h);
          }
        } catch {
          listComplete = false;
        }
      }
      if (!listComplete) {
        return { ok: true, deletedBlobs: [], retainedBlobs: blobHashesToCheck };
      }

      const blobProvider = new LocalFolderBlobProvider(options.blobRoot);
      for (const hash of blobHashesToCheck) {
        if (stillReferenced.has(hash)) {
          retainedBlobs.push(hash);
          continue;
        }
        try {
          await blobProvider.delete(hash);
          deletedBlobs.push(hash);
        } catch {
          // 個別の delete 失敗は致命ではない（blob だけ残る）。続行
          retainedBlobs.push(hash);
        }
      }
    }

    return { ok: true, deletedBlobs, retainedBlobs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
