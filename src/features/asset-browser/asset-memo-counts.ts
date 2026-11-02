// 素材一覧（グリッドのカード・リストの行）に出すメモの件数を、全素材分まとめて数える。
//
// 件数は素材の「メモ」タブと必ず同じ集合（filterMemosByAsset）の大きさ:
//   アーカイブ・ゴミ箱でないメモのうち、
//   1. sourceAsset.fileId が素材の fileId と一致する、または
//   2. 本文に出典ラベル「— {素材名}」が含まれる（旧仕様の後方互換）
//
// 素材ごとに全メモを走査すると「素材数 × メモ数」になるので、メモを 1 回だけ走査して
// 全素材分の Map を作る。1 は fileId で引くだけ。2 は「— 」の出現位置ごとに、その直後が
// どの素材名で始まるかを、名前の先頭 NAME_KEY_MAX 文字までの索引で引く
// （素材名が 1 文字でも 100 文字でも、候補を絞ってから startsWith で確かめる）。

import type { CaptureIndex } from "../mobile-capture";
import type { MediaIndexEntry } from "./media-index";

/** 出典ラベルの記号（filterMemosByAsset の needle と同じ「— 」＝em dash＋空白） */
const LABEL_PREFIX = "— ";

/** 名前の先頭から索引に使う最大文字数 */
const NAME_KEY_MAX = 6;

/** 素材の fileId → 付いているメモの件数（0 件の素材はキーを持たない）。 */
export function countMemosByAsset(
  captureIndex: CaptureIndex | null | undefined,
  media: readonly Pick<MediaIndexEntry, "fileId" | "name">[] | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!captureIndex || !media || media.length === 0) return counts;

  // fileId ごとに最初の素材だけを採る（filterMemosByAsset を素材ごとに呼ぶ側が find で引くのと同じ）
  const seen = new Set<string>();
  const entries: Pick<MediaIndexEntry, "fileId" | "name">[] = [];
  for (const m of media) {
    if (seen.has(m.fileId)) continue;
    seen.add(m.fileId);
    entries.push(m);
  }

  // 名前の先頭 min(長さ, NAME_KEY_MAX) 文字 → その名前の素材
  const byNameKey = new Map<string, Pick<MediaIndexEntry, "fileId" | "name">[]>();
  // 名前が空の素材（needle は「— 」だけ＝「— 」を含むメモ全部に当たる）
  const emptyNamed: Pick<MediaIndexEntry, "fileId" | "name">[] = [];
  for (const e of entries) {
    if (!e.name) {
      emptyNamed.push(e);
      continue;
    }
    const key = e.name.slice(0, NAME_KEY_MAX);
    const list = byNameKey.get(key);
    if (list) list.push(e);
    else byNameKey.set(key, [e]);
  }

  for (const c of captureIndex.captures) {
    if (c.archivedAt || c.deletedAt) continue;
    // 1 件のメモは 1 つの素材に 1 回だけ数える（fileId 一致と出典ラベルの両方に当たっても 1）
    const hit = new Set<string>();
    const sourceFileId = c.sourceAsset?.fileId;
    if (sourceFileId && seen.has(sourceFileId)) hit.add(sourceFileId);

    let at = c.text.indexOf(LABEL_PREFIX);
    while (at !== -1) {
      const rest = c.text.slice(at + LABEL_PREFIX.length);
      for (const e of emptyNamed) hit.add(e.fileId);
      // 直後が素材名で始まるか。名前の長さは 1〜NAME_KEY_MAX 文字は全文キー、それ以上は先頭キー
      for (let len = 1; len <= NAME_KEY_MAX; len++) {
        const candidates = byNameKey.get(rest.slice(0, len));
        if (!candidates) continue;
        for (const e of candidates) {
          if (!hit.has(e.fileId) && rest.startsWith(e.name)) hit.add(e.fileId);
        }
      }
      at = c.text.indexOf(LABEL_PREFIX, at + 1);
    }

    for (const fileId of hit) counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
  }
  return counts;
}
