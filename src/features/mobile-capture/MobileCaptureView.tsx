// モバイル専用クイックキャプチャビュー（捕獲履歴ホーム）
//
// ホームは「捕獲の時系列」— ヘッダーに接続状態チップ、コンテンツ最上部（ヘッダー
// 直下）に検索欄と**捕獲履歴の統合リスト**（CaptureHistorySection）。統合リストは
// 2 つのデータ源 — 捕獲履歴（IndexedDB。待機 / 送信中 / 送信済み / 失敗）と、
// この端末に残る過去のメモ・素材（capture-store / media-index）— を時刻で混ぜて
// 新しい順に並べる。**送信済みも消えない**（送るほど画面が空になり、撮った手応えが
// 残らなかったため）。過去にこの端末へローカル保存した分も localItems として同じ
// リストに出るので、履歴ホームだけでも古い捕獲物が見えなくなることはない。
//
// 捕獲ボタンは画面下固定バー
// （MobileCaptureBar: [書く][URL][写真][動画][音声][ライブラリ]）。
// かつての SendToInboxSheet（ボトムシート）は廃止。メモ・URL もネイティブ JSON
// （capture-file.ts）で履歴行き（捕獲物は全部 Inbox へ。ローカルの capture-store
// には保存しない）。落ちるのはキュー自体が使えない環境（IndexedDB 不可）だけで、
// そのときだけ従来のローカル保存に退避する（データを落とさない非常口）。
//
// スマホにフル設定モーダルは出さない（デスクトップ語彙を持ち込まない）:
// ヘッダー右端の ⚙ はスマホ専用の最小設定シート（MobileSettingsSheet: ストレージ /
// 言語 / アプリ情報）を開く。未接続時の主ボタン（キューセクション内）も
// ストレージ選択（StoragePickerSheet）を開く。設定は端末ごと（localStorage）なので、
// スマホ単体で 接続/切断・client_id 上書きまで完結する。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickyNote, Trash2, Search, X, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import type { CaptureIndex, CaptureEntry } from "./capture-store";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import { MediaPreview } from "../asset-browser/media-preview";
import { UrlBookmarkModal } from "../asset-browser/UrlBookmarkModal";
import { formatRelativeTime } from "../navigation/recent-notes-store";
import { useT } from "../../i18n";
import { CaptureDialog } from "./CaptureDialog";
import { MobileCaptureBar } from "./MobileCaptureBar";
import { MobileSettingsSheet } from "./MobileSettingsSheet";
import { StoragePickerSheet } from "./StoragePickerSheet";
import { CaptureHistorySection, type LocalCaptureItem } from "./inbox/CaptureHistorySection";
import { usePushQueue } from "./inbox/use-push-queue";
import { usePushSettings } from "./inbox/use-push-settings";
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
  const [detailEntry, setDetailEntry] = useState<CaptureEntry | null>(null);
  const [mediaPreviewEntry, setMediaPreviewEntry] = useState<MediaIndexEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const pulling = useRef(false);
  const t = useT();

  // 送信キュー（撮る → 即キュー永続化 → Google Drive の Graphium/Inbox へ直列送信）。
  // push/ は hook 内で動的 import される。
  // 設定モーダルでの client_id 変更・接続・切断は push-events 経由で hook が読み直す
  // ので、常時見えているチップ・キューが古い状態のまま残ることはない。
  const push = usePushQueue();
  // 撮ったものをキュー経路へ送れる環境か。キューはこの端末の IndexedDB で動くので
  // client_id 未設定でも積める（未設定の案内は送信キュー側が出す）— configured では
  // ゲートしない。false のときだけ従来のローカル保存に落ちる（残った退路は
  // enqueue 失敗 = IndexedDB 不可の非常口だけ。モバイル単独利用者はいない前提 —
  // 設計 doc §13.9）。
  const pushRouteAvailable = push.ready;

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

  // ── 統合リスト: 捕獲履歴 + 過去のローカル項目 ──
  // 検索欄はリスト全体に掛ける。履歴側は行に出している文字（メモ / URL の
  // プレビュー、メディアの正規化名）で引っ掛ける。
  const filteredPushItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return push.items;
    return push.items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.preview ?? "").toLowerCase().includes(q),
    );
  }, [push.items, searchQuery]);

  // 過去のローカル項目（メモ・素材）を統合リストの行データに落とす。
  // かつての 2 カラムカードグリッド（従来ホーム）が見せていたものと同じ源
  // （capture-store / media-index）なので、履歴ホーム一本でも過去の捕獲物は残る。
  // 送信対象ではないので状態バッジは付かない（セクション側で区別して描く）。
  const localCaptureItems = useMemo<LocalCaptureItem[]>(() => {
    return filtered.map((item) => {
      if (item.kind === "memo") {
        const firstLine = item.entry.text
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        return {
          id: item.entry.id,
          kind: "memo" as const,
          title: firstLine ?? item.entry.text,
          timestamp: item.entry.createdAt,
        };
      }
      const entry = item.entry;
      return {
        id: entry.fileId,
        kind:
          entry.type === "video" || entry.type === "audio" || entry.type === "url"
            ? entry.type
            : ("image" as const),
        title: entry.name,
        detail: entry.type === "url" ? entry.urlMeta?.domain : undefined,
        // URL はファビコンを引き伸ばすより種別アイコンの方が読みやすい
        thumbnailUrl: entry.type === "image" ? entry.thumbnailUrl : undefined,
        timestamp: entry.uploadedAt,
      };
    });
  }, [filtered]);

  /** 統合リストの行数。ヘッダーの件数と空状態の判定に使う。 */
  const historyCount = filteredPushItems.length + localCaptureItems.length;

  // 統合リストのローカル行タップ → 従来と同じ詳細モーダル（削除もそこにある）
  const handleOpenLocalItem = useCallback(
    (item: LocalCaptureItem) => {
      if (item.kind === "memo") {
        const entry = captureIndex?.captures.find((capture) => capture.id === item.id);
        if (entry) setDetailEntry(entry);
        return;
      }
      const entry = mediaIndex?.media.find((media) => media.fileId === item.id);
      if (entry) setMediaPreviewEntry(entry);
    },
    [captureIndex, mediaIndex],
  );

  // テキストメモ送信。
  // メモも捕獲物 — ローカルの capture-store でなくネイティブ JSON
  //（capture-file.ts）で送信キューへ積む。デスクトップの取り込みで本物のメモとして
  // 着地する。client_id 未設定でも積む（案内は送信キュー側）。
  // キュー自体が使えない環境（IndexedDB 不可）だけ従来のローカル保存に退避する
  //（データを落とさない）。
  const enqueueForSend = push.enqueueForSend;
  const handleSubmit = useCallback(
    async (text: string) => {
      const queued = await enqueueForSend([buildMemoCaptureFile(text)]);
      if (queued) {
        setShowCaptureDialog(false);
        return;
      }
      await onCreateCapture(text);
      setShowCaptureDialog(false);
    },
    [enqueueForSend, onCreateCapture]
  );

  // URL ブックマーク登録。UrlBookmarkModal の入力（タイトル・説明・OGP はモバイル側で
  // 取得済み）をネイティブ JSON に写してキューへ。デスクトップは再取得せず、このメタの
  // まま URL 素材を作る。キュー不可時は従来のローカル登録へ退避。
  const handleRegisterBookmark = useCallback(
    (entry: MediaIndexEntry) => {
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
    },
    [enqueueForSend, onAddUrlBookmark]
  );

  // メディアキャプチャ共通。
  // 撮ったものはこの端末に保存せず**送信キュー**へ直行させる（この端末のライブラリに
  // 貯めてもデスクトップへ渡る橋がなく袋小路のため）。キューはホームに常時見えている
  // ので、enqueue 後に開くものは何もない — アイテムがその場でキュー一覧に出現する。
  // enqueue はジェスチャ非依存なので await してよい。client_id 未設定でもキューに
  // 積まれる（未設定の案内は送信キュー側）。従来のローカル保存に落ちるのはキュー自体が
  // 使えない環境（IndexedDB 不可）だけ。
  const handleCapturedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const queued = await enqueueForSend(files);
      if (queued) return;
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
    [enqueueForSend, onUploadMedia]
  );

  // ── ストレージ選択（StoragePickerSheet）と最小設定シート（MobileSettingsSheet） ──
  // フル設定モーダル（graphium-open-settings）はスマホホームからはもう開かない。
  const [showStoragePicker, setShowStoragePicker] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  // 接続（push.connectAndDrain）をピッカーから要求した印。
  // 成功（connected への遷移）でピッカーを閉じるための状態 — 「開いた時点で既に
  // 接続済み」（設定シートの [変更] 経由）と区別するため、要求の有無で追う。
  const [pickerConnectRequested, setPickerConnectRequested] = useState(false);

  // 最小設定シートのストレージ操作（状態・切断・client_id 上書き）の実体。
  // ピッカー/シートが開いている間だけ push モジュールを引く。
  const pushSettings = usePushSettings(showStoragePicker || showSettingsSheet);

  // ピッカーの Google 選択。**click から同期的に connect へ到達させる**（GIS 契約）。
  // 接続成功 → 残キューを即送信（connectAndDrain）。
  const handlePickGoogle = useCallback(() => {
    setPickerConnectRequested(true);
    push.connectAndDrain();
  }, [push.connectAndDrain]);

  // 接続成功でピッカーを閉じる（+ 実際に使えた経路を記録）。
  useEffect(() => {
    if (!showStoragePicker || !pickerConnectRequested) return;
    if (push.connected && !push.connecting) {
      setShowStoragePicker(false);
      setPickerConnectRequested(false);
      // プロバイダ永続はジェスチャ外なので動的 import でよい（起動時バンドル境界の維持）
      void import("./inbox/push")
        .then((mod) => mod.setPushProvider("google-drive"))
        .catch(() => {});
    }
  }, [showStoragePicker, pickerConnectRequested, push.connected, push.connecting]);

  const closeStoragePicker = useCallback(() => {
    setShowStoragePicker(false);
    setPickerConnectRequested(false);
  }, []);

  // キュー経路が使える環境では、ローカル保存ハンドラが無くても撮れる
  const showMediaButtons = pushRouteAvailable || !!onUploadMedia;
  const mediaDisabled = !pushRouteAvailable && (!onUploadMedia || uploading);

  // 検索入力（ヘッダー固定ではなくスクロール内 = 統合リストの直上に置く）
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

  // 接続状態チップ（ヘッダー）。表示だけ — 接続操作はストレージ選択ピッカー
  //（キューの未接続時主ボタン / 最小設定シートの [接続/変更] から開く）が担う
  //（connect はジェスチャ内同期呼び出しの契約があるため導線を一本化）。
  // push モジュールのロード前は暫定値しか無いので出さない（誤表示より一瞬の不在）。
  const pushConnected = push.configured && push.connected;
  const connectionChip = push.ready && (
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
              : t("memo.count", { count: String(historyCount) })}
          </span>
          {connectionChip}
          {/* 設定入口。開き先はスマホ専用の最小設定シート（ストレージ・言語・
              アプリ情報）— フル設定モーダルはスマホホームからは開かない。 */}
          <button
            onClick={() => setShowSettingsSheet(true)}
            aria-label={t("settings.title")}
            className="p-1.5 -mr-1.5 rounded-md text-muted-foreground active:bg-muted transition-colors"
          >
            <SettingsIcon size={17} />
          </button>
        </div>
      </div>

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

        {/* 捕獲の時系列ホーム: 検索欄 → 統合リスト（コンテンツ最上部）。
            統合リストは捕獲履歴（待機 / 送信中 / 送信済み / 失敗）と過去のローカル
            項目を混ぜて新しい順に並べる。[送信 (n)] は見出し行右端の定位置、未接続 +
            未送信ありのときだけセクション内の接続ボタンが主アクションになる。
            捕獲の入口は画面下固定の捕獲バー（MobileCaptureBar）。履歴は IndexedDB
            永続なので画面を離れても、送信し終えても消えない */}
        {(timeline.length > 0 || push.items.length > 0) && (
          <div className="mb-3">
            {searchInput}
          </div>
        )}

        <CaptureHistorySection
          items={filteredPushItems}
          localItems={localCaptureItems}
          draining={push.draining}
          activeId={push.activeId}
          progress={push.progress}
          configured={push.configured}
          connected={push.connected}
          connecting={push.connecting}
          connectError={push.connectError}
          onSend={push.drainNow}
          onOpenStoragePicker={() => setShowStoragePicker(true)}
          onRemoveItem={push.removeItem}
          onRetryFailed={push.retryFailed}
          onOpenSettings={() => setShowSettingsSheet(true)}
          onOpenLocalItem={handleOpenLocalItem}
          loadItemBlob={push.getItemFile}
          loadThumbnail={push.getItemThumbnail}
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        ) : historyCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <StickyNote size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {/* 空状態の行き先は下の捕獲バー（捕獲物は Inbox 行き） */}
              {searchQuery.trim()
                ? t("nav.noMatchingNotes")
                : t("memo.emptyQueueHome")}
            </p>
          </div>
        ) : null}
      </div>

      {/* 画面下固定バー = 捕獲バー
          （[書く][URL][写真][動画][音声][ライブラリ] → 出力先は送信キュー） */}
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

      {/* URL ブックマーク登録モーダル。入力・メタ取得 UI はデスクトップと共通で、
          登録先だけが送信キュー（ネイティブ JSON）になる */}
      {showBookmarkModal && (
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

      {/* スマホ専用の最小設定シート（⚙ の行き先）。
          ストレージの実体（状態・切断・client_id）は usePushSettings が担う */}
      {showSettingsSheet && (
        <MobileSettingsSheet
          ready={pushSettings.ready}
          configured={pushSettings.configured}
          connected={pushSettings.connected}
          hasBundledId={pushSettings.hasBundledId}
          clientIdOverride={pushSettings.clientIdOverride}
          onSaveClientId={pushSettings.saveClientId}
          onClearClientId={pushSettings.clearClientId}
          onDisconnect={pushSettings.disconnect}
          onOpenStoragePicker={() => setShowStoragePicker(true)}
          onClose={() => setShowSettingsSheet(false)}
        />
      )}

      {/* ストレージ選択（最小設定シートの上にも重なる z-[60]）。
          Google の接続はキュー配線（handlePickGoogle 参照） */}
      {showStoragePicker && (
        <StoragePickerSheet
          googleReady={push.ready && push.configured}
          connecting={push.connecting}
          connectError={push.connectError}
          onSelectGoogle={handlePickGoogle}
          onClose={closeStoragePicker}
        />
      )}
    </div>
  );
}
