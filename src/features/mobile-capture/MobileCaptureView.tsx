// モバイル専用クイックキャプチャビュー
// メモ + メディア（画像・動画・音声）を時系列カードで表示 + キャプチャバー
//
// モバイル連携（実験フラグ）ON のときは、ホーム自体を「送信キュー前提」に組み替える:
// ヘッダーに接続状態チップ、コンテンツ最上部（ヘッダー直下）に未送信キュー
// （SendQueueSection。[送信 (n)] は見出し行右端の定位置。空なら畳む）、その下に
// 従来のメモ検索・タイムラインが 1 スクロールで続く。捕獲ボタンは従来ホームと同じ
// 画面下固定バー（MobileCaptureBar: [書く][URL][写真][動画][音声][ライブラリ]）。
// かつての SendToInboxSheet（ボトムシート）は廃止。メモ・URL もネイティブ JSON
// （capture-file.ts）でキュー行き（捕獲物は全部 Inbox へ。ローカルの capture-store
// には保存しない）。タイムラインは過去分の閲覧用として残る。
// フラグ OFF は従来のホームのまま一切変えない（既存ユーザーは無変化）。
// ヘッダー右端の ⚙ は両フラグ状態で出す — 設定は端末ごと（localStorage）なので、
// スマホ単体でフラグ切替・接続/切断・client_id 上書きに到達できる必要がある。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickyNote, Plus, Trash2, Camera, Video, Mic, Image, Volume2, Search, X, Link, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import { getFaviconUrl } from "../asset-browser/media-index";
import { MediaPreview } from "../asset-browser/media-preview";
import { UrlBookmarkModal } from "../asset-browser/UrlBookmarkModal";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";
import { CaptureDialog } from "./CaptureDialog";
import { MobileCaptureBar } from "./MobileCaptureBar";
import { SendQueueSection } from "./inbox/SendQueueSection";
import { usePushQueue } from "./inbox/use-push-queue";
import { useMobileInboxFlag } from "./inbox/experimental";
import { buildMemoCaptureFile, buildUrlCaptureFile } from "./inbox/capture-file";

// ── 統合タイムラインアイテム ──

type TimelineItem =
  | { kind: "memo"; entry: CaptureEntry; timestamp: string }
  | { kind: "media"; entry: MediaIndexEntry; timestamp: string };

// ── モバイル用メモ編集モーダル ──

function MobileMemoEditModal({
  entry,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: CaptureEntry;
  onClose: () => void;
  onEdit?: (captureId: string, newText: string) => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(entry.text);

  const handleSave = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === entry.text || !onEdit) {
      setEditing(false);
      setEditText(entry.text);
      return;
    }
    onEdit(entry.id, trimmed);
    setEditing(false);
  }, [editText, entry, onEdit]);

  // ESC で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[80dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <StickyNote size={16} className="text-primary shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              {formatRelativeTime(entry.createdAt)}
            </span>
            {entry.modifiedAt && (
              <span className="text-[10px] text-muted-foreground truncate">
                ({t("memo.modified")}: {formatRelativeTime(entry.modifiedAt)})
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onDelete && (
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-auto p-4">
          {editing ? (
            <div className="flex flex-col gap-3 h-full">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                autoFocus
                className="flex-1 w-full min-h-[120px] resize-none bg-background border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setEditing(false); setEditText(entry.text); }}
                  className="px-4 py-2 text-xs rounded-lg border border-border text-foreground active:bg-muted transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground active:opacity-80 transition-opacity"
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`${onEdit ? "cursor-pointer active:bg-muted/50 rounded-lg p-2 -m-2 transition-colors" : ""}`}
              onClick={() => { if (onEdit) setEditing(true); }}
            >
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {entry.text}
              </p>
              {onEdit && (
                <p className="text-[10px] text-muted-foreground mt-3">
                  {t("memo.clickToEdit")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── モバイル用メディアプレビューモーダル ──

function MobileMediaPreviewModal({
  entry,
  onClose,
}: {
  entry: MediaIndexEntry;
  onClose: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[85dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-medium text-foreground truncate">{entry.name}</p>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
        {/* プレビュー */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto bg-muted/30 min-h-[200px]">
          <MediaPreview entry={entry} />
        </div>
        {/* フッター情報 */}
        <div className="px-4 py-2 border-t border-border flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {entry.type === "url" ? entry.urlMeta?.domain ?? "" : entry.mimeType}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(entry.uploadedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// メモカード
function MemoCard({
  entry,
  onTap,
  onDelete,
}: {
  entry: CaptureEntry;
  onTap?: () => void;
  onDelete?: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className="relative bg-card border border-border rounded-lg p-3 transition-colors active:bg-muted/30 cursor-pointer"
      onClick={() => onTap?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowDelete((v) => !v);
      }}
    >
      <p className="text-sm text-foreground line-clamp-4 whitespace-pre-wrap mb-1.5">
        {entry.text}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {formatRelativeTime(entry.createdAt)}
      </p>
      {showDelete && onDelete && (
        <button
          className="absolute top-2 right-2 p-1.5 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
            setShowDelete(false);
          }}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

// メディアカード（サムネイル付き）
function MediaCard({ entry, onTap }: { entry: MediaIndexEntry; onTap?: () => void }) {
  // URL ブックマークカード
  if (entry.type === "url") {
    const domain = entry.urlMeta?.domain ?? "";
    return (
      <div
        className="bg-card border border-border rounded-lg overflow-hidden cursor-pointer active:bg-muted/30 transition-colors"
        onClick={() => onTap?.()}
      >
        <div className="w-full h-24 flex items-center justify-center bg-muted/50">
          <img
            src={getFaviconUrl(domain, 64)}
            alt=""
            className="w-10 h-10 rounded"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <div className="p-2">
          <p className="text-[11px] text-foreground truncate">{entry.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{domain}</p>
        </div>
      </div>
    );
  }

  const icon = entry.type === "video" ? <Video size={20} /> :
               entry.type === "audio" ? <Volume2 size={20} /> :
               <Image size={20} />;

  return (
    <div
      className="bg-card border border-border rounded-lg overflow-hidden cursor-pointer active:bg-muted/30 transition-colors"
      onClick={() => onTap?.()}
    >
      {entry.type === "image" ? (
        <img
          src={entry.thumbnailUrl}
          alt={entry.name}
          className="w-full h-24 object-cover bg-muted"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-24 flex items-center justify-center bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="p-2">
        <p className="text-[11px] text-foreground truncate">{entry.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatRelativeTime(entry.uploadedAt)}
        </p>
      </div>
    </div>
  );
}

export function MobileCaptureView({
  captureIndex,
  mediaIndex,
  loading,
  onCreateCapture,
  onDeleteCapture,
  onEditCapture,
  onUploadMedia,
  onAddUrlBookmark,
  onRefresh,
  creating,
}: {
  captureIndex: CaptureIndex | null;
  mediaIndex?: MediaIndex | null;
  loading: boolean;
  onCreateCapture: (text: string) => Promise<void>;
  onDeleteCapture?: (captureId: string) => Promise<void>;
  onEditCapture?: (captureId: string, newText: string) => void;
  onUploadMedia?: (file: File) => Promise<string>;
  onAddUrlBookmark?: (entry: MediaIndexEntry) => void;
  onRefresh?: () => Promise<void>;
  creating: boolean;
}) {
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [webShareError, setWebShareError] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<CaptureEntry | null>(null);
  const [mediaPreviewEntry, setMediaPreviewEntry] = useState<MediaIndexEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const pulling = useRef(false);
  const t = useT();

  // モバイル連携（実験フラグ・既定 OFF）。OFF の間は送信キュー経路を丸ごと隠し、
  // 撮ったものは従来どおりこの端末の素材ライブラリに保存する。設定のトグルで
  // 切り替わるとイベント経由でここも即時に再レンダリングされる（リロード不要）。
  const mobileInboxEnabled = useMobileInboxFlag();
  // 送信キュー（撮る → 即キュー永続化 → Google Drive の Graphium/Inbox へ直列送信。
  // Google 未設定なら Web Share フォールバック）。push/ は hook 内で動的 import される。
  // フラグ OFF の間は hook 自体が不活性（ロードも自動 drain もしない）。
  // 設定モーダルでの client_id 変更・接続・切断は push-events 経由で hook が読み直す
  // ので、常時見えているチップ・キューが古い状態のまま残ることはない。
  const push = usePushQueue(mobileInboxEnabled);
  // 撮ったものをキュー経路へ送れる環境か。false のときだけ従来のローカル保存に落ちる
  //（ユーザー決定: ローカル保存は「実験フラグ OFF」または「Google 未設定 かつ
  //  Web Share 不可」のみの退路）。
  const pushRouteAvailable =
    mobileInboxEnabled && push.ready && (push.configured || push.canWebShare);

  const PULL_THRESHOLD = 60;

  // Pull-to-Refresh ハンドラ
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.5, 100));
    } else {
      pulling.current = false;
      setPullDistance(0);
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= PULL_THRESHOLD && onRefresh && !refreshing) {
      setRefreshing(true);
      setPullDistance(0);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh, refreshing]);

  // メモ + メディアを時系列で統合
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    // メモ
    for (const entry of captureIndex?.captures ?? []) {
      // アーカイブ・ゴミ箱のメモはタイムラインに出さない
      if (entry.archivedAt || entry.deletedAt) continue;
      items.push({ kind: "memo", entry, timestamp: entry.createdAt });
    }
    // メディア（image, video, audio, url。PDF はスキップ）
    for (const entry of mediaIndex?.media ?? []) {
      if (entry.type === "image" || entry.type === "video" || entry.type === "audio" || entry.type === "url") {
        items.push({ kind: "media", entry, timestamp: entry.uploadedAt });
      }
    }
    // 新しい順
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  }, [captureIndex, mediaIndex]);

  // 検索フィルタ
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return timeline;
    const q = searchQuery.trim().toLowerCase();
    return timeline.filter((item) => {
      if (item.kind === "memo") return item.entry.text.toLowerCase().includes(q);
      if (item.kind === "media") return item.entry.name.toLowerCase().includes(q);
      return false;
    });
  }, [timeline, searchQuery]);

  // テキストメモ送信。
  // キュー前提ホーム（フラグ ON）ではメモも捕獲物 — ローカルの capture-store でなく
  // ネイティブ JSON（capture-file.ts）で送信キューへ積む。デスクトップの取り込みで
  // 本物のメモとして着地する。キュー経路が使えない環境だけ従来のローカル保存に退避する
  //（データを落とさない）。フラグ OFF は従来どおり。
  const enqueueForSend = push.enqueueForSend;
  const handleSubmit = useCallback(
    async (text: string) => {
      if (mobileInboxEnabled) {
        const queued = await enqueueForSend([buildMemoCaptureFile(text)]);
        if (queued) {
          setShowCaptureDialog(false);
          return;
        }
      }
      await onCreateCapture(text);
      setShowCaptureDialog(false);
    },
    [mobileInboxEnabled, enqueueForSend, onCreateCapture]
  );

  // URL ブックマーク登録。フラグ ON では UrlBookmarkModal の入力（タイトル・説明・
  // OGP はモバイル側で取得済み）をネイティブ JSON に写してキューへ。デスクトップは
  // 再取得せず、このメタのまま URL 素材を作る。キュー不可時は従来のローカル登録へ退避。
  const handleRegisterBookmark = useCallback(
    (entry: MediaIndexEntry) => {
      if (mobileInboxEnabled) {
        void enqueueForSend([
          buildUrlCaptureFile({
            url: entry.url,
            title: entry.name,
            description: entry.urlMeta?.description,
            ogImage: entry.urlMeta?.ogImage,
          }),
        ]).then((queued) => {
          if (!queued) onAddUrlBookmark?.(entry);
        });
        setShowBookmarkModal(false);
        return;
      }
      onAddUrlBookmark?.(entry);
      setShowBookmarkModal(false);
    },
    [mobileInboxEnabled, enqueueForSend, onAddUrlBookmark]
  );

  // 削除
  const handleDelete = useCallback(
    async (captureId: string) => {
      if (!onDeleteCapture) return;
      await onDeleteCapture(captureId);
    },
    [onDeleteCapture]
  );

  // メディアキャプチャ共通。
  // モバイル連携 ON では、撮ったものはこの端末に保存せず**送信キュー**へ直行させる
  //（完全置き換え。この端末のライブラリに貯めてもデスクトップへ渡る橋がなく袋小路のため）。
  // キューはホームに常時見えているので、enqueue 後に開くものは何もない —
  // アイテムがその場でキュー一覧に出現する。enqueue はジェスチャ非依存なので await
  // してよい。実験フラグ OFF、またはキュー経路が使えない環境（Google 未設定 かつ
  // Web Share 不可、または IndexedDB 不可）は従来のローカル保存に落とす。
  const handleCapturedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // フラグ OFF はキューに触れず即ローカル保存（hook 側の enabled ガードと二重の防波堤）
      const queued = mobileInboxEnabled ? await enqueueForSend(files) : false;
      if (queued) {
        setWebShareError(null);
        return;
      }
      if (!onUploadMedia) return;
      setUploading(true);
      try {
        await onUploadMedia(files[0]);
      } catch (err) {
        console.error("メディアアップロードに失敗:", err);
      } finally {
        setUploading(false);
      }
    },
    [mobileInboxEnabled, enqueueForSend, onUploadMedia]
  );

  // 従来ホーム（フラグ OFF）の下バー入力用。ON ではセクション側の入力が
  // handleCapturedFiles を直接受ける。
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // 同じものをもう一度撮り直し / 選び直しできるように毎回リセットする
      e.target.value = "";
      void handleCapturedFiles(files);
    },
    [handleCapturedFiles]
  );

  // 共有シートフォールバック（未設定モード）。shareViaWebShare は同期的に
  // navigator.share へ到達する必要がある（await を挟まない — user activation 契約）
  const shareViaWebShare = push.shareViaWebShare;
  const handleWebShare = useCallback(() => {
    setWebShareError(null);
    void shareViaWebShare().then((outcome) => {
      // cancelled（共有シートを閉じただけ）は何も出さない。エラー詳細は
      // 例外 message と同じく英語の技術文字列のまま {error} 枠に入れる
      if (outcome?.status === "failed") setWebShareError(outcome.error);
      if (outcome?.status === "unsupported") setWebShareError("files not shareable on this device");
    });
  }, [shareViaWebShare]);

  // note-app の共通イベントで設定モーダル（保存タブ）を開く
  const openStorageSettings = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("graphium-open-settings", { detail: { tab: "storage" } }),
    );
  }, []);

  // キュー経路が使える環境では、ローカル保存ハンドラが無くても撮れる
  const showMediaButtons = pushRouteAvailable || !!onUploadMedia;
  const mediaDisabled = !pushRouteAvailable && (!onUploadMedia || uploading);

  // 検索入力（従来ホームでは固定バー、キュー前提ホームではスクロール内に置く）
  const searchInput = (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t("memo.searchPlaceholder")}
        className="w-full text-xs pl-8 pr-8 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
      />
      {searchQuery && (
        <button
          onClick={() => setSearchQuery("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  // 接続状態チップ（キュー前提ホームのヘッダー）。表示だけ — 接続操作はキュー側の
  // ボタンが担う（connect はジェスチャ内同期呼び出しの契約があるため導線を一本化）。
  // push モジュールのロード前は暫定値しか無いので出さない（誤表示より一瞬の不在）。
  const pushConnected = push.configured && push.connected;
  const connectionChip = mobileInboxEnabled && push.ready && (
    <span
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] whitespace-nowrap ${
        pushConnected
          ? "border-green-600/30 bg-green-500/10 text-green-700 dark:text-green-400"
          : "border-border bg-muted/50 text-muted-foreground"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${pushConnected ? "bg-green-500" : "bg-muted-foreground/50"}`}
      />
      {!push.configured
        ? t("mobile.send.chipNotConfigured")
        : push.connected
          ? t("settings.mobilePush.statusConnected")
          : t("settings.mobilePush.statusDisconnected")}
    </span>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-6 h-6" />
          <h1 className="text-base font-semibold text-foreground">
            Graphium
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {loading
              ? t("common.loading")
              : t("memo.count", { count: String(filtered.length) })}
          </span>
          {connectionChip}
          {/* 設定入口（両フラグ状態で出す）。設定は端末ごと（localStorage）なので、
              スマホ単体でモバイル連携の ON/OFF・接続/切断・client_id に到達できる
              必要がある。開き先は該当トグルのある保存（storage）タブ。 */}
          <button
            onClick={openStorageSettings}
            aria-label={t("settings.title")}
            className="p-1.5 -mr-1.5 rounded-md text-muted-foreground active:bg-muted transition-colors"
          >
            <SettingsIcon size={17} />
          </button>
        </div>
      </div>

      {/* 検索バー（従来ホームのみ固定位置。キュー前提ホームではスクロール内に出す） */}
      {!mobileInboxEnabled && timeline.length > 0 && (
        <div className="px-3 py-2 border-b border-border">
          {searchInput}
        </div>
      )}

      {/* タイムライン一覧（Pull-to-Refresh 対応） */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-3 py-3"
        onTouchStart={onRefresh ? handleTouchStart : undefined}
        onTouchMove={onRefresh ? handleTouchMove : undefined}
        onTouchEnd={onRefresh ? handleTouchEnd : undefined}
      >
        {/* Pull-to-Refresh インジケーター */}
        {(pullDistance > 0 || refreshing) && (
          <div
            className="flex items-center justify-center transition-all duration-200"
            style={{ height: refreshing ? 40 : pullDistance, overflow: "hidden" }}
          >
            <RefreshCw
              size={18}
              className={`text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
              style={{ opacity: refreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1) }}
            />
          </div>
        )}

        {/* キュー前提ホーム: 未送信キューはコンテンツ最上部（ヘッダー直下）。
            [送信 (n)] は見出し行右端の定位置、未接続時はセクション内の接続ボタンが
            主アクション。捕獲の入口は画面下固定の捕獲バー（MobileCaptureBar）。
            キューは IndexedDB 永続なので画面を離れても消えない。空のときはセクション
            ごと畳まれ、送信済みは自然に消える。その下に従来のメモ検索・タイムラインが
            1 スクロールで続く */}
        {mobileInboxEnabled && push.items.length > 0 && (
          <div className="mb-3">
            <SendQueueSection
              items={push.items}
              draining={push.draining}
              activeId={push.activeId}
              progress={push.progress}
              configured={push.configured}
              connected={push.connected}
              connecting={push.connecting}
              connectError={push.connectError}
              canWebShare={push.canWebShare}
              webShareError={webShareError}
              onSend={push.drainNow}
              onConnect={push.connectAndDrain}
              onRemoveItem={push.removeItem}
              onRetryFailed={push.retryFailed}
              onWebShare={handleWebShare}
              onOpenSettings={openStorageSettings}
              loadItemBlob={push.getItemFile}
            />
          </div>
        )}

        {/* 検索（キュー前提ホームではキューの下・タイムラインの上） */}
        {mobileInboxEnabled && timeline.length > 0 && (
          <div className="mb-3">
            {searchInput}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <StickyNote size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {/* どちらも下バーを指すが、キュー前提ホームは捕獲バー（行き先は
                  送信キュー）なので文言を分ける */}
              {searchQuery.trim()
                ? t("nav.noMatchingNotes")
                : t(mobileInboxEnabled ? "memo.emptyQueueHome" : "memo.empty")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((item) =>
              item.kind === "memo" ? (
                <MemoCard
                  key={item.entry.id}
                  entry={item.entry}
                  onTap={() => setDetailEntry(item.entry)}
                  onDelete={
                    onDeleteCapture
                      ? () => handleDelete(item.entry.id)
                      : undefined
                  }
                />
              ) : (
                <MediaCard
                  key={item.entry.fileId}
                  entry={item.entry}
                  onTap={() => setMediaPreviewEntry(item.entry)}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* 画面下固定バー。キュー前提ホーム（フラグ ON）は捕獲バー
          （[書く][URL][写真][動画][音声][ライブラリ] → 出力先は送信キュー）、
          従来ホーム（フラグ OFF）はメモ作成 + 🔗 + 📷🎥🎙 のまま（既存ユーザーは無変化） */}
      {mobileInboxEnabled ? (
        <MobileCaptureBar
          onComposeMemo={() => setShowCaptureDialog(true)}
          onAddUrl={
            pushRouteAvailable || onAddUrlBookmark
              ? () => setShowBookmarkModal(true)
              : undefined
          }
          showMediaButtons={showMediaButtons}
          mediaDisabled={mediaDisabled}
          onAddFiles={(files) => { void handleCapturedFiles(files); }}
        />
      ) : (
      <div className="border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {uploading && (
          <p className="text-xs text-muted-foreground text-center mb-2">
            {t("asset.uploading")}
          </p>
        )}
        <div className="flex items-center gap-2">
          {/* メモ作成ボタン */}
          <button
            onClick={() => setShowCaptureDialog(true)}
            disabled={creating}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
          >
            <Plus size={18} />
            {creating ? t("memo.creating") : t("memo.new")}
          </button>

          {/* ブックマーク追加ボタン */}
          {onAddUrlBookmark && (
            <button
              onClick={() => setShowBookmarkModal(true)}
              className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors"
              title={t("asset.urlRegisterTitle")}
            >
              <Link size={20} />
            </button>
          )}

          {/* メディアキャプチャボタン（保存経路があるときだけ） */}
          {showMediaButtons && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={mediaDisabled}
                className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
                title={t("asset.type.image")}
              >
                <Camera size={20} />
              </button>
              <button
                onClick={() => videoInputRef.current?.click()}
                disabled={mediaDisabled}
                className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
                title={t("asset.type.video")}
              >
                <Video size={20} />
              </button>
              <button
                onClick={() => audioInputRef.current?.click()}
                disabled={mediaDisabled}
                className="p-3 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
                title={t("asset.type.audio")}
              >
                <Mic size={20} />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}
        </div>
      </div>
      )}

      {/* 付箋入力ダイアログ */}
      {showCaptureDialog && (
        <CaptureDialog
          onSubmit={handleSubmit}
          onClose={() => setShowCaptureDialog(false)}
          submitting={creating}
        />
      )}

      {/* メモ詳細・編集モーダル */}
      {detailEntry && (
        <MobileMemoEditModal
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onEdit={onEditCapture ? (id, text) => {
            onEditCapture(id, text);
            setDetailEntry({ ...detailEntry, text, modifiedAt: new Date().toISOString() });
          } : undefined}
          onDelete={onDeleteCapture ? () => {
            onDeleteCapture(detailEntry.id);
            setDetailEntry(null);
          } : undefined}
        />
      )}

      {/* URL ブックマーク登録モーダル。入力・メタ取得 UI は従来のまま流用し、
          フラグ ON のときだけ登録先が送信キュー（ネイティブ JSON）に切り替わる */}
      {showBookmarkModal && (mobileInboxEnabled || onAddUrlBookmark) && (
        <UrlBookmarkModal
          onRegister={handleRegisterBookmark}
          onClose={() => setShowBookmarkModal(false)}
        />
      )}

      {/* メディアプレビューモーダル */}
      {mediaPreviewEntry && (
        <MobileMediaPreviewModal
          entry={mediaPreviewEntry}
          onClose={() => setMediaPreviewEntry(null)}
        />
      )}
    </div>
  );
}
