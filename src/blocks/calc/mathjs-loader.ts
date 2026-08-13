// mathjs の遅延ローダー
//
// mathjs はフルバンドルで大きい（数百 KB）ため、calc ブロックが初めて
// 評価される瞬間まで読み込まない（dynamic import）。echarts-loader と同じ方針で、
// 計算ブロックを使わないノートのバンドル・起動時間には影響させない。
//
// 単位付き計算（g, mol, g/mol, mL …）が本ブロックの中核価値なので、
// 個別 factory の寄せ集めではなく all 構成で作る。チャンク分割で遅延される
// 前提なら、機能の欠けによる「単位が計算できない」事故の方が高くつく。

import type { MathJsInstance } from "mathjs";

let mathPromise: Promise<MathJsInstance> | null = null;

export function loadMathJs(): Promise<MathJsInstance> {
  if (!mathPromise) {
    mathPromise = (async () => {
      const { create, all } = await import("mathjs");
      const math = create(all, {
        // BigNumber は単位計算との相性・表示の複雑さが増すだけなので number で運用
        number: "number",
      });
      // ノート JSON 経由で式が共有され得るため、実行環境に触れる機能は塞ぐ
      // （mathjs 公式のセキュリティ推奨に従う。evaluate/parse は使うので残す）
      math.import(
        {
          import: () => {
            throw new Error("import is disabled");
          },
        },
        { override: true },
      );
      return math;
    })();
  }
  return mathPromise;
}
