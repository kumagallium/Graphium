// team-shared storage 共有ダイアログ + トリガーボタンをセットにしたコンポーネント
// 旧 MediaDetailModal から分離。MaterialSidePeek / MaterialFullView から再利用する。
// Phase 2b-media: Tauri 専用、shared root + identity 必須、URL は reference 共有。

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Share2 } from "lucide-react";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/platform";
import { loadAuthorIdentity } from "../identity";
import { getSharedRoot, getBlobRoot } from "../../lib/storage/shared";
import { shareMedia, shareReference } from "../sharing";
import type { MediaIndexEntry, MediaSharedRef } from "./media-index";

export type ShareMediaDialogProps = {
  entry: MediaIndexEntry;
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  /** トリガーボタンの className を上書き（既定はパネルアクション色） */
  buttonClassName?: string;
};

/**
 * 共有トリガーボタンとダイアログをセットで描画する。共有状態は entry.sharedRef に従い、
 * 成功時に onSharedRefUpdated を呼ぶ。Tauri 以外では disabled。
 */
export function ShareMediaDialog({
  entry,
  onSharedRefUpdated,
  buttonClassName,
}: ShareMediaDialogProps) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(entry.name);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedRefState, setSharedRefState] = useState(entry.sharedRef);

  useEffect(() => {
    setSharedRefState(entry.sharedRef);
  }, [entry.sharedRef]);

  const isShared = !!sharedRefState;
  const sharedRoot = getSharedRoot();
  const blobRoot = getBlobRoot();
  const sharedAuthor = loadAuthorIdentity();
  const isUrlEntry = entry.type === "url";
  const disabledReason: string | undefined = !isTauri()
    ? t("share.disabled.desktopOnly")
    : !sharedRoot
      ? t("share.disabled.noRoot")
      : !sharedAuthor
        ? t("share.disabled.noIdentity")
        : !isUrlEntry && !blobRoot
          ? t("share.media.disabled.noBlobRoot")
          : undefined;

  const openDialog = useCallback(() => {
    setTitle(entry.name);
    setDescription("");
    setError(null);
    setOpen(true);
  }, [entry.name]);

  const handleShare = useCallback(async () => {
    if (!sharedRoot || !sharedAuthor) return;
    if (!isUrlEntry && !blobRoot) return;
    setBusy(true);
    setError(null);
    try {
      const entryWithRef: MediaIndexEntry = sharedRefState
        ? { ...entry, sharedRef: sharedRefState }
        : entry;
      const result = isUrlEntry
        ? await shareReference(entryWithRef, {
            sharedRoot,
            author: sharedAuthor,
            title,
            description,
          })
        : await shareMedia(entryWithRef, {
            sharedRoot,
            blobRoot: blobRoot!,
            author: sharedAuthor,
            title,
            description,
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSharedRefState(result.sharedRef);
      if (onSharedRefUpdated) {
        await onSharedRefUpdated(entryWithRef, result.sharedRef);
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [sharedRoot, blobRoot, sharedAuthor, isUrlEntry, entry, sharedRefState, title, description, onSharedRefUpdated]);

  return (
    <>
      <button
        onClick={openDialog}
        disabled={!!disabledReason}
        title={disabledReason}
        className={
          buttonClassName ??
          "text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        }
      >
        <Share2 size={14} />
        {isShared ? t("share.reshareToTeam") : t("share.shareToTeam")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">
                {isShared ? t("share.media.dialog.titleReshare") : t("share.media.dialog.titleFirst")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("share.media.dialog.help")}
              </p>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">
                {t("share.media.dialog.titleLabel")}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">
                {t("share.media.dialog.descLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none resize-none"
              />
            </div>
            {error && (
              <p className="text-xs text-red-500 flex items-start gap-1">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span className="break-all">{error}</span>
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleShare}
                disabled={busy || !title.trim()}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busy ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    {t("share.sharing")}
                  </>
                ) : isShared ? (
                  t("share.media.dialog.update")
                ) : (
                  t("share.media.dialog.share")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * shared バッジ（共有済み表示用）。
 * MaterialSidePeek / MaterialFullView のヘッダーに置く。
 */
export function SharedBadge() {
  const t = useT();
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0 inline-flex items-center gap-1"
      title={t("share.badgeTooltip")}
    >
      <Share2 size={10} />
      {t("share.badge")}
    </span>
  );
}
