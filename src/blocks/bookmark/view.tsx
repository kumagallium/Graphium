// ブックマークブロック
// URL を OGP カード形式で表示する

import { createReactBlockSpec } from "@blocknote/react";
import { useState, useEffect } from "react";
import { fetchUrlMetadata, extractDomain, getFaviconUrl } from "../../features/asset-browser/media-index";
// BlockNote のブロック render は React ツリー外でも呼ばれ得るため、Context 不要の t を使う
import { t } from "../../i18n";
import { openBookmarkPeek } from "./index";

export const BookmarkBlock = createReactBlockSpec(
  {
    type: "bookmark" as const,
    propSchema: {
      // 外部 URL
      url: { default: "" },
      // タイトル（OGP or ページタイトル）
      title: { default: "" },
      // 説明文
      description: { default: "" },
      // OGP 画像 URL
      ogImage: { default: "" },
      // ドメイン名
      domain: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const { url, title, description, ogImage, domain } = props.block.props;
      const [meta, setMeta] = useState({
        title: title || "",
        description: description || "",
        ogImage: ogImage || "",
        domain: domain || extractDomain(url),
      });
      const [loading, setLoading] = useState(false);

      // メタデータ未取得で URL がある場合、自動取得して props を更新
      useEffect(() => {
        if (!url || title) return;
        let cancelled = false;
        setLoading(true);
        fetchUrlMetadata(url).then((fetched) => {
          if (cancelled) return;
          const newMeta = {
            title: fetched.title,
            description: fetched.description ?? "",
            ogImage: fetched.ogImage ?? "",
            domain: fetched.domain,
          };
          setMeta(newMeta);
          // ブロック props を永続化
          (props.editor as any).updateBlock(props.block, {
            props: {
              title: newMeta.title,
              description: newMeta.description,
              ogImage: newMeta.ogImage,
              domain: newMeta.domain,
            },
          });
        }).finally(() => {
          if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
      }, [url, title]);

      // URL 未設定
      if (!url) {
        return (
          <div style={styles.placeholder}>
            <span style={styles.placeholderText}>{t("block.bookmark.placeholder")}</span>
          </div>
        );
      }

      // 読み込み中
      if (loading && !meta.title) {
        return (
          <div style={styles.card}>
            <div style={styles.cardBody}>
              <span style={styles.loadingText}>{t("common.loading")}</span>
            </div>
          </div>
        );
      }

      const displayDomain = meta.domain || extractDomain(url);
      const faviconUrl = getFaviconUrl(displayDomain, 32);

      // カード本体クリック: サイドピークが登録されていればそこで開く。
      // 未登録（フォールバック）や外部ボタンでは従来どおり新規タブで開く。
      const openExternal = () => window.open(url, "_blank", "noopener,noreferrer");
      const handleCardClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (!openBookmarkPeek(props.editor, url)) openExternal();
      };

      return (
        <div
          role="button"
          tabIndex={0}
          style={styles.card}
          contentEditable={false}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(e as unknown as React.MouseEvent); }
          }}
        >
          {/* 左: テキスト情報 */}
          <div style={styles.cardBody}>
            <div style={styles.titleRow}>
              <span style={styles.title}>{meta.title || displayDomain}</span>
            </div>
            {meta.description && (
              <span style={styles.description}>{meta.description}</span>
            )}
            <div style={styles.domainRow}>
              <img
                src={faviconUrl}
                alt=""
                style={styles.favicon}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span style={styles.domain}>{displayDomain}</span>
            </div>
          </div>
          {/* 右: OGP 画像 */}
          {meta.ogImage && (
            <div style={styles.ogImageContainer}>
              <img
                src={meta.ogImage}
                alt=""
                style={styles.ogImage}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
        </div>
      );
    },
  },
);

// ── スタイル ──
const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--color-card)",
    textDecoration: "none",
    color: "inherit",
    cursor: "pointer",
    transition: "border-color 0.15s, box-shadow 0.15s",
    maxWidth: "100%",
    minHeight: 80,
  },
  cardBody: {
    flex: 1,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
    minWidth: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  description: {
    fontSize: 12,
    color: "var(--color-muted-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as any,
    lineHeight: "1.4",
  },
  domainRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  favicon: {
    width: 16,
    height: 16,
    borderRadius: 2,
    flexShrink: 0,
  },
  domain: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  ogImageContainer: {
    width: 200,
    minWidth: 200,
    flexShrink: 0,
    overflow: "hidden",
    borderLeft: "1px solid var(--color-border-subtle)",
  },
  ogImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
  },
  placeholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 16px",
    border: "2px dashed var(--color-border)",
    borderRadius: 8,
    background: "var(--color-surface)",
  },
  placeholderText: {
    fontSize: 13,
    color: "var(--color-text-tertiary)",
  },
  loadingText: {
    fontSize: 13,
    color: "var(--color-text-tertiary)",
  },
};
