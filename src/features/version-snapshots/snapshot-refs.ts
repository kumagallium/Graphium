// 版スナップショット内の素材参照の走査。
//
// 版は listFiles() を通らないため media-index の usedIn スキャンの対象外で、
// 「ライブノートからは消えたが版の中には残っている」素材は usedIn が空に見える。
// 素材の削除ダイアログを開いたときにこの関数をオンデマンドで呼び、版内の参照を
// 集計する（版は手動作成で数が少ない前提。常時追跡はせず削除時だけ数える）。

import type { StorageProvider } from "../../lib/storage/types";
import { listSnapshots, loadSnapshot } from "./snapshot-store";
import {
  extractMediaFromBlocks,
  collectSourceAssetFileIdsFromDoc,
} from "../asset-browser/media-index";

export type SnapshotAssetReference = {
  noteId: string;
  snapshotId: string;
  version: number;
  label?: string;
};

/**
 * 素材（fileId + 表示 URL）を参照している版スナップショットの一覧を返す。
 *
 * 照合は usedIn スキャンと同じ 2 系統:
 * - ブロック参照: ブロックの props.url / インラインリンク href と asset.url の一致
 * - doc-level 参照: sourcePdfFileId / sourceDocumentFileId / citedAssetFileIds /
 *   sourceTextFileId / "url:" 系と asset.fileId の一致
 */
export async function findSnapshotsReferencingAsset(
  provider: StorageProvider,
  noteIds: string[],
  asset: { fileId: string; url: string },
): Promise<SnapshotAssetReference[]> {
  const refs: SnapshotAssetReference[] = [];
  for (const noteId of noteIds) {
    const metas = await listSnapshots(provider, noteId);
    for (const meta of metas) {
      const doc = await loadSnapshot(provider, meta.id);
      if (!doc) continue;
      const page = doc.pages[0];
      const blockUrls = page ? extractMediaFromBlocks(page.blocks ?? []) : new Map<string, string>();
      const docRefIds = collectSourceAssetFileIdsFromDoc(doc);
      if (blockUrls.has(asset.url) || docRefIds.has(asset.fileId)) {
        refs.push({ noteId, snapshotId: meta.id, version: meta.version, label: meta.label });
      }
    }
  }
  return refs;
}
