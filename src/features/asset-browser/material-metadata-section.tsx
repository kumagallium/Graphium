// 素材詳細ビューの共通メタデータセクション
// MaterialSidePeek と MaterialFullView から共有して使う。
// Name は inline edit 可（rename ハンドラが渡されていれば）。

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { useT } from "../../i18n";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import type { MediaIndexEntry, MediaType, MediaUsage } from "./media-index";
import { persistOcrTextPatch } from "./media-index";
import { formatDateTime } from "../../lib/format-datetime";
import { getActiveProvider } from "../../lib/storage/registry";
import { runOcrForImage } from "../media-ocr";

const TYPE_HEX: Record<MediaType, string> = {
  image: "#5b8fb9",
  video: "#5b8fb9",
  audio: "#c08b3e",
  pdf: "#c26356",
  url: "#4B7A52",
  document: "#6f5b8b",
  memo: "#b08d3a",
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

  // 画像から読み取ったテキスト（端末内 OCR）。取得元は 2 つある:
  //   1. 素材自身（media-index の ocrText）— ここから読んだ結果。ノート未使用でも持てる
  //   2. その画像を貼っているノートの page.mediaOcr — ノート側で読んだ結果
  // 1 を優先し、無ければ 2 を探す。どちらも無ければ「読む」ボタンを出す。
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const usedIn = entry.usedIn;
  const isImage = entry.type === "image";
  const indexOcrText = entry.ocrText?.trim() || null;

  useEffect(() => {
    if (!isImage) {
      setOcrText(null);
      return;
    }
    if (indexOcrText) {
      setOcrText(indexOcrText);
      return;
    }
    if (usedIn.length === 0) {
      setOcrText(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const u of usedIn) {
        if (!u.noteId || !u.blockId) continue;
        try {
          const doc = await getActiveProvider().loadFile(u.noteId);
          const text = doc?.pages?.[0]?.mediaOcr?.[u.blockId]?.text?.trim();
          if (text) {
            if (!cancelled) setOcrText(text);
            return;
          }
        } catch {
          // 読めないノート（削除済み等）は飛ばす
        }
      }
      if (!cancelled) setOcrText(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage, usedIn, indexOcrText]);

  /** この素材の画像を読み取り、結果を media-index に残す（ノート未使用でも使える経路） */
  const readImageText = useCallback(async () => {
    if (reading) return;
    setReading(true);
    try {
      const result = await runOcrForImage(entry.url);
      setOcrText(result.text || null);
      await persistOcrTextPatch(entry.fileId, result.text);
    } catch (e) {
      console.warn("素材の OCR に失敗:", e);
    } finally {
      setReading(false);
    }
  }, [reading, entry.url, entry.fileId]);

  // Name 編集
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [renaming, setRenaming] = useState(false);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

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
                {...compositionHandlers}
                onKeyDown={(e) => {
                  // IME 変換確定の Enter では確定しない（WKWebView の
                  // compositionend → keydown(13) 順対応。lib/ime-enter.ts 参照）
                  if (e.key === "Enter" && !isImeKey(e)) handleRename();
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
          {isImage && (
            <MetaRow label="Text in image">
              {ocrText ? (
                <>
                  {/* 全文を出す。高さを絞るとスクロールバーが自動で隠れる環境で
                      「途中で切れている」ように見えるため、パネル側のスクロールに任せる。 */}
                  <span className="text-xs text-muted-foreground whitespace-pre-wrap break-words block">
                    {ocrText}
                  </span>
                  <button
                    onClick={() => void readImageText()}
                    disabled={reading}
                    className="mt-1 text-[11px] text-muted-foreground underline hover:text-foreground disabled:opacity-60"
                  >
                    {reading ? t("ocr.running") : t("ocr.readText")}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void readImageText()}
                  disabled={reading}
                  className="inline-flex items-center gap-1 text-xs text-primary underline hover:opacity-80 disabled:opacity-60"
                >
                  {reading ? t("ocr.running") : t("ocr.readText")}
                </button>
              )}
            </MetaRow>
          )}
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
