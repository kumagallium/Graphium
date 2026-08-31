// calc ブロックの評価エンジン
//
// Numi 風の「1 行 1 式」テキストを上から順に評価する。
// - 変数への代入（`target = 5 g`）は同じブロック内の後続行から参照できる
// - 変数スコープはブロック内で閉じる（ブロック間共有はしない。共有すると
//   ブロック順序への依存や SidePeek との整合が壊れやすくなるため）
// - 空行と `#` / `//` 始まりの行はコメントとして素通しする
// - エラーは行単位で表示し、他の行の評価は止めない

import { loadMathJs } from "./mathjs-loader";
import type {
  TableColumnData,
  TableColumnsIndex,
} from "../../features/table-meta/types";

export type CalcLineResult = {
  /** 元の行テキスト（表示は view 側が持つのでここでは判定材料のみ） */
  kind: "empty" | "comment" | "value" | "error";
  /** kind === "value" のときの整形済み結果 */
  text?: string;
};

export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("#") || t.startsWith("//");
}

/**
 * props.results（評価スナップショットの JSON）を安全に読む。壊れていたら空扱い。
 * 表示（view）と Markdown 書き出し（to-markdown）の両方が使う。
 */
export function parseCalcResults(raw: string): CalcLineResult[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 結果の表示整形。有効数字を抑えて秤量値として読める形にする */
function formatValue(math: Awaited<ReturnType<typeof loadMathJs>>, value: unknown): string {
  // 関数定義（`f(x) = x^2`）などは値表示せずシグネチャだけ見せる
  if (typeof value === "function") return "ƒ";
  if (value === undefined) return "";
  return math.format(value, { notation: "auto", precision: 8 });
}

/** 1 列分を mathjs へ渡す値にする。単位が揃っていれば単位付き数量の配列に */
function toMathColumn(math: Awaited<ReturnType<typeof loadMathJs>>, data: TableColumnData): unknown {
  if (data.unit) {
    try {
      // mathjs が知らない単位表記（"個" など）は throw する。その列は素の数値で返す
      math.unit(1, data.unit);
      return data.values.map((v) => math.unit(v, data.unit!));
    } catch {
      /* 数値のまま */
    }
  }
  return data.values;
}

export type EvaluateOutcome = {
  /** 行ごとの評価結果（表示用） */
  lines: CalcLineResult[];
  /**
   * exportNames で指定した変数の、表のセルに書ける文字列表現。
   * スカラーは長さ 1、配列は要素ごと。セルに書けない値（関数など）の変数は含まれない
   */
  exports: Record<string, string[]>;
};

/** 変数の評価値を表のセルに書ける文字列の並びにする。書けない値は null */
function toCellTexts(
  math: Awaited<ReturnType<typeof loadMathJs>>,
  value: unknown,
): string[] | null {
  const one = (v: unknown): string | null => {
    if (typeof v === "number" || typeof v === "bigint") return math.format(v, { notation: "auto", precision: 8 });
    // mathjs の Unit / Fraction / BigNumber は formatter に任せる
    if (v && typeof v === "object" && typeof (v as { toString?: unknown }).toString === "function") {
      try {
        return math.format(v, { notation: "auto", precision: 8 });
      } catch {
        return null;
      }
    }
    return null;
  };
  // Matrix は素の配列に開く
  const plain =
    value && typeof (value as { toArray?: () => unknown[] }).toArray === "function"
      ? (value as { toArray: () => unknown[] }).toArray()
      : value;
  if (Array.isArray(plain)) {
    const texts: string[] = [];
    for (const v of plain) {
      const text = one(v);
      if (text === null) return null; // 入れ子配列などはセルに書けない
      texts.push(text);
    }
    return texts;
  }
  const text = one(plain);
  return text === null ? null : [text];
}

/**
 * ソース全体を評価して行ごとの結果を返す。
 * 評価は毎回まっさらなスコープで行う（前回評価の残留変数を持ち越さない）。
 *
 * tables には表の列データが入り、`table["秤量表"]["質量"]` /
 * `col("秤量表", "質量")` として参照できる。列内で単位表記が揃っていれば
 * 単位付き数量になる（`sum` が `3 g` を返す）。
 * 読み取りは片方向で、表へ書くのは書き戻し（writeback）だけ — それも
 * ここでは値を文字列にして返すのみで、実際の書き込みはホストが行う。
 */
export async function evaluateSource(
  source: string,
  tables?: TableColumnsIndex,
  exportNames?: string[],
): Promise<EvaluateOutcome> {
  const math = await loadMathJs();
  const scope = new Map<string, unknown>();
  if (tables) {
    // 表由来の変数を先に置く。以降の行で同じ名前に代入されたら、そちらが勝つ
    const index: Record<string, Record<string, unknown>> = {};
    for (const [tableName, columns] of Object.entries(tables)) {
      const cols: Record<string, unknown> = {};
      for (const [columnName, data] of Object.entries(columns)) {
        cols[columnName] = toMathColumn(math, data);
      }
      index[tableName] = cols;
    }
    // col("表", "列"): 無い表・無い列は理由の分かるエラーにする
    const lookup = (tableName: unknown, columnName: unknown): unknown => {
      const cols = index[String(tableName)];
      if (!cols) throw new Error(`table not found: ${String(tableName)}`);
      const values = cols[String(columnName)];
      if (values === undefined) throw new Error(`column not found: ${String(columnName)}`);
      return values;
    };
    scope.set("table", index);
    scope.set("col", lookup);
    scope.set("column", lookup);
  }
  const lines = source.split("\n").map((line): CalcLineResult => {
    const trimmed = line.trim();
    if (trimmed === "") return { kind: "empty" };
    if (isCommentLine(line)) return { kind: "comment" };
    try {
      const value = math.evaluate(trimmed, scope);
      return { kind: "value", text: formatValue(math, value) };
    } catch (e) {
      return { kind: "error", text: e instanceof Error ? e.message : String(e) };
    }
  });

  const exports: Record<string, string[]> = {};
  for (const name of exportNames ?? []) {
    if (!scope.has(name)) continue;
    const texts = toCellTexts(math, scope.get(name));
    if (texts) exports[name] = texts;
  }
  return { lines, exports };
}
