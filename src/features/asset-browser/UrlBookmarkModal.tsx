// URL ブックマーク登録モーダル
// 外部 URL を入力し、メタデータを取得してアセットとして登録する

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Loader2, ExternalLink } from "lucide-react";
import { useT } from "../../i18n";
import {
  fetchUrlMetadata,
  generateUrlBookmarkId,
  getFaviconUrl,
  extractDomain,
} from "./media-index";
import type { MediaIndexEntry } from "./media-index";
import { ensureCachedPreviewImage } from "./preview-image";
import { Favicon } from "./favicon";

/**
 * 取得済みメタデータ。「どの URL のものか」を必ず一緒に持つ。
 *
 * タイトル・ドメイン・favicon を URL と別々の state に置くと、URL だけ書き換えた
 * 直後（自動取得のデバウンス待ち 300ms）は前のサイトのメタデータが state に残る。
 * その隙に登録を押されると、URL は新しいサイトなのにタイトル・ドメイン・favicon は
 * 前のサイトのもの、というエントリが保存されてしまう。favicon URL はそのまま
 * 画像リクエストになるので、ユーザーがブックマークしていないホストを叩くことになり、
 * 第三者 favicon サービスをやめた意味が無くなる。
 * 1 つのオブジェクトに束ねて、取得元 URL が一致するときしか読めない形にしている。
 */
export type FetchedMeta = {
  /** このメタデータの取得元 URL（trim 済み） */
  url: string;
  title: string;
  description: string;
  ogImage?: string;
  /** サイトが `<link rel="icon">` で宣言している favicon（第三者サービスは使わない） */
  faviconUrl?: string;
  domain: string;
};

/**
 * 入力中の URL に対して有効なメタデータだけを返す。取得元が違えば null。
 * null は「メタデータ無し」であって異常ではない — プレビューを待たずに登録した
 * ときと同じ扱いで、ドメインだけのエントリとして正しく登録できる。
 */
export function metaForUrl(meta: FetchedMeta | null, url: string): FetchedMeta | null {
  const trimmed = url.trim();
  if (!meta || !trimmed || meta.url !== trimmed) return null;
  return meta;
}

export type UrlBookmarkModalProps = {
  onRegister: (entry: MediaIndexEntry) => void;
  onClose: () => void;
};

export function UrlBookmarkModal({ onRegister, onClose }: UrlBookmarkModalProps) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<FetchedMeta | null>(null);
  const [fetching, setFetching] = useState(false);
  const [registering, setRegistering] = useState(false);
  // 自動取得済み URL を追跡（同じ URL で再取得しないため）
  const lastFetchedUrl = useRef("");
  // 取得リクエストの世代。追い越された古い応答で新しいメタデータを潰さないため
  const fetchSeq = useRef(0);

  /** URL が有効かどうか */
  const isValidUrl = useCallback((value: string) => {
    try {
      new URL(value.trim());
      return true;
    } catch {
      return false;
    }
  }, []);

  // メタデータを取得
  const doFetch = useCallback(async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed || !isValidUrl(trimmed)) return;
    if (lastFetchedUrl.current === trimmed) return;
    lastFetchedUrl.current = trimmed;
    const seq = ++fetchSeq.current;
    setFetching(true);
    try {
      const fetched = await fetchUrlMetadata(trimmed);
      // 追い越された古い応答は捨てる（先に投げた方が後に返ることがある）
      if (seq !== fetchSeq.current) return;
      setMeta({
        url: trimmed,
        title: fetched.title,
        description: fetched.description ?? "",
        ogImage: fetched.ogImage,
        faviconUrl: fetched.faviconUrl,
        domain: fetched.domain,
      });
    } finally {
      if (seq === fetchSeq.current) setFetching(false);
    }
  }, [isValidUrl]);

  // URL が有効な値に変わったら自動取得（ペースト・入力完了時）
  useEffect(() => {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed) || lastFetchedUrl.current === trimmed) return;
    // 短いデバウンス（ペーストは即座に、手入力は少し待つ）
    const timer = setTimeout(() => doFetch(trimmed), 300);
    return () => clearTimeout(timer);
  }, [url, isValidUrl, doFetch]);

  // 現在の URL に紐づくメタデータ。URL を書き換えた瞬間に自動で外れるので、
  // 変更時に個別の state をリセットして回る必要が無い（消し忘れが起きない）。
  // 元の URL に打ち直せばそのまま復帰する。
  const currentMeta = metaForUrl(meta, url);

  /** プレビュー内で編集したタイトル・説明を反映（取得元 URL は保ったまま） */
  const patchMeta = useCallback(
    (patch: Partial<Pick<FetchedMeta, "title" | "description">>) => {
      setMeta((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  // ESC / Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  // 登録
  const handleRegister = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // 押した瞬間の URL に対応するメタデータだけを使う。デバウンス待ちの間に
    // 押されたら「メタデータ無しの登録」になる（前のサイトの値は混ざらない）。
    const m = metaForUrl(meta, trimmed);
    setRegistering(true);
    try {
      const d = m?.domain || extractDomain(trimmed);
      const entry: MediaIndexEntry = {
        fileId: generateUrlBookmarkId(),
        name: m?.title.trim() || d,
        type: "url",
        mimeType: "text/x-uri",
        url: trimmed,
        // favicon はサイト自身のものだけを保存する（第三者サービスは経由しない）。
        // 社内ホストのスキーム・ポートを落とさないよう、フル URL も渡す。
        thumbnailUrl: getFaviconUrl(d, 64, m?.faviconUrl, trimmed),
        uploadedAt: new Date().toISOString(),
        usedIn: [],
        urlMeta: {
          domain: d,
          description: m?.description.trim() || undefined,
          ogImage: m?.ogImage,
          faviconUrl: m?.faviconUrl,
        },
      };
      onRegister(entry);
      // OGP 画像の実体を登録時に一度だけ取り込む（描画ではネットワークに出ない）
      void ensureCachedPreviewImage(entry);
    } finally {
      setRegistering(false);
    }
  }, [url, meta, onRegister]);

  const urlValid = isValidUrl(url);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-popover border border-border rounded-lg shadow-lg w-full max-w-md mx-4">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Link size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {t("asset.urlRegisterTitle")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-5 space-y-4">
          {/* URL 入力 */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">URL</label>
            <div className="relative">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com/article"
                autoFocus
                className="w-full text-xs px-3 py-2 pr-8 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
              />
              {fetching && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          {/* メタデータプレビュー（今の URL の分を取得できたときだけ表示） */}
          {currentMeta && (
            <>
              {/* タイトル */}
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">
                  {t("asset.urlTitle")}
                </label>
                <input
                  type="text"
                  value={currentMeta.title}
                  onChange={(e) => patchMeta({ title: e.target.value })}
                  className="w-full text-xs px-3 py-2 rounded border border-border bg-background text-foreground outline-none focus:border-primary transition-colors"
                />
              </div>

              {/* 説明 */}
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">
                  {t("asset.urlDescription")}
                </label>
                <textarea
                  value={currentMeta.description}
                  onChange={(e) => patchMeta({ description: e.target.value })}
                  rows={2}
                  placeholder={t("asset.urlDescriptionPlaceholder")}
                  className="w-full text-xs px-3 py-2 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors resize-none"
                />
              </div>

              {/* プレビューカード */}
              <div className="border border-border rounded-md p-3 bg-muted/30">
                <div className="flex items-start gap-3">
                  <Favicon
                    domain={currentMeta.domain}
                    url={currentMeta.url}
                    iconUrl={currentMeta.faviconUrl}
                    className="w-8 h-8 rounded mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {currentMeta.title || currentMeta.domain}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {currentMeta.domain}
                    </p>
                    {currentMeta.description && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {currentMeta.description}
                      </p>
                    )}
                  </div>
                  <a
                    href={currentMeta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            </>
          )}
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleRegister}
            disabled={!urlValid || fetching || registering}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {registering ? t("asset.urlRegistering") : t("asset.urlRegister")}
          </button>
        </div>
      </div>
    </div>
  );
}
