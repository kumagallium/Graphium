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
import { DataPreview } from "./DataPreview";
import type { CitationSource } from "./SelectionPill";
import { useT } from "../../i18n";

/** 動画・音声用: Blob URL を非同期取得して再生するラッパー */
function BlobMediaPlayer({
  entry,
  tag,
}: {
  entry: MediaIndexEntry;
  tag: "video" | "audio";
}) {
  const t = useT();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    // blob: / data: は「すでに実体を指している URL」。プロバイダ解決を挟まずそのまま
    // 再生する（ResolvedImage / PdfViewer と同じ扱い）。モバイル受信箱の未取り込み
    // ファイルのプレビュー（transient エントリ）がここを通る。
    // media index に載る素材の url は local-media:// / file-media:// / media-server:// /
    // http(s) のいずれかなので、既存素材の解決経路は一切変わらない。
    if (/^(blob|data):/i.test(entry.url)) { setBlobUrl(entry.url); return; }
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
        {t("asset.playbackFailed")}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        {t("common.loading")}
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
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(entry.url);
    if (!fileId) { setSrc(entry.url); return; }
    provider.getMediaBlobUrl(fileId).then(setSrc).catch(() => {});
  }, [entry.url]);
  if (!src) return <div className="flex items-center justify-center text-muted-foreground">{t("common.loading")}</div>;
  return <img src={src} alt={entry.name} className="max-w-full max-h-full object-contain rounded" />;
}

export type MediaPreviewProps = {
  entry: MediaIndexEntry;
  /** PDF text-layer / URL Reader 内の選択を新規メモとして保存 */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
  /** URL Reader で表示中の記事画像を Graphium の画像アセットとして保存 */
  onSaveImageAsAsset?: (imageUrl: string, sourceEntry: MediaIndexEntry) => Promise<void>;
};

/**
 * メモピーク（type === "memo"）: buildMemoPeekEntry が組んだ transient エントリの
 * 本文をそのまま表示する。素材と違い実体ファイルが無いので blob 解決は不要。
 */
function MemoPreviewCard({ entry }: { entry: MediaIndexEntry }) {
  return (
    <div
      style={{
        alignSelf: "stretch",
        width: "100%",
        maxWidth: 640,
        margin: "0 auto",
        padding: "20px 24px",
        background: "var(--color-card)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--ink-3)", fontSize: 12 }}>
        <span aria-hidden>🗒️</span>
        <span>{new Date(entry.uploadedAt).toLocaleString()}</span>
      </div>
      <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.8, color: "var(--ink-1, var(--color-foreground))" }}>
        {entry.memoText ?? ""}
      </div>
    </div>
  );
}

export function MediaPreview({ entry, onSaveSelectionAsMemo, onSaveImageAsAsset }: MediaPreviewProps) {
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
      return (
        <UrlReaderView
          entry={entry}
          onSaveSelectionAsMemo={onSaveSelectionAsMemo}
          onSaveImageAsAsset={onSaveImageAsAsset}
        />
      );
    case "memo":
      return <MemoPreviewCard entry={entry} />;
    case "data":
      return <DataPreview entry={entry} />;
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
