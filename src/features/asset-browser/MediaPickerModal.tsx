// メディアピッカーモーダル
// スラッシュコマンドから呼び出し、既存メディアを選択してエディタに挿入する

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { fetchMediaBlobUrl, extractDriveFileId } from "../../lib/google-drive";
import type { MediaIndex, MediaIndexEntry, MediaType } from "./media-index";

// 動画サムネイル（AssetGalleryView と同じパターン）
function VideoThumb({ entry }: { entry: MediaIndexEntry }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fileId = extractDriveFileId(entry.url);
    if (!fileId || !videoRef.current) return;
    let cancelled = false;
    fetchMediaBlobUrl(fileId).then((blobUrl) => {
      if (cancelled || !videoRef.current) return;
      videoRef.current.src = blobUrl;
      videoRef.current.load();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [entry.url]);

  return (
    <div className="relative w-full h-20 bg-muted rounded overflow-hidden">
      <video
        ref={videoRef}
        preload="metadata"
        muted
        playsInline
        onLoadedData={() => setLoaded(true)}
        className={`w-full h-full object-cover ${loaded ? "" : "opacity-0"}`}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl">🎥</span>
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center text-white/80 text-lg bg-black/20 pointer-events-none">
        ▶
      </span>
    </div>
  );
}

// メディアアイテム
function PickerItem({
  entry,
  onSelect,
}: {
  entry: MediaIndexEntry;
  onSelect: (entry: MediaIndexEntry) => void;
}) {
  const thumbnail = useMemo(() => {
    switch (entry.type) {
      case "image":
        return (
          <img
            src={entry.thumbnailUrl}
            alt={entry.name}
            className="w-full h-20 object-cover rounded bg-muted"
            loading="lazy"
          />
        );
      case "video":
        return <VideoThumb entry={entry} />;
      case "audio":
        return (
          <div className="w-full h-20 flex items-center justify-center rounded bg-muted">
            <span className="text-xl">🔊</span>
          </div>
        );
      default:
        return (
          <div className="w-full h-20 flex items-center justify-center rounded bg-muted">
            <span className="text-xl">📎</span>
          </div>
        );
    }
  }, [entry]);

  return (
    <button
      onClick={() => onSelect(entry)}
      className="border border-border rounded bg-background hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer text-left"
    >
      {thumbnail}
      <p className="px-1.5 py-1 text-[10px] text-foreground truncate" title={entry.name}>
        {entry.name}
      </p>
    </button>
  );
}

export type MediaPickerModalProps = {
  mediaIndex: MediaIndex | null;
  mediaType: MediaType;
  onSelect: (entry: MediaIndexEntry) => void;
  onClose: () => void;
  /** 新規アップロード（File → URL を返す） */
  onUpload?: (file: File) => Promise<string>;
};

export function MediaPickerModal({
  mediaIndex,
  mediaType,
  onSelect,
  onClose,
  onUpload,
}: MediaPickerModalProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 自動フォーカス
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC で閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!mediaIndex) return [];
    let result = mediaIndex.media.filter((m) => m.type === mediaType);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }
    // 新しいものが先
    return result.sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }, [mediaIndex, mediaType, searchQuery]);

  const typeLabel = t(`asset.type.${mediaType}`);

  const handleSelect = useCallback(
    (entry: MediaIndexEntry) => {
      onSelect(entry);
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("asset.pickTitle", { type: typeLabel })}
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {t("asset.count", { count: String(filtered.length) })}
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* 検索 */}
        <div className="px-4 py-2 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("asset.search")}
            className="w-full text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* グリッド */}
        <div className="flex-1 overflow-auto p-4">
          {/* 新規アップロードボタン */}
          {onUpload && (
            <div className="mb-3">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border text-foreground hover:bg-muted transition-colors cursor-pointer">
                📁 {t("asset.uploadNew")}
                <input
                  type="file"
                  accept={mediaType === "image" ? "image/*" : mediaType === "video" ? "video/*" : mediaType === "audio" ? "audio/*" : "*/*"}
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = await onUpload(file);
                    // アップロード後、そのメディアを挿入用に通知
                    onSelect({
                      fileId: "",
                      name: file.name,
                      type: mediaType,
                      mimeType: file.type,
                      url,
                      thumbnailUrl: url.replace("=s0", "=s200"),
                      uploadedAt: new Date().toISOString(),
                      usedIn: [],
                    });
                    onClose();
                  }}
                />
              </label>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">{t("asset.noMedia")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {filtered.map((entry) => (
                <PickerItem
                  key={entry.fileId}
                  entry={entry}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
