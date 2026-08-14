// calc ブロックの評価エンジン
//
// Numi 風の「1 行 1 式」テキストを上から順に評価する。
// - 変数への代入（`target = 5 g`）は同じブロック内の後続行から参照できる
// - 変数スコープはブロック内で閉じる（ブロック間共有はしない。共有すると
//   ブロック順序への依存や SidePeek との整合が壊れやすくなるため）
// - 空行と `#` / `//` 始まりの行はコメントとして素通しする
// - エラーは行単位で表示し、他の行の評価は止めない

import { loadMathJs } from "./mathjs-loader";

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

/**
 * ソース全体を評価して行ごとの結果を返す。
 * 評価は毎回まっさらなスコープで行う（前回評価の残留変数を持ち越さない）。
 */
export async function evaluateSource(source: string): Promise<CalcLineResult[]> {
  const math = await loadMathJs();
  const scope = new Map<string, unknown>();
  const lines = source.split("\n");

  return lines.map((line): CalcLineResult => {
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
}
