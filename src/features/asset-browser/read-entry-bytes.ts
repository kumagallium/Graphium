// 素材の実体（バイト列）を読む
//
// `readMediaBytes`（blob URL を作らない）があればそれを使い、無いプロバイダでは
// 既存の抽出経路と同じ `getMediaBlobUrl` + fetch で読む。

import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndexEntry } from "./media-index";

export async function readEntryBytes(entry: Pick<MediaIndexEntry, "fileId" | "url">): Promise<Uint8Array> {
  const provider = getActiveProvider();
  const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
  if (provider.readMediaBytes) {
    const bytes = await provider.readMediaBytes(fileId);
    if (bytes) return bytes;
  }
  const blobUrl = await provider.getMediaBlobUrl(fileId);
  const res = await fetch(blobUrl);
  return new Uint8Array(await res.arrayBuffer());
}
