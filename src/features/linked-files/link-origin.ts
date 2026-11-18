// 「元データ」の指定 — 解析で作った小さな素材に、リンクした素材（データの置き場のファイル）を親として結ぶ。
//
// 親の fileId は既存の MediaIndexEntry.derivedFromAssets に入れる（新しい欄・索引の版は増やさない）。
// Graphium は元データの中身を読まない。関係は人が指定した記録でしかない。
//
// 親はリンクした素材だけ: hasExtractedImages / hasExpandedOffice は「この素材を親に持つ素材があれば
// 抽出済み」と判定するため、PDF や Office の取り込み素材を親にすると、抽出していないのに抽出済みに見える。
// リンクした素材は索引で type: "url" なのでこの判定に掛からない。
// 親は必ずリンクした素材・子は必ずリンクしていない素材なので、循環は起きない。

import {
  MEDIA_INDEX_CHANGED_EVENT,
  readMediaIndex,
  saveMediaIndex,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaType,
} from "../asset-browser/media-index";
import { isLinkedEntry, parsePlaceUrl } from "./link-url";

/** 元データを指定できる子の種類（メモ・会話・URL・その他は除く） */
const ORIGIN_CHILD_TYPES: ReadonlySet<MediaType> = new Set<MediaType>([
  "image",
  "pdf",
  "document",
  "data",
  "video",
  "audio",
]);

/** この素材に元データを指定できるか（リンクしていない、取り込んだ素材だけ） */
export function canHaveLinkedOrigin(entry: MediaIndexEntry): boolean {
  return ORIGIN_CHILD_TYPES.has(entry.type) && !isLinkedEntry(entry);
}

/** 画面に出す・指定する親の候補。リンクした素材で、アーカイブされていないもの */
export function listOriginCandidates(index: MediaIndex): MediaIndexEntry[] {
  return index.media.filter((m) => isLinkedEntry(m) && !m.archivedAt);
}

/**
 * この素材に指定済みの元データ（リンクした素材）。索引から消えている id と、
 * リンクした素材でない親（PDF から抽出した画像の親など）は含めない。
 */
export function linkedOriginsOf(index: MediaIndex, entry: MediaIndexEntry): MediaIndexEntry[] {
  const found: MediaIndexEntry[] = [];
  for (const id of entry.derivedFromAssets ?? []) {
    const parent = index.media.find((m) => m.fileId === id);
    if (parent && isLinkedEntry(parent) && !found.includes(parent)) found.push(parent);
  }
  return found;
}

/** 置き場の名前と、置き場の中の場所（表示用） */
export function linkedOriginPlace(entry: MediaIndexEntry): { placeName: string; relPath: string } {
  const relPath = entry.link?.relPath ?? parsePlaceUrl(entry.url)?.relPath ?? "";
  return { placeName: entry.urlMeta?.domain ?? "", relPath };
}

/**
 * 元データを足す・外す。子が対象外・親がリンクした素材でない（または索引に無い）ものは足さない。
 * 外すのはリンクした素材の親だけ（ほかの派生元は残す）。変わらなければ同じ索引を返す。
 */
export function changeLinkedOrigins(
  index: MediaIndex,
  childId: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
): { index: MediaIndex; changed: boolean } {
  const child = index.media.find((m) => m.fileId === childId);
  if (!child || !canHaveLinkedOrigin(child)) return { index, changed: false };
  const isLinkedId = (id: string) => {
    const m = index.media.find((x) => x.fileId === id);
    return !!m && isLinkedEntry(m);
  };
  const current = child.derivedFromAssets ?? [];
  const removeSet = new Set((change.remove ?? []).filter(isLinkedId));
  let next = current.filter((id) => !removeSet.has(id));
  for (const id of change.add ?? []) {
    if (id === childId || !isLinkedId(id) || next.includes(id)) continue;
    next = [...next, id];
  }
  if (next.length === current.length && next.every((id, i) => id === current[i])) {
    return { index, changed: false };
  }
  const media = index.media.map((m) => {
    if (m.fileId !== childId) return m;
    if (next.length === 0) {
      const { derivedFromAssets: _drop, ...rest } = m;
      return rest as MediaIndexEntry;
    }
    return { ...m, derivedFromAssets: next };
  });
  return { index: { ...index, updatedAt: new Date().toISOString(), media }, changed: true };
}

export function addLinkedOrigin(index: MediaIndex, childId: string, parentId: string) {
  return changeLinkedOrigins(index, childId, { add: [parentId] });
}

export function removeLinkedOrigin(index: MediaIndex, childId: string, parentId: string) {
  return changeLinkedOrigins(index, childId, { remove: [parentId] });
}

/**
 * 元データの指定を索引に書き戻す。persistLinkPatch と同じ流儀（読み直し → 差分があるときだけ保存 → 変更通知）。
 * @returns 実際に索引へ反映できたら true
 */
export async function persistLinkedOrigins(
  fileId: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
): Promise<boolean> {
  const index = await readMediaIndex();
  if (!index) return false;
  const { index: next, changed } = changeLinkedOrigins(index, fileId, change);
  if (!changed) return false;
  try {
    await saveMediaIndex(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, { detail: { reason: "link-origin", fileId } }),
      );
    }
    return true;
  } catch (err) {
    console.warn("元データの指定の書き戻し失敗:", err);
    return false;
  }
}
