// メディアプレビュー
// type ごとに viewer を切り替える。プロバイダ依存の URL を blob URL に解決して表示する。
// 旧 MediaDetailModal から分離して、MaterialSidePeek / MaterialFullView 等で再利用できるようにしたもの。

import { useEffect, useRef, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndexEntry } from "./media-index";
import { PdfViewer } from "./PdfViewer";
import { UrlReaderView } from "./UrlReaderView";
import { UrlPreviewCard } from "./url-preview-card";
import { DocumentViewer } from "./DocumentViewer";
import type { CitationSource } from "./SelectionPill";

/** 動画・音声用: Blob URL を非同期取得して再生するラッパー */
function BlobMediaPlayer({
  entry,
  tag,
}: {
  entry: MediaIndexEntry;
  tag: "video" | "audio";
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    const fileId = getActiveProvider().extractFileId(entry.url);
    if (!fileId) { setError(true); return; }

    let cancelled = false;
    getActiveProvider().getMediaBlobUrl(fileId)
      .then((url) => { if (!cancelled) setBlobUrl(url); })
      .catch(() => { if (!cancelled) setError(true); });

    return () => { cancelled = true; };
  }, [entry.url]);

  useEffect(() => {
    if (blobUrl && mediaRef.current) {
      mediaRef.current.load();
    }
  }, [blobUrl]);

  if (error) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        再生できませんでした
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        読み込み中...
      </div>
    );
  }

  if (tag === "video") {
    return (
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={blobUrl}
        controls
        preload="auto"
        className="max-w-full max-h-full rounded"
      />
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-4 w-full">
      <audio
        ref={mediaRef as React.RefObject<HTMLAudioElement>}
        src={blobUrl}
        controls
        preload="auto"
        className="w-full max-w-sm"
      />
    </div>
  );
}

function ResolvedImage({ entry }: { entry: MediaIndexEntry }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(entry.url);
    if (!fileId) { setSrc(entry.url); return; }
    provider.getMediaBlobUrl(fileId).then(setSrc).catch(() => {});
  }, [entry.url]);
  if (!src) return <div className="flex items-center justify-center text-muted-foreground">読み込み中...</div>;
  return <img src={src} alt={entry.name} className="max-w-full max-h-full object-contain rounded" />;
}

export type MediaPreviewProps = {
  entry: MediaIndexEntry;
  /** PDF text-layer / URL Reader 内の選択を新規メモとして保存 */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
};

export function MediaPreview({ entry, onSaveSelectionAsMemo }: MediaPreviewProps) {
  switch (entry.type) {
    case "image":
      return <ResolvedImage entry={entry} />;
    case "video":
      return <BlobMediaPlayer entry={entry} tag="video" />;
    case "audio":
      return <BlobMediaPlayer entry={entry} tag="audio" />;
    case "pdf":
      return <PdfViewer entry={entry} onSaveSelectionAsMemo={onSaveSelectionAsMemo} />;
    case "document":
      return <DocumentViewer entry={entry} onSaveSelectionAsMemo={onSaveSelectionAsMemo} />;
    case "url":
      return <UrlReaderView entry={entry} onSaveSelectionAsMemo={onSaveSelectionAsMemo} />;
    default:
      return (
        <div className="flex items-center justify-center">
          <span className="text-6xl">📎</span>
        </div>
      );
  }
}

// fallback として直接呼びたい場面のため、UrlPreviewCard を re-export
export { UrlPreviewCard };
