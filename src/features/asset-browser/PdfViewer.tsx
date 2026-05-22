// PDF.js text-layer 付きビューア
// MaterialSidePeek / MaterialFullView の MediaPreview から呼ばれる。
//
// iframe（ブラウザ標準 PDF）ではテキスト選択イベントを拾えないため、
// react-pdf の text-layer を有効化し、selectionchange を listen して
// SelectionPill をフロート表示する。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "../../lib/pdfjs-config";

import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndexEntry } from "./media-index";
import { SelectionPill, type CitationSource } from "./SelectionPill";

export type PdfViewerProps = {
  entry: MediaIndexEntry;
  /** Note へ引用ブロックとして挿入 — undefined のときはボタンを表示しない */
  onQuoteToNote?: (source: CitationSource) => void;
  /** Composer Ask に quotedMarkdown として渡す */
  onQuoteToChat?: (source: CitationSource) => void;
};

type PillState = {
  text: string;
  pageNumber: number;
  /** viewport 座標 */
  top: number;
  left: number;
};

const PAGE_WIDTH = 720;

export function PdfViewer({ entry, onQuoteToNote, onQuoteToChat }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pill, setPill] = useState<PillState | null>(null);

  // 1 回しか変わらないストレージプロバイダ依存の解決を memo
  const fileIdResolved = useMemo(
    () => getActiveProvider().extractFileId(entry.url) ?? null,
    [entry.url],
  );

  // Blob URL を取得
  useEffect(() => {
    if (!entry.url) {
      setError("PDF の URL が空です");
      return;
    }
    let cancelled = false;
    setBlobUrl(null);
    setError(null);
    setCurrentPage(1);
    setNumPages(0);
    setPill(null);

    const provider = getActiveProvider();
    if (!fileIdResolved) {
      // ローカル blob URL などをそのまま使用
      setBlobUrl(entry.url);
      return;
    }
    provider
      .getMediaBlobUrl(fileIdResolved)
      .then((url) => {
        if (!cancelled) setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("PDF の取得に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.url, fileIdResolved]);

  // text-layer 内の選択を検出して pill を表示
  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      const container = containerRef.current;
      if (!selection || !container) {
        setPill(null);
        return;
      }
      if (selection.isCollapsed || selection.rangeCount === 0) {
        setPill(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      // 選択範囲がこの viewer 内（text-layer span）に収まっていることを確認
      const ancestorEl =
        ancestor.nodeType === Node.ELEMENT_NODE
          ? (ancestor as Element)
          : ancestor.parentElement;
      if (!ancestorEl || !container.contains(ancestorEl)) {
        return;
      }
      // text-layer の中で起きた選択だけ拾う（ヘッダー UI のクリック選択を除外）
      const inTextLayer = ancestorEl.closest(".react-pdf__Page__textContent");
      if (!inTextLayer) {
        setPill(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setPill(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setPill({
        text,
        pageNumber: currentPage,
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [currentPage]);

  const onDocumentLoad = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setError(null);
  }, []);

  const onDocumentError = useCallback(() => {
    setError("PDF の読み込みに失敗しました");
  }, []);

  const buildSource = useCallback(
    (state: PillState): CitationSource => ({
      entry: {
        fileId: entry.fileId,
        name: entry.name,
        type: entry.type,
        url: entry.url,
        urlMeta: entry.urlMeta,
      },
      selectionText: state.text,
      pageNumber: state.pageNumber,
    }),
    [entry],
  );

  const handleQuoteToNote = useCallback(
    (source: CitationSource) => {
      onQuoteToNote?.(source);
      setPill(null);
      window.getSelection()?.removeAllRanges();
    },
    [onQuoteToNote],
  );

  const handleQuoteToChat = useCallback(
    (source: CitationSource) => {
      onQuoteToChat?.(source);
      setPill(null);
      window.getSelection()?.removeAllRanges();
    },
    [onQuoteToChat],
  );

  if (error) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        {error}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        読み込み中...
      </div>
    );
  }

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
      {/* ページ操作バー */}
      {numPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-border-subtle)",
            background: "var(--color-card)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            title="Previous page"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 4,
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              background: "transparent",
              cursor: currentPage <= 1 ? "not-allowed" : "pointer",
              opacity: currentPage <= 1 ? 0.4 : 1,
              color: "var(--color-foreground)",
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", minWidth: 80, textAlign: "center" }}>
            {currentPage} / {numPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            title="Next page"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 4,
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              background: "transparent",
              cursor: currentPage >= numPages ? "not-allowed" : "pointer",
              opacity: currentPage >= numPages ? 0.4 : 1,
              color: "var(--color-foreground)",
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* PDF 本体 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: 16,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        <Document
          file={blobUrl}
          onLoadSuccess={onDocumentLoad}
          onLoadError={onDocumentError}
          loading={<div className="text-muted-foreground text-sm">読み込み中...</div>}
        >
          <Page
            pageNumber={currentPage}
            width={PAGE_WIDTH}
            renderTextLayer
            renderAnnotationLayer={false}
          />
        </Document>
      </div>

      {/* SelectionPill — 引用先がひとつも提供されていない場合は出さない */}
      {pill && (onQuoteToNote || onQuoteToChat) && (
        <SelectionPill
          source={buildSource(pill)}
          onQuoteToNote={onQuoteToNote ? handleQuoteToNote : undefined}
          onQuoteToChat={onQuoteToChat ? handleQuoteToChat : undefined}
          onDismiss={() => {
            setPill(null);
            window.getSelection()?.removeAllRanges();
          }}
          position={{ top: pill.top, left: pill.left }}
        />
      )}
    </div>
  );
}
