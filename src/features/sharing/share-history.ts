// 再共有（同一 id 上書き）で `history[]` に 1 行足す共通処理。
//
// なぜ要るか:
//   共有コピーを更新すると hash が変わる。受け取った側は「変わった」ことは
//   分かっても「何回・いつ・誰が更新したか」を辿れない。上書きの直前に旧版の
//   hash と更新時刻を積んでおけば、封筒だけで更新の経過を見せられる（本文の
//   世代を残すわけではないので、共有フォルダの容量はほとんど増えない）。
//
// 守っていること:
//   - hash 計算の対象外（hash.ts の HASH_EXCLUDED_KEYS に history が入っている）。
//     履歴を足しても本文と同じ内容なら hash は変わらない
//   - change_kind は "minor" 固定。major は新 id + supersedes で表す（別経路）
//   - 上限 50 件。古い順に落とす（新しい更新のほうが読む側に必要）
//   - 読めなかった（初回共有・消された・権限なし）ときは履歴なしで書く。
//     履歴のために共有そのものを失敗させない

import type { HistoryEntry, SharedEntry } from "../../lib/storage/shared";

/** 1 エントリに残す履歴の上限。超えたら古いものから落とす */
export const SHARED_HISTORY_LIMIT = 50;

/**
 * 既存エントリから「上書き後に持たせる履歴」を作る（純関数）。
 * 既存が無い（初回共有）なら undefined。
 */
export function appendHistory(existing: SharedEntry | null | undefined): HistoryEntry[] | undefined {
  if (!existing || !existing.hash) return undefined;
  const next: HistoryEntry[] = [
    ...(existing.history ?? []),
    {
      hash: existing.hash,
      updated_at: existing.updated_at,
      updated_by: existing.author,
      change_kind: "minor",
    },
  ];
  return next.length > SHARED_HISTORY_LIMIT ? next.slice(next.length - SHARED_HISTORY_LIMIT) : next;
}

/**
 * 再共有のときだけ既存エントリを読んで履歴を作る。
 * 共有関数（share-note / share-media / share-reference）の isUpdate 経路から呼ぶ。
 */
export async function historyForUpdate(
  provider: { read(id: string): Promise<{ entry: SharedEntry }> },
  id: string,
  isUpdate: boolean,
): Promise<HistoryEntry[] | undefined> {
  if (!isUpdate) return undefined;
  try {
    const { entry } = await provider.read(id);
    return appendHistory(entry);
  } catch {
    // 読めなくても共有は通す（履歴は付随情報）
    return undefined;
  }
}
