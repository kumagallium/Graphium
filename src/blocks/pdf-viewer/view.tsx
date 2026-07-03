// PDF 埋め込みブロック
// エディタ内で PDF ファイルをページ送り付きで閲覧できる

import { createReactBlockSpec } from "@blocknote/react";
import { useState, useCallback, useEffect } from "react";
import { Document, Page } from "react-pdf";
import { getActiveProvider } from "../../lib/storage/registry";
import "../../lib/pdfjs-config";
// BlockNote のブロック render は React ツリー外でも呼ばれ得るため、Context 不要の t を使う
import { t } from "../../i18n";

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
        const fileId = getActiveProvider().extractFileId(url);
        if (!fileId) {
          // Drive URL でなければそのまま使用（ローカル blob URL など）
          setBlobUrl(url);
          return;
        }
        let cancelled = false;
        setLoading(true);
        getActiveProvider().getMediaBlobUrl(fileId)
          .then((blob) => {
            if (!cancelled) setBlobUrl(blob);
          })
          .catch(() => {
            if (!cancelled) setError(t("asset.pdfFetchFailed"));
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
        setError(t("asset.pdfLoadFailed"));
      }, []);

      // URL 未設定時のプレースホルダ
      if (!url) {
        return (
          <div style={styles.placeholder}>
            <div style={styles.placeholderIcon}>📄</div>
            <div style={styles.placeholderText}>
              {t("block.pdf.placeholder")}
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
              <div style={styles.loading}>{t("common.loading")}</div>
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
                <div style={styles.loading}>{t("common.loading")}</div>
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
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--color-background)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderBottom: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
    fontSize: 13,
  },
  fileName: {
    fontWeight: 500,
    color: "var(--color-foreground)",
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
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    background: "var(--color-card)",
    cursor: "pointer",
    padding: "2px 8px",
    fontSize: 16,
    lineHeight: "20px",
    color: "var(--color-muted-foreground)",
    userSelect: "none" as const,
  },
  pageInfo: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
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
    color: "var(--color-text-tertiary)",
    fontSize: 13,
  },
  placeholder: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 16px",
    border: "2px dashed var(--color-border)",
    borderRadius: 8,
    background: "var(--color-surface)",
    cursor: "default",
  },
  placeholderIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 13,
    color: "var(--color-text-tertiary)",
    textAlign: "center" as const,
  },
  errorContainer: {
    padding: "16px",
    border: "1px solid var(--color-error-border)",
    borderRadius: 8,
    background: "var(--color-error-bg)",
  },
  errorText: {
    fontSize: 13,
    color: "var(--color-destructive)",
  },
};
