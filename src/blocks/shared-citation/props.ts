// SharedEntry → sharedCitation ブロック props の変換。
// view.tsx（minor 追従）と挿入側（ピッカー確定）の両方から使うため分離する。

import type { SharedEntry } from "../../lib/storage/shared";
import { formatBytes } from "../../lib/format-bytes";

/** 表示スナップショット部分（引用時と minor 追従時に更新される） */
export type CachedCitationProps = {
  cachedTitle: string;
  cachedAuthor: string;
  cachedUpdatedAt: string;
  citedVersion: number;
  fileName: string;
  fileSizeLabel: string;
};

export function entryToCachedProps(entry: SharedEntry): CachedCitationProps {
  const extra = (entry.extra ?? {}) as Record<string, unknown>;
  const blobs = Array.isArray(extra.blobs) ? (extra.blobs as Array<Record<string, unknown>>) : [];
  const blob = blobs[0];
  const originalFilename =
    typeof extra.original_filename === "string" ? extra.original_filename : "";
  const blobFilename = blob && typeof blob.filename === "string" ? blob.filename : "";
  const blobSize = blob && typeof blob.size === "number" ? blob.size : undefined;
  return {
    cachedTitle: typeof extra.title === "string" ? extra.title : "",
    cachedAuthor: entry.author?.name ?? "",
    cachedUpdatedAt: entry.updated_at ?? "",
    citedVersion: entry.version ?? 1,
    fileName: originalFilename || blobFilename,
    fileSizeLabel: blobSize !== undefined ? formatBytes(blobSize) : "",
  };
}

/** 挿入時の全 props（参照 = ID + 引用時 hash + 引用日時 + スナップショット） */
export function entryToBlockProps(entry: SharedEntry) {
  return {
    sharedId: entry.id,
    citedHash: entry.hash,
    entryType: entry.type,
    citedAt: new Date().toISOString(),
    ...entryToCachedProps(entry),
  };
}
