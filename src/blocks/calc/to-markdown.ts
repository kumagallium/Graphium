// 計算ブロック → Markdown（純ロジック）
//
// 式と結果の両方を残す。結果は `// ` を付けて式の右に添える — calc は `//` 始まりを
// コメントとして素通しするので、書き出した Markdown をそのまま calc に貼り戻しても
// 式だけが再評価される（往復しても壊れない）。

import { parseCalcResults } from "./engine";
import { codeBlock, type BlockToMarkdown } from "../markdown-block";

export const calcToMarkdown: BlockToMarkdown = (block, ctx) => {
  const source = String(block.props?.source ?? "");
  if (!source.trim()) return [];

  const lines = source.split("\n");
  // 評価スナップショットは行と 1:1（evaluateSource が全行を map して返す）
  const results = parseCalcResults(String(block.props?.results ?? ""));
  const values = lines.map((_, i) =>
    results[i]?.kind === "value" ? (results[i].text ?? "").trim() : "",
  );

  // 結果の桁を揃えると、秤量メモとして目で追える
  const width = Math.max(...lines.map((line, i) => (values[i] ? line.length : 0)), 0);
  const rendered = lines.map((line, i) =>
    values[i] ? `${line.padEnd(width)}  // ${values[i]}` : line,
  );

  return [codeBlock(rendered.join("\n"), ctx.children)];
};
