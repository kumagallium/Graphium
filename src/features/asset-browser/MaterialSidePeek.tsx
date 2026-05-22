// 素材サイドピーク（material as note の Step 2 設計用）
// SidePeek の outer container pattern を踏襲。type 別 viewer を切り替える。
// ネットワーク図はここには入れず、右パネルに分離する想定。

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Maximize2,
  ExternalLink,
  Trash2,
  Image as ImageIcon,
  Video,
  Volume2,
  FileText,
  Paperclip,
  Link as LinkIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { MediaIndexEntry, MediaType, MediaUsage } from "./media-index";
import { formatDateTime } from "../../lib/format-datetime";

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

// ── Viewer 群（type ごと） ──────────────────────────────────

function ImageViewer({ entry }: { entry: MediaIndexEntry }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-surface)",
        overflow: "hidden",
        padding: 16,
      }}
    >
      {entry.url || entry.thumbnailUrl ? (
        <img
          src={entry.url || entry.thumbnailUrl}
          alt={entry.name}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      ) : (
        <PlaceholderViewer type="image" name={entry.name} />
      )}
    </div>
  );
}

function VideoViewer({ entry }: { entry: MediaIndexEntry }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        padding: 16,
      }}
    >
      {entry.url ? (
        <video
          src={entry.url}
          controls
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      ) : (
        <PlaceholderViewer type="video" name={entry.name} dark />
      )}
    </div>
  );
}

function AudioViewer({ entry }: { entry: MediaIndexEntry }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
        padding: 24,
      }}
    >
      <Volume2 size={64} className="text-muted-foreground" />
      <div className="text-sm text-foreground">{entry.name}</div>
      {entry.url && (
        <audio src={entry.url} controls style={{ width: "100%", maxWidth: 480 }} />
      )}
    </div>
  );
}

function PdfViewer({ entry }: { entry: MediaIndexEntry }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--color-surface)" }}>
      {entry.url ? (
        <iframe
          src={entry.url}
          title={entry.name}
          style={{ flex: 1, border: "none", width: "100%" }}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PlaceholderViewer type="pdf" name={entry.name} />
        </div>
      )}
    </div>
  );
}

function UrlViewer({ entry }: { entry: MediaIndexEntry }) {
  const [showEmbed, setShowEmbed] = useState(false);
  const meta = entry.urlMeta;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
      {/* OGP カード */}
      <div
        style={{
          padding: 16,
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-surface)",
        }}
      >
        {meta?.ogImage && (
          <div
            style={{
              width: "100%",
              aspectRatio: "1200 / 630",
              background: "var(--color-muted)",
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <img
              src={meta.ogImage}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <LinkIcon size={12} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{meta?.domain ?? "url"}</span>
        </div>
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-foreground hover:text-primary transition-colors"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {entry.name}
          <ExternalLink size={12} />
        </a>
        {meta?.description && (
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{meta.description}</p>
        )}
      </div>

      {/* Embed toggle */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--color-border-subtle)" }}>
        <button
          onClick={() => setShowEmbed(!showEmbed)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          {showEmbed ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showEmbed ? "Hide preview" : "Show preview (iframe)"}
        </button>
      </div>

      {/* Embed iframe（オプション） */}
      {showEmbed && entry.url && (
        <iframe
          src={entry.url}
          title={entry.name}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          style={{ flex: 1, border: "none", minHeight: 300, width: "100%" }}
        />
      )}
    </div>
  );
}

function FileViewer({ entry }: { entry: MediaIndexEntry }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
        padding: 24,
      }}
    >
      <Paperclip size={48} className="text-muted-foreground" />
      <div className="text-sm text-foreground text-center">{entry.name}</div>
      <div className="text-xs text-muted-foreground">{entry.mimeType}</div>
      {entry.url && (
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          Download <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function PlaceholderViewer({
  type,
  name,
  dark = false,
}: {
  type: MediaType;
  name: string;
  dark?: boolean;
}) {
  const fg = dark ? "rgba(255,255,255,0.6)" : "var(--color-text-muted)";
  return (
    <div style={{ textAlign: "center", color: fg }}>
      <div style={{ marginBottom: 8 }}>
        <TypeIcon type={type} size={48} />
      </div>
      <div className="text-xs">{name}</div>
      <div className="text-[10px] opacity-70 mt-1">(no preview)</div>
    </div>
  );
}

function ViewerByType({ entry }: { entry: MediaIndexEntry }) {
  switch (entry.type) {
    case "image":
      return <ImageViewer entry={entry} />;
    case "video":
      return <VideoViewer entry={entry} />;
    case "audio":
      return <AudioViewer entry={entry} />;
    case "pdf":
      return <PdfViewer entry={entry} />;
    case "url":
      return <UrlViewer entry={entry} />;
    default:
      return <FileViewer entry={entry} />;
  }
}

// ── メタ情報セクション（折りたたみ） ────────────────────────

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
        maxHeight: open ? 280 : 36,
        transition: "max-height 0.2s ease-out",
        overflow: "hidden",
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
              <span className="text-xs text-muted-foreground">
                {derivedCount} asset(s)
              </span>
            </MetaRow>
          )}
        </div>
      )}
    </div>
  );
}

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

// ── 本体 ───────────────────────────────────────────────────

export type MaterialSidePeekProps = {
  entry: MediaIndexEntry;
  onClose: () => void;
  /** 全画面表示へ昇格 */
  onOpenFull?: (entry: MediaIndexEntry) => void;
  /** 削除 */
  onDelete?: (entry: MediaIndexEntry) => void;
  /** 使用ノートへ遷移 */
  onNavigateNote?: (noteId: string) => void;
  /**
   * inline=true: 親 flex レイアウトに flex item として組み込まれる
   * inline=false（デフォルト）: 画面右端から portal で fixed 表示
   */
  inline?: boolean;
};

export function MaterialSidePeek({
  entry,
  onClose,
  onOpenFull,
  onDelete,
  onNavigateNote,
  inline = false,
}: MaterialSidePeekProps) {
  const containerStyle: React.CSSProperties = inline
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
          title="Close"
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 4,
              borderRadius: 4,
              background: TYPE_HEX[entry.type] + "18",
              color: TYPE_HEX[entry.type],
            }}
          >
            <TypeIcon type={entry.type} size={12} />
          </span>
          <span
            className="text-sm font-medium text-foreground truncate"
            title={entry.name}
          >
            {entry.name}
          </span>
        </div>
        {onOpenFull && (
          <button
            onClick={() => onOpenFull(entry)}
            title="Open in full view"
            style={{
              display: "flex",
              alignItems: "center",
              padding: 6,
              borderRadius: 4,
              color: "var(--color-text-secondary)",
            }}
            className="hover:bg-muted transition-colors"
          >
            <Maximize2 size={14} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(entry)}
            title="Delete"
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

      {/* 本体 viewer */}
      <ViewerByType entry={entry} />

      {/* メタデータ（折りたたみ） */}
      <MetaSection entry={entry} onNavigateNote={onNavigateNote} />
    </div>
  );

  if (inline) return body;
  return createPortal(body, document.body);
}
