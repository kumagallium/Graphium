// 出典照合 — verdict の集約。2 段で集約する:
//   1. 照合する文 1 つに出典が複数あるとき（知見が複数のノートから裏付けられている等）
//   2. ドキュメント 1 件に照合する文が複数あるとき（トピックの要点ごと）

import type { SourceCheckEntry, SourceCheckVerdict } from "../../lib/document-types";

/**
 * 1 つの文の出典ごとの判定を 1 つにまとめる。優先順位（高い方が勝つ）:
 * contradicted > supported > not-in-source > unclear > source-missing。
 *
 * - contradicted: 出典と食い違う記述が 1 件でもあれば、他が supported でも利用者の注意が要る
 * - supported: 食い違いが無ければ、1 つでも支持する出典があればその文は接地している
 * - not-in-source: 「出典に無い」は「判定できない」より情報が多い（LLM が読んで書いていないと
 *   言い切れた）ので unclear より優先する
 * - unclear: 判定を試みたが結論が出なかった
 * - source-missing: 原文そのものを取り出せなかった（LLM 判定にすら至っていない）ので最下位
 */
const SOURCE_PRIORITY: SourceCheckVerdict[] = [
  "contradicted",
  "supported",
  "not-in-source",
  "unclear",
  "source-missing",
];

/**
 * 1 つの文が持つ出典ごとの SourceCheckEntry から代表 verdict を 1 つ選ぶ。
 * entries が空のときは「出典が無い」＝ source-missing 扱いにする。
 */
export function aggregateVerdict(entries: SourceCheckEntry[]): SourceCheckVerdict {
  for (const verdict of SOURCE_PRIORITY) {
    if (entries.some((e) => e.verdict === verdict)) return verdict;
  }
  return "source-missing";
}

/**
 * ドキュメントの文ごとの verdict を 1 つにまとめる。**注意が要るものを優先する**:
 * contradicted > not-in-source > unclear > source-missing > supported。
 *
 * 文どうしは別々の主張なので、1 つの文が出典で支持されても、ほかの文の問題は隠せない
 * （トピックの要点の 1 つが出典に見当たらなければ、ページ全体を「書かれている」と見せない）。
 * 知見は文が 1 つなので、aggregateVerdict の結果がそのまま残る。
 */
const DOCUMENT_PRIORITY: SourceCheckVerdict[] = [
  "contradicted",
  "not-in-source",
  "unclear",
  "source-missing",
  "supported",
];

export function aggregateDocumentVerdict(statementVerdicts: SourceCheckVerdict[]): SourceCheckVerdict {
  for (const verdict of DOCUMENT_PRIORITY) {
    if (statementVerdicts.includes(verdict)) return verdict;
  }
  return "source-missing";
}
