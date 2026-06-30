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
  // ピンチズーム中の即時プレビュー用。ジェスチャ中はこの要素を CSS transform で
  // スケールし、確定時に zoom state へ反映して再ラスタライズする。
  const pagesWrapperRef = useRef<HTMLDivElement | null>(null);
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

  // ── ピンチズーム（トラックパッド） ──
  // macOS のピンチは届き方が 2 系統ある:
  //   - ブラウザ版 (Chrome): `wheel` イベントの ctrlKey=true
  //   - デスクトップ版 (Tauri = WKWebView): Safari の gesturestart/change/end
  // 両方に対応する。26 ページ全部を毎フレーム再描画するとカクつくため、
  // ジェスチャ中は wrapper を CSS transform でスケールして即時プレビューし、
  // 指を離した時点で一度だけ zoom state に確定して綺麗に再ラスタライズする。
  // ビューポート中央を固定点として、確定後にスクロール位置を補正する。
  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const wrapper = pagesWrapperRef.current;
    if (!scrollArea || !wrapper || numPages === 0) return;

    let live = 1; // ジェスチャ中の累積スケール
    let anchor: { localX: number; localY: number; vw: number; vh: number } | null = null;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;

    const begin = () => {
      const saRect = scrollArea.getBoundingClientRect();
      const wRect = wrapper.getBoundingClientRect();
      // ビューポート中央を wrapper ローカル座標（変形前）に変換し、変形の原点にする
      const vcx = saRect.left + saRect.width / 2;
      const vcy = saRect.top + saRect.height / 2;
      anchor = {
        localX: vcx - wRect.left,
        localY: vcy - wRect.top,
        vw: saRect.width,
        vh: saRect.height,
      };
      wrapper.style.transformOrigin = `${anchor.localX}px ${anchor.localY}px`;
    };

    const applyLive = (scale: number) => {
      // zoom * live が [MIN, MAX] に収まるよう live をクランプ
      let s = scale;
      if (zoom * s < ZOOM_MIN) s = ZOOM_MIN / zoom;
      if (zoom * s > ZOOM_MAX) s = ZOOM_MAX / zoom;
      live = s;
      wrapper.style.transform = `scale(${s})`;
    };

    const commit = () => {
      commitTimer = null;
      const a = anchor;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * live * 100) / 100));
      const ratio = newZoom / zoom;
      wrapper.style.transform = "";
      wrapper.style.transformOrigin = "";
      live = 1;
      anchor = null;
      if (newZoom === zoom || !a) return;
      setZoom(newZoom);
      // 再ラスタライズ後にビューポート中央の固定点を復元する。
      // ラスタライズは非同期なので rAF と短い遅延の二段で補正する。
      const restore = () => {
        scrollArea.scrollLeft = a.localX * ratio - a.vw / 2;
        scrollArea.scrollTop = a.localY * ratio - a.vh / 2;
      };
      requestAnimationFrame(restore);
      setTimeout(restore, 120);
    };

    const scheduleCommit = () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(commit, 160);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // ピンチ以外（通常スクロール）は素通し
      e.preventDefault();
      if (!anchor) begin();
      applyLive(live * Math.exp(-e.deltaY * 0.01));
      scheduleCommit();
    };

    // Safari (WKWebView) の gesture イベント。TS の標準 lib に型が無いので any 経由。
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      begin();
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!anchor) begin();
      applyLive((e as unknown as { scale: number }).scale);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      commit();
    };

    scrollArea.addEventListener("wheel", onWheel, { passive: false });
    scrollArea.addEventListener("gesturestart", onGestureStart);
    scrollArea.addEventListener("gesturechange", onGestureChange);
    scrollArea.addEventListener("gestureend", onGestureEnd);
    return () => {
      scrollArea.removeEventListener("wheel", onWheel);
      scrollArea.removeEventListener("gesturestart", onGestureStart);
      scrollArea.removeEventListener("gesturechange", onGestureChange);
      scrollArea.removeEventListener("gestureend", onGestureEnd);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, [zoom, numPages]);

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
        {/* ピンチズーム中はこの wrapper を CSS transform でスケールする（即時プレビュー）。
            確定時に transform を外し zoom（= Page の width）へ反映して再ラスタライズ。 */}
        <div ref={pagesWrapperRef}>
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
