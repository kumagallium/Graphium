// 計算ブロックで「まず知っておくと使える」関数と書き方の一覧
//
// 式の評価は mathjs なので、実際には数百の関数が使える。それを全部並べると
// 探せないので、ここでは秤量・集計・換算・フィットで使うものだけを厳選する。
// 一覧に無い関数も、書けばそのまま使える（一覧は入口であって制限ではない）。
//
// 使い道は 2 つ:
// - 入力補完（suggest.ts）: 関数名を 2 文字打つと、書き方と 1 行の説明が出る
// - 「?」の一覧（view.tsx）: グループごとに並べ、押すとカーソル位置に入る
//
// 書き方（signature）と説明は i18n に置く（引数名も言語ごとに変えるため）。
// キーは calc.fn.<name>.sig / calc.fn.<name>.desc。

export type CalcFunctionGroup = "table" | "aggregate" | "math" | "fit" | "syntax";

export type CalcFunctionEntry = {
  /** 補完・一覧のキー。function は mathjs のスコープ上の名前そのもの */
  name: string;
  group: CalcFunctionGroup;
  /**
   * function: 名前を打って呼ぶもの（補完の対象。挿入は `name(`）
   * syntax: 演算子や書き方の約束（一覧に載せるだけで、補完・挿入はしない）
   */
  kind: "function" | "syntax";
};

export const CALC_FUNCTION_GROUPS: CalcFunctionGroup[] = ["table", "aggregate", "math", "fit", "syntax"];

export const CALC_FUNCTIONS: CalcFunctionEntry[] = [
  { name: "col", group: "table", kind: "function" },
  { name: "sum", group: "aggregate", kind: "function" },
  { name: "mean", group: "aggregate", kind: "function" },
  { name: "median", group: "aggregate", kind: "function" },
  { name: "min", group: "aggregate", kind: "function" },
  { name: "max", group: "aggregate", kind: "function" },
  { name: "std", group: "aggregate", kind: "function" },
  { name: "count", group: "aggregate", kind: "function" },
  { name: "round", group: "math", kind: "function" },
  { name: "sqrt", group: "math", kind: "function" },
  { name: "abs", group: "math", kind: "function" },
  { name: "exp", group: "math", kind: "function" },
  { name: "log", group: "math", kind: "function" },
  { name: "log10", group: "math", kind: "function" },
  { name: "polyfit", group: "fit", kind: "function" },
  { name: "polyval", group: "fit", kind: "function" },
  { name: "r2", group: "fit", kind: "function" },
  { name: "coeffs", group: "fit", kind: "function" },
  { name: "linspace", group: "fit", kind: "function" },
  { name: "to", group: "syntax", kind: "syntax" },
  { name: "elementwise", group: "syntax", kind: "syntax" },
  { name: "comment", group: "syntax", kind: "syntax" },
];

/** 補完の対象になる関数（syntax を除く） */
export const CALC_COMPLETABLE = CALC_FUNCTIONS.filter((f) => f.kind === "function");

/** 書き方の i18n キー */
export function calcFunctionSigKey(name: string): string {
  return `calc.fn.${name}.sig`;
}

/** 説明の i18n キー */
export function calcFunctionDescKey(name: string): string {
  return `calc.fn.${name}.desc`;
}
