// メディアプレビュー
// type ごとに viewer を切り替える。プロバイダ依存の URL を blob URL に解決して表示する。
// 旧 MediaDetailModal から分離して、MaterialSidePeek / MaterialFullView 等で再利用できるようにしたもの。

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getActiveProvider } from "../../lib/storage/registry";
import { useT } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";
import { getFaviconUrl } from "./media-index";
import { PdfViewer } from "./PdfViewer";
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

function UrlPreview({ entry }: { entry: MediaIndexEntry }) {
  const t = useT();
  const domain = entry.urlMeta?.domain ?? "";
  return (
    <div className="flex flex-col items-center justify-center gap-4 max-w-sm text-center px-6">
      {entry.urlMeta?.ogImage ? (
        <img src={entry.urlMeta.ogImage} alt="" className="max-w-full max-h-48 rounded object-cover" />
      ) : (
        <img
          src={getFaviconUrl(domain, 128)}
          alt=""
          className="w-16 h-16 rounded"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{entry.name}</p>
        <p className="text-[10px] text-muted-foreground">{domain}</p>
        {entry.urlMeta?.description && (
          <p className="text-xs text-muted-foreground mt-2">{entry.urlMeta.description}</p>
        )}
      </div>
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <ExternalLink size={12} />
        {t("asset.urlOpen")}
      </a>
    </div>
  );
}

export type MediaPreviewProps = {
  entry: MediaIndexEntry;
  /** PDF text-layer 内の選択を Note に引用挿入 — 未指定で Quote→Note ボタン非表示 */
  onQuoteToNote?: (source: CitationSource) => void;
  /** PDF text-layer 内の選択を Composer Ask に渡す — 未指定で Quote→Chat ボタン非表示 */
  onQuoteToChat?: (source: CitationSource) => void;
};

export function MediaPreview({ entry, onQuoteToNote, onQuoteToChat }: MediaPreviewProps) {
  switch (entry.type) {
    case "image":
      return <ResolvedImage entry={entry} />;
    case "video":
      return <BlobMediaPlayer entry={entry} tag="video" />;
    case "audio":
      return <BlobMediaPlayer entry={entry} tag="audio" />;
    case "pdf":
      return (
        <PdfViewer entry={entry} onQuoteToNote={onQuoteToNote} onQuoteToChat={onQuoteToChat} />
      );
    case "url":
      return <UrlPreview entry={entry} />;
    default:
      return (
        <div className="flex items-center justify-center">
          <span className="text-6xl">📎</span>
        </div>
      );
  }
}
