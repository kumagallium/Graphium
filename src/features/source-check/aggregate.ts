// 出典照合（Source check, v1） — 知見 1 件に複数の出典があるときの verdict 集約。

import type { SourceCheckEntry, SourceCheckVerdict } from "../../lib/document-types";

/**
 * 優先順位（高い方が勝つ）: contradicted > supported > not-in-source > unclear > source-missing。
 *
 * - contradicted: 出典と食い違う記述が 1 件でもあれば、他が supported でも利用者の注意が要る
 * - supported: 食い違いが無ければ、1 つでも支持する出典があれば知見は接地している
 * - not-in-source: 「出典に無い」は「判定できない」より情報が多い（LLM が読んで書いていないと
 *   言い切れた）ので unclear より優先する
 * - unclear: 判定を試みたが結論が出なかった
 * - source-missing: 原文そのものを取り出せなかった（LLM 判定にすら至っていない）ので最下位
 */
const PRIORITY: SourceCheckVerdict[] = [
  "contradicted",
  "supported",
  "not-in-source",
  "unclear",
  "source-missing",
];

/**
 * 知見 1 件が持つ複数の SourceCheckEntry から代表 verdict を 1 つ選ぶ。
 * entries が空のときは「出典が無い」＝ source-missing 扱いにする。
 */
export function aggregateVerdict(entries: SourceCheckEntry[]): SourceCheckVerdict {
  for (const verdict of PRIORITY) {
    if (entries.some((e) => e.verdict === verdict)) return verdict;
  }
  return "source-missing";
}
