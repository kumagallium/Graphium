// 素材 viewer 内でテキスト選択時に出るフローティング pill
// PDF / URL embed / 画像 OCR テキストなどから共通で使う想定。
// 引用は一旦「メモに保存」だけに揃え、PDF スコープのチャットは別 PR で扱う。

import { StickyNote, BookOpen } from "lucide-react";
import { useT } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";

export type PillState = {
  text: string;
  top: number;
  left: number;
  placement: "above" | "below";
};

export type CitationSource = {
  /** 引用元アセット */
  entry: Pick<MediaIndexEntry, "fileId" | "name" | "type" | "url" | "urlMeta">;
  /** 選択テキスト */
  selectionText: string;
  /** PDF の場合のページ番号 */
  pageNumber?: number;
  /** URL の場合の text fragment（Scroll To Text Fragment 形式 :~:text=...） */
  textFragment?: string;
};

export type SelectionPillProps = {
  source: CitationSource;
  /** 選択範囲を新規メモとして保存 */
  onSaveAsMemo: (source: CitationSource) => void;
  /** 取り消し（選択解除） */
  onDismiss?: () => void;
  /**
   * viewport 上の位置。指定しない場合は inline で親が制御。
   * placement="above" (default): top を pill 下端として上方向に配置（選択範囲の上に出す）
   * placement="below": top を pill 上端として下方向に配置（選択範囲の下に出す）
   */
  position?: { top: number; left: number; placement?: "above" | "below" };
};

/**
 * 選択テキストの上にフロートする小さな pill。
 * Notion / Apple Books の選択メニューと同じパターン。
 */
export function SelectionPill({
  source,
  onSaveAsMemo,
  onDismiss,
  position,
}: SelectionPillProps) {
  const t = useT();
  const placement = position?.placement ?? "above";
  const containerStyle: React.CSSProperties = position
    ? {
        position: "fixed",
        top: position.top,
        left: position.left,
        // above: 自身の高さ分上に引き上げる / below: そのまま下に置く
        transform: placement === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
        marginTop: placement === "above" ? -8 : 0,
        zIndex: 200,
      }
    : { position: "relative", display: "inline-block" };

  return (
    <div
      style={{
        ...containerStyle,
        background: "var(--color-popover, #fff)",
        border: "1px solid var(--color-border, #e5e7eb)",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
        padding: 4,
        display: "flex",
        gap: 2,
        alignItems: "center",
      }}
      data-selection-pill
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onSaveAsMemo(source)}
        title={t("asset.quoteToMemoTooltip")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: "var(--color-foreground)",
          fontSize: 12,
          cursor: "pointer",
        }}
        className="hover:bg-muted transition-colors"
      >
        <StickyNote size={14} />
        {t("asset.quoteToMemo")}
      </button>

      {onDismiss && (
        <>
          <div style={{ width: 1, height: 18, background: "var(--color-border)" }} />
          <button
            type="button"
            onClick={onDismiss}
            title={t("asset.quoteDismiss")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--color-text-tertiary, #888)",
              fontSize: 12,
              cursor: "pointer",
            }}
            className="hover:bg-muted transition-colors"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Note に挿入される引用ブロックの見た目プレビュー。
 * 実装時は BlockNote の "quote" block を使う想定。
 * source 表示は wiki banner と同じ形式に揃える。
 */
export function CitationBlockPreview({ source }: { source: CitationSource }) {
  const sourceLabel = (() => {
    if (source.entry.type === "pdf") {
      return `${source.entry.name}${source.pageNumber ? ` · p.${source.pageNumber}` : ""}`;
    }
    if (source.entry.type === "url") {
      return source.entry.urlMeta?.domain ?? source.entry.name;
    }
    return source.entry.name;
  })();

  return (
    <div
      style={{
        borderLeft: "3px solid var(--forest, #4B7A52)",
        paddingLeft: 12,
        paddingTop: 6,
        paddingBottom: 6,
        margin: "12px 0",
      }}
    >
      <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-2)", margin: 0 }}>
        {source.selectionText}
      </p>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "var(--ink-3)",
        }}
      >
        <BookOpen size={11} />
        <span>Source: {sourceLabel}</span>
        {source.entry.type === "url" && source.entry.url && (
          <a
            href={source.entry.url + (source.textFragment ? `#:~:text=${encodeURIComponent(source.textFragment)}` : "")}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--color-primary)", textDecoration: "none" }}
          >
            ↗
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Composer Ask に渡される quoted state の見た目プレビュー。
 * 実装時は AI Assistant store の openChat({ sourceBlockIds, quotedMarkdown }) を呼ぶ。
 * sourceBlockIds は素材引用の場合は空、quotedMarkdown に出典付き引用を Markdown で渡す。
 */
export function ComposerQuotedPreview({ source }: { source: CitationSource }) {
  const sourceLabel = (() => {
    if (source.entry.type === "pdf") {
      return `${source.entry.name}${source.pageNumber ? `, p.${source.pageNumber}` : ""}`;
    }
    if (source.entry.type === "url") {
      return source.entry.urlMeta?.domain ?? source.entry.name;
    }
    return source.entry.name;
  })();

  return (
    <div
      style={{
        background: "var(--color-muted, #f5f5f5)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        padding: 8,
        margin: "8px 0",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 4 }}>
        Quoted from {sourceLabel}
      </div>
      <blockquote
        style={{
          margin: 0,
          paddingLeft: 8,
          borderLeft: "2px solid var(--color-border)",
          fontSize: 12,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}
      >
        {source.selectionText}
      </blockquote>
    </div>
  );
}
