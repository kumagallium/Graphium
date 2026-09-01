// PDF 埋め込みブロック
// エディタ内で PDF ファイルをページ送り付きで閲覧できる

import { createReactBlockSpec } from "@blocknote/react";
import { useState, useCallback, useEffect } from "react";
import { Document, Page } from "react-pdf";
import { getActiveProvider } from "../../lib/storage/registry";
import "../../lib/pdfjs-config";
// BlockNote のブロック render は React ツリー外でも呼ばれ得るため、Context 不要の t を使う
import { t, useLocaleSubscription } from "../../i18n";
import { isLocalMediaRef, remoteRefHost } from "../../features/asset-browser/local-media-ref";
import {
  allowRemoteContentFor,
  editorRemoteScope,
  useBlockedRemoteBlock,
  useRemoteContentAllowed,
} from "../remote-content/store";

/**
 * プロバイダの fileId 抽出を描画中に呼ぶための安全版。
 * getActiveProvider() はプロバイダ未設定だと throw するが、描画のたびに落とすほどの
 * ことではない。取れなければ null（＝プロバイダ由来ではない）として扱う。
 */
function safeExtractFileId(url: string): string | null {
  try {
    return getActiveProvider().extractFileId(url);
  } catch {
    return null;
  }
}

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
      // 言語切替でラベルを引き直す（BlockNote の render は Context を辿れないため購読する）
      useLocaleSubscription();
      const { url, name } = props.block.props;
      const [numPages, setNumPages] = useState<number>(0);
      const [currentPage, setCurrentPage] = useState<number>(1);
      const [error, setError] = useState<string | null>(null);
      const [blobUrl, setBlobUrl] = useState<string | null>(null);
      const [loading, setLoading] = useState(false);

      // 外部ホストの PDF は、ノートを開いただけでは取りに行かない。
      // <Document file={url}> は pdf.js がその URL を取りに行くので、image ブロックと
      // 同じく「開いた＝差出人に通知」になる。判定は「プロバイダ由来か」ではなく
      // ローカル参照かどうかで行う（blob: の PDF を壊さないため）。
      // プロバイダを取れない状況（未設定）では取れない側＝外部扱いに倒す。
      const scope = editorRemoteScope(props.editor);
      const remoteAllowed = useRemoteContentAllowed(scope);
      const isRemote =
        Boolean(url) && !isLocalMediaRef(url) && !safeExtractFileId(url);
      const gated = isRemote && !remoteAllowed;
      useBlockedRemoteBlock(scope, props.block.id, gated);

      // Google Drive URL → Blob URL に変換（CORS 回避）
      useEffect(() => {
        if (!url || gated) return;
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
      }, [url, gated]);

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

      // 外部ホストの PDF をまだ読み込んでいない状態。押すとこのノートの分だけ読み込む。
      if (gated) {
        const host = remoteRefHost(url);
        return (
          <div
            style={{ ...styles.placeholder, cursor: "pointer" }}
            role="button"
            tabIndex={0}
            contentEditable={false}
            onClick={() => allowRemoteContentFor(scope)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); allowRemoteContentFor(scope); }
            }}
          >
            <div style={styles.placeholderIcon}>📄</div>
            <div style={styles.placeholderText}>
              {host ? `${t("block.remoteContent.pdf")} — ${host}` : t("block.remoteContent.pdf")}
            </div>
            <div style={styles.placeholderText}>{t("block.remoteContent.why")}</div>
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
    /**
     * 書き出し・コピー用の HTML。
     *
     * createReactBlockSpec は toExternalHTML を渡さないと render に落ちる
     * （ReactBlockSpec.tsx の `blockImplementation.toExternalHTML || blockImplementation.render`）。
     * 落ちた先はゲートの分岐を持つビューア本体なので、ブロック中のノートを書き出すと
     * 枠の文言（「PDF — <host>」等）が本文に入り、URL は残らなかった。bookmark と同じ形で
     * props だけから組み立て、**ゲートの分岐を持たない**。ブロック中でも同意済みでも
     * 同じ HTML になる。作るのは `<a>` と `<p>` だけなので、書き出し自体が要求を出さない。
     * ゲートが変えてよいのは「何を取りに行くか」だけで、「何が書き出されるか」ではない。
     */
    toExternalHTML: (props) => {
      const { url, name } = props.block.props;
      // URL 未設定のブロックは書き出す中身を持たない
      if (!url) return <p />;
      return (
        <p>
          <a href={url}>{name || url}</a>
        </p>
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
