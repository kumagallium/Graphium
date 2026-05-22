// 素材詳細ビューの共通ヘッダー
// MaterialSidePeek と MaterialFullView から共有して使う。
// 構成: 閉じる / type アイコン / 名前（編集可） / メタチップ / アクション群 / Full toggle / 削除

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Trash2,
  Image as ImageIcon,
  Video,
  Volume2,
  FileText,
  Paperclip,
  Link as LinkIcon,
  BookOpen,
  BookPlus,
  FlaskConical,
  Images,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useT } from "../../i18n";
import type { MediaIndexEntry, MediaSharedRef, MediaType } from "./media-index";
import { ShareMediaDialog, SharedBadge } from "./share-media-dialog";

const TYPE_HEX: Record<MediaType, string> = {
  image: "#5b8fb9",
  video: "#5b8fb9",
  audio: "#c08b3e",
  pdf: "#c26356",
  url: "#4B7A52",
  other: "#7a7a7a",
};

function TypeIcon({ type, size = 14 }: { type: MediaType; size?: number }) {
  switch (type) {
    case "image":
      return <ImageIcon size={size} />;
    case "video":
      return <Video size={size} />;
    case "audio":
      return <Volume2 size={size} />;
    case "pdf":
      return <FileText size={size} />;
    case "url":
      return <LinkIcon size={size} />;
    default:
      return <Paperclip size={size} />;
  }
}

export type MaterialDetailHeaderProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  onIngest?: (entry: MediaIndexEntry) => void;
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  onNavigateNote?: (noteId: string) => void;
  knowledgeWikiNoteId?: string;
  /** Full view と SidePeek の切替トグル */
  onToggleFull?: () => void;
  fullMode?: boolean;
  /** 削除 */
  onDelete?: (entry: MediaIndexEntry) => void;
  /**
   * "sidePeek": 旧 SidePeek 互換のコンパクトな inline-style ヘッダー（小さい）。
   * "titleBar": Note のタイトルバーと同じ Tailwind クラス + サイズ感（フル画面用）。
   * 既定: "sidePeek"
   */
  variant?: "sidePeek" | "titleBar";
};

export function MaterialDetailHeader({
  entry,
  onClose,
  onRename,
  onIngest,
  onCreateProvNote,
  onExtractPdfPages,
  onSharedRefUpdated,
  onNavigateNote,
  knowledgeWikiNoteId,
  onToggleFull,
  fullMode = false,
  onDelete,
  variant = "sidePeek",
}: MaterialDetailHeaderProps) {
  const t = useT();

  // ── 名前編集 ──
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (!editing) setEditName(entry.name);
  }, [entry.name, editing]);

  const handleRename = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === entry.name || !onRename) {
      setEditing(false);
      setEditName(entry.name);
      return;
    }
    setRenaming(true);
    try {
      await onRename(entry, trimmed);
      setEditing(false);
    } catch {
      setEditName(entry.name);
      setEditing(false);
    } finally {
      setRenaming(false);
    }
  }, [editName, entry, onRename]);

  // ── PDF ページ画像抽出 ──
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  const handleExtractPages = useCallback(async () => {
    if (!onExtractPdfPages || extracting) return;
    setExtracting(true);
    setExtractError(null);
    setExtractProgress({ done: 0, total: 0 });
    try {
      await onExtractPdfPages(entry, (done, total) => {
        setExtractProgress({ done, total });
      });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
      setExtractProgress(null);
    }
  }, [entry, extracting, onExtractPdfPages]);

  const isShared = !!entry.sharedRef;
  const usageNoteCount = new Set(entry.usedIn.map((u) => u.noteId)).size;
  const canIngest = !!onIngest && (entry.type === "url" || entry.type === "pdf");
  const canCreateProv = !!onCreateProvNote && (entry.type === "url" || entry.type === "pdf");
  const canExtract = !!onExtractPdfPages && entry.type === "pdf";

  const titleBarMode = variant === "titleBar";

  return (
    <>
      <div
        className={
          titleBarMode
            ? "px-3 md:px-4 py-2.5 md:py-2 border-b border-border flex items-center gap-2 md:gap-3 shrink-0"
            : undefined
        }
        style={
          titleBarMode
            ? undefined
            : {
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderBottom: "1px solid var(--color-border-subtle)",
                background: "var(--color-surface)",
                flexShrink: 0,
              }
        }
      >
        <button
          onClick={onClose}
          title={t("common.close")}
          style={{
            display: "flex",
            alignItems: "center",
            padding: 6,
            borderRadius: 4,
            color: "var(--color-text-secondary)",
          }}
          className="hover:bg-muted transition-colors"
        >
          <X size={14} />
        </button>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 4,
            borderRadius: 4,
            background: TYPE_HEX[entry.type] + "18",
            color: TYPE_HEX[entry.type],
            flexShrink: 0,
          }}
        >
          <TypeIcon type={entry.type} size={12} />
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  setEditing(false);
                  setEditName(entry.name);
                }
              }}
              disabled={renaming}
              autoFocus
              className="text-sm font-semibold text-foreground bg-transparent border-b-2 border-primary outline-none min-w-[120px] flex-1"
            />
          ) : (
            <span
              className={`text-sm font-medium truncate ${titleBarMode ? "text-muted-foreground" : "text-foreground"} ${onRename ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
              title={onRename ? t("asset.clickToRename") : entry.name}
              onClick={() => { if (onRename) setEditing(true); }}
            >
              {entry.name}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground shrink-0">
            {entry.type === "url" ? entry.urlMeta?.domain ?? "" : entry.mimeType}
          </span>
          {usageNoteCount > 0 && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t("asset.usedInCount", { count: String(usageNoteCount) })}
            </span>
          )}
          {isShared && <SharedBadge />}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canIngest && (
            knowledgeWikiNoteId ? (
              <>
                <button
                  onClick={() => onNavigateNote?.(`wiki:${knowledgeWikiNoteId}`)}
                  className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5"
                  title={t("knowledge.openInKnowledge")}
                >
                  <BookOpen size={14} />
                  {t("knowledge.inKnowledge")}
                </button>
                <button
                  onClick={() => onIngest!(entry)}
                  className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded-md hover:bg-primary/10"
                  title={t("knowledge.regenerate")}
                  aria-label={t("knowledge.regenerate")}
                >
                  <RefreshCw size={14} />
                </button>
              </>
            ) : (
              <button
                onClick={() => onIngest!(entry)}
                className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5"
              >
                <BookPlus size={14} />
                {t("knowledge.addToKnowledge")}
              </button>
            )
          )}
          {canCreateProv && (
            <button
              onClick={() => onCreateProvNote!(entry)}
              className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5"
            >
              <FlaskConical size={14} />
              Create PROV Note
            </button>
          )}
          {canExtract && (
            <button
              onClick={handleExtractPages}
              disabled={extracting}
              className="text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("asset.pdfExtractImages.help")}
            >
              {extracting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {extractProgress && extractProgress.total > 0
                    ? t("asset.pdfExtractImages.progress", {
                        done: String(extractProgress.done),
                        total: String(extractProgress.total),
                      })
                    : t("asset.pdfExtractImages.running")}
                </>
              ) : (
                <>
                  <Images size={14} />
                  {t("asset.pdfExtractImages.button")}
                </>
              )}
            </button>
          )}
          <ShareMediaDialog entry={entry} onSharedRefUpdated={onSharedRefUpdated} />

          {onToggleFull && (
            <button
              onClick={onToggleFull}
              title={fullMode ? t("asset.exitFull") : t("asset.openInFull")}
              style={{
                display: "flex",
                alignItems: "center",
                padding: 6,
                borderRadius: 4,
                color: "var(--color-text-secondary)",
              }}
              className="hover:bg-muted transition-colors"
            >
              {fullMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(entry)}
              title={t("common.delete")}
              style={{
                display: "flex",
                alignItems: "center",
                padding: 6,
                borderRadius: 4,
                color: "var(--color-text-secondary)",
              }}
              className="hover:bg-muted hover:text-destructive transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* PDF 抽出エラー */}
      {extractError && (
        <div className="px-3 py-2 border-b border-border bg-red-50 text-xs text-red-600 flex items-start gap-1.5 shrink-0">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-all">{t("asset.pdfExtractImages.error")}: {extractError}</span>
        </div>
      )}
    </>
  );
}
