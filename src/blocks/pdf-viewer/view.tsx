// PDF 埋め込みブロック
// エディタ内で PDF ファイルをページ送り付きで閲覧できる

import { createReactBlockSpec } from "@blocknote/react";
import { useState, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { fetchMediaBlobUrl, extractDriveFileId } from "../../lib/google-drive";

// pdf.js ワーカーの設定（react-pdf v10 推奨）
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const PdfViewerBlock = createReactBlockSpec(
  {
    type: "pdf" as const,
    propSchema: {
      // PDF の URL（アップロード後の URL やローカル blob URL）
      url: { default: "" },
      // 表示名
      name: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const { url, name } = props.block.props;
      const [numPages, setNumPages] = useState<number>(0);
      const [currentPage, setCurrentPage] = useState<number>(1);
      const [error, setError] = useState<string | null>(null);
      const [blobUrl, setBlobUrl] = useState<string | null>(null);
      const [loading, setLoading] = useState(false);

      // Google Drive URL → Blob URL に変換（CORS 回避）
      useEffect(() => {
        if (!url) return;
        const fileId = extractDriveFileId(url);
        if (!fileId) {
          // Drive URL でなければそのまま使用（ローカル blob URL など）
          setBlobUrl(url);
          return;
        }
        let cancelled = false;
        setLoading(true);
        fetchMediaBlobUrl(fileId)
          .then((blob) => {
            if (!cancelled) setBlobUrl(blob);
          })
          .catch(() => {
            if (!cancelled) setError("PDF の取得に失敗しました");
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => { cancelled = true; };
      }, [url]);

      const onDocumentLoadSuccess = useCallback(
        ({ numPages: total }: { numPages: number }) => {
          setNumPages(total);
          setCurrentPage(1);
          setError(null);
        },
        [],
      );

      const onDocumentLoadError = useCallback(() => {
        setError("PDF の読み込みに失敗しました");
      }, []);

      // URL 未設定時のプレースホルダ
      if (!url) {
        return (
          <div style={styles.placeholder}>
            <div style={styles.placeholderIcon}>📄</div>
            <div style={styles.placeholderText}>
              PDF ファイルをドラッグ＆ドロップ、またはスラッシュメニューから挿入
            </div>
          </div>
        );
      }

      // Blob URL 取得中
      if (loading || !blobUrl) {
        return (
          <div style={styles.container}>
            <div style={styles.header}>
              <span style={styles.fileName}>{name || "PDF"}</span>
            </div>
            <div style={styles.viewer}>
              <div style={styles.loading}>読み込み中…</div>
            </div>
          </div>
        );
      }

      // エラー表示
      if (error) {
        return (
          <div style={styles.errorContainer}>
            <span style={styles.errorText}>{error}</span>
          </div>
        );
      }

      return (
        <div style={styles.container}>
          {/* ヘッダー：ファイル名 + ページ操作 */}
          <div style={styles.header}>
            <span style={styles.fileName}>{name || "PDF"}</span>
            <div style={styles.controls}>
              <button
                style={{
                  ...styles.navButton,
                  opacity: currentPage <= 1 ? 0.3 : 1,
                }}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                contentEditable={false}
              >
                ‹
              </button>
              <span style={styles.pageInfo}>
                {currentPage} / {numPages}
              </span>
              <button
                style={{
                  ...styles.navButton,
                  opacity: currentPage >= numPages ? 0.3 : 1,
                }}
                onClick={() =>
                  setCurrentPage((p) => Math.min(numPages, p + 1))
                }
                disabled={currentPage >= numPages}
                contentEditable={false}
              >
                ›
              </button>
            </div>
          </div>

          {/* PDF 表示エリア */}
          <div style={styles.viewer}>
            <Document
              file={blobUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={
                <div style={styles.loading}>読み込み中…</div>
              }
            >
              <Page
                pageNumber={currentPage}
                width={560}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Document>
          </div>
        </div>
      );
    },
  },
);

// ── スタイル ──
const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    overflow: "hidden",
    background: "#fafafa",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    fontSize: 13,
  },
  fileName: {
    fontWeight: 500,
    color: "#334155",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: 400,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  navButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    background: "#fff",
    cursor: "pointer",
    padding: "2px 8px",
    fontSize: 16,
    lineHeight: "20px",
    color: "#475569",
    userSelect: "none" as const,
  },
  pageInfo: {
    fontSize: 12,
    color: "#64748b",
    minWidth: 60,
    textAlign: "center" as const,
  },
  viewer: {
    display: "flex",
    justifyContent: "center",
    padding: "16px 0",
    minHeight: 200,
    maxHeight: 500,
    overflow: "auto",
  },
  loading: {
    padding: 40,
    color: "#94a3b8",
    fontSize: 13,
  },
  placeholder: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 16px",
    border: "2px dashed #cbd5e1",
    borderRadius: 8,
    background: "#f8fafc",
    cursor: "default",
  },
  placeholderIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center" as const,
  },
  errorContainer: {
    padding: "16px",
    border: "1px solid #fca5a5",
    borderRadius: 8,
    background: "#fef2f2",
  },
  errorText: {
    fontSize: 13,
    color: "#dc2626",
  },
};
