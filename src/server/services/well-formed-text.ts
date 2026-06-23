// LLM リクエスト本文に混入する「不正なサロゲートペア（lone surrogate）」を無害化するユーティリティ。
//
// 背景:
//   ノート本文や Wiki context を文字数（UTF-16 コードユニット数）基準で切り詰めると、
//   絵文字や BMP 外文字のサロゲートペアの途中で切れて、片割れ（lone high/low surrogate）が
//   残ることがある。破損したノートを貼り付けた場合も同様。
//   JS の JSON.stringify は lone surrogate を `\uD800` のようにエスケープして「JS 的には妥当な」
//   JSON を出力するが、Anthropic API サーバ（Python の json デコーダ）はこれを受け取ると
//   「no low surrogate in string」で 400 を返す。
//   → JSON 化される前に lone surrogate を除去しておけば、この 400 を構造的に防げる。
//
// 方針:
//   well-formed でない文字列だけを U+FFFD（置換文字）に置き換える。正常な文字列は変更しない。

import type { ModelMessage } from "ai";

// lone high surrogate（後ろに low surrogate が無い）/ lone low surrogate（前に high surrogate が無い）
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * 文字列を well-formed な UTF-16 にする（lone surrogate を U+FFFD に置換）。
 * Node 20+ / モダンブラウザの String.prototype.toWellFormed があればそれを使い、
 * 無ければ正規表現でフォールバックする。
 */
export function toWellFormed(text: string): string {
  const native = (String.prototype as { toWellFormed?: () => string }).toWellFormed;
  if (typeof native === "function") {
    return native.call(text);
  }
  return text.replace(LONE_SURROGATE, "�");
}

/**
 * ModelMessage の content（string もしくは content part 配列）内のテキストを well-formed 化する。
 * 文字列 content はそのまま、配列 content は各 part の text フィールドのみをサニタイズする。
 * binary（image / file の data 等）には触れない。
 */
export function sanitizeMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    const { content } = message;
    if (typeof content === "string") {
      return { ...message, content: toWellFormed(content) } as ModelMessage;
    }
    if (Array.isArray(content)) {
      const parts = content.map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text: unknown }).text === "string"
        ) {
          return { ...part, text: toWellFormed((part as { text: string }).text) };
        }
        return part;
      });
      return { ...message, content: parts } as ModelMessage;
    }
    return message;
  });
}
