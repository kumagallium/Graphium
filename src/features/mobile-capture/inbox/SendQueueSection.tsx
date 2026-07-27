// モバイルホームの送信キューセクション（かつての SendToInboxSheet の置き換え）。
//
// ホーム自体が送信キューになった: 未送信キューがコンテンツ最上部（ヘッダー直下）に
// 常にインラインで見え、「シートを開く」という操作は存在しない。捕獲ボタンは画面下
// 固定の捕獲バー（MobileCaptureBar）が担い、ここはキュー表示専任。**usePushQueue の
// スナップショットを props で受け取るだけのプレゼンテーション層** で、キュー操作・
// 認可・drain は use-push-queue.ts が担う（props 駆動なので Storybook で全状態を
// 再現できる）。
//
// 表示ルール:
// - キューが空のときはセクションごと畳む（null）— 送信済みはキューから消えるので、
//   送り終えるとホームはタイムラインだけに戻る。
// - 見出し行: タイトル + 件数（左）/ [送信 (n)]（右端・接続済みモードのみ）。
//   送信ボタンはリストが伸びても位置が動かない定位置（見出し行の右端）に置く。
// - キュー行: メディアは正規化名 + サムネ、メモ / URL 捕獲はアイコン + 中身プレビュー
//   （メモ = 本文先頭、URL = タイトル + ドメイン）。
// - リスト下の主アクションはモード別:
//   接続済み = なし（送信は見出し行の定位置）/ 未接続 = [ストレージに接続] →
//   ストレージ選択（StoragePickerSheet。Google/OneDrive/共有シートの選択と connect の
//   ジェスチャ契約はピッカー側が担う — ここはシートを開くだけ）/
//   未設定 = 案内 + 設定導線（最小設定シートの client_id 上書き）+ 共有シート
//   フォールバック（canWebShare 時）。onWebShare は **click から同期的に呼ぶ**
//   （navigator.share の user activation 契約。await を挟まない）。
// - サムネイル: 画像だけ loadItemBlob で IndexedDB の Blob を読み object URL を作る。
//   行の unmount（削除・送信完了・ビュー離脱）で必ず URL.revokeObjectURL する。
//   動画・音声・その他は種別アイコン（デスクトップ InboxView と同じ判断）。

import { useEffect, useState } from "react";
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
  Settings as SettingsIcon,
  Share as ShareIcon,
  RotateCcw,
} from "lucide-react";
import { useT } from "../../../i18n";
import { formatBytes } from "../../../lib/format-bytes";
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
 * 画像サムネイルを読む上限。これを超える画像はアイコン表示に倒す
 * （InboxView の THUMBNAIL_MAX_BYTES と同じ判断）。
 */
const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024;

export type SendQueueSectionProps = {
  /** キューのアイテム（enqueue 順）。 */
  items: PushQueueItemMeta[];
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
  /** Web Share フォールバックが使えるか（未設定モードでのみ使う）。 */
  canWebShare: boolean;
  /** Web Share の失敗表示（cancelled は渡さないこと）。 */
  webShareError?: string | null;
  /** 手動送信（接続済みモード・見出し行の定位置ボタン）。 */
  onSend: () => void;
  /** ストレージ選択（StoragePickerSheet）を開く。connect の実体はピッカー側。 */
  onOpenStoragePicker: () => void;
  onRemoveItem: (id: string) => void;
  onRetryFailed: () => void;
  /** 共有シートで送る。**click から同期的に呼ばれる**。 */
  onWebShare: () => void;
  onOpenSettings: () => void;
  /** キューアイテムの Blob を読む（画像サムネイル用）。省略時はアイコン表示。 */
  loadItemBlob?: (id: string) => Promise<Blob | null>;
};

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

/** メモ / URL 捕獲ファイル（capture-file.ts の JSON）のキューアイテムか。 */
function isCaptureFileItem(item: PushQueueItemMeta): boolean {
  return item.mime === GRAPHIUM_CAPTURE_MIME || isGraphiumCaptureName(item.name);
}

/**
 * メモ / URL 捕獲アイテムの行表示（アイコン + プレビュー）。
 * kind は正規化名（`-memo` / `-url`）から即決めてアイコンを出し、本文プレビューは
 * キューの Blob（JSON）を読んでから差す（QueueThumbnail が画像でやるのと同じ判断）。
 * 読めない・形状不正のときはファイル名表示にフォールバックする。
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
        // プレビューが出ないだけ。名前表示にフォールバックする。
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

/**
 * 行のサムネイル。画像かつ上限以下のときだけキューの Blob を読み object URL を作る。
 * object URL は行の unmount（削除・送信完了で消える・ビュー離脱）で必ず revoke する。
 * 読めなかったら種別アイコンにフォールバック。
 */
function QueueThumbnail({
  item,
  loadItemBlob,
}: {
  item: PushQueueItemMeta;
  loadItemBlob?: (id: string) => Promise<Blob | null>;
}) {
  const thumbnailable =
    !!loadItemBlob && item.mime.startsWith("image/") && item.bytes <= THUMBNAIL_MAX_BYTES;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!thumbnailable || !loadItemBlob) return;
    let cancelled = false;
    let created: string | null = null;
    void loadItemBlob(item.id)
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
  }, [thumbnailable, loadItemBlob, item.id]);

  return (
    <div className="w-10 h-10 shrink-0 rounded border border-border bg-muted/40 flex items-center justify-center overflow-hidden text-muted-foreground">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        kindIcon(item.mime)
      )}
    </div>
  );
}

/**
 * キューの 1 行。メディアは正規化名 + サムネイル、メモ / URL 捕獲は
 * アイコン（📝 / 🔗）+ 中身のプレビュー（メモ = 本文先頭、URL = タイトルとドメイン）で出す。
 * 状態（待機 / 送信中 % / 失敗）・削除・進捗バーは種別によらず共通。
 */
function QueueRow({
  item,
  isActive,
  percent,
  onRemove,
  loadItemBlob,
}: {
  item: PushQueueItemMeta;
  isActive: boolean;
  percent: number;
  onRemove: () => void;
  loadItemBlob?: (id: string) => Promise<Blob | null>;
}) {
  const t = useT();
  const isCapture = isCaptureFileItem(item);
  const payload = useCapturePayload(item, isCapture, loadItemBlob);
  const captureKind = payload?.kind ?? captureKindFromName(item.name);

  // メディア行: 正規化名 + サイズ。捕獲行: プレビュー + 種別（メモ）/ ドメイン（URL）。
  // ペイロード読込前・形状不正はファイル名にフォールバックする。
  const primary = isCapture && payload ? captureFilePreview(payload) : item.name;
  const detail = !isCapture
    ? formatBytes(item.bytes)
    : captureKind === "memo"
      ? t("mobile.send.kindMemo")
      : payload?.kind === "url"
        ? extractDomain(payload.url)
        : "";

  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-card">
      {isCapture ? (
        <div className="w-10 h-10 shrink-0 rounded border border-border bg-muted/40 flex items-center justify-center overflow-hidden text-muted-foreground">
          {captureKindIcon(captureKind)}
        </div>
      ) : (
        <QueueThumbnail item={item} loadItemBlob={loadItemBlob} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground truncate">{primary}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-1.5">
          {detail && <span className="truncate max-w-[45%]">{detail}</span>}
          {isActive ? (
            <span className="text-primary flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              {t("mobile.send.statusSending", { percent: String(percent) })}
            </span>
          ) : item.status === "failed" ? (
            <span className="text-destructive flex items-center gap-1">
              <AlertCircle size={10} />
              {t("mobile.send.statusFailed")}
            </span>
          ) : (
            <span>{t("mobile.send.statusWaiting")}</span>
          )}
        </p>
        {item.status === "failed" && item.lastError && (
          <p className="text-[10px] text-destructive/80 truncate mt-0.5">
            {item.lastError}
          </p>
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
        aria-label={t("mobile.send.remove")}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function SendQueueSection({
  items,
  draining,
  activeId,
  progress,
  configured,
  connected,
  connecting,
  connectError,
  canWebShare,
  webShareError,
  onSend,
  onOpenStoragePicker,
  onRemoveItem,
  onRetryFailed,
  onWebShare,
  onOpenSettings,
  loadItemBlob,
}: SendQueueSectionProps) {
  const t = useT();

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  // 空のときはセクションごと畳む（送信済みは queue から消える）。
  // 捕獲の入口は画面下の MobileCaptureBar が常時担うので、ここに残すものは無い。
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="send-queue-block">
      {/* 見出し行。[送信 (n)] はこの行の右端が定位置 — リストが伸びても動かない。
          名前は enqueue 時に正規化済み（送り先でもこの名前になる） */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-foreground">{t("mobile.send.title")}</h2>
          <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
            {t("mobile.pendingCount", { count: String(items.length) })}
          </span>
        </div>
        {configured && connected && (
          <button
            onClick={onSend}
            disabled={pendingCount === 0 || draining}
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
        {items.map((item) => (
          <QueueRow
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            percent={itemPercent(item, progress)}
            onRemove={() => onRemoveItem(item.id)}
            loadItemBlob={loadItemBlob}
          />
        ))}
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
      {webShareError && (
        <p className="text-xs text-destructive leading-relaxed">
          {t("mobile.send.webShareFailed", { error: webShareError })}
        </p>
      )}

      {/* リスト下の主アクション（接続済みモードは見出し行の [送信] が担うので無し）。
          未接続時はストレージ選択（Google / OneDrive / 共有シート）を開く —
          プロバイダの説明・選択・接続はピッカー側の責務 */}
      {configured ? (
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
        <>
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
          {canWebShare && (
            <>
              <button
                onClick={onWebShare}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity"
              >
                <ShareIcon size={16} />
                {t("mobile.send.webShare", { count: String(items.length) })}
              </button>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("mobile.send.webShareHint")}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
