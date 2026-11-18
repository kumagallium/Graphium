// リンクした素材の URL（graphium-place://<placeId>/<相対パス>）の組み立てと解析。
// Rust 側と共有する約束: 相対パスは常に "/" 区切り・先頭に "/" なし・各区切りを encodeURIComponent。

import type { MediaIndexEntry, MediaLink, MediaLinkSnapshot } from "../asset-browser/media-index";

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

/** 履歴の最大件数（media-index の MediaLink.history と同じ） */
export const MAX_LINK_HISTORY = 20;

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isValidSnapshot(v: unknown): v is MediaLinkSnapshot {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isFiniteNumber(o.size) && isFiniteNumber(o.mtimeMs) && typeof o.recordedAt === "string";
}

/** 控えの本体（履歴以外）が正しい形か。 */
function hasValidCore(link: unknown): link is Record<string, unknown> {
  if (!link || typeof link !== "object") return false;
  const o = link as Record<string, unknown>;
  return (
    isNonEmptyString(o.placeId) &&
    isNonEmptyString(o.relPath) &&
    isFiniteNumber(o.size) &&
    isFiniteNumber(o.mtimeMs) &&
    typeof o.recordedAt === "string"
  );
}

/** 控えが全体として正しい形か（履歴があれば配列で、各要素も正しい形）。 */
export function isValidMediaLink(link: unknown): link is MediaLink {
  if (!hasValidCore(link)) return false;
  const h = link.history;
  if (h === undefined) return true;
  return Array.isArray(h) && h.every(isValidSnapshot);
}

/** 壊れた履歴の要素を捨て、20 件で切って返す。本体が壊れていれば null。 */
export function sanitizeMediaLink(link: unknown): MediaLink | null {
  if (!hasValidCore(link)) return null;
  const out: MediaLink = {
    placeId: link.placeId as string,
    relPath: link.relPath as string,
    size: link.size as number,
    mtimeMs: link.mtimeMs as number,
    recordedAt: link.recordedAt as string,
  };
  if (Array.isArray(link.history)) {
    out.history = link.history
      .filter(isValidSnapshot)
      .slice(0, MAX_LINK_HISTORY)
      .map((h) => ({ size: h.size, mtimeMs: h.mtimeMs, recordedAt: h.recordedAt }));
  }
  return out;
}

/**
 * リンクした素材のエントリか。
 * type が url・控えが正しい形・url が置き場の URL で、url と控えの置き場 id・相対パスが一致するときだけ true。
 */
export function isLinkedEntry(entry: MediaIndexEntry): boolean {
  if (entry.type !== "url" || !isValidMediaLink(entry.link)) return false;
  const parsed = parsePlaceUrl(entry.url);
  return !!parsed && parsed.placeId === entry.link.placeId && parsed.relPath === entry.link.relPath;
}
