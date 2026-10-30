// PowerPoint 素材の表紙（.pptx に保存されている 1 枚目の縮小画像）を一覧のサムネイルに出す
//
// 読み出しは素材 1 件につき 1 回だけ（fileId ごとに Promise をメモする）。
// 縮小画像は数 KB〜数十 KB なので、blob URL はアプリを閉じるまで持ち続ける。
// 縮小画像が無いファイルは null を覚え、毎回読み直さない。

import { useEffect, useState } from "react";
import { readEntryBytes } from "./read-entry-bytes";
import type { MediaIndexEntry } from "./media-index";

const coverCache = new Map<string, Promise<string | null>>();

/** 表紙の blob URL（無い・読めないときは null） */
export function loadPptxCoverUrl(entry: Pick<MediaIndexEntry, "fileId" | "url">): Promise<string | null> {
  const cached = coverCache.get(entry.fileId);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const bytes = await readEntryBytes(entry);
      const { readPptxThumbnail } = await import("../office-import/pptx");
      const thumb = readPptxThumbnail(bytes);
      if (!thumb) return null;
      return URL.createObjectURL(new Blob([thumb.bytes as BlobPart], { type: thumb.mimeType }));
    } catch (err) {
      console.warn("[pptx-cover] 表紙の読み出しに失敗:", err);
      return null;
    }
  })();
  coverCache.set(entry.fileId, promise);
  return promise;
}

/** enabled になったら表紙を読む（一覧では画面に入ってから） */
export function usePptxCover(entry: Pick<MediaIndexEntry, "fileId" | "url">, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadPptxCoverUrl(entry).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
    // fileId が同じなら同じ素材（url は表示のたびに同じ値）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.fileId, enabled]);
  return url;
}
