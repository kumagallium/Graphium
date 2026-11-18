// LaTeX → Word の数式（OMML）の木
//
// 画面の数式は KaTeX が描いている（features/math/render-katex.ts）。Word へも同じ KaTeX に
// LaTeX を読ませ、その MathML 出力を Word の数式へ写す（mathml-to-omml.ts）。
// 画面で描ける式だけが対象になり、マクロや記号の解釈が画面と食い違わない。
//
// 式ごとに「全部写せたら数式、写せなければ null」。null のとき呼び出し側は、これまでどおり
// LaTeX の文字（$ … $ / $$ … $$）を出す。KaTeX が読めない式・写せない要素（行列・複数行・
// 式番号・囲みなど）・壊れた入力は、すべて null になる。例外は外へ出さない。

import katex from "katex";
import { mathMLToOmml, type OmmlNode } from "./mathml-to-omml";

/** これより長い式は数式にしない（貼り付けられた巨大な文字列で時間を使わない） */
export const MAX_MATH_LATEX_LENGTH = 4000;

/**
 * LaTeX を Word の数式（m:oMath）にする。写せなければ null。
 * display が true ならブロックの数式（総和の添え字が上下に付く）、false なら文中の数式。
 */
export function latexToOmml(latex: unknown, display: boolean): OmmlNode | null {
  try {
    const source = typeof latex === "string" ? latex.trim() : "";
    if (!source || source.length > MAX_MATH_LATEX_LENGTH) return null;
    const markup = katex.renderToString(source, {
      output: "mathml",
      displayMode: display,
      throwOnError: true,
      // 画面の描画（render-katex.ts）と同じ: 警告は出さず、信頼が要る命令（\href など）は通さない
      strict: "ignore",
      trust: false,
      maxExpand: 1000,
    });
    return mathMLToOmml(markup);
  } catch {
    // KaTeX の解析エラー・写せない要素・深すぎる入れ子（RangeError）
    return null;
  }
}
