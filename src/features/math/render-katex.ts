// KaTeX レンダリングの薄いラッパ
//
// ブロック数式（src/blocks/math）とインライン数式（src/features/inline-math）で
// 共通の描画・エラー処理を使うために 1 箇所に集約する。
//
// KaTeX の CSS はここで 1 回だけ読み込む（両方で import すると Vite が重複を
// 解決してくれるが、フォント参照を含むので入口を明示しておく）。

import katex from "katex";
import "katex/dist/katex.min.css";

export type MathRenderResult = {
  /** 成功時の HTML。失敗時は null */
  html: string | null;
  /** 失敗時のエラーメッセージ（KaTeX の ParseError の説明）。成功時は null */
  error: string | null;
};

/**
 * LaTeX を HTML に変換する。
 * KaTeX が解釈できない式でも例外は投げず、error にメッセージを詰めて返す
 * （論文取り込みでは解釈できない記法が混ざりうるため、編集を止めない）。
 */
export function renderMath(latex: string, displayMode: boolean): MathRenderResult {
  const source = (latex ?? "").trim();
  if (!source) return { html: null, error: null };
  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      // 未知のコマンドを黙って捨てず、エラーとして扱う（自前のエラー表示に回す）
      strict: false,
      // \tag{1} など論文の式番号を許可する
      trust: false,
    });
    return { html, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "KaTeX parse error: ..." の前置きは UI では冗長なので落とす
    return { html: null, error: message.replace(/^KaTeX parse error:\s*/, "") };
  }
}
