// ブックマークブロック
// URL を OGP カード形式で表示する

import { createReactBlockSpec } from "@blocknote/react";
import { useState, useEffect } from "react";
import { fetchUrlMetadata, extractDomain } from "../../features/asset-browser/media-index";
import { useBookmarkPreviewImage } from "../../features/asset-browser/preview-image";
import { Favicon } from "../../features/asset-browser/favicon";
import { remoteRefHost } from "../../features/asset-browser/local-media-ref";
import {
  allowRemoteContentFor,
  editorRemoteScope,
  useBlockedRemoteBlock,
  useRemoteContentAllowed,
} from "../remote-content/store";
// BlockNote のブロック render は React ツリー外でも呼ばれ得るため、Context 不要の t を使う
import { t, useLocaleSubscription } from "../../i18n";
import { openBookmarkPeek } from "./callbacks";

/**
 * カードが読むぶんのブロック props。createReactBlockSpec が render に渡す block は
 * これを含んでいる（余分なフィールドは構造的に無視される）。
 */
export type BookmarkCardProps = {
  block: {
    id: string;
    props: { url: string; title: string; description: string; domain: string };
  };
  editor: any;
};

/**
 * ブックマークカード本体。
 * 外へ出る経路とゲートの判定がここに集まるので、spec とは別に公開してテストから直接描く。
 */
export function BookmarkCard({ block, editor }: BookmarkCardProps) {
  // 言語切替でラベルを引き直す（BlockNote の render は Context を辿れないため購読する）
  useLocaleSubscription();
  const { url, title, description, domain } = block.props;
  const [meta, setMeta] = useState({
    title: title || "",
    description: description || "",
    domain: domain || extractDomain(url),
    // サイトが宣言している favicon。ブロック props には保存せず（スキーマ据え置き）、
    // 未取得なら Favicon 側が https://<host>/favicon.ico にフォールバックする
    faviconUrl: "",
  });
  const [loading, setLoading] = useState(false);
  // hero はローカルにキャッシュした data URL のみ。og:image の remote URL を
  // props に持って描くと、ノートを開くたび・PDF 書き出しのたびに配信元へ GET が
  // 飛ぶ（このブロックは referrerPolicy も無く、アプリ内 URL も Referer で漏れていた）。
  const hero = useBookmarkPreviewImage(url);

  // ── 外部メディアゲート ──
  //
  // ここで止めるのは**画面に出るカードの取得だけ**。書き出し・クリップボードは
  // このコンポーネントを通らない（下の BookmarkExternalHTML）。
  //
  // このカードからブックマーク先へ出る経路は 2 つあり、どちらもノートを開いた
  // だけで飛ぶ。
  //   1. メタデータ取得 … fetchUrlMetadata は url をパス・クエリごと GET する。
  //      画像 1 枚より相手に渡せる情報が多く、受信者ごとに変えた URL を書いて
  //      おけば「誰がいつ開いたか」がそのまま判る。
  //   2. favicon … <img src="https://<host>/favicon.ico">。出るのはホスト名だけだが、
  //      受信者ごとのサブドメインを書けば同じ見分けができる。
  //
  // 止めるのは「開いたら props が空だった」ときだけにする。title が入っている
  // カード（スラッシュメニューのピッカー経由の挿入と、一度取得して書き戻した
  // もの）は props だけで描けるので、ゲートに関係なくそのまま出る。
  //
  // 貼り付け時の取得（url-paste.ts の registerUrlAsset）はユーザーの操作の直後に
  // 走るもので、ここは通らないのでそのまま。ただしその取得結果が書かれるのは
  // 素材インデックス側で、ブロック props を埋めるのは下の effect だけなので、
  // 貼った直後のカードもいったんこの枠になる。
  const scope = editorRemoteScope(editor);
  const remoteAllowed = useRemoteContentAllowed(scope);
  const gated = Boolean(url) && !title && !remoteAllowed;
  // バーの件数に数えるのは、カードごと差し止めているこの状態だけ。メタデータが揃っていて
  // favicon だけ伏せているカードまで数えると、自分で貼ったブックマークのあるノートで
  // バーが出っぱなしになり、それを消したい人が「読み込む」を押して**そのノートの他の**
  // 外部メディアまで許可してしまう。
  useBlockedRemoteBlock(scope, block.id, gated);

  // メタデータ未取得で URL がある場合、自動取得して props を更新
  useEffect(() => {
    if (!url || title || gated) return;
    let cancelled = false;
    setLoading(true);
    fetchUrlMetadata(url).then((fetched) => {
      if (cancelled) return;
      const newMeta = {
        title: fetched.title,
        description: fetched.description ?? "",
        domain: fetched.domain,
        faviconUrl: fetched.faviconUrl ?? "",
      };
      setMeta(newMeta);
      // ブロック props を永続化。ogImage は remote URL なので二度と書かない
      // （既存ノートに残っている値は document-migration が読み込み時に消す）
      editor.updateBlock(block, {
        props: {
          title: newMeta.title,
          description: newMeta.description,
          ogImage: "",
          domain: newMeta.domain,
        },
      });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [url, title, gated]);

  // URL 未設定
  if (!url) {
    return (
      <div style={styles.placeholder}>
        <span style={styles.placeholderText}>{t("block.bookmark.placeholder")}</span>
      </div>
    );
  }

  // メタデータをまだ取りに行っていない状態。押すとこのノートの分だけ読み込む。
  // 見た目と文言は remote-content/placeholder.ts（画像・動画・音声）に合わせる。
  // この枠は画面にしか出ない（書き出しは BookmarkExternalHTML が担う）。
  if (gated) {
    // ホスト名は props の domain ではなく url から出す。domain は差出人が書ける値で、
    // 「どこへ取りに行くのか」を偽れてしまう。パスとクエリは出さない（計測用の
    // トークンが載っていることが多く、画面共有でそのまま出てしまうため）。
    const blockedHost = remoteRefHost(url);
    const allow = () => allowRemoteContentFor(scope);
    return (
      <div
        className="graphium-remote-blocked"
        data-remote-content-blocked=""
        role="button"
        tabIndex={0}
        style={styles.blocked}
        contentEditable={false}
        title={t("block.remoteContent.action")}
        onClick={(e) => { e.preventDefault(); allow(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); allow(); }
        }}
      >
        {/* 目のアイコン（斜線入り）。lucide の eye-off と同じ形 */}
        <span style={styles.blockedIcon}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.7 5.1A11 11 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7" />
            <path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a10.9 10.9 0 0 0 5.4-1.4" />
            <path d="M9.9 4.2 2 2m20 20L2 2" />
          </svg>
        </span>
        <div style={styles.blockedBody}>
          <span style={styles.blockedTitle}>
            {blockedHost ? `${t("slash.bookmark")} — ${blockedHost}` : t("slash.bookmark")}
          </span>
          <span style={styles.blockedWhy}>{t("block.remoteContent.why")}</span>
        </div>
        <span style={styles.blockedAction}>{t("block.remoteContent.action")}</span>
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

  // カード本体クリック: サイドピークが登録されていればそこで開く。
  // 未登録（フォールバック）や外部ボタンでは従来どおり新規タブで開く。
  const openExternal = () => window.open(url, "_blank", "noopener,noreferrer");
  const handleCardClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!openBookmarkPeek(editor, url)) openExternal();
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
          {/* favicon はサイト自身へ 1 リクエスト飛ぶ。props にはアイコンの実体も
              ローカル参照も持っていないので、同意前は描かずドメイン名だけにする
              （候補が全滅したときと同じ、Favicon が null を返す見た目）。 */}
          {remoteAllowed && (
            <Favicon
              domain={displayDomain}
              url={url}
              iconUrl={meta.faviconUrl}
              style={styles.favicon}
            />
          )}
          <span style={styles.domain}>{displayDomain}</span>
        </div>
      </div>
      {/* 右: プレビュー画像（ローカルキャッシュの data URL のみ） */}
      {hero && (
        <div style={styles.heroContainer}>
          <img
            src={hero}
            alt=""
            style={styles.hero}
            referrerPolicy="no-referrer"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 書き出し・クリップボード用の HTML（Markdown はこの HTML から作られる）。
 *
 * createReactBlockSpec は toExternalHTML を渡さないと render に落ちる
 * （ReactBlockSpec.tsx の `blockImplementation.toExternalHTML || blockImplementation.render`）。
 * 落ちた先はゲートの分岐を持つカード本体なので、既定であるブロック中のノートを
 * Markdown に書き出すと、枠の文言（「Bookmark — <host>」「読み込む」）が本文として
 * 入り、URL は 1 文字も残らなかった。画面には何も出ないまま書き出しの中身が消える
 * ので、元の漏れよりたちが悪い。
 *
 * そこでここは props だけで組み立て、**ゲートの分岐を持たない**。ブロック中でも
 * 同意済みでも同じ HTML になる。作るのは `<a>` と `<p>` だけ＝取得を行う要素が
 * 無いので、書き出し・コピーそのものが外へ要求を出すこともなくなる（同意済みの
 * カードを書き出すと favicon へ 1 件出ていた経路が消える）。ゲートが変えてよいのは
 * 「何を取りに行くか」だけで、「何が書き出されるか」ではない。
 *
 * カードの見た目（favicon と、ローカルキャッシュの hero 画像）は書き出しに入らない。
 * どちらも url から導き直せる飾りで、書き出しに残すべき中身は URL・タイトル・説明文。
 */
export function BookmarkExternalHTML({ block }: { block: BookmarkCardProps["block"] }) {
  const { url, title, description } = block.props;
  // URL 未設定のカード（挿入直後の入力待ち）は書き出す中身を持たない。
  // 入力を促す画面上の文言を書き出しに混ぜても意味が無いので空にする。
  if (!url) return <p />;
  return (
    <>
      {/* リンクテキストはタイトル、未取得なら URL 自身。URL は必ず href に残る。
          <p> で包むのは、裸の <a> だと段落にならず、前後のブロックの
          リンクと 1 行に連結されてしまうため（カードは 1 ブロック＝1 段落）。 */}
      <p>
        <a href={url}>{title || url}</a>
      </p>
      {/* 説明文はゲート以前の書き出しにも入っていた本文なので落とさない */}
      {description ? <p>{description}</p> : null}
    </>
  );
}

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
      // OGP 画像 URL（旧データ互換のためスキーマには残すが、書き込みも描画もしない。
      // 描画は素材インデックス側のローカルキャッシュ経由 — 上の hero を参照）
      ogImage: { default: "" },
      // ドメイン名
      domain: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => <BookmarkCard block={props.block} editor={props.editor} />,
    // 渡さないと BlockNote が render に落とす。落ちた先はゲートの分岐を持つ
    // カード本体なので、書き出しから URL が消える（BookmarkExternalHTML 参照）。
    toExternalHTML: (props) => <BookmarkExternalHTML block={props.block} />,
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
  heroContainer: {
    width: 200,
    minWidth: 200,
    flexShrink: 0,
    overflow: "hidden",
    borderLeft: "1px solid var(--color-border-subtle)",
  },
  hero: {
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
  // ── ブロック中の枠（remote-content/placeholder.ts と同じ寸法・色）──
  blocked: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    boxSizing: "border-box" as const,
    width: "100%",
    minHeight: 72,
    padding: "12px 14px",
    border: "1px dashed var(--color-border)",
    borderRadius: 8,
    background: "var(--color-surface)",
    cursor: "pointer",
    userSelect: "none" as const,
  },
  blockedIcon: {
    display: "inline-flex",
    flexShrink: 0,
    color: "var(--color-text-tertiary)",
  },
  blockedBody: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  blockedTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--color-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  blockedWhy: {
    fontSize: 12,
    lineHeight: "1.4",
    color: "var(--color-text-tertiary)",
  },
  blockedAction: {
    flexShrink: 0,
    padding: "4px 10px",
    borderRadius: "var(--r-1)",
    border: "1px solid var(--color-border)",
    background: "var(--color-card)",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--color-foreground)",
  },
};
