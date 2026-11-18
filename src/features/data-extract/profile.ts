// 列の素性（数値か文字か・値の種類）を調べる
//
// 条件の入力欄を列に合わせて出し分けるための下調べ。演算子の候補（数値だけ大小比較）と、
// 種類が少ない列の値の候補（datalist）に使う。

import { parseNumeric } from "../../blocks/chart/chart-data";
import { yieldToEventLoop } from "../data-import/large-file";
import type { ColumnKind, ColumnProfile } from "./types";

/** 空でないセルのうち、これ以上が数値として読めれば数値列（単位つき "12 g" も数値） */
const NUMBER_RATIO = 0.9;
/** 値の候補を出す種類数の上限 */
export const DISTINCT_LIMIT = 50;

type Acc = {
  name: string;
  index: number;
  nonEmpty: number;
  numeric: number;
  /** 値 → 出現数。種類が上限を超えたら null にして数えるのをやめる（23 万行で Map を肥らせない） */
  counts: Map<string, number> | null;
};

function newAccs(headers: string[]): Acc[] {
  const seen = new Set<string>();
  const accs: Acc[] = [];
  headers.forEach((header, index) => {
    const name = header.trim();
    // 空の見出しは対象外。同名は最初の 1 つ（columnsFromText と同じ規則）
    if (!name || seen.has(name)) return;
    seen.add(name);
    accs.push({ name, index, nonEmpty: 0, numeric: 0, counts: new Map() });
  });
  return accs;
}

function feed(accs: Acc[], rows: string[][], from: number, to: number): void {
  for (let r = from; r < to; r++) {
    const row = rows[r];
    for (const acc of accs) {
      const cell = (row[acc.index] ?? "").trim();
      if (cell === "") continue;
      acc.nonEmpty++;
      if (parseNumeric(cell) !== null) acc.numeric++;
      if (acc.counts) {
        acc.counts.set(cell, (acc.counts.get(cell) ?? 0) + 1);
        if (acc.counts.size > DISTINCT_LIMIT) acc.counts = null;
      }
    }
  }
}

function finish(accs: Acc[]): ColumnProfile[] {
  return accs.map((acc) => {
    const kind: ColumnKind =
      acc.nonEmpty > 0 && acc.numeric >= acc.nonEmpty * NUMBER_RATIO ? "number" : "text";
    const profile: ColumnProfile = { name: acc.name, kind };
    if (acc.counts && acc.counts.size > 0) {
      // 多い順。同数は最初に現れた順（Map は挿入順・sort は安定）
      profile.distinct = [...acc.counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    }
    return profile;
  });
}

/** 列ごとの素性を調べる（同期版） */
export function profileColumns(headers: string[], rows: string[][]): ColumnProfile[] {
  const accs = newAccs(headers);
  feed(accs, rows, 0, rows.length);
  return finish(accs);
}

/** 列の種類だけを調べる（applyExtract が eq/ne の比べ方を決めるのに使う。distinct は作らない） */
export function columnKindOf(rows: string[][], index: number): ColumnKind {
  let nonEmpty = 0;
  let numeric = 0;
  for (const row of rows) {
    const cell = (row[index] ?? "").trim();
    if (cell === "") continue;
    nonEmpty++;
    if (parseNumeric(cell) !== null) numeric++;
  }
  return nonEmpty > 0 && numeric >= nonEmpty * NUMBER_RATIO ? "number" : "text";
}

/**
 * 小分けの非同期版。大きな表で画面を固めないよう、一定時間ごとに制御を返す。
 * 結果は profileColumns と同じ
 */
export async function profileColumnsAsync(
  headers: string[],
  rows: string[][],
  opts?: { sliceMs?: number }
): Promise<ColumnProfile[]> {
  const sliceMs = opts?.sliceMs ?? 12;
  const accs = newAccs(headers);
  const CHUNK = 2000;
  let sliceStart = Date.now();
  for (let from = 0; from < rows.length; from += CHUNK) {
    feed(accs, rows, from, Math.min(rows.length, from + CHUNK));
    if (Date.now() - sliceStart >= sliceMs) {
      await yieldToEventLoop();
      sliceStart = Date.now();
    }
  }
  return finish(accs);
}
