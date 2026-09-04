// アセットギャラリービュー（メインエリアに表示）
// メディアタイプ別にサムネイル一覧を表示、ノート紐付き・削除に対応

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Video, Volume2, FileText, Table, Paperclip, Play, Link, ExternalLink, Plus, LayoutGrid, List as ListIcon, Bot, MoreHorizontal, Download, Images, Loader2, ScanText, Folder } from "lucide-react";
import { UNFILED_PATH } from "../note-context/folder-tree-model";
import { aggregateNoteContexts, noteContextHue, addNoteContext, removeNoteContext } from "../note-context/context-tags";
import { ContextTagPicker } from "../note-context/ContextTagPicker";
import { ContextBadge } from "../note-context/ContextBadge";
import {
  assetFolderValues,
  resolveAssetFolders,
  type NoteFolderLookup,
} from "./asset-folders";
import { FilterPopup, type FilterOption } from "@/ui/filter-popup";
import { useT } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
import { useRangeSelect } from "../../hooks/use-range-select";
import { formatDateTime } from "../../lib/format-datetime";
import type { MediaIndex, MediaIndexEntry, MediaType } from "./media-index";
import { getFaviconUrl, canExtractEmbeddedImages, hasExtractedImages, persistOcrTextPatch, isLocalPreviewRef } from "./media-index";
import { DELIMITED_FILE_ACCEPT } from "../data-import/file-kind";
import { runOcrForImage, OcrToast, type OcrToastState } from "../media-ocr";
import { OcrTimeoutError } from "../../lib/ocr";

/** 一括 OCR を打ち切る連続タイムアウト回数 */
const BULK_OCR_MAX_CONSECUTIVE_TIMEOUTS = 2;
import { startPreviewBackfill, usePreviewImage } from "./preview-image";
import { Favicon } from "./favicon";
import { MaterialSidePeek } from "./MaterialSidePeek";
import { MaterialFullView } from "./MaterialFullView";
import { AiAssistantProvider } from "../ai-assistant/store";
import type { KnowledgeKindLookup } from "./asset-graph-panel";
import type { CitationSource } from "./SelectionPill";
import { UrlBookmarkModal } from "./UrlBookmarkModal";
import { MediaPickerModal } from "./MediaPickerModal";
import { useIsDesktop } from "../../hooks/use-media-query";
import { IntakeReceptacle, type IntakeFile, type IntakeSource } from "../intake";

type SortKey = "uploadedAt" | "name" | "usedIn";

// 削除確認ダイアログ。
// ノート（usedIn）または版スナップショットから参照されている素材は、削除ではなく
// アーカイブ（一覧から隠すが既存の表示は生かす）を推奨する。
function DeleteConfirmDialog({
  fileName,
  usedInCount,
  snapshotRefCount,
  onConfirm,
  onArchive,
  onCancel,
  deleting,
}: {
  fileName: string;
  /** この素材を参照しているノート数（usedIn） */
  usedInCount: number;
  /** この素材を参照している版スナップショット数（null = 集計中） */
  snapshotRefCount: number | null;
  onConfirm: () => void;
  /** アーカイブ確定（未指定なら従来の削除のみの2択） */
  onArchive?: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const t = useT();
  const counting = snapshotRefCount === null;
  const hasRefs = usedInCount > 0 || (snapshotRefCount ?? 0) > 0;
  const showArchive = Boolean(onArchive) && !counting && hasRefs;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          {showArchive ? t("asset.archiveRecommendTitle") : t("asset.deleteConfirmTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {counting
            ? t("asset.countingSnapshots")
            : showArchive
              ? t("asset.archiveRecommendMessage", {
                  name: fileName,
                  noteCount: String(usedInCount),
                  snapshotCount: String(snapshotRefCount ?? 0),
                })
              : t("asset.deleteConfirmMessage", { name: fileName })}
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
            disabled={deleting || counting}
            className={
              showArchive
                ? "px-3 py-1.5 text-xs rounded border border-destructive/60 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                : "px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
            }
          >
            {deleting
              ? t("asset.deleting")
              : showArchive
                ? t("asset.deletePermanently")
                : t("common.delete")}
          </button>
          {showArchive && (
            <button
              onClick={onArchive}
              disabled={deleting}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {t("asset.archive")}
            </button>
          )}
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
    : "w-full h-40 flex items-center justify-center bg-muted";
  // 画像は必ず wrapper div の中に入れる。裸の <img> だと preflight の
  // img{max-width:100%} が効き、list 表示で列幅 0 のときサムネが 0px に潰れる。
  const imgCls = compact ? "w-full h-full object-cover" : "w-full h-full object-contain";
  const iconSize = compact ? 16 : 32;

  return (
    <div className={wrapperCls}>
      {src ? (
        <img src={src} alt={entry.name} className={imgCls} loading="lazy" />
      ) : (
        <Image size={iconSize} className="text-muted-foreground" />
      )}
    </div>
  );
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
    : "relative w-full h-40 bg-muted overflow-hidden";
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
        className={`w-full h-full ${compact ? "object-cover" : "object-contain"} ${loaded ? "" : "opacity-0"}`}
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
  // hero はローカルにキャッシュした data URL だけ。og:image / leadImage の remote URL は
  // 描画に使わない（カードを描くたびに配信元へ GET が飛ぶため）。無ければ favicon。
  const hero = usePreviewImage(entry);
  const [heroFailed, setHeroFailed] = useState(false);
  const showHero = hero && !heroFailed;

  if (compact) {
    return (
      <div className="w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0 overflow-hidden">
        {showHero ? (
          <img
            src={hero}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setHeroFailed(true)}
          />
        ) : (
          <Favicon domain={domain} url={entry.url} iconUrl={entry.urlMeta?.faviconUrl} className="w-5 h-5 rounded" />
        )}
      </div>
    );
  }
  if (showHero) {
    return (
      <div className="w-full h-40 bg-muted overflow-hidden">
        <img
          src={hero}
          alt={entry.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setHeroFailed(true)}
        />
      </div>
    );
  }
  return (
    <div className="w-full h-40 flex flex-col items-center justify-center gap-2 bg-muted px-3">
      <Favicon domain={domain} url={entry.url} iconUrl={entry.urlMeta?.faviconUrl} className="w-8 h-8 rounded" />
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
        : "w-full h-40 flex items-center justify-center bg-muted";
      return <div className={cls}><Volume2 size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
    case "pdf": {
      const cls = compact
        ? "w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0"
        : "w-full h-40 flex items-center justify-center bg-muted";
      return <div className={cls}><FileText size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
    case "url":
      return <UrlThumbnail entry={entry} compact={compact} />;
    case "data": {
      const cls = compact
        ? "w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0"
        : "w-full h-40 flex items-center justify-center bg-muted";
      return <div className={cls}><Table size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
    default: {
      const cls = compact
        ? "w-10 h-10 flex items-center justify-center rounded bg-muted shrink-0"
        : "w-full h-40 flex items-center justify-center bg-muted";
      return <div className={cls}><Paperclip size={compact ? 16 : 32} className="text-muted-foreground" /></div>;
    }
  }
}

// メディアカードコンポーネント
function MediaCard({
  entry,
  onDelete,
  onOpenDetail,
}: {
  entry: MediaIndexEntry;
  onDelete: (entry: MediaIndexEntry) => void;
  onOpenDetail: (entry: MediaIndexEntry) => void;
}) {
  const t = useT();
  // サムネ自体が中身を物語る素材はホバー時のみ名前を出す。
  // それ以外（PDF / 音声 / hero なし URL / その他）はアイコンだけだと
  // 情報量がゼロなので、ファイル名を常時表示する。
  // hero の有無は同期的に判る previewImage 参照で決める（実体の読み出しは非同期なので、
  // 読めてから判定するとカードの高さが描画途中で変わる）
  const hasVisualThumbnail =
    entry.type === "image" ||
    entry.type === "video" ||
    (entry.type === "url" && isLocalPreviewRef(entry.urlMeta?.previewImage));

  return (
    <div className="border border-border rounded-md bg-background hover:border-primary/40 transition-colors group relative overflow-hidden">
      {/* 右上アクション群（ホバーで表示） */}
      <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {entry.type === "url" && (
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="bg-background/80 hover:bg-background text-muted-foreground hover:text-primary rounded-full w-5 h-5 flex items-center justify-center transition-colors"
            title={t("asset.urlOpen")}
          >
            <ExternalLink size={12} />
          </a>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry); }}
          className="bg-background/80 hover:bg-destructive hover:text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs transition-colors"
          title={t("common.delete")}
        >
          ✕
        </button>
      </div>

      {/* サムネイル（クリックでモーダル表示） */}
      <button
        onClick={() => onOpenDetail(entry)}
        className="block w-full cursor-pointer"
      >
        <MediaThumbnail entry={entry} />
      </button>

      {hasVisualThumbnail ? (
        // ホバー時のファイル名オーバーレイ
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/75 via-black/55 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <p className="text-xs font-medium text-white truncate" title={entry.name}>
            {entry.name}
          </p>
        </div>
      ) : (
        // ファイル名常時表示帯
        <div className="px-2 py-1.5 border-t border-border-subtle">
          <p className="text-xs font-medium text-foreground truncate" title={entry.name}>
            {entry.name}
          </p>
        </div>
      )}
    </div>
  );
}

export type AssetGalleryViewProps = {
  mediaIndex: MediaIndex | null;
  mediaType: MediaType;
  /** AI が使えるか（バックエンド到達 + モデル登録済み）。false なら Full view の
   *  AI チャットタブ等を隠す。AI 系コールバック（onIngestMedia 等）の undefined
   *  ガードとは別に、Provider 経由で子の AI UI 表示を制御する。 */
  aiAvailable?: boolean;
  onBack: () => void;
  onNavigateNote: (noteId: string) => void;
  onDeleteMedia: (entry: MediaIndexEntry) => Promise<void>;
  /** 素材をアーカイブ（削除ダイアログの推奨アクション）。未指定なら従来の削除2択 */
  onArchiveMedia?: (entry: MediaIndexEntry) => void;
  /** 素材を参照している版スナップショット数のオンデマンド集計（削除ダイアログ用） */
  countSnapshotRefs?: (entry: MediaIndexEntry) => Promise<number>;
  onRenameMedia: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  /**
   * 素材のフォルダ（noteContexts）を保存する。渡されたときだけ付与 UI を出す。
   * ノートと同じフォルダ体系を共有する。
   */
  onSetMediaContexts?: (fileId: string, contexts: string[]) => Promise<void> | void;
  /** ノート側で使われているフォルダ名（付与ピッカーの候補に混ぜる。体系を共有するため） */
  noteFolders?: readonly string[];
  /**
   * ノート id → そのノートのフォルダ。素材が使われているノートのフォルダを
   * 「その素材のフォルダ」として導出するために使う（保存はしない）。
   */
  noteFolderLookup?: NoteFolderLookup;
  /** URL ブックマーク登録コールバック（type === "url" のときのみ使用） */
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  /** ファイル直接アップロード（image/video/audio/pdf/document、ノート非経由） */
  onUploadMedia?: (file: File) => Promise<string>;
  /** 投入口の受け皿から直接渡されたファイル群を取り込む（素材が 1 件も無いときの初回受け皿用） */
  onIntakeFiles?: (files: IntakeFile[], source: IntakeSource) => void;
  /** メディアから Knowledge を生成（URL/PDF 用） */
  onIngestMedia?: (entry: MediaIndexEntry) => void;
  /** URL から PROV ラベル付きノートを生成する（URL エントリー限定） */
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /** PDF を原文構成のまま UI 言語へ全文翻訳して 1 ノート化する（PDF 限定） */
  onTranslatePdf?: (entry: MediaIndexEntry) => void;
  /** アセットグラフの利用ノードクリックで、離脱せず右に SidePeek でノートを開く */
  onOpenNoteInSidePeek?: (noteId: string) => void;
  /** 開くノートサイドピークの noteId。指定時は PDF を Full view にして右パネルの左に並べる */
  notePeekId?: string | null;
  /** notePeekId のノートサイドピーク要素を生成する（呼び出し側で SidePeek を組み立てる） */
  renderNotePeek?: (noteId: string) => ReactNode;
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
  /** Word (.docx) 素材の埋め込み画像を子素材として抽出する */
  onExtractDocxImages?: (
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
   * 「一覧に戻せ」というシグナル。値が変わるたびに開きっぱなしの SidePeek / Full view を
   * 畳んで一覧表示へ戻す。note-app の closeAllViews から渡される。
   * 素材タイプの切替は mediaType 変化で畳めるが、**同じタイプを押し直した場合**は
   * mediaType も変わらず再マウントもされないため、親から畳む手段がこれしかない
   * （例: ドキュメントを Full view で開いた状態でサイドバーの「ドキュメント」を押す →
   * 従来は無反応に見えていた）。
   */
  backToListSeq?: number;
  /**
   * PDF text-layer の選択を新規メモとして保存する。
   * note-app から渡される。AssetGalleryView はノートを開かないため、
   * 引用は「メモに保存」の 1 ステップに揃えた（後でメモピッカーから任意のノートに引用できる）。
   */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
  /** URL Reader で表示中の記事画像を Graphium の画像アセットとして保存する（note-app から渡される） */
  onSaveImageAsAsset?: (imageUrl: string, sourceEntry: MediaIndexEntry) => Promise<void>;
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

// 素材タイプごとの表示モード（gallery / list）。
// 画像・動画はサムネイルが情報になるのでギャラリー、それ以外（URL・PDF・
// ドキュメント・音声など）はサムネイルが判別の役に立たないのでリストを
// デフォルトにする。ユーザーがタイプ別にトグルした選択は localStorage に記憶する。
type AssetViewMode = "gallery" | "list";
const ASSET_VIEW_MODE_KEY = "graphium:assetViewModeByType";

function defaultViewModeFor(type: MediaType): AssetViewMode {
  return type === "image" || type === "video" ? "gallery" : "list";
}

function loadViewModeMap(): Partial<Record<MediaType, AssetViewMode>> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(ASSET_VIEW_MODE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// そのタイプの保存値（あれば）を優先し、無ければタイプ別デフォルトを返す
function resolveViewMode(type: MediaType): AssetViewMode {
  const stored = loadViewModeMap()[type];
  return stored === "gallery" || stored === "list" ? stored : defaultViewModeFor(type);
}

function persistViewMode(type: MediaType, mode: AssetViewMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    const map = loadViewModeMap();
    map[type] = mode;
    localStorage.setItem(ASSET_VIEW_MODE_KEY, JSON.stringify(map));
  } catch {
    // no-op
  }
}

export function AssetGalleryView({
  mediaIndex,
  mediaType,
  aiAvailable = true,
  onBack,
  onNavigateNote,
  onDeleteMedia,
  onArchiveMedia,
  countSnapshotRefs,
  onRenameMedia,
  onSetMediaContexts,
  noteFolders,
  noteFolderLookup,
  onAddUrlBookmark,
  onUploadMedia,
  onIntakeFiles,
  onIngestMedia,
  onCreateProvNote,
  onTranslatePdf,
  onOpenNoteInSidePeek,
  notePeekId,
  renderNotePeek,
  resolveKnowledgeWikiId,
  onSharedRefUpdated,
  onExtractPdfPages,
  onExtractDocxImages,
  getKnowledgeKind,
  focusFileId,
  focusFullMode,
  onFocusConsumed,
  backToListSeq,
  onSaveSelectionAsMemo,
  onSaveImageAsAsset,
  captureIndex,
  onDeleteMemo,
  onCreateMemoForAsset,
}: AssetGalleryViewProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("uploadedAt");
  const [sortAsc, setSortAsc] = useState(false);
  // Documents タブのサブフィルタ（PDF / Word / All）
  const [docFilter, setDocFilter] = useState<"all" | "pdf" | "word">("all");
  // フォルダでの絞り込み（ノートと同じ体系。UNFILED_PATH は「フォルダに入っていない素材」）
  const [folderFilter, setFolderFilter] = useState<string[]>([]);
  // 素材が属するフォルダ（自分で付けたもの + 使われているノートのフォルダ）を求める。
  // 参照表が渡らない文脈（Storybook など）では自分で付けた分だけになる。
  const emptyLookup = useMemo(() => new Map<string, readonly string[]>(), []);
  const foldersOf = useCallback(
    (entry: MediaIndexEntry) => resolveAssetFolders(entry, noteFolderLookup ?? emptyLookup),
    [noteFolderLookup, emptyLookup],
  );
  const [folderFilterOpen, setFolderFilterOpen] = useState(false);
  // 選択した素材へのフォルダ付与（ノート一覧の一括付与と同じ ContextTagPicker）
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPos, setAssignPos] = useState({ top: 0, left: 0 });
  const [assignApplied, setAssignApplied] = useState<string[]>([]);
  const assignBtnRef = useRef<HTMLButtonElement>(null);
  const [folderFilterPos, setFolderFilterPos] = useState({ top: 0, left: 0 });
  const folderFilterBtnRef = useRef<HTMLButtonElement>(null);
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
    // タブ切替時に Documents サブフィルタもリセット
    setDocFilter("all");
  }, [mediaType]);

  // 親（note-app の closeAllViews）から「一覧に戻せ」と言われたら畳む。
  // 同じ素材タイプを押し直したときは mediaType が変わらず上の effect が走らないため、
  // seq の変化で検知する。これが無いと Full view のまま
  // 「サイドバーの素材カテゴリを押しても無反応」になる。
  // 初回マウント時も 1 度走るが detailEntry は null なので無害。
  // focus 反映（下の effect）より前に置く: 素材ピークの最大化は
  // closeAllViews() → setActiveAssetType() → setFocusedMaterial() の順で来るので、
  // declaration 順で「畳んでから開く」を保証する。
  useEffect(() => {
    if (backToListSeq === undefined) return;
    setDetailEntry(null);
    setDetailFullMode(false);
  }, [backToListSeq]);
  // この修正より前に登録された URL ブックマークは hero 画像をローカルに持たない。
  // ギャラリーを開いたタイミングで少しずつ後追い取得する（セッション 1 回・件数と
  // 間隔で絞る）。取れなければ favicon 表示のままで、remote URL は描かない。
  useEffect(() => {
    startPreviewBackfill(mediaIndex);
  }, [mediaIndex]);

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

  // ノートサイドピークを開くときは PDF を Full view にする（右パネルの左に並べるため）。
  // MaterialSidePeek にはノートピークを並べる場所が無いため。
  useEffect(() => {
    if (notePeekId && detailEntry && !detailFullMode) {
      setDetailFullMode(true);
    }
  }, [notePeekId, detailEntry, detailFullMode]);
  // デスクトップはサイドピークを inline（flex 兄弟）で並べてギャラリーをリフローさせ、
  // モバイルは従来どおり overlay（portal fixed）で被せる — エディタ画面と同じ方針
  const isDesktop = useIsDesktop();
  const [showUrlModal, setShowUrlModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // ビュー切替（gallery / list）— 素材タイプごとに既定値と選択を持つ
  const [viewMode, setViewMode] = useState<AssetViewMode>(() => resolveViewMode(mediaType));
  // タブ（mediaType）切替時は、そのタイプの保存値（無ければタイプ別デフォルト）に追従する
  useEffect(() => {
    setViewMode(resolveViewMode(mediaType));
  }, [mediaType]);
  // ユーザーが明示的にトグルしたときだけ、そのタイプの選択を保存する
  const changeViewMode = useCallback(
    (mode: AssetViewMode) => {
      setViewMode(mode);
      persistViewMode(mediaType, mode);
    },
    [mediaType],
  );
  // 複数選択（list モードのみで利用）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkExtracting, setBulkExtracting] = useState(false);
  // 一括 OCR の進捗（何件目まで終わったか）。null なら実行していない。
  const [bulkOcr, setBulkOcr] = useState<{ done: number; total: number } | null>(null);
  // 一括 OCR の右下トースト（自動 OCR と同じ見た目）。ボタンの進捗表示だけだと、
  // 詰まったのか終わったのか分からない
  const [bulkOcrToast, setBulkOcrToast] = useState<OcrToastState>(null);

  // ⋯ ハンバーガーメニュー（Documents タブ用）
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // 単一素材のダウンロード（共通ヘルパー）
  // 注意: getMediaBlobUrl は既にキャッシュ済みの blob: URL を返す（local/server-fs プロバイダ）。
  // それを更に fetch → blob → createObjectURL すると同じデータを 2 重にメモリへ載せて
  // 大きいファイルでブラウザがフリーズする。同一オリジン (blob:) なら直接 a.download に渡す。
  // 外部 URL (Drive CDN 等) の場合のみ fetch 経由の fallback を使う。
  const downloadEntry = useCallback(async (entry: MediaIndexEntry) => {
    if (entry.type === "url") return;
    const provider = getActiveProvider();
    const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
    const blobUrl = await provider.getMediaBlobUrl(fileId);

    let href = blobUrl;
    let createdObjectUrl: string | null = null;
    if (!blobUrl.startsWith("blob:")) {
      // 外部 URL: download 属性が効かないので一度 fetch して objectURL を作る
      const res = await fetch(blobUrl);
      const blob = await res.blob();
      href = URL.createObjectURL(blob);
      createdObjectUrl = href;
    }

    const a = document.createElement("a");
    a.href = href;
    a.download = entry.name || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (createdObjectUrl) {
      setTimeout(() => URL.revokeObjectURL(createdObjectUrl!), 1000);
    }
  }, []);

  const acceptByType: Record<MediaType, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
    pdf: "application/pdf",
    url: "",
    // Documents タブは PDF + Word/Excel/PowerPoint を受ける
    document: ".docx,.doc,.xlsx,.xls,.pptx,.ppt,.pdf",
    // 装置の生データ。ここに置いた素材は本文へ挿入するときに
    // 取り込みダイアログを通って表になる
    data: DELIMITED_FILE_ACCEPT,
    // memo は transient なピーク専用タイプ（アップロード経路には現れない）
    memo: "",
    other: "",
  };

  const handleFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !onUploadMedia) return;
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          // onUploadMedia が返すのは保存先 URL（fileId ではない）。
          // media-index は fileId で引くので、ここで URL から取り出す。
          const url = await onUploadMedia(file);
          if (!file.type.startsWith("image/")) continue;
          const fileId = getActiveProvider().extractFileId(url);
          if (!fileId) continue;
          // 画像はその場で文字も読み取る。後から一括 OCR もできるが、
          // 入れた時点で読めていれば検索にすぐ乗る。読み取りは手元の File から
          // 直接行う（保存先 URL の解決を待たずに済む）。
          try {
            const result = await runOcrForImage(file);
            await persistOcrTextPatch(fileId, result.text);
          } catch (err) {
            // 読めなくてもアップロード自体は成功しているので流す
            console.warn("[asset-gallery] アップロード時の OCR に失敗:", file.name, err);
          }
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
  // Documents タブには PDF も含める（UI 上の統合。内部 type は維持）。
  // docFilter が "pdf" / "word" のときはサブフィルタを適用する。
  const filtered = useMemo(() => {
    if (!mediaIndex) return [];
    let result = mediaIndex.media.filter((m) => {
      if (m.archivedAt) return false;
      if (mediaType !== "document") return m.type === mediaType;
      if (docFilter === "pdf") return m.type === "pdf";
      if (docFilter === "word") return m.type === "document";
      return m.type === "document" || m.type === "pdf";
    });
    // フォルダ絞り込み（OR・小文字比較）。ノート一覧の文脈フィルタと同じ規則にそろえる
    if (folderFilter.length > 0) {
      const wantsUnfiled = folderFilter.includes(UNFILED_PATH);
      const set = new Set(
        folderFilter.filter((c) => c !== UNFILED_PATH).map((c) => c.toLowerCase()),
      );
      result = result.filter((m) => {
        // 導出込み。ノートに貼っただけの素材も、そのノートのフォルダで拾える
        const all = assetFolderValues(m, noteFolderLookup ?? emptyLookup);
        if (wantsUnfiled && all.length === 0) return true;
        return all.some((c) => set.has(c.trim().toLowerCase()));
      });
    }
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
  }, [mediaIndex, mediaType, searchQuery, sortKey, sortAsc, docFilter, folderFilter, noteFolderLookup, emptyLookup]);

  // フォルダ絞り込みの選択肢。いま見ている種類の素材に実際に付いているものだけ出す
  // （空振りする候補を並べない）。未分類は件数が 1 件以上あるときだけ足す。
  const folderFilterOptions = useMemo<FilterOption[]>(() => {
    if (!mediaIndex) return [];
    const inScope = mediaIndex.media.filter((m) => {
      if (m.archivedAt) return false;
      if (mediaType !== "document") return m.type === mediaType;
      return m.type === "document" || m.type === "pdf";
    });
    const counts = aggregateNoteContexts(
      inScope.map((m) => ({ noteContexts: assetFolderValues(m, noteFolderLookup ?? emptyLookup) })),
    );
    const options: FilterOption[] = counts.map(({ value, count }) => ({
      value,
      label: value,
      count,
      icon: (
        <span
          className="block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: `hsl(${noteContextHue(value)} 45% 45%)` }}
        />
      ),
    }));
    const unfiled = inScope.filter(
      (m) => assetFolderValues(m, noteFolderLookup ?? emptyLookup).length === 0,
    ).length;
    if (unfiled > 0) {
      options.push({ value: UNFILED_PATH, label: t("nav.unfiled"), count: unfiled });
    }
    return options;
  }, [mediaIndex, mediaType, t, noteFolderLookup, emptyLookup]);

  // その素材が属するフォルダ（自分で付けたもの + 使われているノートのフォルダ）。
  // 参照表が渡らない文脈（Storybook など）では自分で付けた分だけになる。
  // 付与ピッカーの候補。素材に付いているものと、ノート側のフォルダの両方から集める
  // （体系を共有しているので、ノートで使っているフォルダに素材も入れられるべき）。
  const assignSuggestions = useMemo(
    () =>
      aggregateNoteContexts([
        ...(mediaIndex?.media ?? []),
        ...(noteFolders ?? []).map((value) => ({ noteContexts: [value] })),
      ]),
    [mediaIndex, noteFolders],
  );

  // Documents タブのサブフィルタ用件数
  const docCounts = useMemo(() => {
    if (!mediaIndex) return { pdf: 0, word: 0, all: 0 };
    let pdf = 0;
    let word = 0;
    for (const m of mediaIndex.media) {
      if (m.archivedAt) continue;
      if (m.type === "pdf") pdf++;
      else if (m.type === "document") word++;
    }
    return { pdf, word, all: pdf + word };
  }, [mediaIndex]);

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

  // 削除対象が決まったら、版スナップショット内の参照をオンデマンドで数える。
  // usedIn（ノート参照）は entry に同期値で載っているが、版は listFiles 外で
  // usedIn スキャンに含まれないため、ダイアログを開いた瞬間に走査する。
  const [snapshotRefCount, setSnapshotRefCount] = useState<number | null>(null);
  useEffect(() => {
    if (!deleteTarget || !countSnapshotRefs) {
      setSnapshotRefCount(deleteTarget ? 0 : null);
      return;
    }
    let cancelled = false;
    setSnapshotRefCount(null);
    countSnapshotRefs(deleteTarget)
      .then((n) => {
        if (!cancelled) setSnapshotRefCount(n);
      })
      .catch(() => {
        if (!cancelled) setSnapshotRefCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [deleteTarget, countSnapshotRefs]);

  const handleArchiveConfirm = useCallback(() => {
    if (!deleteTarget || !onArchiveMedia) return;
    onArchiveMedia(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, onArchiveMedia]);

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
  // Documents タブも一括 Knowledge 化対象（中の PDF/Word は onIngestMedia 側で分岐）
  const bulkActionable = mediaType === "url" || mediaType === "pdf" || mediaType === "document";
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

  // 一括ダウンロード: 選択中の素材を順次保存（URL ブックマークは除外）
  const downloadableSelectedCount = useMemo(
    () =>
      filtered.filter((e) => selectedIds.has(e.fileId) && e.type !== "url").length,
    [filtered, selectedIds],
  );
  const handleBulkDownload = useCallback(async () => {
    const targets = filtered.filter((e) => selectedIds.has(e.fileId) && e.type !== "url");
    if (targets.length === 0) return;
    setBulkDownloading(true);
    try {
      for (const entry of targets) {
        try {
          await downloadEntry(entry);
        } catch (err) {
          console.error("[asset-gallery] ダウンロード失敗:", entry.name, err);
        }
        // 連続するダウンロードプロンプトが抑制されないよう少し待つ
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      setBulkDownloading(false);
    }
  }, [downloadEntry, filtered, selectedIds]);

  // 一括埋め込み画像抽出: 選択中の PDF / Word (.docx) のうち、
  // まだ画像を抽出していないものだけを対象にする（重複抽出でゴミが増えるのを防ぐ）。
  const isBulkExtractTarget = useCallback(
    (e: MediaIndexEntry) =>
      canExtractEmbeddedImages(e) && !!mediaIndex && !hasExtractedImages(e, mediaIndex),
    [mediaIndex],
  );
  const extractableSelectedCount = useMemo(
    () => filtered.filter((e) => selectedIds.has(e.fileId) && isBulkExtractTarget(e)).length,
    [filtered, selectedIds, isBulkExtractTarget],
  );
  const handleBulkExtractImages = useCallback(async () => {
    const targets = filtered.filter(
      (e) => selectedIds.has(e.fileId) && isBulkExtractTarget(e),
    );
    if (targets.length === 0) return;
    setBulkExtracting(true);
    try {
      // 順次実行（各 entry が内部で画像を順次アップロードするため、並列だと
      // mediaIndex の race が起きうる）。個別の進捗トーストは各ハンドラ側に任せる。
      for (const entry of targets) {
        try {
          if (entry.type === "pdf" && onExtractPdfPages) {
            await onExtractPdfPages(entry, () => {});
          } else if (entry.type === "document" && onExtractDocxImages) {
            await onExtractDocxImages(entry, () => {});
          }
        } catch (err) {
          console.error("[asset-gallery] 画像抽出失敗:", entry.name, err);
        }
      }
      setSelectedIds(new Set());
    } finally {
      setBulkExtracting(false);
    }
  }, [filtered, selectedIds, isBulkExtractTarget, onExtractPdfPages, onExtractDocxImages]);

  // 一括 OCR（画像のみ）。選択した画像の文字を順に読み取り、素材側に保存する。
  // 順次実行なのは media-index の書き戻しが競合しないようにするため（一括削除・
  // 一括画像抽出と同じ理由）。OCR 自体も worker 1 つを直列で使う。
  // 既に読み取り済みの画像も対象に含める（選んだものは読み直す、が素直な期待）。
  const ocrableSelected = useMemo(
    () => filtered.filter((e) => selectedIds.has(e.fileId) && e.type === "image"),
    [filtered, selectedIds],
  );
  const handleBulkOcr = useCallback(async () => {
    if (ocrableSelected.length === 0) return;
    const total = ocrableSelected.length;
    setBulkOcr({ done: 0, total });
    setBulkOcrToast({ running: total, chars: 0, empty: 0, failed: 0 });
    let chars = 0;
    let empty = 0;
    let failed = 0;
    // 連続でタイムアウト（宙吊り）したら、残りを 1 件ずつ 120s 待つのは無意味なので
    // 打ち切る。recognizeImage が 1 回目のタイムアウトで worker を作り直しているので、
    // 2 回続けば「作り直しても動かない」＝この環境では今は読めない、と判断する。
    let consecutiveTimeouts = 0;
    let aborted = false;
    try {
      for (const [i, entry] of ocrableSelected.entries()) {
        try {
          const result = await runOcrForImage(entry.url);
          await persistOcrTextPatch(entry.fileId, result.text);
          consecutiveTimeouts = 0;
          if (result.text) chars += result.text.replace(/\s/g, "").length;
          else empty += 1;
        } catch (err) {
          console.error("[asset-gallery] OCR 失敗:", entry.name, err);
          failed += 1;
          if (err instanceof OcrTimeoutError && ++consecutiveTimeouts >= BULK_OCR_MAX_CONSECUTIVE_TIMEOUTS) {
            aborted = true;
          }
        }
        setBulkOcr({ done: i + 1, total });
        setBulkOcrToast({ running: total - (i + 1), chars, empty, failed });
        if (aborted) break;
      }
      if (!aborted) setSelectedIds(new Set());
    } finally {
      setBulkOcr(null);
      setBulkOcrToast({ running: 0, chars, empty, failed });
    }
  }, [ocrableSelected]);

  // タイプ別の表示名
  const typeLabel = t(`asset.type.${mediaType}`);

  // Full view 中はギャラリーを完全に置き換える（左ナビは外側に残るので独立して見える）
  if (detailEntry && detailFullMode) {
    // 素材全画面ビューの AI チャットタブ用に、素材ビュー専用の AiAssistantProvider で
    // ラップする。ノート編集の Provider（ノートごとに分離）とは独立した会話ストアになる。
    // 会話は素材ごとに appdata へ保存される（asset-chat-store）ので、素材が変わったら
    // fileId を key にストアごと作り直す（前の素材の会話が次の素材のファイルへ
    // 書き込まれるのを防ぐ。ノート切替でサイドピークを remount するのと同じ理由）。
    return (
      <AiAssistantProvider key={detailEntry.fileId} aiAvailable={aiAvailable}>
      <MaterialFullView
        noteFolderLookup={noteFolderLookup}
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
        onTranslatePdf={onTranslatePdf}
        onOpenNoteInSidePeek={onOpenNoteInSidePeek}
        noteSidePeek={notePeekId && renderNotePeek ? renderNotePeek(notePeekId) : null}
        knowledgeWikiNoteId={resolveKnowledgeWikiId?.(detailEntry)}
        onSharedRefUpdated={async (entry, sharedRef) => {
          setDetailEntry({ ...entry, sharedRef });
          if (onSharedRefUpdated) await onSharedRefUpdated(entry, sharedRef);
        }}
        onExtractPdfPages={onExtractPdfPages}
        onExtractDocxImages={onExtractDocxImages}
        mediaIndex={mediaIndex}
        getKnowledgeKind={getKnowledgeKind}
        onSwitchAsset={(nextEntry) => setDetailEntry(nextEntry)}
        onDelete={(entry) => setDeleteTarget(entry)}
        onSaveSelectionAsMemo={onSaveSelectionAsMemo}
        onSaveImageAsAsset={onSaveImageAsAsset}
        captureIndex={captureIndex}
        onDeleteMemo={onDeleteMemo}
        onCreateMemo={
          onCreateMemoForAsset
            ? (text) => onCreateMemoForAsset(detailEntry, text)
            : undefined
        }
      />
      </AiAssistantProvider>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-background">
      {/* 一括 OCR の進行・結果トースト（fixed なのでレイアウトに影響しない） */}
      <OcrToast state={bulkOcrToast} />
      {/* ギャラリー本体（縦 flex）。デスクトップでサイドピークが inline で並ぶと残り幅にリフローする */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          {/* サイドピークが inline で並んで狭くなっても縦折れしないよう nowrap にする */}
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            {t("common.back")}
          </button>
          <h1 className="text-base font-semibold text-foreground whitespace-nowrap shrink-0">{typeLabel}</h1>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {t("asset.count", { count: String(filtered.length) })}
          </span>
          {mediaType === "url" && onAddUrlBookmark && (
            <button
              onClick={() => setShowUrlModal(true)}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <Plus size={12} />
              {t("asset.urlAdd")}
            </button>
          )}
          {mediaType === "document" && onUploadMedia && (
            <div className="ml-auto relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                disabled={uploading}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title={t("common.menu")}
                aria-label={t("common.menu")}
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-60 bg-popover border border-border rounded-lg shadow-md py-1 z-50">
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors disabled:text-muted-foreground"
                    onClick={() => { setMenuOpen(false); docxInputRef.current?.click(); }}
                    disabled={uploading}
                    title={t("asset.uploadDocxHint")}
                  >
                    <Plus size={14} />
                    {uploading ? t("asset.uploading") : t("asset.uploadDocx")}
                  </button>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors disabled:text-muted-foreground"
                    onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }}
                    disabled={uploading}
                    title={t("asset.uploadPdfHint")}
                  >
                    <Plus size={14} />
                    {uploading ? t("asset.uploading") : t("asset.uploadPdf")}
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed"
                    onClick={() => { setMenuOpen(false); void handleBulkDownload(); }}
                    disabled={downloadableSelectedCount === 0 || bulkDownloading}
                    title={
                      downloadableSelectedCount === 0
                        ? t("asset.downloadSelectedHint")
                        : undefined
                    }
                  >
                    <Download size={14} />
                    {bulkDownloading
                      ? t("asset.downloading")
                      : downloadableSelectedCount > 0
                        ? t("asset.downloadSelectedWithCount", { count: String(downloadableSelectedCount) })
                        : t("asset.downloadSelected")}
                  </button>
                </div>
              )}
              <input
                ref={docxInputRef}
                type="file"
                accept=".docx"
                multiple
                onChange={handleFilePicked}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                onChange={handleFilePicked}
                className="hidden"
              />
            </div>
          )}
          {mediaType !== "url" && mediaType !== "document" && onUploadMedia && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60 whitespace-nowrap shrink-0"
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


        {/* 検索バー + サブフィルタ + ソート */}
        <div className="px-6 py-2 border-b border-border flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("asset.search")}
            className="w-full max-w-xs text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
          {/* Documents タブのサブフィルタ（PDF / Word / All） */}
          {mediaType === "document" && (
            <div className="flex items-center gap-1">
              {([
                { key: "all" as const, label: t("asset.docFilter.all"), count: docCounts.all },
                { key: "pdf" as const, label: t("asset.docFilter.pdf"), count: docCounts.pdf },
                { key: "word" as const, label: t("asset.docFilter.word"), count: docCounts.word },
              ]).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setDocFilter(key)}
                  className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
                    docFilter === key
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                  <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
                </button>
              ))}
            </div>
          )}
          {/* フォルダ絞り込み。ノートと同じ体系なので、一覧の「フォルダ」列と同じ見え方にする */}
          {folderFilterOptions.length > 0 && (
            <button
              ref={folderFilterBtnRef}
              onClick={() => {
                const rect = folderFilterBtnRef.current?.getBoundingClientRect();
                if (rect) setFolderFilterPos({ top: rect.bottom + 4, left: rect.left });
                setFolderFilterOpen((v) => !v);
              }}
              title={t("nav.filterContexts")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full transition-colors ${
                folderFilter.length > 0
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Folder size={12} />
              <span>{t("nav.folders")}</span>
              {folderFilter.length > 0 && (
                <span className="text-[10px] opacity-70">({folderFilter.length})</span>
              )}
            </button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {/* ソートボタンは gallery モード専用（list モードは列ヘッダのクリックで揃える） */}
            {viewMode === "gallery" && (
              <>
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
              </>
            )}
            {/* ビュー切替 */}
            <div className="ml-2 inline-flex rounded border border-border overflow-hidden">
              <button
                onClick={() => changeViewMode("gallery")}
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
                onClick={() => changeViewMode("list")}
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
              {onSetMediaContexts && (
                <button
                  ref={assignBtnRef}
                  onClick={() => {
                    const rect = assignBtnRef.current?.getBoundingClientRect();
                    if (rect) setAssignPos({ top: rect.bottom + 4, left: rect.left - 120 });
                    setAssignApplied([]);
                    setAssignOpen(true);
                  }}
                  className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                  title={t("nav.applyContextsTooltip")}
                >
                  <Folder size={12} />
                  {t("nav.applyContexts", { count: String(selectedIds.size) })}
                </button>
              )}
              {bulkActionable && onIngestMedia && (
                <button
                  onClick={handleBulkIngest}
                  className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                  title={t("asset.bulkIngestTitle")}
                >
                  <Bot size={12} />
                  {t("asset.bulkIngest", { count: String(selectedIds.size) })}
                </button>
              )}
              {bulkActionable && onCreateProvNote && (
                <button
                  onClick={handleBulkCreateProvNote}
                  className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                  title={t("asset.bulkCreateProvNoteTitle")}
                >
                  <Bot size={12} />
                  {t("asset.bulkCreateProvNote", { count: String(selectedIds.size) })}
                </button>
              )}
              {ocrableSelected.length > 0 && (
                <button
                  onClick={() => void handleBulkOcr()}
                  disabled={!!bulkOcr}
                  className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
                  title={t("asset.bulkOcrTitle")}
                >
                  {bulkOcr ? <Loader2 size={12} className="animate-spin" /> : <ScanText size={12} />}
                  {bulkOcr
                    ? t("asset.bulkOcrRunning", {
                        done: String(bulkOcr.done),
                        total: String(bulkOcr.total),
                      })
                    : t("asset.bulkOcr", { count: String(ocrableSelected.length) })}
                </button>
              )}
              {extractableSelectedCount > 0 && (onExtractPdfPages || onExtractDocxImages) && (
                <button
                  onClick={() => void handleBulkExtractImages()}
                  disabled={bulkExtracting}
                  className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
                  title={t("asset.bulkExtractImagesTitle")}
                >
                  {bulkExtracting ? <Loader2 size={12} className="animate-spin" /> : <Images size={12} />}
                  {bulkExtracting
                    ? t("asset.pdfExtractImages.running")
                    : t("asset.bulkExtractImages", { count: String(extractableSelectedCount) })}
                </button>
              )}
              {downloadableSelectedCount > 0 && (
                <button
                  onClick={() => void handleBulkDownload()}
                  disabled={bulkDownloading}
                  className="px-3 py-1 text-xs font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
                  title={t("asset.downloadHint")}
                >
                  <Download size={12} />
                  {bulkDownloading
                    ? t("asset.downloading")
                    : t("asset.downloadSelectedWithCount", { count: String(downloadableSelectedCount) })}
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
            onIntakeFiles && mediaIndex && mediaIndex.media.length === 0 ? (
              <div className="py-10 max-w-[560px] mx-auto">
                <IntakeReceptacle lead={t("intake.emptyMaterialsLead")} onFilesSelected={onIntakeFiles} />
              </div>
            ) : (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">{t("asset.noMedia")}</p>
              </div>
            )
          ) : viewMode === "gallery" ? (
            // 列数はコンテナ幅に追従（サイドピークが inline で並ぶと自動で減る）。
            // モバイル（overlay 表示）はリフロー不要なので従来どおり 2 列固定
            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {filtered.map((entry) => (
                <MediaCard
                  key={entry.fileId}
                  entry={entry}
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
                    className="py-2 px-3 whitespace-nowrap cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("name")}
                  >
                    {t("asset.colName")}{sortKey === "name" && (sortAsc ? " ↑" : " ↓")}
                  </th>
                  <th
                    className="py-2 px-2 w-[88px] text-center whitespace-nowrap cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("usedIn")}
                    title={t("asset.colUsedIn")}
                  >
                    {t("asset.colUsedIn")}{sortKey === "usedIn" && (sortAsc ? " ↑" : " ↓")}
                  </th>
                  <th
                    className="py-2 pl-3 w-[140px] whitespace-nowrap cursor-pointer hover:text-foreground"
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
                      <td className="py-2 px-3 max-w-0 w-full">
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
                        {/* この素材が入っているフォルダ。ノートと同じ体系なので、
                            ノート一覧のフォルダ列と同じ ContextBadge で見せる */}
                        {foldersOf(entry).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {foldersOf(entry).map((f) => (
                              <ContextBadge
                                key={f.value}
                                value={f.value}
                                // ノート由来は薄く出す。外すならノート側、という違いを見せる
                                className={f.derived ? "opacity-60" : undefined}
                              />
                            ))}
                          </div>
                        )}
                        {entry.type === "url" && entry.urlMeta?.domain && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {entry.urlMeta.domain}
                          </p>
                        )}
                        {entry.type === "url" && (entry.urlMeta?.excerpt || entry.urlMeta?.description) && (
                          <p
                            className="text-[10px] text-muted-foreground truncate mt-0.5 italic"
                            title={entry.urlMeta.excerpt || entry.urlMeta.description}
                          >
                            {entry.urlMeta.excerpt || entry.urlMeta.description}
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
            usedInCount={deleteTarget.usedIn.length}
            snapshotRefCount={snapshotRefCount}
            onConfirm={handleDeleteConfirm}
            onArchive={onArchiveMedia ? handleArchiveConfirm : undefined}
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

      {/* メディア詳細: サイドピーク。デスクトップは inline flex item（ギャラリーが縮んでリフローし、
          全サムネイルが触れる）、モバイルは overlay（portal fixed）。
          Full mode は早期 return で別ルートに渡す */}
      {detailEntry && (
        <MaterialSidePeek
          noteFolderLookup={noteFolderLookup}
          inline={isDesktop}
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
          onTranslatePdf={onTranslatePdf}
          onOpenNoteInSidePeek={onOpenNoteInSidePeek}
          knowledgeWikiNoteId={resolveKnowledgeWikiId?.(detailEntry)}
          onSharedRefUpdated={async (entry, sharedRef) => {
            setDetailEntry({ ...entry, sharedRef });
            if (onSharedRefUpdated) await onSharedRefUpdated(entry, sharedRef);
          }}
          onExtractPdfPages={onExtractPdfPages}
          onExtractDocxImages={onExtractDocxImages}
          mediaIndex={mediaIndex}
          getKnowledgeKind={getKnowledgeKind}
          onSwitchAsset={(nextEntry) => setDetailEntry(nextEntry)}
          onSaveSelectionAsMemo={onSaveSelectionAsMemo}
          onSaveImageAsAsset={onSaveImageAsAsset}
        />
      )}
      {assignOpen && onSetMediaContexts && (
        <ContextTagPicker
          position={assignPos}
          onClose={() => setAssignOpen(false)}
          suggestions={assignSuggestions}
          selected={assignApplied}
          onAdd={(value) => {
            // 選択中の素材すべてに足す（既に入っているものはそのまま）
            void (async () => {
              for (const fileId of selectedIds) {
                const entry = mediaIndex?.media.find((m) => m.fileId === fileId);
                if (!entry) continue;
                const next = addNoteContext(entry.noteContexts, value);
                await onSetMediaContexts(fileId, next ?? []);
              }
              setAssignApplied((prev) => (prev.includes(value) ? prev : [...prev, value]));
            })();
          }}
          onRemove={(value) => {
            void (async () => {
              for (const fileId of selectedIds) {
                const entry = mediaIndex?.media.find((m) => m.fileId === fileId);
                if (!entry) continue;
                const next = removeNoteContext(entry.noteContexts, value);
                await onSetMediaContexts(fileId, next ?? []);
              }
              setAssignApplied((prev) => prev.filter((v) => v !== value));
            })();
          }}
        />
      )}
      {folderFilterOpen && (
        <FilterPopup
          position={folderFilterPos}
          onClose={() => setFolderFilterOpen(false)}
          title={t("nav.folders")}
          options={folderFilterOptions}
          selected={folderFilter}
          onChange={setFolderFilter}
          searchPlaceholder={t("common.search")}
          clearLabel={t("nav.clearFilter")}
          noMatchText={t("nav.contextEmpty")}
          minWidth={220}
        />
      )}
    </div>
  );
}
