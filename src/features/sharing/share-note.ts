// ノートを team-shared storage に書き出す（Phase 2a + 2c-1）。
//
// Phase 2a の設計判断:
// - personal 側のノートは消さない（コピー扱い）
// - Share 済みノートを再 Share した場合は **同じ id に上書き**（minor 改訂）
// - shared 側の body は GraphiumDocument の JSON シリアライズ（他の Graphium で
//   開けば完全復元できる）。markdown 変換は v2 で検討
//
// Phase 2c-1（自動 blob 化）:
// - ノート内 image/video/audio/file/pdf ブロックの実体を BlobStorageProvider に
//   put し、shared 側 doc では props.url を `shared-blob:<hash>` に置換する
// - extra.blobs に BlobRef[] を載せる（後の resolver / GC が引ける）
// - personal 側 doc は無変更
//
// 設計: docs/internal/team-shared-storage-design.md §3 / §12 Phase 2c

import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  newSharedId,
  computeSharedEntryHash,
  type SharedEntry,
  type BlobRef,
} from "../../lib/storage/shared";
import {
  autoUploadMediaBlobs,
  collectMediaRefs,
  type FetchMediaBytes,
} from "./auto-blob";
import { getActiveProvider } from "../../lib/storage/registry";
import { invoke } from "@tauri-apps/api/core";

export type ShareNoteResult =
  | {
      ok: true;
      doc: GraphiumDocument;
      entry: SharedEntry;
      isUpdate: boolean;
    }
  | { ok: false; error: string };

export type ShareNoteOptions = {
  /** Settings から渡される shared root path */
  root: string;
  /** Settings 登録済みの AuthorIdentity（必須） */
  author: AuthorIdentity;
  /**
   * Settings から渡される blob root path（Phase 2c-1）。
   * ノート内 media block の実体を blob として書き出すために使う。
   * media を含むノートでは必須。テキストのみのノートは未指定でも動く。
   */
  blobRoot?: string | null;
  /**
   * テスト用フック（本番では未指定）。
   * - extractFileId: 既定で active StorageProvider のものを使う
   * - fetchBytes: 既定で Tauri の `read_media_file` を使う
   */
  __test?: {
    extractFileId?: (url: string) => string | null;
    fetchBytes?: FetchMediaBytes;
  };
};

const defaultFetchBytes: FetchMediaBytes = async (fileId: string) => {
  const b64 = await invoke<string>("read_media_file", { fileId });
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * ノートを shared に書き出し、`sharedRef` 付きの新しい GraphiumDocument を返す。
 * 既に共有済みのノート（doc.sharedRef がある）は同じ id に上書きされる。
 *
 * 注意: 呼び出し側で「現在のドキュメント状態」を保存しておくこと。
 *       本関数は doc を編集せず、新しい sharedRef を載せた document を返すだけ。
 */
export async function shareNote(
  doc: GraphiumDocument,
  options: ShareNoteOptions,
): Promise<ShareNoteResult> {
  return shareGraphiumDocument(doc, "note", {}, options);
}

/**
 * ノート / Knowledge 共通の Share コア。GraphiumDocument を JSON 化して
 * shared に書き出すフローは entry type と extra フィールド以外同一。
 * share-knowledge.ts からも使う（features/sharing 内部専用）。
 */
export async function shareGraphiumDocument(
  doc: GraphiumDocument,
  entryType: "note" | "knowledge",
  extraFields: Record<string, unknown>,
  options: ShareNoteOptions,
): Promise<ShareNoteResult> {
  try {
    // ── Phase 2c-1: 自動 blob 化 ──
    const extractFileId =
      options.__test?.extractFileId ??
      ((url: string) => getActiveProvider().extractFileId(url));
    const refs = collectMediaRefs(doc, extractFileId);
    if (refs.length > 0 && !options.blobRoot) {
      return {
        ok: false,
        error:
          "Blob root is not configured. Set it in Settings → Shared storage to share notes that contain media.",
      };
    }

    let entryDoc: GraphiumDocument = doc;
    let blobs: BlobRef[] = [];
    if (refs.length > 0 && options.blobRoot) {
      const blobProvider = new LocalFolderBlobProvider(options.blobRoot);
      const fetchBytes = options.__test?.fetchBytes ?? defaultFetchBytes;
      const result = await autoUploadMediaBlobs(doc, {
        extractFileId,
        fetchBytes,
        blobProvider,
      });
      entryDoc = result.doc;
      blobs = result.blobs;
    }

    const provider = new LocalFolderSharedProvider(options.root, {
      email: options.author.email,
    });
    const isUpdate = !!doc.sharedRef;
    const id = doc.sharedRef?.id ?? newSharedId();
    const now = new Date().toISOString();

    // body は shared 側で完全復元できるよう、置換後 doc 全体を JSON 化
    const bodyJson = JSON.stringify(entryDoc);
    const body = new TextEncoder().encode(bodyJson);

    const baseEntry: SharedEntry = {
      id,
      type: entryType,
      author: options.author,
      created_at: doc.sharedRef?.sharedAt ?? now,
      updated_at: now,
      hash: "", // provider.write が再計算する
      prov: { derived_from: [] },
      extra: {
        title: doc.title,
        ...extraFields,
        // Phase 2c-1: 埋め込まれた媒体の BlobRef 一覧（dedup 済み）
        ...(blobs.length > 0 ? { blobs } : {}),
      },
    };

    // hash 値を sharedRef に持たせるためにここで先に計算する
    const hash = await computeSharedEntryHash(baseEntry, body);
    await provider.write(baseEntry, body);

    const updatedDoc: GraphiumDocument = {
      ...doc,
      sharedRef: {
        id,
        type: entryType,
        sharedAt: now,
        hash,
      },
    };

    return {
      ok: true,
      doc: updatedDoc,
      entry: { ...baseEntry, hash },
      isUpdate,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
