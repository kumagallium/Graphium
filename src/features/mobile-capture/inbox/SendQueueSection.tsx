// モバイルホームの送信キューセクション（かつての SendToInboxSheet の置き換え）。
//
// ホーム自体が送信キューになった: 撮影ボタン行と未送信キューが常にインラインで
// 見え、「シートを開く」という操作は存在しない。ここは **usePushQueue の
// スナップショットを props で受け取るだけのプレゼンテーション層** で、キュー操作・
// 認可・drain は use-push-queue.ts が担う（props 駆動なので Storybook で全状態を
// 再現できる）。
//
// 表示ルール:
// - 捕獲ボタン行: [書く][URL]（onComposeMemo / onAddUrl が渡されたとき）+
//   撮影ピッカー（写真/動画/音声/ライブラリから。showCaptureRow の間）。
//   撮る → onAddFiles → キューに出現（この端末には保存しない）。メモ / URL も
//   親がキューへ積む（capture-file.ts の JSON）— 捕獲物は全部 Inbox へ。
// - キュー行: メディアは正規化名 + サムネ、メモ / URL 捕獲はアイコン + 中身プレビュー
//   （メモ = 本文先頭、URL = タイトル + ドメイン）。
// - キューブロック: アイテムがあるときだけ出す。空のときは丸ごと畳む —
//   送信済みはキューから消えるので、送り終えるとセクションは撮影行だけに戻る。
// - 主アクションはモード別:
//   接続済み = 送信 (n) / 未接続 = Google Drive に接続 /
//   未設定 = 案内 + 設定導線 + 共有シートフォールバック（canWebShare 時）。
//   onConnect / onWebShare は **click から同期的に呼ぶ**（navigator.share と GIS の
//   user activation 契約。use-push-queue 側の注記どおり await を挟まない）。
// - サムネイル: 画像だけ loadItemBlob で IndexedDB の Blob を読み object URL を作る。
//   行の unmount（削除・送信完了・ビュー離脱）で必ず URL.revokeObjectURL する。
//   動画・音声・その他は種別アイコン（デスクトップ InboxView と同じ判断）。

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Video,
  Mic,
  Images,
  Image as ImageIcon,
  Volume2,
  Paperclip,
  PenLine,
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
  /** 撮影ボタン行を出すか（キュー経路もローカル保存も無い環境では隠す）。 */
  showCaptureRow: boolean;
  /** 撮影ボタンの一時無効化（ローカル保存フォールバックのアップロード中など）。 */
  captureDisabled?: boolean;
  /** 撮影・選択したファイルをキューへ（経路が無ければ親がローカル保存に落とす）。 */
  onAddFiles: (files: File[]) => void;
  /**
   * [書く]（メモ捕獲）ボタン。渡されたときだけ捕獲ボタン行の先頭に出す。
   * メモもキュー行き（「捕獲物は全部 Inbox へ」）— 入力 UI は親（CaptureDialog）の責務。
   */
  onComposeMemo?: () => void;
  /** [URL] 捕獲ボタン。渡されたときだけ出す（入力 UI は親の UrlBookmarkModal）。 */
  onAddUrl?: () => void;
  /** 手動送信（接続済みモード）。 */
  onSend: () => void;
  /** Google Drive へ接続。**click から同期的に呼ばれる**。 */
  onConnect: () => void;
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
  showCaptureRow,
  captureDisabled,
  onAddFiles,
  onComposeMemo,
  onAddUrl,
  onSend,
  onConnect,
  onRemoveItem,
  onRetryFailed,
  onWebShare,
  onOpenSettings,
  loadItemBlob,
}: SendQueueSectionProps) {
  const t = useT();
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // 同じファイルをもう一度撮り直し / 選び直しできるように毎回リセットする
    e.target.value = "";
    if (picked.length > 0) onAddFiles(picked);
  };

  // 捕獲ボタン: [書く][URL]（渡されたときだけ）+ 撮影ピッカー（showCaptureRow の間）。
  // メモ・URL も撮影と同じ「捕獲 → キュー」の並びに置く（捕獲物は全部 Inbox へ）。
  const captureButtons: {
    key: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }[] = [
    ...(onComposeMemo
      ? [{ key: "memo", icon: <PenLine size={18} />, label: t("mobile.send.addMemo"), onClick: onComposeMemo }]
      : []),
    ...(onAddUrl
      ? [{ key: "url", icon: <LinkIcon size={18} />, label: t("mobile.send.addUrl"), onClick: onAddUrl }]
      : []),
    ...(showCaptureRow
      ? [
          { key: "photo", icon: <Camera size={18} />, label: t("mobile.send.addPhoto"), onClick: () => photoRef.current?.click(), disabled: captureDisabled },
          { key: "video", icon: <Video size={18} />, label: t("mobile.send.addVideo"), onClick: () => videoRef.current?.click(), disabled: captureDisabled },
          { key: "audio", icon: <Mic size={18} />, label: t("mobile.send.addAudio"), onClick: () => audioRef.current?.click(), disabled: captureDisabled },
          { key: "library", icon: <Images size={18} />, label: t("mobile.send.addLibrary"), onClick: () => libraryRef.current?.click(), disabled: captureDisabled },
        ]
      : []),
  ];
  // Tailwind の purge 対策で列数はクラス名を列挙して選ぶ。6 個 = 3 列 2 段（ラベルが
  // 潰れない）/ 4 個 = 従来の 1 段 / 2 個 = [書く][URL] だけの退避構成。
  const captureGridCols =
    captureButtons.length >= 5 ? "grid-cols-3" : captureButtons.length === 2 ? "grid-cols-2" : "grid-cols-4";

  return (
    <div className="flex flex-col gap-3">
      {/* 捕獲ボタン行。書く / URL / 撮る = 即キューへ（シートは開かない — もう存在しない） */}
      {captureButtons.length > 0 && (
        <div className={`grid ${captureGridCols} gap-2`}>
          {captureButtons.map((p) => (
            <button
              key={p.key}
              onClick={p.onClick}
              disabled={p.disabled}
              className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border border-border text-muted-foreground active:bg-muted transition-colors disabled:opacity-50"
            >
              {p.icon}
              <span className="text-[10px] leading-none text-foreground">{p.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 未送信キュー。空のときは丸ごと畳む（送信済みは queue から消える）。
          名前は enqueue 時に正規化済み（送り先でもこの名前になる） */}
      {items.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="send-queue-block">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground">{t("mobile.send.title")}</h2>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {t("mobile.pendingCount", { count: String(items.length) })}
            </span>
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

          {/* 主アクション（モード別） */}
          {configured ? (
            connected ? (
              <button
                onClick={onSend}
                disabled={pendingCount === 0 || draining}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
              >
                {draining ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t("mobile.send.sending")}
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    {t("mobile.send.action", { count: String(pendingCount) })}
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  onClick={onConnect}
                  disabled={connecting}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
                >
                  {connecting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t("mobile.send.connecting")}
                    </>
                  ) : (
                    t("mobile.send.connectGoogle")
                  )}
                </button>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("mobile.send.helpDrive")}
                </p>
              </>
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
      )}

      {/* 撮影 / 選択の入力。accept は image/* のまま置く（iOS はこれで HEIC を JPEG に
          変換して渡す。accept に image/heic を含めると逆に HEIC のまま来る）。 */}
      {showCaptureRow && (
        <>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            data-testid="send-queue-photo"
            onChange={addFiles}
          />
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            data-testid="send-queue-video"
            onChange={addFiles}
          />
          <input
            ref={audioRef}
            type="file"
            accept="audio/*"
            capture="environment"
            className="hidden"
            data-testid="send-queue-audio"
            onChange={addFiles}
          />
          {/* フォトライブラリからは複数選択。撮影用の capture は付けない */}
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            data-testid="send-queue-library"
            onChange={addFiles}
          />
        </>
      )}
    </div>
  );
}
