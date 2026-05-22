// 素材詳細ビューの共通メタデータセクション
// MaterialSidePeek と MaterialFullView から共有して使う。
// Name は inline edit 可（rename ハンドラが渡されていれば）。

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { useT } from "../../i18n";
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

export type MaterialMetadataSectionProps = {
  entry: MediaIndexEntry;
  onNavigateNote?: (noteId: string) => void;
  /** Name を inline 編集するためのハンドラ。未指定なら読み取り専用表示 */
  onRename?: (entry: MediaIndexEntry, newName: string) => Promise<void>;
  /** デフォルトで開くか（既定: true）。"plain" 時は無視される（常に open） */
  defaultOpen?: boolean;
  /**
   * "collapsible"（既定）: 自前で「Metadata」トグルボタン + 内容を出す。SidePeek 用。
   * "plain": 内容だけを出す（呼び出し側のパネルが container/タイトル役を担う）。
   *          MaterialFullView の右パネル内で使うとき向け。
   */
  variant?: "collapsible" | "plain";
};

export function MaterialMetadataSection({
  entry,
  onNavigateNote,
  onRename,
  defaultOpen = true,
  variant = "collapsible",
}: MaterialMetadataSectionProps) {
  const t = useT();
  const collapsible = variant === "collapsible";
  const [open, setOpen] = useState(defaultOpen);
  const derivedCount = entry.derivedFromAssets?.length ?? 0;

  // Name 編集
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

  const contentStyle: React.CSSProperties = collapsible
    ? {
        padding: "0 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflow: "auto",
        maxHeight: 280,
      }
    : {
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflow: "auto",
      };

  const showContent = collapsible ? open : true;

  return (
    <div
      style={
        collapsible
          ? {
              borderTop: "1px solid var(--color-border-subtle)",
              background: "var(--color-card)",
              flexShrink: 0,
            }
          : undefined
      }
    >
      {collapsible && (
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
      )}
      {showContent && (
        <div style={contentStyle}>
          <MetaRow label="Name">
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
                className="text-xs text-foreground bg-transparent border-b border-primary outline-none w-full"
              />
            ) : (
              <span
                className={`text-xs text-foreground break-words ${onRename ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
                title={onRename ? t("asset.clickToRename") : entry.name}
                onClick={() => { if (onRename) setEditing(true); }}
              >
                {entry.name}
              </span>
            )}
          </MetaRow>
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
