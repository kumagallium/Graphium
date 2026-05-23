// URL Reader Mode ビューア (PR3-d)
//
// PdfViewer と対称な体験を URL アセットに与える。
// - サーバーの /api/url/reader を叩いて Readability 抽出結果を取得
// - 本文 HTML を sandbox 化したコンテナに描画（サーバー側で sanitize 済み）
// - PdfViewer と同じ mouseup + selectionchange パターンで選択検出
// - 選択確定時に SelectionPill を出して onSaveSelectionAsMemo に流す
//
// Readability が読み取れなかった URL（SPA / paywall / 非記事）は
// 既存の OGP カード (UrlPreview) に fallback する。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useT } from "../../i18n";
import { apiBase } from "../../lib/platform";
import type { MediaIndexEntry } from "./media-index";
import { persistUrlMetaPatch } from "./media-index";
import { SelectionPill, type CitationSource } from "./SelectionPill";
import { UrlPreviewCard } from "./url-preview-card";
import { buildTextFragment } from "./text-fragment";

type ReaderArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  content: string;
  textContent: string;
  excerpt: string;
  leadImage: string | null;
  fetchedAt: string;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; article: ReaderArticle }
  | { kind: "empty"; reason?: string }
  | { kind: "error"; message: string };

type PillState = {
  text: string;
  top: number;
  left: number;
  placement: "above" | "below";
};

export type UrlReaderViewProps = {
  entry: MediaIndexEntry;
  /** Reader 内の選択を新規メモとして保存 — undefined のとき pill 自体を出さない */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
};

export function UrlReaderView({ entry, onSaveSelectionAsMemo }: UrlReaderViewProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [pill, setPill] = useState<PillState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // ── Reader 取得 ──
  useEffect(() => {
    if (!entry.url) {
      setStatus({ kind: "empty", reason: "URL が空です" });
      return;
    }
    let cancelled = false;
    setStatus({ kind: "loading" });
    setPill(null);

    (async () => {
      try {
        const res = await fetch(`${apiBase()}/url/reader`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: entry.url }),
        });
        if (cancelled) return;
        if (res.status === 422) {
          // Reader が読み取れなかった → fallback
          setStatus({ kind: "empty" });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setStatus({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
          return;
        }
        const article = (await res.json()) as ReaderArticle;
        if (!article.content || !article.textContent) {
          setStatus({ kind: "empty" });
          return;
        }
        setStatus({ kind: "ready", article });
        // Phase 4: excerpt / lang をインデックスに書き戻して
        // 次回 AssetGalleryView の URL カード等に出せるようにする。
        // 書き込み失敗は UI 表示に影響しないため await しない。
        void persistUrlMetaPatch(entry.fileId, {
          excerpt: article.excerpt || undefined,
          lang: article.lang || undefined,
          leadImage: article.leadImage || undefined,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Reader 取得に失敗しました";
        setStatus({ kind: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry.url, reloadKey]);

  // ── 選択検出 ──
  // PdfViewer と同じ「mouseup + selectionchange の両方を listen」パターン。
  // article コンテナ内に anchor が乗っているときだけ pill を出す。
  useEffect(() => {
    if (status.kind !== "ready") {
      setPill(null);
      return;
    }
    const evaluateSelection = () => {
      const selection = window.getSelection();
      const article = articleRef.current;
      if (!selection || !article) {
        setPill(null);
        return;
      }
      if (selection.isCollapsed || selection.rangeCount === 0) {
        setPill(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const candidateNodes: Array<Node | null> = [
        selection.anchorNode,
        selection.focusNode,
        range.startContainer,
        range.endContainer,
        range.commonAncestorContainer,
      ];
      let anchoredEl: Element | null = null;
      for (const node of candidateNodes) {
        if (!node) continue;
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        if (el && article.contains(el)) {
          anchoredEl = el;
          break;
        }
      }
      if (!anchoredEl) {
        // article 外 — 既存 pill は維持
        return;
      }

      const text = normalizeReaderSelectionText(selection.toString());
      if (!text) {
        setPill(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const willClipTop = rect.top < 48;
      setPill({
        text,
        top: willClipTop ? rect.bottom + 8 : rect.top,
        left: rect.left + rect.width / 2,
        placement: willClipTop ? "below" : "above",
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("[data-selection-pill]")) return;
      setTimeout(evaluateSelection, 0);
    };
    const onSelectionChange = () => evaluateSelection();

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [status.kind]);

  const buildSource = useCallback(
    (state: PillState, article: ReaderArticle): CitationSource => ({
      entry: {
        fileId: entry.fileId,
        name: entry.name,
        type: entry.type,
        url: entry.url,
        urlMeta: entry.urlMeta,
      },
      selectionText: state.text,
      textFragment: buildTextFragment(state.text, article.textContent),
    }),
    [entry],
  );

  const handleSaveAsMemo = useCallback(
    (source: CitationSource) => {
      onSaveSelectionAsMemo?.(source);
      setPill(null);
      window.getSelection()?.removeAllRanges();
    },
    [onSaveSelectionAsMemo],
  );

  const handleReload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  // ── レンダリング ──
  if (status.kind === "loading") {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-secondary)",
          fontSize: 13,
        }}
      >
        {t("asset.url.readerLoading")}
      </div>
    );
  }

  if (status.kind === "empty") {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {t("asset.url.readerEmpty")}
        </p>
        <UrlPreviewCard entry={entry} />
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
        }}
      >
        <p style={{ fontSize: 13, color: "var(--color-error)" }}>
          {t("asset.url.readerError")}: {status.message}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleReload}
            style={toolBtnPrimary}
            className="hover:opacity-90"
          >
            <RefreshCw size={12} style={{ marginRight: 4 }} />
            {t("asset.url.readerRetry")}
          </button>
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            style={toolBtnSecondary}
            className="hover:bg-muted"
          >
            <ExternalLink size={12} style={{ marginRight: 4 }} />
            {t("asset.urlOpen")}
          </a>
        </div>
      </div>
    );
  }

  // ── ready ──
  const { article } = status;
  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* ツールバー: ドメイン + 原文を開く */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          background: "var(--color-card)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {article.siteName ?? entry.urlMeta?.domain ?? ""}
          {article.byline ? ` · ${article.byline}` : ""}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            style={toolBtnSecondary}
            className="hover:bg-muted transition-colors"
          >
            <ExternalLink size={12} style={{ marginRight: 4 }} />
            {t("asset.urlOpen")}
          </a>
        </div>
      </div>

      {/* 本文スクロール領域 */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 24,
          minHeight: 0,
          background: "var(--color-surface)",
        }}
      >
        <article
          ref={articleRef}
          data-graphium-reader-root
          lang={article.lang ?? undefined}
          style={{
            margin: "0 auto",
            maxWidth: "68ch",
            fontFamily: "var(--ui)",
            fontSize: 15,
            lineHeight: 1.7,
            color: "var(--ink)",
          }}
          className="graphium-reader-article"
        >
          {article.title && (
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                lineHeight: 1.3,
                margin: "0 0 16px",
                color: "var(--ink)",
              }}
            >
              {article.title}
            </h1>
          )}
          <div
            // サーバー側で sanitize 済み（sanitizeReaderHtml）。
            // ここで dangerouslySetInnerHTML を使う前提はサーバーを信頼すること。
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        </article>
      </div>

      {/* SelectionPill — メモ保存ハンドラがない場合は出さない */}
      {pill && onSaveSelectionAsMemo && (
        <SelectionPill
          source={buildSource(pill, article)}
          onSaveAsMemo={handleSaveAsMemo}
          onDismiss={() => {
            setPill(null);
            window.getSelection()?.removeAllRanges();
          }}
          position={{ top: pill.top, left: pill.left, placement: pill.placement }}
        />
      )}
    </div>
  );
}

/**
 * Reader 由来のテキストには PDF ほどの行折り問題はないが、
 * CJK のゼロ幅・特殊空白だけ整える。
 */
function normalizeReaderSelectionText(raw: string): string {
  return raw
    .replace(/ /g, " ")
    .replace(/[  -​]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const toolBtnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "transparent",
  color: "var(--color-foreground)",
  textDecoration: "none",
  cursor: "pointer",
};

const toolBtnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  fontSize: 11,
  borderRadius: 4,
  border: "none",
  background: "var(--color-primary)",
  color: "var(--color-primary-foreground)",
  cursor: "pointer",
};
