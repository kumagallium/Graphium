// LaTeX を MathML にする（会話内プレビュー用）。
//
// アプリは KaTeX の HTML 出力（＋ CSS とフォント）で数式を組むが、プレビューの画面は
// 1 枚の HTML に閉じて配るので、CSS とフォントを持ち込まずに済む MathML 出力を使う。
// MathML はブラウザ（Chromium 109 以降・Safari・Firefox）がそのまま組版する。
//
// trust: false のまま（\href や \includegraphics などの外部参照を作らせない）。
// 組めない式は null を返し、呼び出し側は LaTeX の文字のまま見せる。

import katex from "katex";

export function latexToMathml(latex: string, displayMode: boolean): string | null {
  const source = (latex ?? "").trim();
  if (!source) return null;
  try {
    return katex.renderToString(source, {
      displayMode,
      output: "mathml",
      throwOnError: true,
      strict: false,
      trust: false,
    });
  } catch {
    return null;
  }
}
