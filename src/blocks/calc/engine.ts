// calc ブロックの評価エンジン
//
// Numi 風の「1 行 1 式」テキストを上から順に評価する。
// - 変数への代入（`target = 5 g`）は同じブロック内の後続行から参照できる
// - 変数スコープはブロック内で閉じる（ブロック間共有はしない。共有すると
//   ブロック順序への依存や SidePeek との整合が壊れやすくなるため）
// - 空行と `#` / `//` 始まりの行はコメントとして素通しする
// - エラーは行単位で表示し、他の行の評価は止めない
// - `*` `/` `^` は列（1 次元の配列）に対して行ごとの演算にする（行列演算にはしない）

import { loadMathJs } from "./mathjs-loader";
import { createFitFunctions, formatBound, formatFit, isPolyFit } from "./fit";
import type { UnitAdapter } from "./fit";
import type { MathNode } from "mathjs";
import { t } from "../../i18n";
import type {
  TableColumnData,
  TableColumnsIndex,
  TableRowNamesIndex,
} from "../../features/table-meta/types";

export type CalcLineResult = {
  /** 元の行テキスト（表示は view 側が持つのでここでは判定材料のみ） */
  kind: "empty" | "comment" | "value" | "error";
  /** kind === "value" のときの整形済み結果 */
  text?: string;
  /** 値は返せたが注意が要るとき（フィット範囲外の外挿など）の一言 */
  warn?: string;
  /** 行に収まらない補足（フィットの適用範囲など）。hover で読ませる */
  detail?: string;
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
  // フィットは係数の羅列より次数・当てはまり・適用範囲のほうが判断に効く
  if (isPolyFit(value)) return formatFit(value, t).text;
  if (value === undefined) return "";
  return math.format(value, { notation: "auto", precision: 8 });
}

/**
 * 1 列分を mathjs へ渡す値にする。単位が揃っていれば単位付き数量の配列に。
 * 読めないセル（null）は NaN にして行の位置を保つ。列どうしの計算ではその行だけ
 * NaN になり、集計（AGGREGATES）は NaN を飛ばす
 */
function toMathColumn(math: Awaited<ReturnType<typeof loadMathJs>>, data: TableColumnData): unknown {
  const values = data.values.map((v) => (v === null ? NaN : v));
  if (data.unit) {
    try {
      // mathjs が知らない単位表記（"個" など）は throw する。その列は素の数値で返す
      math.unit(1, data.unit);
      return values.map((v) => math.unit(v, data.unit!));
    } catch {
      /* 数値のまま */
    }
  }
  return values;
}

/**
 * 1 セルを mathjs へ渡す値にする。列の単位が揃っていればそれを、揃っていなければ
 * そのセル自身の単位を付ける（mathjs の知らない単位なら素の数値）
 */
function toMathCell(
  math: Awaited<ReturnType<typeof loadMathJs>>,
  data: TableColumnData,
  rowIndex: number,
): unknown {
  const value = data.values[rowIndex];
  if (value === null || value === undefined) return NaN;
  const unit = data.unit ?? data.cellUnits?.[rowIndex];
  if (unit) {
    try {
      return math.unit(value, unit);
    } catch {
      /* 数値のまま */
    }
  }
  return value;
}

/** 空欄の行（NaN、または値が NaN の単位付き数量）か */
function isBlankValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isNaN(v);
  if (v && typeof v === "object" && "value" in v) {
    const value = (v as { value: unknown }).value;
    return typeof value === "number" && Number.isNaN(value);
  }
  return false;
}

/**
 * 空欄を飛ばして集計する関数。列の空欄は NaN で行の位置を保っているので、
 * そのままでは `sum` が NaN になる。表計算ソフトの SUM と同じく空欄は無いものとして扱う。
 * 一覧に無い関数（cumsum など）は NaN がそのまま伝わる — 黙って詰めると行がずれるので、
 * 見える NaN の方がよい
 */
const AGGREGATES = [
  "sum", "prod", "mean", "median", "mode", "min", "max",
  "std", "variance", "mad", "quantileSeq", "count",
] as const;

function skipBlanksIn(math: Awaited<ReturnType<typeof loadMathJs>>, name: (typeof AGGREGATES)[number]) {
  const fn = math[name] as (...args: unknown[]) => unknown;
  return (...args: unknown[]): unknown =>
    fn(
      ...args.map((arg) => {
        // 1 次元の配列（列）だけ空欄を除く。スカラーや dim などの引数はそのまま
        const plain = math.isMatrix(arg) ? arg.toArray() : arg;
        if (!Array.isArray(plain) || plain.some(Array.isArray)) return arg;
        return plain.filter((v) => !isBlankValue(v));
      }),
    );
}

/**
 * `*` `/` `^` を行ごとの演算（dotMultiply / dotDivide / dotPow）に差し替える。
 * mathjs では `*` が行列積、`/` が逆行列を使う割り算、`^` が行列冪なので、列どうしに
 * 使うと "Matrix must be square" で落ちるか、内積のスカラーが黙って返る。計算ブロックの
 * 表は 1 次元の列しか作らないので行列演算の出番は無く、書いた人は「同じ行の値どうしの
 * 計算」を期待する（実際に col("表","投入量")/col("表","MW") と書いて ? になった）。
 * スカラーと単位付き数量では結果は変わらない（実測）。`.*` `./` `.^` と明示した式も
 * そのまま通る
 */
function toElementwise(math: Awaited<ReturnType<typeof loadMathJs>>, node: MathNode): MathNode {
  return node.transform((n) => {
    if (!math.isOperatorNode(n)) return n;
    switch (n.fn) {
      case "multiply":
        return new math.OperatorNode(".*", "dotMultiply", n.args, n.implicit);
      case "divide":
        return new math.OperatorNode("./", "dotDivide", n.args, n.implicit);
      case "pow":
        return new math.OperatorNode(".^", "dotPow", n.args, n.implicit);
      default:
        return n;
    }
  });
}

/**
 * `col("表","列") = 式` / `table["表"]["列"] = 式` の行。書いた人は表の列へ書き戻したいが、
 * 前者は mathjs が左辺を拒み、後者は添字代入として**通ってしまう**（評価ごとの一時
 * オブジェクトを書き換えるだけで、表には何も書かれない）。どちらも評価せず、
 * 入口（変数に入れて、結果の隣の ⇥ で表と列を選ぶ）を、その行の表・列・右辺を使った
 * 具体例つきで案内する。「名前 = 式」とだけ言っても何のことか伝わらなかった
 */
const COLUMN_ASSIGNMENT =
  /^\s*(?:col(?:umn)?\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)|table\[\s*"([^"]+)"\s*\]\s*\[\s*"([^"]+)"\s*\])\s*=(?!=)\s*(.*)$/;

/** 案内に載せる右辺の長さ。長い式はツールチップに収まらないので切る */
const EXAMPLE_RHS_MAX = 40;

function explainColumnAssignment(line: string): string | null {
  const m = line.match(COLUMN_ASSIGNMENT);
  if (!m) return null;
  const table = m[1] ?? m[3];
  const column = m[2] ?? m[4];
  const rhsRaw = m[5].trim();
  const rhs =
    rhsRaw === "" ? "…" : rhsRaw.length > EXAMPLE_RHS_MAX ? rhsRaw.slice(0, EXAMPLE_RHS_MAX - 1) + "…" : rhsRaw;
  return t("calc.errorAssignToColumn", { table, column, rhs });
}

/**
 * mathjs の素のエラーのうち、計算ブロックの使い方に直結するものだけ言い換える。
 * `3 = x` のような左辺は "Invalid left hand side of assignment" で落ちる。
 * 左辺に書けるのが変数名だけだと言えないと自力で抜けられない
 */
function explainError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/Invalid left hand side of assignment/.test(message)) return t("calc.errorAssignLeftSide");
  return message;
}

/**
 * フィット関数に渡す単位の窓口。mathjs の Unit をここだけで扱い、fit.ts は
 * mathjs に依存しないでおく（テストが軽くなり、単位の扱いも 1 か所に閉じる）。
 */
function unitAdapterFor(math: Awaited<ReturnType<typeof loadMathJs>>): UnitAdapter {
  const asUnit = (v: unknown): { toNumber: (u: string) => number; formatUnits: () => string } | null => {
    if (!v || typeof v !== "object") return null;
    const u = v as { toNumber?: unknown; formatUnits?: unknown };
    return typeof u.toNumber === "function" && typeof u.formatUnits === "function"
      ? (v as { toNumber: (u: string) => number; formatUnits: () => string })
      : null;
  };
  return {
    unitOf: (v) => {
      const u = asUnit(v);
      if (!u) return null;
      try {
        return u.formatUnits() || null;
      } catch {
        return null;
      }
    },
    toNumberIn: (v, unit) => {
      const u = asUnit(v);
      if (!u) return typeof v === "number" ? v : NaN;
      // 換算できない単位同士（K と g など）はここで throw し、行のエラーになる
      return u.toNumber(unit);
    },
    make: (value, unit) => math.unit(value, unit),
  };
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
    // 空欄の行から出た値は空のセルにする（"NaN" と書き込まない）
    if (isBlankValue(v)) return "";
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
  /** 表の行の名前。`cell("表", "行", "列")` が行を引くのに使う */
  rowNames?: TableRowNamesIndex,
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
    // cell("表", "行", "列"): 1 列目のテキストで行を引き、その行の 1 セルを返す。
    // 行の番号（col(...)[2]）と違って、行を足したり並べ替えたりしても同じセルを指す
    scope.set("cell", (tableName: unknown, rowName: unknown, columnName: unknown): unknown => {
      const table = String(tableName);
      const columns = tables[table];
      if (!columns) throw new Error(`table not found: ${table}`);
      const data = columns[String(columnName)];
      if (data === undefined) throw new Error(`column not found: ${String(columnName)}`);
      // 同じ名前の行は先にある方を採る（表・列の同名と同じ規則）
      const rowIndex = (rowNames?.[table] ?? []).indexOf(String(rowName).trim());
      if (rowIndex < 0) throw new Error(`row not found: ${String(rowName)}`);
      const value = toMathCell(math, data, rowIndex);
      // 空欄は NaN で黙って先へ流さず、どのセルかを言う（1 セルを名指しした以上、ほぼ記入漏れ）
      if (isBlankValue(value)) {
        throw new Error(`cell is empty: ${table} / ${String(rowName)} / ${String(columnName)}`);
      }
      return value;
    });
  }
  // スコープに置いた名前は mathjs の同名関数より先に引かれる
  for (const name of AGGREGATES) scope.set(name, skipBlanksIn(math, name));
  // 測定点の違う物性値を揃えるための多項式フィット。mathjs には無いので自前で足す
  // （詳細と設計の決め事は fit.ts）。表があってもなくても使えるようスコープ外に置く
  const fit = createFitFunctions(unitAdapterFor(math));
  scope.set("polyfit", fit.polyfit);
  scope.set("polyval", fit.polyval);
  scope.set("coeffs", fit.coeffs);
  scope.set("r2", fit.r2);
  scope.set("linspace", fit.linspace);

  const lines = source.split("\n").map((line): CalcLineResult => {
    const trimmed = line.trim();
    if (trimmed === "") return { kind: "empty" };
    if (isCommentLine(line)) return { kind: "comment" };
    const columnAssignment = explainColumnAssignment(trimmed);
    if (columnAssignment) return { kind: "error", text: columnAssignment };
    fit.resetExtrapolation();
    try {
      const value = toElementwise(math, math.parse(trimmed)).compile().evaluate(scope);
      const result: CalcLineResult = { kind: "value", text: formatValue(math, value) };
      // 行に収まらない適用範囲は hover に逃がす（結果カラムは左が切れるため）
      if (isPolyFit(value)) result.detail = formatFit(value, t).detail;
      // 外挿は値を返した上で警告する。throw にすると後続の ZT 計算ごと落ちる
      const extrapolated = fit.takeExtrapolation();
      if (extrapolated) {
        result.warn =
          extrapolated.lo === extrapolated.hi
            ? t("calc.fitExtrapolatedAt", { at: formatBound(extrapolated.lo) })
            : t("calc.fitExtrapolated", {
                lo: formatBound(extrapolated.lo),
                hi: formatBound(extrapolated.hi),
              });
      }
      return result;
    } catch (e) {
      return { kind: "error", text: explainError(e) };
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
