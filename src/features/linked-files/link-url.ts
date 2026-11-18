// リンクした素材の URL（graphium-place://<placeId>/<相対パス>）の組み立てと解析。
// Rust 側と共有する約束: 相対パスは常に "/" 区切り・先頭に "/" なし・各区切りを encodeURIComponent。

import type { MediaIndexEntry } from "../asset-browser/media-index";

export const PLACE_URL_SCHEME = "graphium-place://";

/** 置き場の id と相対パスから URL を作る。 */
export function buildPlaceUrl(placeId: string, relPath: string): string {
  const path = relPath.split("/").map(encodeURIComponent).join("/");
  return `${PLACE_URL_SCHEME}${encodeURIComponent(placeId)}/${path}`;
}

/** URL を置き場の id と相対パスに戻す。形が合わない・危ない値は null。 */
export function parsePlaceUrl(url: string): { placeId: string; relPath: string } | null {
  if (typeof url !== "string" || !url.startsWith(PLACE_URL_SCHEME)) return null;
  const rest = url.slice(PLACE_URL_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const rawId = rest.slice(0, slash);
  const rawPath = rest.slice(slash + 1);
  if (!rawPath) return null;
  try {
    const placeId = decodeURIComponent(rawId);
    if (!placeId) return null;
    const parts = rawPath.split("/").map((p) => decodeURIComponent(p));
    // 空の区切り・"."・".."・区切り文字を含む値は置き場の外に出うるので受けない
    if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("/") || p.includes("\\"))) {
      return null;
    }
    return { placeId, relPath: parts.join("/") };
  } catch {
    return null;
  }
}

export function isPlaceUrl(url: string): boolean {
  return parsePlaceUrl(url) !== null;
}

/** リンクした素材のエントリか（type が url・link を持ち・url が置き場の URL）。 */
export function isLinkedEntry(entry: MediaIndexEntry): boolean {
  return entry.type === "url" && !!entry.link && isPlaceUrl(entry.url);
}
