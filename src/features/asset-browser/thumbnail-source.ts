// 一覧・ピッカーのサムネイルをどこから読むか
//
// 原寸（getMediaBlobUrl）は数 MB の Base64 を 1 枚ごとに往復し、60 枚で WebView が
// 数百 MB 膨らむ（2026-09-04 の実測）。縮小版（getMediaThumbnailUrl）を持つプロバイダでは
// そちらを使い、画像として読めない素材や未実装のプロバイダでは原寸に落とす。
// 読み始めるのは画面に入ってから（useInView）— 一覧は数百枚あり得るので、
// 見えていない分まで先に読まない。

import { useEffect, useRef, useState, type RefObject } from "react";
import type { StorageProvider } from "../../lib/storage/types";

/** サムネイルの長辺（px）。一覧の枠より少し大きく、Retina でも粗くならない程度 */
export const THUMBNAIL_EDGE = 320;

/** 縮小版があればそれ、無ければ原寸の表示用 URL */
export async function thumbnailUrlFor(
  provider: StorageProvider,
  fileId: string,
  mimeTypeHint?: string,
): Promise<string> {
  if (provider.getMediaThumbnailUrl) {
    try {
      return await provider.getMediaThumbnailUrl(fileId, THUMBNAIL_EDGE);
    } catch {
      // 画像として読めない（SVG・壊れたファイル等）→ 原寸に落とす
    }
  }
  return provider.getMediaBlobUrl(fileId, mimeTypeHint);
}

/** 要素が画面（の少し手前）に入ったら true になり、以後は変わらない */
export function useInView<T extends HTMLElement>(rootMargin = "200px"): [RefObject<T>, boolean] {
  // React 18 の型では useRef<T>(null) が RefObject<T>（ref 属性に渡せる形）になる
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}
