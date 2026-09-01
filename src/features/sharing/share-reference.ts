// URL ブックマークを team-shared storage に共有する（Phase 2b-media-url）。
//
// 設計:
// - SharedEntry.type = "reference"。design doc §2 で reference は
//   「DOI、書誌情報、ローカル / 外部 PDF への参照」を扱う。
// - URL ブックマークはバイト列を持たないため blob 不使用。body はメタデータ JSON。
// - 同じ fileId（= URL ブックマークの内部 ID）の再 Share は同 SharedEntry id を維持。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Share アクション

import type { AuthorIdentity } from "../document-provenance/types";
import type {
  MediaIndexEntry,
  MediaSharedRef,
} from "../asset-browser/media-index";
import {
  LocalFolderSharedProvider,
  newSharedId,
  computeSharedEntryHash,
  type SharedEntry,
} from "../../lib/storage/shared";

export type ShareReferenceOptions = {
  /** Settings の shared root */
  sharedRoot: string;
  /** Settings 登録済みの AuthorIdentity（必須） */
  author: AuthorIdentity;
  /** ユーザーが入力したタイトル（未指定なら entry.name を使用） */
  title?: string;
  /** ユーザーが入力した説明（任意。urlMeta.description より優先） */
  description?: string;
};

export type ShareReferenceResult =
  | {
      ok: true;
      sharedRef: MediaSharedRef;
      isUpdate: boolean;
    }
  | { ok: false; error: string };

/**
 * URL ブックマークを reference SharedEntry として共有する。blob root は不要。
 */
export async function shareReference(
  entry: MediaIndexEntry,
  options: ShareReferenceOptions,
): Promise<ShareReferenceResult> {
  try {
    if (entry.type !== "url") {
      return {
        ok: false,
        error: "shareReference is only for URL bookmarks. Use shareMedia for files.",
      };
    }
    if (!entry.url) {
      return { ok: false, error: "URL bookmark has no url" };
    }

    const isUpdate = !!entry.sharedRef;
    const id = entry.sharedRef?.id ?? newSharedId();
    const now = new Date().toISOString();
    const title = options.title?.trim() || entry.name;
    const description = options.description?.trim() || entry.urlMeta?.description;

    // body は URL メタデータの JSON。受け取り側はこれを decode して bookmark を復元できる。
    //
    // og:image は載せない。remote URL のまま共有フォルダに流すと、受け取った側が
    // カードを描くたびに publisher（多くは CDN・計測ドメイン）へ GET が飛ぶ
    // ——「チームの誰がいつその資料を見たか」を配信元に配る経路になる。
    // 画像は各自の端末でローカルにキャッシュし直す（url があれば復元できる）。
    const referenceBody = {
      url: entry.url,
      title,
      domain: entry.urlMeta?.domain,
      description,
    };
    const body = new TextEncoder().encode(JSON.stringify(referenceBody));

    const baseSharedEntry: SharedEntry = {
      id,
      type: "reference",
      author: options.author,
      created_at: entry.sharedRef?.sharedAt ?? now,
      updated_at: now,
      hash: "", // provider.write が再計算する
      prov: { derived_from: [] },
      extra: {
        title,
        url: entry.url,
        domain: entry.urlMeta?.domain ?? null,
        description: description ?? null,
      },
    };

    const hash = await computeSharedEntryHash(baseSharedEntry, body);
    const provider = new LocalFolderSharedProvider(options.sharedRoot, {
      email: options.author.email,
    });
    await provider.write(baseSharedEntry, body);

    const sharedRef: MediaSharedRef = {
      id,
      type: "reference",
      sharedAt: now,
      hash,
    };

    return { ok: true, sharedRef, isUpdate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
