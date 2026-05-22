// 素材サイドピーク（material as note）
// 旧 MediaDetailModal を置き換える本流コンポーネント。
//
// レイアウト:
//   - inline:  親 flex に組み込まれる（ノートのサイドピークと同じパターン）
//   - portal:  画面右から fixed で被さる
//   - full:    画面全面を覆うフルスクリーンオーバーレイ（"Open in full" ボタンで切替）
//
// 中身: ヘッダー（編集可能タイトル + アクション群） / ビューア（type 別） /
//       メタデータ（Used in / Derived） / Asset graph（関連ノート + 派生）
// アクションは渡されないと UI に出ない（feature toggle）。

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  ChevronDown,
  ChevronRight,
  BookOpen,
  BookPlus,
  FlaskConical,
  Images,
  Loader2,
  AlertCircle,
  RefreshCw,
  GitBranch,
} from "lucide-react";
import type { MediaIndex, MediaIndexEntry, MediaSharedRef, MediaType, MediaUsage } from "./media-index";
import { formatDateTime } from "../../lib/format-datetime";
import { useT } from "../../i18n";
import { MediaPreview } from "./media-preview";
import {
  AssetGraphPanel,
  shouldShowAssetGraph,
  type KnowledgeKindLookup,
} from "./asset-graph-panel";
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

// ── メタデータセクション ──────────────────────────────────

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div
        style={{
          width: 100,
          fontSize: 10,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
          paddingTop: 1,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function MetaSection({
  entry,
  onNavigateNote,
}: {
  entry: MediaIndexEntry;
  onNavigateNote?: (noteId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const derivedCount = entry.derivedFromAssets?.length ?? 0;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        background: "var(--color-card)",
        flexShrink: 0,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          color: "var(--color-text-secondary)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Metadata
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto", maxHeight: 240 }}>
          <MetaRow label="Type">
            <span style={{ color: TYPE_HEX[entry.type] }} className="text-xs font-medium uppercase">
              {entry.type}
            </span>
          </MetaRow>
          <MetaRow label="Uploaded">
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(entry.uploadedAt)}
            </span>
          </MetaRow>
          <MetaRow label={`Used in (${entry.usedIn.length})`}>
            {entry.usedIn.length === 0 ? (
              <span className="text-xs text-muted-foreground/60">—</span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {entry.usedIn.slice(0, 6).map((u: MediaUsage) => (
                  <button
                    key={`${u.noteId}-${u.blockId}`}
                    onClick={() => onNavigateNote?.(u.noteId)}
                    className="text-xs text-foreground hover:text-primary transition-colors text-left truncate"
                    title={u.noteTitle}
                  >
                    → {u.noteTitle}
                  </button>
                ))}
                {entry.usedIn.length > 6 && (
                  <span className="text-[10px] text-muted-foreground">
                    + {entry.usedIn.length - 6} more
                  </span>
                )}
              </div>
            )}
          </MetaRow>
          {derivedCount > 0 && (
            <MetaRow label={`Derived from (${derivedCount})`}>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <GitBranch size={11} />
                {derivedCount} asset(s)
              </span>
            </MetaRow>
          )}
        </div>
      )}
    </div>
  );
}

// ── Asset graph セクション（collapsible） ────────────────────

function GraphSection({
  entry,
  mediaIndex,
  getKnowledgeKind,
  onNavigateNote,
  onSwitchAsset,
}: {
  entry: MediaIndexEntry;
  mediaIndex?: MediaIndex | null;
  getKnowledgeKind?: KnowledgeKindLookup;
  onNavigateNote: (noteId: string) => void;
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!shouldShowAssetGraph(entry, mediaIndex)) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        background: "var(--color-card)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: open ? 280 : 36,
        transition: "height 0.2s ease-out",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          color: "var(--color-text-secondary)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          textAlign: "left",
          flexShrink: 0,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Asset graph
      </button>
      {open && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <AssetGraphPanel
            entry={entry}
            mediaIndex={mediaIndex}
            getKnowledgeKind={getKnowledgeKind}
            onNavigateNote={onNavigateNote}
            onSwitchAsset={onSwitchAsset}
            showLegend
          />
        </div>
      )}
    </div>
  );
}

// ── 本体 ───────────────────────────────────────────────────

export type MaterialSidePeekProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  /** 全画面表示へ昇格 / 縮小 — 渡された場合のみ Maximize2 / Minimize2 ボタンを表示 */
  onToggleFull?: () => void;
  /** 現在 full mode 表示中か */
  fullMode?: boolean;
  /** 削除 */
  onDelete?: (entry: MediaIndexEntry) => void;
  /** 使用ノートへ遷移 */
  onNavigateNote?: (noteId: string) => void;
  /** タイトル編集 */
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  /** Knowledge 化（URL / PDF 限定） */
  onIngest?: (entry: MediaIndexEntry) => void;
  /** PROV ラベル付きノート生成（URL / PDF 限定） */
  onCreateProvNote?: (entry: MediaIndexEntry) => void;
  /** PDF 各ページを画像として抽出 */
  onExtractPdfPages?: (
    entry: MediaIndexEntry,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ extracted: number }>;
  /** team-shared storage 共有成功時 */
  onSharedRefUpdated?: (entry: MediaIndexEntry, sharedRef: MediaSharedRef) => Promise<void> | void;
  /** 既存 Knowledge wiki の ID（あれば「In Knowledge」表示） */
  knowledgeWikiNoteId?: string;
  /** Asset graph のためのインデックス */
  mediaIndex?: MediaIndex | null;
  /** Wiki kind ルックアップ（グラフのノート色） */
  getKnowledgeKind?: KnowledgeKindLookup;
  /** グラフから関連アセットノードクリック時の差し替え */
  onSwitchAsset?: (entry: MediaIndexEntry) => void;
  /**
   * inline=true: 親 flex に flex item として組み込まれる（ノートのサイドピーク同等）
   * inline=false（デフォルト）: 画面右端から portal で fixed 表示
   * fullMode=true のときは inline 設定を無視してフルスクリーンオーバーレイ
   */
  inline?: boolean;
};

export function MaterialSidePeek({
  entry,
  onClose,
  onToggleFull,
  fullMode = false,
  onDelete,
  onNavigateNote,
  onRename,
  onIngest,
  onCreateProvNote,
  onExtractPdfPages,
  onSharedRefUpdated,
  knowledgeWikiNoteId,
  mediaIndex,
  getKnowledgeKind,
  onSwitchAsset,
  inline = false,
}: MaterialSidePeekProps) {
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

  // ── ESC で閉じる（fullMode 中も同様） ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── レイアウトスタイル ──
  const containerStyle: React.CSSProperties = fullMode
    ? {
        position: "fixed",
        inset: 0,
        background: "var(--color-card)",
        zIndex: 110,
        display: "flex",
        flexDirection: "column",
      }
    : inline
      ? {
          position: "relative",
          height: "100%",
          flexShrink: 0,
          width: 480,
          background: "var(--color-card)",
          borderLeft: "1px solid var(--color-border-subtle)",
          display: "flex",
          flexDirection: "column",
          animation: "sidePeekSlideIn 0.2s ease-out",
        }
      : {
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "55%",
          minWidth: 400,
          maxWidth: 800,
          background: "var(--color-card)",
          borderLeft: "1px solid var(--color-border-subtle)",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          animation: "sidePeekSlideIn 0.2s ease-out",
        };

  const isShared = !!entry.sharedRef;
  const usageNoteCount = new Set(entry.usedIn.map((u) => u.noteId)).size;
  const canIngest = !!onIngest && (entry.type === "url" || entry.type === "pdf");
  const canCreateProv = !!onCreateProvNote && (entry.type === "url" || entry.type === "pdf");
  const canExtract = !!onExtractPdfPages && entry.type === "pdf";

  const body = (
    <div data-side-peek style={containerStyle}>
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
          flexShrink: 0,
        }}
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

        {/* タイプアイコン */}
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

        {/* 名前（編集可） */}
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
              className={`text-sm font-medium text-foreground truncate ${onRename ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
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

        {/* アクション */}
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
          {/* Share — 全 type 共通（Tauri 限定だが UI は常時、disabled は内部で判定） */}
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
        <div className="px-3 py-2 border-b border-border bg-red-50 text-xs text-red-600 flex items-start gap-1.5">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-all">{t("asset.pdfExtractImages.error")}: {extractError}</span>
        </div>
      )}

      {/* 本体 viewer */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "var(--color-surface)",
          overflow: "auto",
          minHeight: 0,
        }}
      >
        <MediaPreview entry={entry} />
      </div>

      {/* メタデータ（折りたたみ） */}
      <MetaSection entry={entry} onNavigateNote={onNavigateNote} />

      {/* Asset graph（関連ノート + 派生） */}
      {onNavigateNote && (
        <GraphSection
          entry={entry}
          mediaIndex={mediaIndex}
          getKnowledgeKind={getKnowledgeKind}
          onNavigateNote={onNavigateNote}
          onSwitchAsset={onSwitchAsset}
        />
      )}
    </div>
  );

  if (inline && !fullMode) return body;
  return createPortal(body, document.body);
}
