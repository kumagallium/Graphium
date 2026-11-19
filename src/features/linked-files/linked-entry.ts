// リンクした素材のエントリ（索引では type: "url"）の組み立てと状態の判定。

import {
  addMediaEntry,
  MEDIA_INDEX_CHANGED_EVENT,
  readMediaIndex,
  saveMediaIndex,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaLink,
} from "../asset-browser/media-index";
import { buildPlaceUrl, parsePlaceUrl } from "./link-url";
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

/** まとめてリンクした結果。outside はどの置き場の中でもなかった件数 */
export type AddLinkedEntriesResult = {
  index: MediaIndex;
  linked: MediaIndexEntry[];
  existing: MediaIndexEntry[];
  outside: number;
};

/** 選んだファイルをまとめて索引に足す。同じ選択の中の重複も、リンク済みとして数える。 */
export function addLinkedEntries(args: {
  index: MediaIndex;
  picked: PickedFile[];
  places: Pick<PlaceInfo, "id" | "name">[];
  now: string;
  newFileId: () => string;
}): AddLinkedEntriesResult {
  const { picked, places, now, newFileId } = args;
  let index = args.index;
  const linked: MediaIndexEntry[] = [];
  const existing: MediaIndexEntry[] = [];
  let outside = 0;
  for (const file of picked) {
    const place = places.find((p) => p.id === file.placeId);
    if (!place || file.relPath === null) {
      outside += 1;
      continue;
    }
    const built = buildLinkedEntry({ picked: file, place, now, fileId: newFileId() });
    const result = addLinkedEntry(index, built);
    index = result.index;
    (result.added ? linked : existing).push(result.entry);
  }
  return { index, linked, existing, outside };
}

/** 置き場の名前が変わったときに、一覧に出る名前（urlMeta.domain）を合わせる。 */
export function withPlaceName(entry: MediaIndexEntry, placeName: string): MediaIndexEntry {
  return {
    ...entry,
    urlMeta: { ...(entry.urlMeta ?? { domain: placeName }), domain: placeName },
  };
}

/** 索引の中の、その置き場のリンクした素材すべてに新しい置き場の名前を当てる。変わらなければ同じ索引を返す。 */
export function withPlaceNameInIndex(
  index: MediaIndex,
  placeId: string,
  placeName: string,
): { index: MediaIndex; changed: number } {
  let changed = 0;
  const media = index.media.map((m) => {
    if (m.type !== "url") return m;
    const id = m.link?.placeId ?? parsePlaceUrl(m.url)?.placeId;
    if (id !== placeId || m.urlMeta?.domain === placeName) return m;
    changed++;
    return withPlaceName(m, placeName);
  });
  if (changed === 0) return { index, changed };
  return { index: { ...index, updatedAt: new Date().toISOString(), media }, changed };
}

/**
 * 置き場の名前を変えたあとに呼ぶ。索引を読み直し、その置き場の素材の名前（urlMeta.domain）を合わせて保存する。
 * persistLinkPatch と同じ流儀（読み直し → 書き戻し → 変更通知）。返り値は書き換えた件数。
 */
export async function persistPlaceName(placeId: string, placeName: string): Promise<number> {
  const index = await readMediaIndex();
  if (!index) return 0;
  const { index: next, changed } = withPlaceNameInIndex(index, placeId, placeName);
  if (changed === 0) return 0;
  try {
    await saveMediaIndex(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail: { reason: "place-renamed", placeId } }),
      );
    }
    return changed;
  } catch (err) {
    console.warn("置き場の名前の書き戻し失敗:", err);
    return 0;
  }
}
