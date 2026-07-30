// モバイルホームの捕獲履歴セクション（かつての SendQueueSection / SendToInboxSheet）。
//
// ホーム = 捕獲の時系列。撮ったものは送信状態にかかわらず 1 本のリストに新しい順で
// 並び続ける（ユーザー決定）。かつては「未送信キュー」と「過去のローカル項目の
// タイムライン」が別セクションで、送信に成功するとキューから消える設計だったため、
// 送るほど画面が空になり「撮った手応え」がどこにも残らなかった。
//
// 2 つのデータ源をこのセクションが 1 本に混ぜる:
// - items: 捕獲履歴（IndexedDB。pending / 送信中 / failed / sent）— enqueuedAt 順
// - localItems: この端末のメモ・素材（capture-store / media-index）— 過去の記録
// どちらも timestamp の新しい順に混ぜ、**送信対象（状態バッジあり）と過去のローカル
// 項目（バッジなし・破線枠）を見た目で区別する**。送信済みは控えめ、要対応（待機・
// 失敗）が目立つ塗り分け。
//
// **usePushQueue のスナップショットを props で受け取るだけのプレゼンテーション層**で、
// キュー操作・認可・drain は use-push-queue.ts が担う（props 駆動なので Storybook で
// 全状態を再現できる）。
//
// 表示ルール:
// - 履歴もローカル項目も無いときはセクションごと畳む（null）。捕獲の入口は画面下の
//   MobileCaptureBar が常時担うので、ここに残すものは無い。
// - 見出し行: タイトル + 未送信件数（左）/ [送信 (n)]（右端・接続済み + 未送信ありのみ）。
//   送信ボタンはリストが伸びても位置が動かない定位置（見出し行の右端）に置く。
// - 行: メディアはサムネ + 正規化名、メモ / URL 捕獲はアイコン + 中身プレビュー
//   （メモ = 本文先頭、URL = タイトル + ドメイン）。ローカル項目も同じ骨格で並べる。
// - リスト下の主アクション（接続 / 未設定の案内）は**未送信があるときだけ**出す —
//   送るものが無いのに接続を迫らない。
// - サムネイル: 画像だけ loadThumbnail で縮小 JPEG（送信済みでも残る）を読み object URL
//   を作る。行の unmount（削除・ビュー離脱）で必ず URL.revokeObjectURL する。
//   動画・音声・その他は種別アイコン（デスクトップ InboxView と同じ判断）。

import { useEffect, useMemo, useState } from "react";
import {
  Video,
  Image as ImageIcon,
  Volume2,
  Paperclip,
  Link as LinkIcon,
  StickyNote,
  Send,
  Trash2,
  Loader2,
  AlertCircle,
  Check,
  Settings as SettingsIcon,
  RotateCcw,
} from "lucide-react";
import { useT } from "../../../i18n";
import { formatBytes } from "../../../lib/format-bytes";
import { formatRelativeTime } from "../../navigation/recent-notes-store";
import {
  GRAPHIUM_CAPTURE_MIME,
  captureFilePreview,
  captureKindFromName,
  isGraphiumCaptureName,
  parseGraphiumCaptureFile,
  type GraphiumCaptureKind,
  type GraphiumCapturePayload,
} from "./capture-file";
import { extractDomain } from "../../asset-browser/media-index";
import type { PushProgress, PushQueueItemMeta } from "./push";

/**
 * この端末に残っている過去の捕獲物（ローカルのメモ・素材）の行データ。
 * 送信対象ではないので状態バッジは付かない。id は元データ（capture-store のメモ id /
 * media-index の fileId）を指し、タップで元の詳細モーダルを開くのに使う。
 */
export type LocalCaptureItem = {
  id: string;
  kind: "memo" | "image" | "video" | "audio" | "url";
  /** 行の主テキスト（メモ本文の先頭行 / 素材名 / URL タイトル）。 */
  title: string;
  /** 行の副テキスト（ドメインなど）。 */
  detail?: string;
  /** 画像素材のサムネイル URL。 */
  thumbnailUrl?: string;
  /** ISO8601。時系列の並びに使う。 */
  timestamp: string;
};

export type CaptureHistorySectionProps = {
  /** 捕獲履歴（enqueue 順。送信済みも含む）。 */
  items: PushQueueItemMeta[];
  /** この端末に残る過去の捕獲物（メモ・素材）。 */
  localItems?: LocalCaptureItem[];
  draining: boolean;
  /** 送信中アイテムの id。 */
  activeId: string | null;
  /** アイテム別進捗。 */
  progress: Record<string, PushProgress>;
  /** client_id が解決できるか。 */
  configured: boolean;
  /** 有効なトークンがあるか。 */
  connected: boolean;
  connecting: boolean;
  connectError?: string | null;
  /** 手動送信（接続済みモード・見出し行の定位置ボタン）。 */
  onSend: () => void;
  /** ストレージ選択（StoragePickerSheet）を開く。connect の実体はピッカー側。 */
  onOpenStoragePicker: () => void;
  onRemoveItem: (id: string) => void;
  onRetryFailed: () => void;
  onOpenSettings: () => void;
  /** ローカル項目をタップしたとき（元の詳細モーダルを開く）。 */
  onOpenLocalItem?: (item: LocalCaptureItem) => void;
  /** 履歴アイテムの実体を読む（メモ / URL 捕獲の中身プレビュー用。送信済みは null）。 */
  loadItemBlob?: (id: string) => Promise<Blob | null>;
  /** 履歴アイテムのサムネイル画像を読む（送信済みでも残る縮小 JPEG）。 */
  loadThumbnail?: (id: string) => Promise<Blob | null>;
};

/** 履歴の 1 行（2 つのデータ源を混ぜた後の内部表現）。 */
type HistoryRowItem =
  | { source: "push"; timestamp: string; order: string; item: PushQueueItemMeta }
  | { source: "local"; timestamp: string; order: string; item: LocalCaptureItem };

function itemPercent(item: PushQueueItemMeta, progress: Record<string, PushProgress>): number {
  const p = progress[item.id];
  if (!p || p.totalBytes === 0) return 0;
  return Math.min(100, Math.round((p.sentBytes / p.totalBytes) * 100));
}

function kindIcon(mime: string, size = 16) {
  if (mime.startsWith("video/")) return <Video size={size} />;
  if (mime.startsWith("audio/")) return <Volume2 size={size} />;
  if (mime.startsWith("image/")) return <ImageIcon size={size} />;
  return <Paperclip size={size} />;
}

function localKindIcon(kind: LocalCaptureItem["kind"], size = 16) {
  if (kind === "memo") return <StickyNote size={size} />;
  if (kind === "url") return <LinkIcon size={size} />;
  if (kind === "video") return <Video size={size} />;
  if (kind === "audio") return <Volume2 size={size} />;
  return <ImageIcon size={size} />;
}

/** メモ / URL 捕獲ファイル（capture-file.ts の JSON）の履歴アイテムか。 */
function isCaptureFileItem(item: PushQueueItemMeta): boolean {
  return item.mime === GRAPHIUM_CAPTURE_MIME || isGraphiumCaptureName(item.name);
}

/**
 * メモ / URL 捕獲アイテムのペイロード。送信前は実体（JSON）を読んで出すが、
 * 送信後は実体が捨てられているので、enqueue 時にレコードへ写した preview を使う
 * （呼び出し側で `payload ?? item.preview` の順にフォールバックする）。
 */
function useCapturePayload(
  item: PushQueueItemMeta,
  enabled: boolean,
  loadItemBlob?: (id: string) => Promise<Blob | null>,
): GraphiumCapturePayload | null {
  const [payload, setPayload] = useState<GraphiumCapturePayload | null>(null);

  useEffect(() => {
    if (!enabled || !loadItemBlob) return;
    let cancelled = false;
    void loadItemBlob(item.id)
      .then((blob) => blob?.text())
      .then((text) => {
        if (cancelled || text == null) return;
        setPayload(parseGraphiumCaptureFile(item.name, text));
      })
      .catch(() => {
        // プレビューが出ないだけ。preview / 名前表示にフォールバックする。
      });
    return () => {
      cancelled = true;
      setPayload(null);
    };
  }, [enabled, loadItemBlob, item.id, item.name]);

  return enabled ? payload : null;
}

function captureKindIcon(kind: GraphiumCaptureKind | null, size = 16) {
  if (kind === "memo") return <StickyNote size={size} />;
  if (kind === "url") return <LinkIcon size={size} />;
  return <Paperclip size={size} />;
}

/** 行のサムネイル枠（画像が読めなければアイコン）。 */
function ThumbnailFrame({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <div
      className={`w-10 h-10 shrink-0 rounded border border-border bg-muted/40 flex items-center justify-center overflow-hidden text-muted-foreground ${
        dim ? "opacity-70" : ""
      }`}
    >
      {children}
    </div>
  );
}

/**
 * 履歴行のサムネイル。画像のときだけ loadThumbnail（縮小 JPEG。送信済みでも残る）を
 * 読み object URL を作る。object URL は行の unmount で必ず revoke する。
 * 読めなかったら種別アイコンにフォールバック。
 */
function HistoryThumbnail({
  item,
  dim,
  loadThumbnail,
}: {
  item: PushQueueItemMeta;
  dim?: boolean;
  loadThumbnail?: (id: string) => Promise<Blob | null>;
}) {
  const thumbnailable = !!loadThumbnail && item.mime.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!thumbnailable || !loadThumbnail) return;
    let cancelled = false;
    let created: string | null = null;
    void loadThumbnail(item.id)
      .then((blob) => {
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {
        // サムネが出ないだけ。アイコン表示にフォールバックする。
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [thumbnailable, loadThumbnail, item.id]);

  return (
    <ThumbnailFrame dim={dim}>
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        kindIcon(item.mime)
      )}
    </ThumbnailFrame>
  );
}

/**
 * 捕獲履歴の 1 行（送信対象）。メディアはサムネ + 正規化名、メモ / URL 捕獲は
 * アイコン（📝 / 🔗）+ 中身のプレビュー。状態（待機 / 送信中 % / 送信済み / 失敗）・
 * 削除・進捗バーは種別によらず共通。送信済みは控えめ（淡い枠・淡い文字）に落として、
 * 要対応（待機・失敗）が視線を集めるようにする。
 */
function PushRow({
  item,
  isActive,
  percent,
  onRemove,
  loadItemBlob,
  loadThumbnail,
}: {
  item: PushQueueItemMeta;
  isActive: boolean;
  percent: number;
  onRemove: () => void;
  loadItemBlob?: (id: string) => Promise<Blob | null>;
  loadThumbnail?: (id: string) => Promise<Blob | null>;
}) {
  const t = useT();
  const isCapture = isCaptureFileItem(item);
  const payload = useCapturePayload(item, isCapture, loadItemBlob);
  const captureKind = payload?.kind ?? captureKindFromName(item.name);
  const isSent = item.status === "sent";
  const isFailed = item.status === "failed";

  // メディア行: 正規化名 + サイズ。捕獲行: プレビュー + 種別（メモ）/ ドメイン（URL）。
  // 捕獲行のプレビューは 実体 → レコードの preview → ファイル名 の順にフォールバックする。
  const capturePreview = payload ? captureFilePreview(payload) : item.preview;
  const primary = isCapture && capturePreview ? capturePreview : item.name;
  const captureUrl = payload?.kind === "url" ? payload.url : item.previewUrl;
  const detail = !isCapture
    ? formatBytes(item.bytes)
    : captureKind === "memo"
      ? t("mobile.send.kindMemo")
      : captureUrl
        ? extractDomain(captureUrl)
        : "";

  return (
    <div
      data-testid="capture-history-row"
      data-status={isActive ? "uploading" : item.status}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${
        isFailed
          ? "border-destructive/40 bg-destructive/5"
          : isSent
            ? // 送信済みは塗りを外して背景に沈める（要対応の行が浮き上がる）
              "border-border/50 bg-transparent"
            : "border-border bg-card shadow-sm"
      }`}
    >
      {isCapture ? (
        <ThumbnailFrame dim={isSent}>{captureKindIcon(captureKind)}</ThumbnailFrame>
      ) : (
        <HistoryThumbnail item={item} dim={isSent} loadThumbnail={loadThumbnail} />
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-xs truncate ${isSent ? "text-muted-foreground" : "text-foreground"}`}>
          {primary}
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-1.5">
          {detail && <span className="truncate max-w-[45%]">{detail}</span>}
          {isActive ? (
            <span className="text-primary flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              {t("mobile.send.statusSending", { percent: String(percent) })}
            </span>
          ) : isFailed ? (
            <span className="text-destructive flex items-center gap-1">
              <AlertCircle size={10} />
              {t("mobile.send.statusFailed")}
            </span>
          ) : isSent ? (
            <span className="flex items-center gap-1 text-muted-foreground/80">
              <Check size={10} />
              {t("mobile.send.statusSent")}
            </span>
          ) : (
            <span className="text-foreground/70">{t("mobile.send.statusWaiting")}</span>
          )}
          <span className="text-muted-foreground/60 truncate">
            {formatRelativeTime(item.sentAt ?? item.enqueuedAt)}
          </span>
        </p>
        {isFailed && item.lastError && (
          <p className="text-[10px] text-destructive/80 truncate mt-0.5">{item.lastError}</p>
        )}
        {isActive && (
          <div className="h-1 mt-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        disabled={isActive}
        aria-label={isSent ? t("mobile.history.remove") : t("mobile.send.remove")}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/**
 * 過去のローカル項目（この端末のメモ・素材）の 1 行。送信対象ではないので
 * **状態バッジも削除ボタンも出さない** — タップで元の詳細モーダル（そこに削除がある）
 * を開くだけ。破線の枠にして、送信対象の行と一目で区別できるようにする。
 */
function LocalRow({ item, onOpen }: { item: LocalCaptureItem; onOpen?: () => void }) {
  return (
    <div
      data-testid="capture-history-row"
      data-status="local"
      onClick={onOpen}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed border-border/60 ${
        onOpen ? "cursor-pointer active:bg-muted/30 transition-colors" : ""
      }`}
    >
      <ThumbnailFrame dim>
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          localKindIcon(item.kind)
        )}
      </ThumbnailFrame>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">{item.title}</p>
        <p className="text-[10px] text-muted-foreground/70 tabular-nums flex items-center gap-1.5">
          {item.detail && <span className="truncate max-w-[45%]">{item.detail}</span>}
          <span className="truncate">{formatRelativeTime(item.timestamp)}</span>
        </p>
      </div>
    </div>
  );
}

export function CaptureHistorySection({
  items,
  localItems,
  draining,
  activeId,
  progress,
  configured,
  connected,
  connecting,
  connectError,
  onSend,
  onOpenStoragePicker,
  onRemoveItem,
  onRetryFailed,
  onOpenSettings,
  onOpenLocalItem,
  loadItemBlob,
  loadThumbnail,
}: CaptureHistorySectionProps) {
  const t = useT();

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const unsentCount = pendingCount + failedCount;

  // 2 つのデータ源を時刻で混ぜて新しい順に。同時刻は名前 / id の降順で安定させる
  // （同一バッチの捕獲は enqueuedAt が同値で、名前の連番だけが順序を持つ）。
  const rows = useMemo<HistoryRowItem[]>(() => {
    const merged: HistoryRowItem[] = [
      ...items.map((item) => ({
        source: "push" as const,
        timestamp: item.enqueuedAt,
        order: item.name,
        item,
      })),
      ...(localItems ?? []).map((item) => ({
        source: "local" as const,
        timestamp: item.timestamp,
        order: item.id,
        item,
      })),
    ];
    return merged.sort((a, b) => {
      const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return diff !== 0 ? diff : b.order.localeCompare(a.order);
    });
  }, [items, localItems]);

  // 履歴もローカル項目も無いときはセクションごと畳む（空状態の文言は呼び出し側）。
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="capture-history-block">
      {/* 見出し行。[送信 (n)] はこの行の右端が定位置 — リストが伸びても位置が動かない。
          未送信が無いときは送信ボタンごと出さない（送るものが無いのに押させない） */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-foreground">{t("mobile.history.title")}</h2>
          {unsentCount > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
              {t("mobile.history.unsent", { count: String(unsentCount) })}
            </span>
          )}
        </div>
        {configured && connected && pendingCount > 0 && (
          <button
            onClick={onSend}
            disabled={draining}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium active:opacity-80 transition-opacity disabled:opacity-50"
          >
            {draining ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("mobile.send.sending")}
              </>
            ) : (
              <>
                <Send size={13} />
                {t("mobile.send.action", { count: String(pendingCount) })}
              </>
            )}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) =>
          row.source === "push" ? (
            <PushRow
              key={`push-${row.item.id}`}
              item={row.item}
              isActive={row.item.id === activeId}
              percent={itemPercent(row.item, progress)}
              onRemove={() => onRemoveItem(row.item.id)}
              loadItemBlob={loadItemBlob}
              loadThumbnail={loadThumbnail}
            />
          ) : (
            <LocalRow
              key={`local-${row.item.kind}-${row.item.id}`}
              item={row.item}
              onOpen={onOpenLocalItem ? () => onOpenLocalItem(row.item) : undefined}
            />
          ),
        )}
      </div>

      {/* 再試行（failed があるときだけ） */}
      {failedCount > 0 && (
        <button
          onClick={onRetryFailed}
          className="self-start flex items-center gap-1.5 text-xs text-primary active:opacity-70 transition-opacity"
        >
          <RotateCcw size={13} />
          {t("mobile.send.retryFailed", { count: String(failedCount) })}
        </button>
      )}

      {/* エラー表示 */}
      {connectError && (
        <p className="text-xs text-destructive leading-relaxed">
          {t("mobile.send.connectFailed", { error: connectError })}
        </p>
      )}

      {/* リスト下の主アクションは**未送信があるときだけ**（接続済みモードは見出し行の
          [送信] が担うので無し）。未接続時はストレージ選択を開く — プロバイダの説明・
          選択・接続はピッカー側の責務。未設定（client_id 無し）は案内 + 設定導線のみ */}
      {unsentCount > 0 &&
        (configured ? (
          !connected && (
            <button
              onClick={onOpenStoragePicker}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t("mobile.send.connecting")}
                </>
              ) : (
                t("mobile.send.connectStorage")
              )}
            </button>
          )
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("mobile.send.notConfigured")}
            </p>
            <button
              onClick={onOpenSettings}
              className="self-start flex items-center gap-1.5 text-xs text-primary active:opacity-70 transition-opacity"
            >
              <SettingsIcon size={13} />
              {t("mobile.send.openSettings")}
            </button>
          </div>
        ))}
    </div>
  );
}
