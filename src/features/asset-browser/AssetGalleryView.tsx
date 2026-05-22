// アセットギャラリービュー（メインエリアに表示）
// メディアタイプ別にサムネイル一覧を表示、ノート紐付き・削除に対応

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Video, Volume2, FileText, Paperclip, Play, Link, ExternalLink, Plus, LayoutGrid, List as ListIcon, BookPlus, FlaskConical } from "lucide-react";
import { useT } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
import { useRangeSelect } from "../../hooks/use-range-select";
import { formatDate, formatDateTime } from "../../lib/format-datetime";
import type { MediaIndex, MediaIndexEntry, MediaType } from "./media-index";
import { getFaviconUrl } from "./media-index";
import { MaterialSidePeek } from "./MaterialSidePeek";
import { MaterialFullView } from "./MaterialFullView";
import type { KnowledgeKindLookup } from "./asset-graph-panel";
import type { CitationSource } from "./SelectionPill";
import { UrlBookmarkModal } from "./UrlBookmarkModal";
import { MediaPickerModal } from "./MediaPickerModal";

type SortKey = "uploadedAt" | "name" | "usedIn";

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

// 一括削除確認ダイアログ — 影響を受けるノート数を表示
function BulkDeleteConfirmDialog({
  count,
  refNoteCount,
  onConfirm,
  onCancel,
  deleting,
}: {
  count: number;
  refNoteCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {t("asset.bulkDeleteConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {refNoteCount > 0
            ? t("asset.bulkDeleteConfirmMessage", {
                count: String(count),
                refCount: String(refNoteCount),
              })
            : t("asset.bulkDeleteConfirmMessageNoRef", { count: String(count) })}
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
function ImageThumbnail({ entry, compact = false }: { entry: MediaIndexEntry; compact?: boolean }) {
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

  const wrapperCls = compact
    ? "w-10 h-10 flex items-center justify-center rounded bg-muted overflow-hidden shrink-0"
    : "w-full h-32 flex items-center justify-center rounded-t-md bg-muted";
  const imgCls = compact
    ? "w-10 h-10 object-cover rounded bg-muted shrink-0"
    : "w-full h-32 object-cover rounded-t-md bg-muted";
  const iconSize = compact ? 16 : 32;

  if (!src) {
    return <div className={wrapperCls}><Image size={iconSize} className="text-muted-foreground" /></div>;
  }
  return <img src={src} alt={entry.name} className={imgCls} loading="lazy" />;
}

// 動画サムネイル: Intersection Observer で画面内に入ったときだけ Blob URL を取得
function VideoThumbnail({ entry, compact = false }: { entry: MediaIndexEntry; compact?: boolean }) {
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

  const wrapperCls = compact
    ? "relative w-10 h-10 rounded bg-muted overflow-hidden shrink-0"
    : "relative w-full h-32 rounded-t-md bg-muted overflow-hidden";
  const iconSize = compact ? 16 : 32;
  const playSize = compact ? 14 : 24;

  return (
    <div ref={containerRef} className={wrapperCls}>
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
          <Video size={iconSize} className="text-muted-foreground" />
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center text-white/80 bg-black/20 pointer-events-none">
        <Play size={playSize} fill="currentColor" />
      </span>
    </div>
  );
}

// URL ブックマークサムネイル: favicon + ドメイン表示
function UrlThumbnail({ entry, compact = false }: { entry: MediaIndexEntry; compact?: boolean }) {
  const domain = entry.urlMeta?.domain ?? "";
  if (compact) {
    return (
      <div className="w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0">
        <img
          src={getFaviconUrl(domain)}
          alt=""
          className="w-5 h-5 rounded"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }
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

// 共通サムネイルディスパッチ（gallery/list 両用）
function MediaThumbnail({ entry, compact = false }: { entry: MediaIndexEntry; compact?: boolean }) {
  switch (entry.type) {
    case "image":
      return <ImageThumbnail entry={entry} compact={compact} />;
    case "video":
      return <VideoThumbnail entry={entry} compact={compact} />;
    case "audio": {
      const cls = compact
        ? "w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0"
        : "w-full h-32 flex items-center justify-center rounded-t-md bg-muted";
      return <div className={cls}><Volume2 size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
    case "pdf": {
      const cls = compact
        ? "w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0"
        : "w-full h-32 flex items-center justify-center rounded-t-md bg-muted";
      return <div className={cls}><FileText size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
    case "url":
      return <UrlThumbnail entry={entry} compact={compact} />;
    default: {
      const cls = compact
        ? "w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0"
        : "w-full h-32 flex items-center justify-center rounded-t-md bg-muted";
      return <div className={cls}><Paperclip size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
  }
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
        <MediaThumbnail entry={entry} />
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
  /** ファイル直接アップロード（image/video/audio/pdf のみ使用、ノート非経由） */
  onUploadMedia?: (file: File) => Promise<string>;
  /** メディアから Knowledge を生成（URL/PDF 用） */
  onIngestMedia?: (entry: MediaIndexEntry) => void;
  /** URL から PROV ラベル付きノートを生成する（URL エントリー限定） */
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /**
   * 与えられた URL/PDF が既に Knowledge 化されている場合の wiki ノート ID を返す。
   * 戻り値があれば MediaDetailModal は「In Knowledge」表示に切り替わる。
   */
  resolveKnowledgeWikiId?: (entry: MediaIndexEntry) => string | undefined;
  /**
   * メディアの team-shared 共有が成功したときに、media index へ sharedRef を反映する
   * コールバック（Phase 2b-media）。親側で saveMediaIndex 経由で永続化する。
   */
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: import("./media-index").MediaSharedRef) => Promise<void> | void;
  /**
   * PDF アセットの各ページを画像化して画像アセットに登録するアクション。
   * 親側で pdf-image-extractor + handleUploadMedia を組み立てて渡す。
   */
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /**
   * Knowledge ノートの kind 別色を出すためのルックアップ。
   * 渡されない場合はフォールバック色で描画。
   */
  getKnowledgeKind?: KnowledgeKindLookup;
  /**
   * 親（note-app）からフォーカスしたい素材を指定する。
   * 例: ノートのグラフから画像ノードをクリック → そのアセットを Full view で開く。
   * mediaType と組み合わせて使う前提（mediaType=entry.type に切替えられた直後を想定）。
   * 渡されると AssetGalleryView 内部の detailEntry / detailFullMode に反映し、
   * 反映後に onFocusConsumed を呼んで親側の state をクリアする。
   */
  focusFileId?: string | null;
  focusFullMode?: boolean;
  onFocusConsumed?: () => void;
  /**
   * PDF text-layer の選択を新規メモとして保存する。
   * note-app から渡される。AssetGalleryView はノートを開かないため、
   * 引用は「メモに保存」の 1 ステップに揃えた（後でメモピッカーから任意のノートに引用できる）。
   */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
  /** Memos タブ用のキャプチャインデックス */
  captureIndex?: import("../mobile-capture").CaptureIndex | null;
  /** Memos タブからメモを削除 */
  onDeleteMemo?: (memoId: string) => void;
  /**
   * Memos タブの入力欄から、対象素材に紐づくメモを直接追加する。
   * 親側で sourceAsset の付与・トースト等を行う。
   */
  onCreateMemoForAsset?: (entry: MediaIndexEntry, text: string) => void | Promise<void>;
};

export function AssetGalleryView({
  mediaIndex,
  mediaType,
  onBack,
  onNavigateNote,
  onDeleteMedia,
  onRenameMedia,
  onAddUrlBookmark,
  onUploadMedia,
  onIngestMedia,
  onCreateProvNote,
  resolveKnowledgeWikiId,
  onSharedRefUpdated,
  onExtractPdfPages,
  getKnowledgeKind,
  focusFileId,
  focusFullMode,
  onFocusConsumed,
  onSaveSelectionAsMemo,
  captureIndex,
  onDeleteMemo,
  onCreateMemoForAsset,
}: AssetGalleryViewProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MediaIndexEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailEntry, setDetailEntry] = useState<MediaIndexEntry | null>(null);
  // サイドピーク中に「Open in full」を押すとフルスクリーンオーバーレイ化
  const [detailFullMode, setDetailFullMode] = useState(false);
  // サイドバーで別の素材タイプ（Images / PDFs / URLs ...）に切り替えたら
  // 開きっぱなしの SidePeek / Full view を必ず畳む。
  // これを忘れると、Full view 中はその素材が固定描画され続けてサイドバーが効かなく見える。
  useEffect(() => {
    setDetailEntry(null);
    setDetailFullMode(false);
  }, [mediaType]);

  // 親から focusFileId が降ってきたら、その entry を SidePeek / Full view で開く。
  // ノートのグラフから画像ノードクリック → このアセットを Full view で表示、の経路。
  // mediaType 変更直後に走るので、上の clear useEffect の後に置く（declaration 順）。
  useEffect(() => {
    if (!focusFileId || !mediaIndex) return;
    const target = mediaIndex.media.find((m) => m.fileId === focusFileId);
    if (!target) {
      // 見つからない（削除済み等）。consumed として親をクリアする。
      onFocusConsumed?.();
      return;
    }
    setDetailEntry(target);
    setDetailFullMode(focusFullMode ?? false);
    onFocusConsumed?.();
  }, [focusFileId, focusFullMode, mediaIndex, onFocusConsumed]);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // ビュー切替（gallery / list）— localStorage に永続化
  const [viewMode, setViewMode] = useState<"gallery" | "list">(() => {
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem("graphium:assetViewMode") : null;
      return v === "list" ? "list" : "gallery";
    } catch {
      return "gallery";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("graphium:assetViewMode", viewMode);
    } catch {
      // no-op
    }
  }, [viewMode]);
  // 複数選択（list モードのみで利用）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const acceptByType: Record<MediaType, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
    pdf: "application/pdf",
    url: "",
    other: "",
  };

  const handleFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !onUploadMedia) return;
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          await onUploadMedia(file);
        }
      } catch (err) {
        console.error("メディアアップロード失敗:", err);
        alert(t("asset.uploadFailed"));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onUploadMedia, t]
  );

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
      } else if (sortKey === "usedIn") {
        cmp = a.usedIn.length - b.usedIn.length;
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

  // ── 複数選択（list モード）──
  // タイプ／検索／ソートが変わったら選択をクリア
  useEffect(() => {
    setSelectedIds(new Set());
  }, [mediaType, searchQuery, sortKey, sortAsc]);
  // 表示中エントリーの順序付き ID（範囲選択用）
  const orderedIds = useMemo(() => filtered.map((e) => e.fileId), [filtered]);
  const range = useRangeSelect(orderedIds, selectedIds, setSelectedIds);
  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.fileId));
  const someSelected = selectedIds.size > 0;
  const toggleSelectAll = useCallback(() => {
    const ids = filtered.map((e) => e.fileId);
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  }, [filtered, selectedIds]);
  // 選択中のエントリーから影響を受けるノート数（重複除外）
  const selectedRefNoteCount = useMemo(() => {
    const noteIds = new Set<string>();
    for (const e of filtered) {
      if (!selectedIds.has(e.fileId)) continue;
      for (const u of e.usedIn) noteIds.add(u.noteId);
    }
    return noteIds.size;
  }, [filtered, selectedIds]);
  const handleBulkDeleteConfirm = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const targets = filtered.filter((e) => selectedIds.has(e.fileId));
    setBulkDeleting(true);
    try {
      // 順次削除（並列だと mediaIndex の race が起きうる）
      for (const entry of targets) {
        await onDeleteMedia(entry);
      }
      setSelectedIds(new Set());
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  }, [filtered, selectedIds, onDeleteMedia]);

  // 一括 Knowledge 化（URL/PDF のみ）
  // onIngestMedia は内部でトーストキューに積む fire-and-forget なので、
  // 同期的に順次キックすれば各エントリーが個別ジョブとして並走する
  const bulkActionable = mediaType === "url" || mediaType === "pdf";
  const handleBulkIngest = useCallback(() => {
    if (!onIngestMedia || selectedIds.size === 0) return;
    const targets = filtered.filter((e) => selectedIds.has(e.fileId));
    for (const entry of targets) {
      onIngestMedia(entry);
    }
    setSelectedIds(new Set());
  }, [filtered, selectedIds, onIngestMedia]);
  const handleBulkCreateProvNote = useCallback(() => {
    if (!onCreateProvNote || selectedIds.size === 0) return;
    const targets = filtered.filter((e) => selectedIds.has(e.fileId));
    for (const entry of targets) {
      onCreateProvNote(entry);
    }
    setSelectedIds(new Set());
  }, [filtered, selectedIds, onCreateProvNote]);

  // タイプ別の表示名
  const typeLabel = t(`asset.type.${mediaType}`);

  // Full view 中はギャラリーを完全に置き換える（左ナビは外側に残るので独立して見える）
  if (detailEntry && detailFullMode) {
    return (
      <MaterialFullView
        entry={detailEntry}
        onClose={() => {
          setDetailEntry(null);
          setDetailFullMode(false);
        }}
        onToggleFull={() => setDetailFullMode(false)}
        onNavigateNote={(noteId) => {
          setDetailEntry(null);
          setDetailFullMode(false);
          onNavigateNote(noteId);
        }}
        onRename={async (entry, newName) => {
          setDetailEntry({ ...entry, name: newName });
          await onRenameMedia(entry, newName);
        }}
        onIngest={onIngestMedia}
        onCreateProvNote={onCreateProvNote}
        knowledgeWikiNoteId={resolveKnowledgeWikiId?.(detailEntry)}
        onSharedRefUpdated={async (entry, sharedRef) => {
          setDetailEntry({ ...entry, sharedRef });
          if (onSharedRefUpdated) await onSharedRefUpdated(entry, sharedRef);
        }}
        onExtractPdfPages={onExtractPdfPages}
        mediaIndex={mediaIndex}
        getKnowledgeKind={getKnowledgeKind}
        onSwitchAsset={(nextEntry) => setDetailEntry(nextEntry)}
        onDelete={(entry) => setDeleteTarget(entry)}
        onSaveSelectionAsMemo={onSaveSelectionAsMemo}
        captureIndex={captureIndex}
        onDeleteMemo={onDeleteMemo}
        onCreateMemo={
          onCreateMemoForAsset
            ? (text) => onCreateMemoForAsset(detailEntry, text)
            : undefined
        }
      />
    );
  }

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
        {mediaType !== "url" && onUploadMedia && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <Plus size={12} />
              {uploading ? t("asset.uploading") : t("asset.upload")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptByType[mediaType]}
              multiple
              onChange={handleFilePicked}
              className="hidden"
            />
          </>
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
          {/* ビュー切替 */}
          <div className="ml-2 inline-flex rounded border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("gallery")}
              title={t("asset.viewGallery")}
              aria-pressed={viewMode === "gallery"}
              className={`px-2 py-1 transition-colors ${
                viewMode === "gallery"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid size={12} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              title={t("asset.viewList")}
              aria-pressed={viewMode === "list"}
              className={`px-2 py-1 transition-colors border-l border-border ${
                viewMode === "list"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListIcon size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* 一括アクションバー（list モードで選択時のみ） */}
      {viewMode === "list" && someSelected && (
        <div className="px-6 py-2 border-b border-border bg-primary/5 flex items-center gap-3">
          <span className="text-xs text-foreground font-medium">
            {selectedIds.size} / {filtered.length}
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("asset.deselectAll")}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {bulkActionable && onIngestMedia && (
              <button
                onClick={handleBulkIngest}
                className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                title={t("asset.bulkIngestTitle")}
              >
                <BookPlus size={12} />
                {t("asset.bulkIngest", { count: String(selectedIds.size) })}
              </button>
            )}
            {bulkActionable && onCreateProvNote && (
              <button
                onClick={handleBulkCreateProvNote}
                className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                title={t("asset.bulkCreateProvNoteTitle")}
              >
                <FlaskConical size={12} />
                {t("asset.bulkCreateProvNote", { count: String(selectedIds.size) })}
              </button>
            )}
            <button
              onClick={() => setBulkDeleteOpen(true)}
              className="px-3 py-1 text-xs font-medium rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              {t("asset.deleteSelected", { count: String(selectedIds.size) })}
            </button>
          </div>
        </div>
      )}

      {/* メイン表示（ギャラリー or リスト） */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {!mediaIndex ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{t("asset.noMedia")}</p>
          </div>
        ) : viewMode === "gallery" ? (
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
        ) : (
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
                <th className="py-2 px-2 w-[36px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    title={allSelected ? t("asset.deselectAll") : t("asset.selectAll")}
                  />
                </th>
                <th className="py-2 px-2 w-[56px]" />
                <th
                  className="py-2 px-3 cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("name")}
                >
                  {t("asset.colName")}{sortKey === "name" && (sortAsc ? " ↑" : " ↓")}
                </th>
                <th
                  className="py-2 px-2 w-[80px] text-center cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("usedIn")}
                  title={t("asset.colUsedIn")}
                >
                  {t("asset.colUsedIn")}{sortKey === "usedIn" && (sortAsc ? " ↑" : " ↓")}
                </th>
                <th
                  className="py-2 pl-3 w-[130px] cursor-pointer hover:text-foreground"
                  onClick={() => handleSort("uploadedAt")}
                >
                  {t("asset.colDate")}{sortKey === "uploadedAt" && (sortAsc ? " ↑" : " ↓")}
                </th>
                <th className="py-2 px-2 w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, index) => {
                const isSelected = selectedIds.has(entry.fileId);
                return (
                  <tr
                    key={entry.fileId}
                    className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                    onMouseDown={(e) => range.onRowMouseDown(e, index)}
                    onMouseEnter={() => range.onRowMouseEnter(index)}
                    onClick={() => {
                      if (range.shouldSuppressClick()) return;
                      setDetailEntry(entry);
                    }}
                  >
                    <td
                      className="py-2 px-2 cursor-pointer"
                      title={t("asset.dragToRangeSelect")}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => range.onCheckboxMouseDown(e, index)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        tabIndex={-1}
                        className="w-3.5 h-3.5 rounded border-border accent-primary pointer-events-none"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <MediaThumbnail entry={entry} compact />
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-foreground truncate" title={entry.name}>
                          {entry.name}
                        </span>
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
                      {entry.type === "url" && entry.urlMeta?.domain && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {entry.urlMeta.domain}
                        </p>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center text-xs text-muted-foreground tabular-nums">
                      {entry.usedIn.length > 0 ? entry.usedIn.length : <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="py-2 pl-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDateTime(entry.uploadedAt)}
                    </td>
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setDeleteTarget(entry)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-xs p-1"
                        title={t("common.delete")}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

      {/* 一括削除確認ダイアログ */}
      {bulkDeleteOpen && (
        <BulkDeleteConfirmDialog
          count={selectedIds.size}
          refNoteCount={selectedRefNoteCount}
          onConfirm={handleBulkDeleteConfirm}
          onCancel={() => setBulkDeleteOpen(false)}
          deleting={bulkDeleting}
        />
      )}

      {/* メディア詳細: サイドピーク（Full mode は早期 return で別ルートに渡す） */}
      {detailEntry && (
        <MaterialSidePeek
          entry={detailEntry}
          onClose={() => {
            setDetailEntry(null);
            setDetailFullMode(false);
          }}
          onToggleFull={() => setDetailFullMode(true)}
          onNavigateNote={(noteId) => {
            setDetailEntry(null);
            setDetailFullMode(false);
            onNavigateNote(noteId);
          }}
          onRename={async (entry, newName) => {
            setDetailEntry({ ...entry, name: newName });
            await onRenameMedia(entry, newName);
          }}
          onIngest={onIngestMedia}
          onCreateProvNote={onCreateProvNote}
          knowledgeWikiNoteId={resolveKnowledgeWikiId?.(detailEntry)}
          onSharedRefUpdated={async (entry, sharedRef) => {
            setDetailEntry({ ...entry, sharedRef });
            if (onSharedRefUpdated) await onSharedRefUpdated(entry, sharedRef);
          }}
          onExtractPdfPages={onExtractPdfPages}
          mediaIndex={mediaIndex}
          getKnowledgeKind={getKnowledgeKind}
          onSwitchAsset={(nextEntry) => setDetailEntry(nextEntry)}
          onSaveSelectionAsMemo={onSaveSelectionAsMemo}
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
