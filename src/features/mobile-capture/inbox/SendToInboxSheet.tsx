// モバイルの送信キューシート。
//
// 下バーの 📷🎥🎙 で撮ったファイルは即キュー（push/queue.ts）に永続化され、この
// シートが開く。ここは **subscribePushQueue のスナップショットを props で受け取る
// だけのプレゼンテーション層** で、キュー操作・認可・drain は use-push-queue.ts が担う
// （props 駆動なので Storybook で全状態を再現できる）。
//
// 3 つのモード:
// - 接続済み（configured && connected）: 自動送信が走る。手動の「送信」も置く。
// - 未接続（configured && !connected）: 「Google Drive に接続」。connect は
//   ジェスチャ内で同期に呼ぶ必要があるため、onConnect を click から直接叩く。
// - 未設定（!configured）: 設定への導線 + Web Share フォールバック
//   （onWebShare も同期呼び出し必須 — navigator.share の user activation）。
//
// かつての Web Share 版シート（wip/web-share-sheet-rescue の SendToInboxSheet）の
// レイアウト（ボトムシート・追加ピッカー・一覧）を下敷きに、staged ローカル state を
// キュー購読に置き換えた。シートを閉じてもキューは消えない（IndexedDB 永続）。

import { useRef } from "react";
import {
  X,
  Camera,
  Video,
  Mic,
  Images,
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
import type { PushProgress, PushQueueItemMeta } from "./push";

export type SendToInboxSheetProps = {
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
  /** 追加撮影・追加選択のファイルをキューへ。 */
  onAddFiles: (files: File[]) => void;
  /** 手動送信（接続済みモード）。 */
  onSend: () => void;
  /** Google Drive へ接続。**click から同期的に呼ばれる**。 */
  onConnect: () => void;
  onRemoveItem: (id: string) => void;
  onRetryFailed: () => void;
  /** 共有シートで送る。**click から同期的に呼ばれる**。 */
  onWebShare: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

function itemPercent(item: PushQueueItemMeta, progress: Record<string, PushProgress>): number {
  const p = progress[item.id];
  if (!p || p.totalBytes === 0) return 0;
  return Math.min(100, Math.round((p.sentBytes / p.totalBytes) * 100));
}

export function SendToInboxSheet({
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
  onAddFiles,
  onSend,
  onConnect,
  onRemoveItem,
  onRetryFailed,
  onWebShare,
  onOpenSettings,
  onClose,
}: SendToInboxSheetProps) {
  const t = useT();
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // 同じファイルをもう一度選べるように毎回リセットする
    e.target.value = "";
    if (picked.length > 0) onAddFiles(picked);
  };

  const pickers: {
    ref: React.RefObject<HTMLInputElement | null>;
    icon: React.ReactNode;
    label: string;
  }[] = [
    { ref: photoRef, icon: <Camera size={18} />, label: t("mobile.send.addPhoto") },
    { ref: videoRef, icon: <Video size={18} />, label: t("mobile.send.addVideo") },
    { ref: audioRef, icon: <Mic size={18} />, label: t("mobile.send.addAudio") },
    { ref: libraryRef, icon: <Images size={18} />, label: t("mobile.send.addLibrary") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[85dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{t("mobile.send.title")}</h2>
            {items.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("mobile.pendingCount", { count: String(items.length) })}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
          {/* 行き先の説明（モード別） */}
          {configured ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("mobile.send.helpDrive")}
            </p>
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
          )}

          {/* 撮る / 選ぶ（キューへ追加） */}
          <div className="grid grid-cols-2 gap-2">
            {pickers.map((p) => (
              <button
                key={p.label}
                onClick={() => p.ref.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl border border-border text-sm text-foreground active:bg-muted transition-colors"
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </div>

          {/* キュー一覧。名前は enqueue 時に正規化済み（送り先でもこの名前になる） */}
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              {t("mobile.send.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {items.map((item) => {
                const isActive = item.id === activeId;
                const percent = itemPercent(item, progress);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-1.5">
                        <span>{formatBytes(item.bytes)}</span>
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
                      onClick={() => onRemoveItem(item.id)}
                      disabled={isActive}
                      aria-label={t("mobile.send.remove")}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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

          {/* Web Share フォールバックの補足（未設定モードのみ） */}
          {!configured && canWebShare && items.length > 0 && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("mobile.send.webShareHint")}
            </p>
          )}
        </div>

        {/* 主アクション（モード別） */}
        <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
            )
          ) : canWebShare ? (
            <button
              onClick={onWebShare}
              disabled={items.length === 0}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm active:opacity-80 transition-opacity disabled:opacity-50"
            >
              <ShareIcon size={16} />
              {t("mobile.send.webShare", { count: String(items.length) })}
            </button>
          ) : (
            <button
              onClick={onOpenSettings}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border text-sm text-foreground active:bg-muted transition-colors"
            >
              <SettingsIcon size={16} />
              {t("mobile.send.openSettings")}
            </button>
          )}
        </div>

        {/* 撮影 / 選択の入力。accept は image/* のまま置く（iOS はこれで HEIC を JPEG に
            変換して渡す。accept に image/heic を含めると逆に HEIC のまま来る）。 */}
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          data-testid="send-inbox-photo"
          onChange={addFiles}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          data-testid="send-inbox-video"
          onChange={addFiles}
        />
        <input
          ref={audioRef}
          type="file"
          accept="audio/*"
          capture="environment"
          className="hidden"
          data-testid="send-inbox-audio"
          onChange={addFiles}
        />
        {/* フォトライブラリからは複数選択。撮影用の capture は付けない */}
        <input
          ref={libraryRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          data-testid="send-inbox-library"
          onChange={addFiles}
        />
      </div>
    </div>
  );
}
