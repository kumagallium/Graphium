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
  Download,
  Languages,
} from "lucide-react";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/platform";
import { loadAuthorIdentity } from "../identity";
import { getSharedRoot, getBlobRoot } from "../../lib/storage/shared";
import { shareMedia, shareReference } from "../sharing";
import { getActiveProvider } from "../../lib/storage/registry";
import { isWordDocxEntry } from "./media-index";
import type { MediaIndexEntry, MediaSharedRef } from "./media-index";

export type MaterialActionsMenuProps = {
  entry: MediaIndexEntry;
  onIngest?: (entry: MediaIndexEntry) => void;
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /** PDF / URL を原文構成のまま UI 言語へ全文翻訳して 1 ノート化する */
  onTranslatePdf?: (entry: MediaIndexEntry) => void;
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /**
   * Word (.docx) 素材の埋め込み画像を取り出して子素材として登録する。
   * PDF の onExtractPdfPages と機能対称な扱い（UI 上は同じ「埋め込み画像を抽出」）。
   */
  onExtractDocxImages?: (
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
  onTranslatePdf,
  onExtractPdfPages,
  onExtractDocxImages,
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

  // 埋め込み画像抽出（PDF / Word 共通の動線）
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const handleExtractEmbeddedImages = useCallback(async () => {
    if (extracting) return;
    setExtracting(true);
    setExtractError(null);
    try {
      if (entry.type === "pdf" && onExtractPdfPages) {
        await onExtractPdfPages(entry, () => {});
      } else if (entry.type === "document" && onExtractDocxImages) {
        await onExtractDocxImages(entry, () => {});
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  }, [entry, extracting, onExtractPdfPages, onExtractDocxImages]);

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

  // Word (.docx) も Knowledge 化 / PROV ノート化 / 埋め込み画像抽出対象に含める
  // （PDF と機能を揃える）。Excel/PowerPoint は未対応。
  const isDocxEntry = isWordDocxEntry(entry);
  const canIngest = !!onIngest && (entry.type === "url" || entry.type === "pdf" || isDocxEntry);
  const canCreateProv = !!onCreateProvNote && (entry.type === "url" || entry.type === "pdf" || isDocxEntry);
  // 全文翻訳は PDF と URL（Reader 本文）が対象。Knowledge / PROV と動線を揃える。
  const canTranslate = !!onTranslatePdf && (entry.type === "pdf" || entry.type === "url");
  const canExtract =
    (!!onExtractPdfPages && entry.type === "pdf")
    || (!!onExtractDocxImages && isDocxEntry);
  // 原本ダウンロード: URL ブックマーク以外（バイト実体があるもの）が対象
  const canDownload = entry.type !== "url";
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const provider = getActiveProvider();
      const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
      const blobUrl = await provider.getMediaBlobUrl(fileId);

      // getMediaBlobUrl が既に blob: URL を返している場合、再度 fetch すると
      // 同データを 2 重にメモリへ載せてしまう（大きい PDF/.docx でフリーズ）。
      // 同一オリジンの blob: なら直接 a.download に渡す。外部 URL のみ fetch fallback。
      let href = blobUrl;
      let createdObjectUrl: string | null = null;
      if (!blobUrl.startsWith("blob:")) {
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
    } catch (err) {
      console.error("[material-actions-menu] ダウンロード失敗:", err);
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [downloading, entry]);

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
                  title={t("knowledge.openInKnowledge")}
                >
                  <Bot size={14} className="text-primary" />
                  {t("knowledge.openEntry")}
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
          {canTranslate && (
            <>
              {(canIngest || canCreateProv) && <div className="my-1 border-t border-border" />}
              <button
                className={itemClass}
                onClick={() => { onTranslatePdf!(entry); setOpen(false); }}
                title={entry.type === "url" ? t("asset.translateUrlTitle") : t("asset.translatePdfTitle")}
              >
                <Languages size={14} className="text-primary" />
                {t("asset.translatePdf")}
              </button>
            </>
          )}
          {canExtract && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={itemClass}
                disabled={extracting}
                onClick={() => { void handleExtractEmbeddedImages(); setOpen(false); }}
                title={t("asset.pdfExtractImages.help")}
              >
                {extracting ? <Loader2 size={14} className="animate-spin" /> : <Images size={14} />}
                {t("asset.pdfExtractImages.button")}
              </button>
            </>
          )}
          {canDownload && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                className={itemClass}
                disabled={downloading}
                onClick={() => { void handleDownload(); setOpen(false); }}
                title={t("asset.downloadHint")}
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {downloading ? t("asset.downloading") : t("asset.download")}
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
      {(extractError || shareError || downloadError) && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-destructive/40 rounded-lg shadow-md p-2 z-50 text-[11px] text-destructive">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-all">{extractError ?? shareError ?? downloadError}</span>
          </div>
        </div>
      )}
    </div>
  );
}
