// アセットギャラリービュー（メインエリアに表示）
// メディアタイプ別にサムネイル一覧を表示、ノート紐付き・削除に対応

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Video, Volume2, FileText, Paperclip, Play, Link, ExternalLink, Plus } from "lucide-react";
import { useT } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
/** 日付を YYYY-MM-DD 形式でフォーマット */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}
import type { MediaIndex, MediaIndexEntry, MediaType } from "./media-index";
import { getFaviconUrl } from "./media-index";
import { MediaDetailModal } from "./MediaDetailModal";
import { UrlBookmarkModal } from "./UrlBookmarkModal";
import { MediaPickerModal } from "./MediaPickerModal";

type SortKey = "uploadedAt" | "name";

// 削除確認ダイアログ
function DeleteConfirmDialog({
  fileName,
  onConfirm,
  onCancel,
  deleting,
}: {
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("asset.deleteConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("asset.deleteConfirmMessage", { name: fileName })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {deleting ? t("asset.deleting") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// 画像サムネイル: local-media:// URL を Blob URL に変換して表示
function ImageThumbnail({ entry }: { entry: MediaIndexEntry }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(entry.thumbnailUrl);
    if (!fileId) {
      // Google Drive 等: URL をそのまま使う
      setSrc(entry.thumbnailUrl);
      return;
    }
    // ローカル: Blob URL に変換
    provider.getMediaBlobUrl(fileId).then(setSrc).catch(() => {});
  }, [entry.thumbnailUrl]);

  if (!src) {
    return <div className="w-full h-32 flex items-center justify-center rounded-t-md bg-muted"><Image size={32} className="text-muted-foreground" /></div>;
  }
  return <img src={src} alt={entry.name} className="w-full h-32 object-cover rounded-t-md bg-muted" loading="lazy" />;
}

// 動画サムネイル: Intersection Observer で画面内に入ったときだけ Blob URL を取得
function VideoThumbnail({ entry }: { entry: MediaIndexEntry }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);

  // 画面内に入ったら visible = true（200px 手前で先読み）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // visible になったら Blob URL を取得
  useEffect(() => {
    if (!visible) return;
    const fileId = getActiveProvider().extractFileId(entry.url);
    if (!fileId || !videoRef.current) return;

    let cancelled = false;
    getActiveProvider().getMediaBlobUrl(fileId).then((blobUrl) => {
      if (cancelled || !videoRef.current) return;
      videoRef.current.src = blobUrl;
      videoRef.current.load();
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [entry.url, visible]);

  return (
    <div ref={containerRef} className="relative w-full h-32 rounded-t-md bg-muted overflow-hidden">
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
          <Video size={32} className="text-muted-foreground" />
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center text-white/80 bg-black/20 pointer-events-none">
        <Play size={24} fill="currentColor" />
      </span>
    </div>
  );
}

// URL ブックマークサムネイル: favicon + ドメイン表示
function UrlThumbnail({ entry }: { entry: MediaIndexEntry }) {
  const domain = entry.urlMeta?.domain ?? "";
  return (
    <div className="w-full h-32 flex flex-col items-center justify-center gap-2 rounded-t-md bg-muted px-3">
      <img
        src={getFaviconUrl(domain)}
        alt=""
        className="w-8 h-8 rounded"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="text-[10px] text-muted-foreground truncate max-w-full">{domain}</span>
    </div>
  );
}

// メディアカードコンポーネント
function MediaCard({
  entry,
  onNavigateNote,
  onDelete,
  onOpenDetail,
}: {
  entry: MediaIndexEntry;
  onNavigateNote: (noteId: string) => void;
  onDelete: (entry: MediaIndexEntry) => void;
  onOpenDetail: (entry: MediaIndexEntry) => void;
}) {
  const t = useT();

  // サムネイル表示
  const thumbnail = useMemo(() => {
    switch (entry.type) {
      case "image":
        return <ImageThumbnail entry={entry} />;
      case "video":
        return <VideoThumbnail entry={entry} />;
      case "audio":
        return (
          <div className="w-full h-32 flex items-center justify-center rounded-t-md bg-muted">
            <Volume2 size={32} className="text-muted-foreground" />
          </div>
        );
      case "pdf":
        return (
          <div className="w-full h-32 flex items-center justify-center rounded-t-md bg-muted">
            <FileText size={32} className="text-muted-foreground" />
          </div>
        );
      case "url":
        return <UrlThumbnail entry={entry} />;
      default:
        return (
          <div className="w-full h-32 flex items-center justify-center rounded-t-md bg-muted">
            <Paperclip size={32} className="text-muted-foreground" />
          </div>
        );
    }
  }, [entry]);

  return (
    <div className="border border-border rounded-md bg-background hover:border-primary/40 transition-colors group relative">
      {/* 削除ボタン */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(entry); }}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-background/80 hover:bg-destructive hover:text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs transition-all z-10"
        title={t("common.delete")}
      >
        ✕
      </button>

      {/* サムネイル（クリックでモーダル表示） */}
      <button
        onClick={() => onOpenDetail(entry)}
        className="w-full cursor-pointer"
      >
        {thumbnail}
      </button>

      {/* メタデータ */}
      <div className="p-2">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium text-foreground truncate flex-1" title={entry.name}>
            {entry.name}
          </p>
          {entry.type === "url" && (
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary transition-colors shrink-0"
              title={t("asset.urlOpen")}
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {formatDate(entry.uploadedAt)}
        </p>
        {entry.type === "url" && entry.urlMeta?.description && (
          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
            {entry.urlMeta.description}
          </p>
        )}
        {/* 使用されているノート */}
        {entry.usedIn.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {entry.usedIn.map((usage) => (
              <button
                key={`${usage.noteId}-${usage.blockId}`}
                onClick={() => onNavigateNote(usage.noteId)}
                className="text-[10px] text-primary hover:underline truncate max-w-[120px]"
                title={usage.noteTitle}
              >
                {usage.noteTitle}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground italic">
            {t("asset.unused")}
          </p>
        )}
      </div>
    </div>
  );
}

export type AssetGalleryViewProps = {
  mediaIndex: MediaIndex | null;
  mediaType: MediaType;
  onBack: () => void;
  onNavigateNote: (noteId: string) => void;
  onDeleteMedia: (entry: MediaIndexEntry) => Promise<void>;
  onRenameMedia: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  /** URL ブックマーク登録コールバック（type === "url" のときのみ使用） */
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
};

export function AssetGalleryView({
  mediaIndex,
  mediaType,
  onBack,
  onNavigateNote,
  onDeleteMedia,
  onRenameMedia,
  onAddUrlBookmark,
}: AssetGalleryViewProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MediaIndexEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailEntry, setDetailEntry] = useState<MediaIndexEntry | null>(null);
  const [showUrlModal, setShowUrlModal] = useState(false);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      setSortAsc(key === "name"); // 名前はデフォルト昇順、日付はデフォルト降順
      return key;
    });
  }, []);

  // タイプ別にフィルタ + 検索 + ソート
  const filtered = useMemo(() => {
    if (!mediaIndex) return [];
    let result = mediaIndex.media.filter((m) => m.type === mediaType);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.usedIn.some((u) => u.noteTitle.toLowerCase().includes(q)) ||
          m.urlMeta?.domain?.toLowerCase().includes(q) ||
          m.urlMeta?.description?.toLowerCase().includes(q) ||
          (m.type === "url" && m.url.toLowerCase().includes(q))
      );
    }
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "uploadedAt") {
        cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [mediaIndex, mediaType, searchQuery, sortKey, sortAsc]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDeleteMedia(deleteTarget);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteMedia]);

  // タイプ別の表示名
  const typeLabel = t(`asset.type.${mediaType}`);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("common.back")}
        </button>
        <h1 className="text-base font-semibold text-foreground">{typeLabel}</h1>
        <span className="text-xs text-muted-foreground">
          {t("asset.count", { count: String(filtered.length) })}
        </span>
        {mediaType === "url" && onAddUrlBookmark && (
          <button
            onClick={() => setShowUrlModal(true)}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus size={12} />
            {t("asset.urlAdd")}
          </button>
        )}
      </div>

      {/* 検索バー + ソート */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("asset.search")}
          className="w-full max-w-xs text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
        />
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => handleSort("uploadedAt")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "uploadedAt"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("asset.sortDate")}{sortKey === "uploadedAt" && (sortAsc ? " ↑" : " ↓")}
          </button>
          <button
            onClick={() => handleSort("name")}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              sortKey === "name"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("asset.sortName")}{sortKey === "name" && (sortAsc ? " ↑" : " ↓")}
          </button>
        </div>
      </div>

      {/* ギャラリーグリッド */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {!mediaIndex ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("asset.noMedia")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filtered.map((entry) => (
              <MediaCard
                key={entry.fileId}
                entry={entry}
                onNavigateNote={onNavigateNote}
                onDelete={setDeleteTarget}
                onOpenDetail={setDetailEntry}
              />
            ))}
          </div>
        )}
      </div>

      {/* 削除確認ダイアログ */}
      {deleteTarget && (
        <DeleteConfirmDialog
          fileName={deleteTarget.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      {/* メディア詳細モーダル */}
      {detailEntry && (
        <MediaDetailModal
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onNavigateNote={onNavigateNote}
          onRename={async (entry, newName) => {
            // 楽観的更新: モーダル内の表示を即座に反映
            setDetailEntry({ ...entry, name: newName });
            await onRenameMedia(entry, newName);
          }}
        />
      )}

      {/* URL ピッカーモーダル（新規登録 + 既存選択） */}
      {showUrlModal && onAddUrlBookmark && (
        <MediaPickerModal
          mediaIndex={mediaIndex}
          mediaType="url"
          onSelect={() => setShowUrlModal(false)}
          onClose={() => setShowUrlModal(false)}
          onAddUrlBookmark={onAddUrlBookmark}
        />
      )}
    </div>
  );
}
