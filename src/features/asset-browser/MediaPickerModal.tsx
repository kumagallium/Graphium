// メディアピッカーモーダル
// スラッシュコマンドから呼び出し、既存メディアを選択してエディタに挿入する
// URL タイプの場合は新規 URL 登録フォームを表示する

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { getActiveProvider } from "../../lib/storage/registry";
import { DELIMITED_FILE_ACCEPT } from "../data-import/file-kind";
import type { MediaIndex, MediaIndexEntry, MediaType } from "./media-index";
import {
  fetchUrlMetadata,
  generateUrlBookmarkId,
  getFaviconUrl,
  extractDomain,
  mimeToMediaType,
} from "./media-index";

// 画像サムネイル: local-media:// URL を Blob URL に変換して表示
// AssetGalleryView.ImageThumbnail と同じパターン
function ImageThumb({ entry }: { entry: MediaIndexEntry }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(entry.thumbnailUrl);
    if (!fileId) {
      setSrc(entry.thumbnailUrl);
      return;
    }
    let cancelled = false;
    provider.getMediaBlobUrl(fileId)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry.thumbnailUrl]);

  if (!src) {
    return <div className="w-full h-20 rounded bg-muted" />;
  }
  return (
    <img
      src={src}
      alt={entry.name}
      className="w-full h-20 object-cover rounded bg-muted"
      loading="lazy"
    />
  );
}

// 動画サムネイル（AssetGalleryView と同じパターン）
function VideoThumb({ entry }: { entry: MediaIndexEntry }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fileId = getActiveProvider().extractFileId(entry.url);
    if (!fileId || !videoRef.current) return;
    let cancelled = false;
    getActiveProvider().getMediaBlobUrl(fileId).then((blobUrl) => {
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
        return <ImageThumb entry={entry} />;
      case "video":
        return <VideoThumb entry={entry} />;
      case "audio":
        return (
          <div className="w-full h-20 flex items-center justify-center rounded bg-muted">
            <span className="text-xl">🔊</span>
          </div>
        );
      case "pdf":
        return (
          <div className="w-full h-20 flex items-center justify-center rounded bg-muted">
            <span className="text-xl">📄</span>
          </div>
        );
      case "document":
        return (
          <div className="w-full h-20 flex items-center justify-center rounded bg-muted">
            <span className="text-xl">📝</span>
          </div>
        );
      case "data":
        return (
          <div className="w-full h-20 flex items-center justify-center rounded bg-muted">
            <span className="text-xl">🧾</span>
          </div>
        );
      case "url":
        return (
          <div className="w-full h-20 flex flex-col items-center justify-center gap-1 rounded bg-muted px-2">
            <img
              src={getFaviconUrl(entry.urlMeta?.domain ?? "", 32)}
              alt=""
              className="w-6 h-6 rounded"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-[9px] text-muted-foreground truncate max-w-full">
              {entry.urlMeta?.domain ?? ""}
            </span>
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

/**
 * 挿入時の表示形式。
 *   embed … 中身をノート内に展開（画像/PDF/file/bookmark ブロック）
 *   link  … @リンク（素材は inline @名前、URL はハイパーリンク）として挿入し中身は展開しない
 */
export type AssetDisplayMode = "embed" | "link";

export type MediaPickerModalProps = {
  mediaIndex: MediaIndex | null;
  mediaType: MediaType;
  onSelect: (entry: MediaIndexEntry, displayMode: AssetDisplayMode) => void;
  onClose: () => void;
  /** 新規アップロード（File → URL を返す） */
  onUpload?: (file: File) => Promise<string>;
  /** URL ブックマーク登録コールバック（mediaType === "url" のとき使用） */
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  /** 初期 URL（ペースト時に自動入力する） */
  initialUrl?: string;
  /**
   * 「埋め込み / リンク」の表示形式トグルを表示するか。
   * onSelect 側で displayMode === "link" を処理できる呼び出し元のみ true にする。
   * 未指定（false）なら従来どおり常に埋め込みで挿入する。
   */
  allowDisplayMode?: boolean;
};

export function MediaPickerModal({
  mediaIndex,
  mediaType,
  onSelect,
  onClose,
  onUpload,
  onAddUrlBookmark,
  initialUrl,
  allowDisplayMode = false,
}: MediaPickerModalProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  // 挿入時の表示形式（埋め込み / リンク）。
  // document（PDF/docx）と URL は中身展開より参照が主目的なのでリンクを既定にする。
  // 画像/動画/音声は見せること自体が目的なので埋め込みを既定にする。
  const [displayMode, setDisplayMode] = useState<AssetDisplayMode>(
    mediaType === "document" || mediaType === "url" ? "link" : "embed",
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // URL 登録フォーム用の状態
  const [newUrl, setNewUrl] = useState(initialUrl ?? "");
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlRegistering, setUrlRegistering] = useState(false);
  const lastFetchedUrl = useRef("");
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

  // 自動フォーカス: URL タイプでは「新しい URL を追加する」入力欄を最初の焦点にする
  // （既存検索より新規追加が主目的のため）。それ以外のタイプは検索ボックス。
  useEffect(() => {
    if (mediaType === "url" && onAddUrlBookmark) {
      urlInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [mediaType, onAddUrlBookmark]);

  // ESC で閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // initialUrl が既存に一致するかチェック（ハイライト表示用）
  const existingMatch = useMemo(() => {
    if (!initialUrl || !mediaIndex) return null;
    return mediaIndex.media.find(
      (m) => m.type === "url" && m.url === initialUrl,
    ) ?? null;
  }, [initialUrl, mediaIndex]);

  const filtered = useMemo(() => {
    if (!mediaIndex) return [];
    // Documents タブには PDF も含める（AssetGalleryView と同じ統合方針）。
    // アーカイブ済み素材は新規挿入の候補に出さない（既存参照の表示は生きる）。
    let result = mediaIndex.media.filter((m) =>
      !m.archivedAt &&
      (mediaType === "document"
        ? m.type === "document" || m.type === "pdf"
        : m.type === mediaType)
    );
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.urlMeta?.domain?.toLowerCase().includes(q) ||
        m.urlMeta?.description?.toLowerCase().includes(q) ||
        (m.type === "url" && m.url.toLowerCase().includes(q))
      );
    }
    // 新しいものが先
    return result.sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }, [mediaIndex, mediaType, searchQuery]);

  const typeLabel = t(`asset.type.${mediaType}`);

  const handleSelect = useCallback(
    (entry: MediaIndexEntry) => {
      onSelect(entry, displayMode);
      onClose();
    },
    [onSelect, onClose, displayMode],
  );

  // URL 新規登録
  const handleUrlRegister = useCallback(async (urlToRegister?: string) => {
    const targetUrl = (urlToRegister ?? newUrl).trim();
    if (!targetUrl || !onAddUrlBookmark) return;
    try {
      new URL(targetUrl);
    } catch {
      return;
    }
    // 重複チェック
    const existing = mediaIndex?.media.find(
      (m) => m.type === "url" && m.url === targetUrl,
    );
    if (existing) {
      handleSelect(existing);
      return;
    }
    setUrlRegistering(true);
    setUrlFetching(true);
    try {
      const meta = await fetchUrlMetadata(targetUrl);
      const entry: MediaIndexEntry = {
        fileId: generateUrlBookmarkId(),
        name: meta.title,
        type: "url",
        mimeType: "text/x-uri",
        url: targetUrl,
        thumbnailUrl: getFaviconUrl(meta.domain),
        uploadedAt: new Date().toISOString(),
        usedIn: [],
        urlMeta: {
          domain: meta.domain,
          description: meta.description,
          ogImage: meta.ogImage,
        },
      };
      onAddUrlBookmark(entry);
      onSelect(entry, displayMode);
      onClose();
    } finally {
      setUrlFetching(false);
      setUrlRegistering(false);
    }
  }, [newUrl, onAddUrlBookmark, mediaIndex, handleSelect, onClose, onSelect, displayMode]);

  const isValidNewUrl = useMemo(() => {
    try {
      new URL(newUrl.trim());
      return true;
    } catch {
      return false;
    }
  }, [newUrl]);

  const isUrlType = mediaType === "url";

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

        {/* 挿入方法トグル（埋め込み / リンク） */}
        {allowDisplayMode && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <span className="text-[10px] text-muted-foreground shrink-0">
            {t("asset.displayMode")}
          </span>
          <div className="flex rounded border border-border overflow-hidden">
            {(["embed", "link"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDisplayMode(mode)}
                className={`px-3 py-1 text-[11px] transition-colors ${
                  displayMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {mode === "embed" ? t("asset.displayEmbed") : t("asset.displayLink")}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground truncate">
            {displayMode === "embed" ? t("asset.displayEmbedHint") : t("asset.displayLinkHint")}
          </span>
        </div>
        )}

        {/* グリッド */}
        <div className="flex-1 overflow-auto p-4">
          {/* 既存一致バナー */}
          {existingMatch && (
            <div className="mb-3 p-3 border border-primary/30 bg-primary/5 rounded-md">
              <p className="text-xs text-foreground mb-2">{t("asset.urlExistingMatch")}</p>
              <button
                onClick={() => handleSelect(existingMatch)}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded border border-border bg-background hover:border-primary transition-colors"
              >
                <img
                  src={getFaviconUrl(existingMatch.urlMeta?.domain ?? "", 32)}
                  alt=""
                  className="w-5 h-5 rounded shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{existingMatch.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{existingMatch.urlMeta?.domain}</p>
                </div>
              </button>
            </div>
          )}
          {/* URL タイプ: 新規 URL 登録フォーム */}
          {isUrlType && onAddUrlBookmark && (
            <div className="mb-3">
              <div className="flex gap-2">
                <input
                  ref={urlInputRef}
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  {...compositionHandlers}
                  onKeyDown={(e) => {
                    // IME 変換確定の Enter では登録しない（WKWebView の
                    // compositionend → keydown(13) 順対応。lib/ime-enter.ts 参照）
                    if (e.key === "Enter" && !isImeKey(e) && isValidNewUrl && !urlRegistering) {
                      e.preventDefault();
                      handleUrlRegister();
                    }
                  }}
                  placeholder="https://example.com/article"
                  className="flex-1 text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
                />
                <button
                  onClick={() => handleUrlRegister()}
                  disabled={!isValidNewUrl || urlRegistering}
                  className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                >
                  {urlFetching ? (
                    <><Loader2 size={12} className="animate-spin" /> {t("asset.urlRegistering")}</>
                  ) : (
                    <>{t("asset.urlAdd")}</>
                  )}
                </button>
              </div>
            </div>
          )}
          {/* メディアタイプ: 新規アップロードボタン */}
          {!isUrlType && onUpload && (
            <div className="mb-3">
              <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border text-foreground transition-colors ${uploading ? "opacity-50 pointer-events-none" : "hover:bg-muted cursor-pointer"}`}>
                {uploading ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    {t("asset.uploading")}
                  </>
                ) : (
                  <>📁 {t("asset.uploadNew")}</>
                )}
                <input
                  type="file"
                  accept={
                    mediaType === "image" ? "image/*"
                    : mediaType === "video" ? "video/*"
                    : mediaType === "audio" ? "audio/*"
                    : mediaType === "pdf" ? "application/pdf"
                    : mediaType === "document" ? ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt"
                    : mediaType === "data" ? DELIMITED_FILE_ACCEPT
                    : "*/*"
                  }
                  className="hidden"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      const url = await onUpload(file);
                      // Documents タブ経由のアップロードでは MIME に応じて pdf / document を分岐
                      const resolvedType =
                        mediaType === "document" ? mimeToMediaType(file.type, file.name) : mediaType;
                      onSelect({
                        fileId: "",
                        name: file.name,
                        type: resolvedType,
                        mimeType: file.type,
                        url,
                        thumbnailUrl: url.replace("=s0", "=s200"),
                        uploadedAt: new Date().toISOString(),
                        usedIn: [],
                      }, displayMode);
                      onClose();
                    } finally {
                      setUploading(false);
                    }
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
