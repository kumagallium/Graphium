// ドキュメント素材プレビュー（.docx 等）
// .docx は mammoth.js で HTML 化して表示する。
// 他のドキュメント形式（Excel/PowerPoint 等）は現状未対応で placeholder を出す。
//
// 取り込み時と同じ mammoth 経路を踏むため、画像はデフォルトで base64 埋め込みされる。
// プレビュー用途なのでメディア層には書き出さず、表示の都度 HTML を生成する。

import { useEffect, useState } from "react";
import { getActiveProvider } from "../../lib/storage/registry";
import { isDocumentMime } from "./media-index";
import type { MediaIndexEntry } from "./media-index";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function DocumentViewer({ entry }: { entry: MediaIndexEntry }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);

    (async () => {
      // 現状は .docx のみプレビュー対応。Excel/PowerPoint は将来対応。
      if (entry.mimeType !== DOCX_MIME) {
        const isKnownDoc = isDocumentMime(entry.mimeType);
        setError(
          isKnownDoc
            ? "この形式のプレビューはまだ対応していません（現状は .docx のみ）。"
            : "プレビュー非対応のファイル形式です。",
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
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setHtml(result.value);
      } catch (err) {
        if (cancelled) return;
        console.error("[document-viewer] プレビュー読み込み失敗:", err);
        setError("プレビューの読み込みに失敗しました。");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry.fileId, entry.mimeType, entry.url]);

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
        読み込み中…
      </div>
    );
  }

  // mammoth の出力 HTML は自分のアセット由来で信頼できる前提。
  // それでも将来の安全のため、`prose` 風の基本スタイルだけ当てて表示する。
  return (
    <div className="w-full h-full overflow-auto bg-background">
      <div
        className="max-w-3xl mx-auto px-6 py-8 text-sm leading-relaxed text-foreground document-preview"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
