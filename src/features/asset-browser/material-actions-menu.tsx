// 素材詳細ビューの 3-dot アクションメニュー
// Note の NoteHeaderMenu と同じ pattern で、素材向けのアクション
// (Knowledge / PROV / Extract / Share / Delete) を 1 つのドロップダウンに集約する。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  Bot,
  Images,
  Trash2,
  Share2,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/platform";
import { loadAuthorIdentity } from "../identity";
import { getSharedRoot, getBlobRoot } from "../../lib/storage/shared";
import { shareMedia, shareReference } from "../sharing";
import type { MediaIndexEntry, MediaSharedRef } from "./media-index";

export type MaterialActionsMenuProps = {
  entry: MediaIndexEntry;
  onIngest?: (entry: MediaIndexEntry) => void;
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  onNavigateNote?: (noteId: string) => void;
  knowledgeWikiNoteId?: string;
  onDelete?: (entry: MediaIndexEntry) => void;
};

export function MaterialActionsMenu({
  entry,
  onIngest,
  onCreateProvNote,
  onExtractPdfPages,
  onSharedRefUpdated,
  onNavigateNote,
  knowledgeWikiNoteId,
  onDelete,
}: MaterialActionsMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // PDF ページ抽出
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const handleExtractPages = useCallback(async () => {
    if (!onExtractPdfPages || extracting) return;
    setExtracting(true);
    setExtractError(null);
    try {
      await onExtractPdfPages(entry, () => {});
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  }, [entry, extracting, onExtractPdfPages]);

  // 共有関連
  const sharedRoot = getSharedRoot();
  const blobRoot = getBlobRoot();
  const sharedAuthor = loadAuthorIdentity();
  const isUrlEntry = entry.type === "url";
  const isShared = !!entry.sharedRef;
  const shareDisabledReason: string | undefined = !isTauri()
    ? t("share.disabled.desktopOnly")
    : !sharedRoot
      ? t("share.disabled.noRoot")
      : !sharedAuthor
        ? t("share.disabled.noIdentity")
        : !isUrlEntry && !blobRoot
          ? t("share.media.disabled.noBlobRoot")
          : undefined;
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleShare = useCallback(async () => {
    if (!sharedRoot || !sharedAuthor) return;
    if (!isUrlEntry && !blobRoot) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const result = isUrlEntry
        ? await shareReference(entry, { sharedRoot, author: sharedAuthor, title: entry.name, description: "" })
        : await shareMedia(entry, { sharedRoot, blobRoot: blobRoot!, author: sharedAuthor, title: entry.name, description: "" });
      if (!result.ok) {
        setShareError(result.error);
        return;
      }
      if (onSharedRefUpdated) await onSharedRefUpdated(entry, result.sharedRef);
    } finally {
      setShareBusy(false);
    }
  }, [sharedRoot, blobRoot, sharedAuthor, isUrlEntry, entry, onSharedRefUpdated]);

  const itemClass =
    "w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground rounded hover:bg-muted transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed";

  const canIngest = !!onIngest && (entry.type === "url" || entry.type === "pdf");
  const canCreateProv = !!onCreateProvNote && (entry.type === "url" || entry.type === "pdf");
  const canExtract = !!onExtractPdfPages && entry.type === "pdf";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={t("common.menu")}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-md py-1 z-50">
          {canIngest && (
            knowledgeWikiNoteId ? (
              <>
                <button
                  className={itemClass}
                  onClick={() => { onNavigateNote?.(`wiki:${knowledgeWikiNoteId}`); setOpen(false); }}
                >
                  <Bot size={14} className="text-primary" />
                  {t("knowledge.openInKnowledge")}
                </button>
                <button
                  className={itemClass}
                  onClick={() => { onIngest!(entry); setOpen(false); }}
                >
                  <RefreshCw size={14} />
                  {t("knowledge.regenerate")}
                </button>
              </>
            ) : (
              <button
                className={itemClass}
                onClick={() => { onIngest!(entry); setOpen(false); }}
              >
                <Bot size={14} className="text-primary" />
                {t("knowledge.addToKnowledge")}
              </button>
            )
          )}
          {canCreateProv && (
            <>
              {canIngest && <div className="my-1 border-t border-border" />}
              <button
                className={itemClass}
                onClick={() => { onCreateProvNote!(entry); setOpen(false); }}
                title={t("asset.createProvNoteTitle")}
              >
                <Bot size={14} className="text-primary" />
                {t("asset.createProvNote")}
              </button>
            </>
          )}
          {canExtract && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={itemClass}
                disabled={extracting}
                onClick={() => { void handleExtractPages(); setOpen(false); }}
                title={t("asset.pdfExtractImages.help")}
              >
                {extracting ? <Loader2 size={14} className="animate-spin" /> : <Images size={14} />}
                {t("asset.pdfExtractImages.button")}
              </button>
            </>
          )}
          <div className="my-1 border-t border-border" />
          <button
            className={itemClass}
            disabled={!!shareDisabledReason || shareBusy}
            onClick={() => { void handleShare(); setOpen(false); }}
            title={shareDisabledReason}
          >
            {shareBusy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
            {shareBusy ? t("share.sharing") : isShared ? t("share.reshareToTeam") : t("share.shareToTeam")}
          </button>
          {onDelete && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={`${itemClass} hover:bg-destructive/10 hover:text-destructive`}
                onClick={() => { onDelete(entry); setOpen(false); }}
              >
                <Trash2 size={14} />
                {t("common.delete")}
              </button>
            </>
          )}
        </div>
      )}
      {(extractError || shareError) && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-destructive/40 rounded-lg shadow-md p-2 z-50 text-[11px] text-destructive">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-all">{extractError ?? shareError}</span>
          </div>
        </div>
      )}
    </div>
  );
}
