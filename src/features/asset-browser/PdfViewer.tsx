// PDF.js text-layer 付きビューア
// MaterialSidePeek / MaterialFullView の MediaPreview から呼ばれる。
//
// iframe（ブラウザ標準 PDF）ではテキスト選択イベントを拾えないため、
// react-pdf の text-layer を有効化し、selectionchange を listen して
// SelectionPill をフロート表示する。
//
// 表示は全ページを縦スクロールで並べる（論文 PDF を読む UX を優先）。
// 現在ページ（引用 caption の p.N 用）は IntersectionObserver で
// もっとも viewport に出ているページから決定する。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { PDFJS_DOC_OPTIONS } from "../../lib/pdfjs-config";

import { useT } from "../../i18n";
import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaIndexEntry } from "./media-index";
import { SelectionPill, type CitationSource } from "./SelectionPill";
import { normalizePdfSelectionText } from "./pdf-selection-text";

export type PdfViewerProps = {
  entry: MediaIndexEntry;
  /** PDF text-layer の選択を新規メモとして保存 — undefined のとき pill 自体を出さない */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
};

type PillState = {
  text: string;
  pageNumber: number;
  /** viewport 座標 */
  top: number;
  left: number;
  /** 選択範囲の上に出すか下に出すか（viewport 上端で見切れる場合は下） */
  placement: "above" | "below";
};

/** 基準幅。zoom と掛け合わせて Page の width を決める */
const BASE_PAGE_WIDTH = 720;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.2;

export function PdfViewer({ entry, onSaveSelectionAsMemo }: PdfViewerProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
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
    pageRefs.current.clear();

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

  // ── 選択検出 ──
  // selectionchange はドラッグ中に大量に発火し、commonAncestorContainer が
  // text-layer の外側（document/body）になる過渡状態もあるため、
  // mouseup（マウスでの選択確定）と selectionchange（キーボード選択）を
  // 両方 listen して、いずれも確定した選択範囲を解釈する方針にする。
  //
  // 引用 p.N を確定するためには「選択範囲が乗っているページ番号」が要る。
  // anchorNode から data-page-number を遡って拾う。
  useEffect(() => {
    const evaluateSelection = () => {
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

      // 選択範囲のどこか（anchor / focus / commonAncestor）が viewer 内なら採用
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
        if (el && container.contains(el)) {
          anchoredEl = el;
          break;
        }
      }
      if (!anchoredEl) {
        // viewer 外の選択 — 既存 pill を維持
        return;
      }

      // text-layer の中にいるか確認（react-pdf v10 は `.textLayer` を使う；
      // 旧バージョン互換として `.react-pdf__Page__textContent` も拾う）
      const inTextLayer =
        anchoredEl.closest(".textLayer") ||
        anchoredEl.closest(".react-pdf__Page__textContent");
      if (!inTextLayer) {
        // viewer 内だがツールバー側等 — 既存 pill を維持
        return;
      }

      // PDF の text layer は視覚的な行単位で改行が入っている。
      // ハイフネーション解消と段落内改行の除去をかけて、読みやすい形に整える。
      const text = normalizePdfSelectionText(selection.toString());
      if (!text) {
        setPill(null);
        return;
      }

      const pageWrapper = anchoredEl.closest("[data-page-number]");
      const pageNumberAttr = pageWrapper?.getAttribute("data-page-number");
      const pageNumber = pageNumberAttr ? Number(pageNumberAttr) : currentPage;
      const rect = range.getBoundingClientRect();
      // viewport の上端が近いと translate(-100%) で画面外に出るため、その場合は
      // 選択範囲の下に出す。
      const willClipTop = rect.top < 48;
      setPill({
        text,
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : currentPage,
        top: willClipTop ? rect.bottom + 8 : rect.top,
        left: rect.left + rect.width / 2,
        placement: willClipTop ? "below" : "above",
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      // pill 自身のクリックは無視（pill 内ボタン押下時に re-evaluate しない）
      const target = e.target;
      if (target instanceof Element && target.closest("[data-selection-pill]")) return;
      // Chrome は mouseup 時点で selection 確定済みだが、Safari は次フレームになる
      // ケースがあるため setTimeout で 1 フレーム待つ
      setTimeout(evaluateSelection, 0);
    };
    const onSelectionChange = () => evaluateSelection();

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [currentPage]);

  // ── スクロール時の current page 追跡 ──
  // viewport の中央に最も近いページを current にする。
  useEffect(() => {
    if (numPages === 0) return;
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 最も visible なエントリを採用
        let bestPage = currentPage;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            const p = (e.target as HTMLElement).dataset.pageNumber;
            if (p) bestPage = Number(p);
          }
        }
        if (bestPage !== currentPage && bestRatio > 0) {
          setCurrentPage(bestPage);
        }
      },
      {
        root: scrollArea,
        threshold: [0.25, 0.5, 0.75],
      },
    );

    // 全ページ要素を observe
    pageRefs.current.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [numPages, currentPage]);

  const registerPage = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) {
      pageRefs.current.set(pageNumber, el);
    } else {
      pageRefs.current.delete(pageNumber);
    }
  }, []);

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

  const handleSaveAsMemo = useCallback(
    (source: CitationSource) => {
      onSaveSelectionAsMemo?.(source);
      setPill(null);
      window.getSelection()?.removeAllRanges();
    },
    [onSaveSelectionAsMemo],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10));
  }, []);
  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10));
  }, []);
  const handleZoomReset = useCallback(() => setZoom(1), []);

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

  const pageWidth = BASE_PAGE_WIDTH * zoom;
  const toolBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    width: 24,
    height: 24,
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    background: "transparent",
    cursor: "pointer",
    color: "var(--color-foreground)",
  };

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
      {/* ツールバー: ページ位置インジケーター + ズーム */}
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
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", minWidth: 80 }}>
          {numPages > 0
            ? t("asset.pdf.pageOf", {
                current: String(currentPage),
                total: String(numPages),
              })
            : "…"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= ZOOM_MIN}
            title={t("asset.pdf.zoomOut")}
            aria-label={t("asset.pdf.zoomOut")}
            style={{
              ...toolBtnStyle,
              cursor: zoom <= ZOOM_MIN ? "not-allowed" : "pointer",
              opacity: zoom <= ZOOM_MIN ? 0.4 : 1,
            }}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={handleZoomReset}
            disabled={zoom === 1}
            title={t("asset.pdf.zoomReset")}
            aria-label={t("asset.pdf.zoomReset")}
            style={{
              ...toolBtnStyle,
              cursor: zoom === 1 ? "default" : "pointer",
              opacity: zoom === 1 ? 0.4 : 1,
              minWidth: 48,
              width: "auto",
              padding: "4px 8px",
              fontSize: 11,
            }}
          >
            <RotateCcw size={12} style={{ marginRight: 4 }} />
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= ZOOM_MAX}
            title={t("asset.pdf.zoomIn")}
            aria-label={t("asset.pdf.zoomIn")}
            style={{
              ...toolBtnStyle,
              cursor: zoom >= ZOOM_MAX ? "not-allowed" : "pointer",
              opacity: zoom >= ZOOM_MAX ? 0.4 : 1,
            }}
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* PDF 本体: 全ページを縦に並べる。
          オーバーフロー時の挙動:
            - flex + justify-content:center だと左端にスクロールできない既知の問題があるため、
              各ページラッパは width:fit-content + margin:0 auto で中央寄せする。
              （ページがコンテナより狭ければ中央、広ければ左寄せで水平スクロール可能になる）
            - overscroll-behavior-x:contain で macOS の二本指横スワイプ→「戻る」を抑止 */}
      <div
        ref={scrollAreaRef}
        style={{
          flex: 1,
          overflow: "auto",
          overscrollBehaviorX: "contain",
          padding: 16,
          minHeight: 0,
          background: "var(--color-surface)",
        }}
      >
        <Document
          file={blobUrl}
          options={PDFJS_DOC_OPTIONS}
          onLoadSuccess={onDocumentLoad}
          onLoadError={onDocumentError}
          loading={<div className="text-muted-foreground text-sm text-center py-8">読み込み中...</div>}
        >
          {numPages > 0 &&
            Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
              <div
                key={pageNumber}
                ref={(el) => registerPage(pageNumber, el)}
                data-page-number={pageNumber}
                style={{
                  width: "fit-content",
                  margin: "0 auto 12px",
                }}
              >
                <Page
                  pageNumber={pageNumber}
                  width={pageWidth}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />
              </div>
            ))}
        </Document>
      </div>

      {/* SelectionPill — メモ保存ハンドラがない場合は出さない */}
      {pill && onSaveSelectionAsMemo && (
        <SelectionPill
          source={buildSource(pill)}
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
