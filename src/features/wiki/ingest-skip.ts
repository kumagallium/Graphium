// 一括ナレッジ化の「取り込み済みで変わっていない」スキップ判定
//
// 背景: 一括ナレッジ化は AI 由来ノート（source === "ai"）を外すだけで、既にナレッジ化
// されていて内容が変わっていないノートも毎回読ませていた。呼び出し回数だけかかって
// 結果はほぼ変わらない。
//
// 「取り込み済みか」は知見の時刻では判定できない（知見は既定 OFF の拡張で、
// 新規ユーザーには存在しない）。またトピックページの modifiedAt / lastIngestedAt でも
// 判定できない（トピックは複数の資料から改訂されるため、別のノートで改訂されただけで
// 「このノートも取り込み済み」に誤検出する）。
//
// 正しい材料は各ナレッジページの documentProvenance.activities（EditActivity）の
// `used`（この操作が取り込んだソースの id）。対象ノートを used に含む活動の endedAt の
// 最大値が、そのノートを最後に取り込んだ時刻になる。資料ごとに正確で、新しい保存先も要らない。

import type { GraphiumDocument } from "../../lib/document-types";

/**
 * ナレッジページ群の来歴から、指定ソース（ノート等）を最後に取り込んだ時刻を求める。
 * 見つからなければ undefined（= 取り込み記録なし）。
 */
export function lastIngestedAtForSource(
  sourceId: string,
  docs: GraphiumDocument[],
): string | undefined {
  let latest: string | undefined;
  for (const doc of docs) {
    const activities = doc.documentProvenance?.activities;
    if (!activities) continue;
    for (const activity of activities) {
      if (!activity.used?.includes(sourceId)) continue;
      if (!activity.endedAt) continue;
      if (!latest || new Date(activity.endedAt).getTime() > new Date(latest).getTime()) {
        latest = activity.endedAt;
      }
    }
  }
  return latest;
}

/**
 * 資料が最後の取り込み以降に変わっていないかを判定する。
 * - lastIngestedAt が無ければ外さない（false）
 * - 時刻が壊れていて比較できないときも外さない側に倒す（false）
 * - sourceModifiedAt <= lastIngestedAt のときだけ true（外してよい）
 */
export function shouldSkipUnchangedSource(
  sourceModifiedAt: string,
  lastIngestedAt: string | undefined,
): boolean {
  if (!lastIngestedAt) return false;
  const modifiedTime = new Date(sourceModifiedAt).getTime();
  const ingestedTime = new Date(lastIngestedAt).getTime();
  if (Number.isNaN(modifiedTime) || Number.isNaN(ingestedTime)) return false;
  return modifiedTime <= ingestedTime;
}
