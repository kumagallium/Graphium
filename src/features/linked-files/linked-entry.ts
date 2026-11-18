// リンクした素材のエントリ（索引では type: "url"）の組み立てと状態の判定。

import {
  addMediaEntry,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaLink,
} from "../asset-browser/media-index";
import { buildPlaceUrl } from "./link-url";
import type { LinkStat, PickedFile, PlaceInfo } from "./places";

export type LinkState = "ok" | "changed" | "missing" | "unreachable" | "unregistered";

/** 履歴の上限 */
export const LINK_HISTORY_MAX = 20;

/** 控えといまの値を比べて状態を決める（大きさと更新日時だけ。中身は読まない）。 */
export function linkState(link: MediaLink, stat: LinkStat): LinkState {
  if (stat.state !== "ok") return stat.state;
  if (stat.size !== link.size || stat.mtimeMs !== link.mtimeMs) return "changed";
  return "ok";
}

/** 選んだファイルからリンクした素材のエントリを作る。fileId は generateUrlBookmarkId() を渡す。 */
export function buildLinkedEntry(args: {
  picked: PickedFile;
  place: Pick<PlaceInfo, "id" | "name">;
  now: string;
  fileId: string;
}): MediaIndexEntry {
  const { picked, place, now, fileId } = args;
  if (picked.placeId === null || picked.relPath === null) {
    throw new Error("picked file is not inside a registered place");
  }
  return {
    fileId,
    name: picked.name,
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl(picked.placeId, picked.relPath),
    thumbnailUrl: "",
    uploadedAt: now,
    usedIn: [],
    urlMeta: { domain: place.name, description: picked.relPath },
    link: {
      placeId: picked.placeId,
      relPath: picked.relPath,
      size: picked.size,
      mtimeMs: picked.mtimeMs,
      recordedAt: now,
    },
  };
}

/** いまの値を控え直す。前の値を履歴の先頭に積む。取れない・ok でないときは元のまま。 */
export function acceptLinkChange(link: MediaLink, stat: LinkStat, now: string): MediaLink {
  if (stat.state !== "ok" || typeof stat.size !== "number" || typeof stat.mtimeMs !== "number") {
    return link;
  }
  const prev = { size: link.size, mtimeMs: link.mtimeMs, recordedAt: link.recordedAt };
  return {
    ...link,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    recordedAt: now,
    history: [prev, ...(link.history ?? [])].slice(0, LINK_HISTORY_MAX),
  };
}

/** 同じ URL のリンクした素材があればそれを返し、無ければ足す。 */
export function addLinkedEntry(
  index: MediaIndex,
  entry: MediaIndexEntry,
): { index: MediaIndex; entry: MediaIndexEntry; added: boolean } {
  const existing = index.media.find((m) => m.type === "url" && m.url === entry.url);
  if (existing) return { index, entry: existing, added: false };
  return { index: addMediaEntry(index, entry), entry, added: true };
}

/** 置き場の名前が変わったときに、一覧に出る名前（urlMeta.domain）を合わせる。 */
export function withPlaceName(entry: MediaIndexEntry, placeName: string): MediaIndexEntry {
  return {
    ...entry,
    urlMeta: { ...(entry.urlMeta ?? { domain: placeName }), domain: placeName },
  };
}
