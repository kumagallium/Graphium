// ドキュメント素材プレビュー（.docx 等）
// .docx は mammoth.js で HTML 化して表示する。
// 他のドキュメント形式（Excel/PowerPoint 等）は現状未対応で placeholder を出す。
//
// 取り込み時と同じ mammoth 経路を踏み、画像は base64 data URL で埋め込む。
// ブラウザで表示できない形式（EMF / TIFF）は docx-import/renderable-image の
// 変換器で PNG / SVG に変換してから埋め込む（研究文書の Excel グラフ貼り付け等）。
// プレビュー用途なのでメディア層には書き出さず、表示の都度 HTML を生成する。
//
// テキスト選択 → メモ化フロー: PdfViewer と同じパターンで SelectionPill を表示し、
// onSaveSelectionAsMemo に CitationSource を渡す。.docx はページ概念が薄いので
// pageNumber は付けない（selectionText のみ）。

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import { isDocumentMime } from "./media-index";
import type { MediaIndexEntry } from "./media-index";
import { SelectionPill, type CitationSource, type PillState } from "./SelectionPill";
import { useT } from "../../i18n";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type DocumentViewerProps = {
  entry: MediaIndexEntry;
  /** テキスト選択を新規メモとして保存する（未指定なら SelectionPill を出さない） */
  onSaveSelectionAsMemo?: (source: CitationSource) => void;
};

export function DocumentViewer({ entry, onSaveSelectionAsMemo }: DocumentViewerProps) {
  const t = useT();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<PillState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    setPill(null);

    (async () => {
      // 現状は .docx のみプレビュー対応。Excel/PowerPoint は将来対応。
      if (entry.mimeType !== DOCX_MIME) {
        const isKnownDoc = isDocumentMime(entry.mimeType);
        setError(
          isKnownDoc
            ? t("asset.previewUnsupportedDocxOnly")
            : t("asset.previewUnsupported"),
        );
        return;
      }

      try {
        const provider = getActiveProvider();
        const fileId = provider.extractFileId(entry.url) ?? entry.fileId;
        const blobUrl = await provider.getMediaBlobUrl(fileId);
        const res = await fetch(blobUrl);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;

        const mammoth = await import("mammoth");
        const { isRenderableImageMime, convertNonRenderableImage } = await import(
          "../docx-import/renderable-image"
        );
        // File → data URL（プレビューはメディア層に保存せず、その場で埋め込む）
        const fileToDataUrl = (file: File) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            convertImage: mammoth.images.imgElement(async (image) => {
              const base64 = await image.readAsBase64String();
              // 表示できる形式は mammoth デフォルトと同じ base64 埋め込み
              if (isRenderableImageMime(image.contentType)) {
                return { src: `data:${image.contentType};base64,${base64}` };
              }
              // EMF / TIFF は表示可能な PNG / SVG に変換して埋め込む
              try {
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const converted = await convertNonRenderableImage(
                  image.contentType,
                  bytes.buffer,
                  "preview",
                );
                if (converted) return { src: await fileToDataUrl(converted) };
              } catch (err) {
                console.warn("[document-viewer] 非対応画像形式の変換失敗:", err);
              }
              // 変換できない形式（WMF 等）は空 src（従来どおり非表示）
              return { src: "" };
            }),
          },
        );
        if (cancelled) return;
        setHtml(result.value);
      } catch (err) {
        if (cancelled) return;
        console.error("[document-viewer] プレビュー読み込み失敗:", err);
        setError(t("asset.previewLoadFailed"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry.fileId, entry.mimeType, entry.url]);

  // テキスト選択検出: container 内のテキストが選択されたら SelectionPill を出す
  useEffect(() => {
    if (!onSaveSelectionAsMemo) return;

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
      // anchor / focus / commonAncestor のいずれかが viewer 内なら採用
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
      if (!anchoredEl) return; // viewer 外の選択は無視（既存 pill を維持）

      const text = selection.toString().replace(/\s+/g, " ").trim();
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
  }, [onSaveSelectionAsMemo]);

  const handleSaveAsMemo = useCallback(
    (source: CitationSource) => {
      onSaveSelectionAsMemo?.(source);
      setPill(null);
      window.getSelection()?.removeAllRanges();
    },
    [onSaveSelectionAsMemo],
  );

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-6">
        {error}
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-6">
        {t("common.loading")}
      </div>
    );
  }

  const citationSource: CitationSource | null = pill
    ? {
        entry: {
          fileId: entry.fileId,
          name: entry.name,
          type: entry.type,
          url: entry.url,
          urlMeta: entry.urlMeta,
        },
        selectionText: pill.text,
      }
    : null;

  // mammoth の出力 HTML は自分のアセット由来で信頼できる前提。
  // それでも将来の安全のため、`prose` 風の基本スタイルだけ当てて表示する。
  return (
    <div className="w-full h-full overflow-auto bg-background" ref={containerRef}>
      <div
        className="max-w-3xl mx-auto px-6 py-8 text-sm leading-relaxed text-foreground document-preview"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {pill && citationSource && onSaveSelectionAsMemo && (
        <SelectionPill
          source={citationSource}
          onSaveAsMemo={handleSaveAsMemo}
          onDismiss={() => setPill(null)}
          position={{ top: pill.top, left: pill.left, placement: pill.placement }}
        />
      )}
      <style>{`
        .document-preview h1 { font-size: 1.5rem; font-weight: 700; margin: 1.2em 0 0.6em; }
        .document-preview h2 { font-size: 1.25rem; font-weight: 700; margin: 1em 0 0.5em; }
        .document-preview h3 { font-size: 1.1rem; font-weight: 600; margin: 0.9em 0 0.4em; }
        .document-preview p { margin: 0.5em 0; }
        .document-preview ul, .document-preview ol { padding-left: 1.5em; margin: 0.5em 0; }
        .document-preview li { margin: 0.2em 0; }
        .document-preview table { border-collapse: collapse; margin: 0.8em 0; }
        .document-preview td, .document-preview th { border: 1px solid var(--color-border-subtle); padding: 4px 8px; }
        .document-preview img { max-width: 100%; height: auto; margin: 0.5em 0; }
        .document-preview a { color: var(--color-primary, #5b8fb9); text-decoration: underline; }
      `}</style>
    </div>
  );
}
