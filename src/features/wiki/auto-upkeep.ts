// おまかせで整える — 点検（ナレッジどうし）と出典照合（ナレッジと資料）を 1 つのボタンで通す
//
// 2026-11-05 決定: 手入れ画面のタブを「手入れ」と「手入れの履歴」の 2 つにし、おまかせも 1 つにする。
// 押すと 点検 → 手当て → 出典照合 → 手当て の順に進み、全体を 1 つの実行（auto_tidy）に記録する。
// 点検側の計画は auto-tidy.ts、照合側の計画は source-check/auto-fix.ts（どちらも純関数）。
// この層は 2 つの結果と進み具合を 1 つにまとめる型だけを持つ。

import type { AutoSourceCheckDone } from "../source-check/auto-fix";
import { isFixed as isSourceCheckFixed } from "../source-check/auto-fix";
import type { AutoTidyDone } from "./auto-tidy";

export type AutoUpkeepProgress =
  /** 点検（AI 解析）の最中。ナレッジが窓に分かれるときは何窓済んだか（done / total）と、始めた時刻 */
  | { phase: "checking"; done?: number; total?: number; startedAt?: number }
  /** 点検で決めた手当ての最中 */
  | { phase: "fixing"; done: number; total: number }
  /** 出典照合の最中（中断できる） */
  | { phase: "sourceChecking"; index: number; total: number; startedAt?: number }
  /** 照合で決めた手当ての最中 */
  | { phase: "sourceFixing"; done: number; total: number };

export type AutoUpkeepResult = {
  /** 点検側の手当て */
  tidy: AutoTidyDone[];
  /** 照合側の手当て */
  sourceCheck: AutoSourceCheckDone[];
  /** 今回照合したページの数 */
  checkedCount: number;
  finishedAt: string;
  /** AI の点検が（一部でも）失敗し、機械判定だけで整えた */
  lintFailed?: boolean;
  /** 出典照合を途中で止めた（照合側の手当ては行っていない） */
  interrupted?: boolean;
};

/** 済んだ手当ての数（作り直し・併記のあとの照合でまだ合わないものは数えない） */
export function countFixed(result: AutoUpkeepResult): number {
  return result.tidy.filter((d) => d.ok).length + result.sourceCheck.filter(isSourceCheckFixed).length;
}

/** 試したが済まなかった手当ての数 */
export function countNotFixed(result: AutoUpkeepResult): number {
  return result.tidy.length + result.sourceCheck.length - countFixed(result);
}
