// 単体メディアを team-shared storage に共有する（Phase 2b-media）。
//
// 設計判断:
// - SharedEntry.type = "data-manifest"。design doc §4 で「画像 / CSV / 顕微鏡データ等」
//   は data-manifest として扱う方針。ここでは BlobRef を 1 つだけ持つ単純な manifest を作る
// - メディアバイト列は BlobStorageProvider に put（content-addressed なので dedup される）
// - 同じ fileId の再 Share は同 SharedEntry id を維持（minor revision）
// - 既存メディアの再 Share では blob hash が同じなら blob 書き込みもスキップされる
//
// 設計詳細: docs/internal/team-shared-storage-design.md §4 / §3 Share アクション

import { invoke } from "@tauri-apps/api/core";
import type { AuthorIdentity } from "../document-provenance/types";
import type {
  MediaIndexEntry,
  MediaSharedRef,
} from "../asset-browser/media-index";
import {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  newSharedId,
  computeSharedEntryHash,
  type SharedEntry,
  type BlobRef,
} from "../../lib/storage/shared";
import { historyForUpdate } from "./share-history";

export type ShareMediaOptions = {
  /** Settings の shared root（manifest を置く先） */
  sharedRoot: string;
  /** Settings の blob root（実体バイト列を置く先） */
  blobRoot: string;
  /** Settings 登録済みの AuthorIdentity（必須） */
  author: AuthorIdentity;
  /** ユーザーが入力したタイトル（未指定なら entry.name を使用） */
  title?: string;
  /** ユーザーが入力した説明（任意） */
  description?: string;
  /**
   * 共有した時点の実効フォルダ（素材ギャラリーが表示しているもの ＝
   * 自分で付けた分 ∪ 貼ったノート由来）。ノート共有の extra.noteContexts と同型で、
   * 共有ライブラリの表でも同じ「フォルダ」列で絞り込めるようにする（鏡の原則）。
   * 一覧は本文を読まずに描くので、メタデータ側に持たせる必要がある。
   */
  noteContexts?: string[];
};

export type ShareMediaResult =
  | {
      ok: true;
      sharedRef: MediaSharedRef;
      isUpdate: boolean;
    }
  | { ok: false; error: string };

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * メディアエントリを team-shared storage に共有する。
 *
 * 既に sharedRef がある場合は同じ SharedEntry id を維持（minor revision）。
 * 他人が共有したメディアの上書きは Phase 2b-1 の author check に阻まれる。
 *
 * 注意: URL ブックマーク（type === "url"）は本体バイト列を持たないため対象外。
 *       呼び出し側で type をチェックしてから呼ぶこと。
 */
export async function shareMedia(
  entry: MediaIndexEntry,
  options: ShareMediaOptions,
): Promise<ShareMediaResult> {
  try {
    if (entry.type === "url") {
      return { ok: false, error: "URL bookmarks cannot be shared as media" };
    }

    // 1. メディアの実体バイト列を Tauri から取得
    const base64 = await invoke<string>("read_media_file", { fileId: entry.fileId });
    const bytes = base64ToUint8(base64);

    // 2. blob root に put（content-addressed なので既存と同じハッシュなら dedup）
    const blobProvider = new LocalFolderBlobProvider(options.blobRoot);
    const blobRef: BlobRef = await blobProvider.put(bytes, { filename: entry.name });

    // 3. data-manifest SharedEntry を作成（or 同 id 上書き）
    const isUpdate = !!entry.sharedRef;
    const id = entry.sharedRef?.id ?? newSharedId();
    const now = new Date().toISOString();
    const title = options.title?.trim() || entry.name;

    const provider = new LocalFolderSharedProvider(options.sharedRoot, {
      email: options.author.email,
    });
    // 再共有なら旧版の hash を history に積む（上書き前に読む）
    const history = await historyForUpdate(provider, id, isUpdate);

    const baseSharedEntry: SharedEntry = {
      id,
      type: "data-manifest",
      author: options.author,
      created_at: entry.sharedRef?.sharedAt ?? now,
      updated_at: now,
      hash: "", // provider.write が再計算する
      prov: { derived_from: [] },
      ...(history ? { history } : {}),
      extra: {
        title,
        description: options.description ?? null,
        media_type: entry.type,
        mime_type: entry.mimeType,
        original_filename: entry.name,
        // BlobRef を manifest に埋め込む。data-manifest の本体は将来的に
        // 「複数 BlobRef の集合」になりうる（CSV + 画像セット等）が、
        // Phase 2b-media では単一 BlobRef のシンプル形に絞る。
        blobs: [blobRef],
        // 再共有も同じ経路を通るので、共有側のフォルダは常に上書きされる
        noteContexts: options.noteContexts ?? [],
      },
    };

    // body は空（メタデータ完結。実体は blob root にある）
    const body = new TextEncoder().encode("");

    // hash を予め計算して sharedRef に持たせる（provider.write 内でも再計算される）
    const hash = await computeSharedEntryHash(baseSharedEntry, body);

    await provider.write(baseSharedEntry, body);

    const sharedRef: MediaSharedRef = {
      id,
      type: "data-manifest",
      sharedAt: now,
      hash,
      blobHash: blobRef.hash,
    };

    return { ok: true, sharedRef, isUpdate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
