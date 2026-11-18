// 条件で行を絞り、選んだ列だけを取り出す
//
// 画面を持たない純粋な処理。結果は新しい小さな素材（CSV）として書き出す前提なので、
// 行の順序は元のまま保つ。

import { parseNumeric } from "../../blocks/chart/chart-data";
import { columnKindOf } from "./profile";
import type {
  ColumnKind,
  ColumnProfile,
  ExtractCondition,
  ExtractResult,
  ExtractSpec,
} from "./types";

/**
 * 条件として効くか。値が空（notEmpty 以外）は「まだ書きかけ」で、無いのと同じに扱う —
 * 入力途中で結果が 0 行に潰れるのを防ぐ
 */
export function isActiveCondition(c: ExtractCondition): boolean {
  if (!c.column.trim()) return false;
  if (c.op === "notEmpty") return true;
  return (c.value ?? "").trim() !== "";
}

type Compiled = (cell: string) => boolean;

function compile(c: ExtractCondition, kind: ColumnKind): Compiled {
  const raw = (c.value ?? "").trim();
  switch (c.op) {
    case "notEmpty":
      return (cell) => cell.trim() !== "";
    case "contains": {
      const needle = raw.toLowerCase();
      return (cell) => cell.toLowerCase().includes(needle);
    }
    case "eq":
    case "ne": {
      const want = parseNumeric(raw);
      // 数値の列で値も数値なら数値として比べる（1.0 と 1 は等しい）。それ以外は文字列
      const eq: Compiled =
        kind === "number" && want !== null
          ? (cell) => parseNumeric(cell) === want
          : (cell) => cell.trim() === raw;
      return c.op === "eq" ? eq : (cell) => !eq(cell);
    }
    default: {
      // gt / ge / lt / le。どちらかが数値として読めなければ満たさない
      const want = parseNumeric(raw);
      if (want === null) return () => false;
      return (cell) => {
        const n = parseNumeric(cell);
        if (n === null) return false;
        if (c.op === "gt") return n > want;
        if (c.op === "ge") return n >= want;
        if (c.op === "lt") return n < want;
        return n <= want;
      };
    }
  }
}

/**
 * 条件をすべて満たす行だけを、選んだ列の順で返す。
 * profiles を渡すと eq/ne の列の種類をそこから引く（無ければ必要な列だけその場で調べる）
 */
export function applyExtract(
  headers: string[],
  rows: string[][],
  spec: ExtractSpec,
  profiles?: ColumnProfile[]
): ExtractResult {
  // 見出し名 → 最初の列の位置（同名は最初の 1 つ）
  const indexOf = new Map<string, number>();
  headers.forEach((h, i) => {
    const name = h.trim();
    if (name && !indexOf.has(name)) indexOf.set(name, i);
  });

  const tests: { index: number; test: Compiled }[] = [];
  for (const c of spec.conditions) {
    if (!isActiveCondition(c)) continue;
    const index = indexOf.get(c.column.trim());
    if (index === undefined) continue; // 存在しない列を指す条件は無視
    let kind: ColumnKind = "text";
    if (c.op === "eq" || c.op === "ne") {
      kind =
        profiles?.find((p) => p.name === c.column.trim())?.kind ?? columnKindOf(rows, index);
    }
    tests.push({ index, test: compile(c, kind) });
  }

  // 選んだ列。存在しない名前は無視し、残らなければ全列（元と同じ形）
  const picked: number[] = [];
  for (const name of spec.columns) {
    const i = indexOf.get(name.trim());
    if (i !== undefined && !picked.includes(i)) picked.push(i);
  }
  const allColumns = picked.length === 0;
  const outIndexes = allColumns ? headers.map((_, i) => i) : picked;

  const out: string[][] = [];
  for (const row of rows) {
    let ok = true;
    for (const { index, test } of tests) {
      if (!test(row[index] ?? "")) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(outIndexes.map((i) => row[i] ?? ""));
  }
  return { headers: outIndexes.map((i) => headers[i]), rows: out, sourceRows: rows.length };
}
