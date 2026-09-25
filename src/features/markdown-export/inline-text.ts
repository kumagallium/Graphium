// BlockNote の inline content（text / link / inlineMath）を 1 本の文字列にする共通処理
//
// エディタを通さずにノート本文を文字列にする経路（AI への入力・MCP・検索索引・照合キー）が
// 共通で使う。用途による違いは上付き・下付きの扱いだけ:
//   - scripts: true（AI に渡す本文）— <sup> / <sub> で包む。Markdown 書き出し
//     （sanitize-blocks.ts）と同じ表記。落とすと「10⁵」が「105」、「H₂O」が「H2O」になり、
//     AI が読む本文の意味が変わる
//   - 既定（平文）— タグを入れない。検索索引・照合キー・目次向け。検索は NFKC 正規化で
//     「10⁵」も「105」に揃うので、タグを入れないほうが引ける（"sup" が語として混ざらない）
// inlineMath はどちらでも $…$ にする（数式は書式ではなく内容なので、平文でも残す）。
// リンクは中身の文字だけを出す（URL は出さない）。
//
// エディタや DOM に依存しない純関数にしておく — MCP サーバー（src/mcp）からも import する。

import { scriptStyleToMarkdown } from "../../lib/script-styles";
import { inlineMathToMarkdown } from "../math/markdown-math";

export type InlineTextOptions = {
  /** 上付き・下付きを <sup> / <sub> で包む（AI に渡す本文用）。既定は false（平文） */
  scripts?: boolean;
};

/** inline content 配列を文字列にする（配列でなければ空文字） */
export function inlineContentToText(content: unknown, options: InlineTextOptions = {}): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, any>;
    if (it.type === "inlineMath") {
      text += inlineMathToMarkdown(String(it.props?.latex ?? ""));
    } else if (typeof it.text === "string") {
      text += options.scripts ? scriptStyleToMarkdown(it.text, it.styles).text : it.text;
    } else if (Array.isArray(it.content)) {
      // link など、中身を content に持つもの
      text += inlineContentToText(it.content, options);
    }
  }
  return text;
}
