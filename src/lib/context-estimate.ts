// AI に送る量の目安（サーバーと画面の両方で使う純ロジック）
//
// ローカルのモデル（LM Studio など）は読み込むときのコンテキスト長で一度に扱える量が決まる。
// 送る前に、読み込み中の長さ（サーバーが LM Studio に問い合わせる）と、ここで見積もった
// 要りそうな長さを比べて、足りなければ先に知らせる。トークン数は文字数からの目安で、多めに見る。

/** 文字数からトークン数の目安（多めに見積もる。漢字かなは 1 字 0.7、それ以外は 0.3） */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[　-ヿ㐀-鿿豈-﫿＀-￯]/.test(ch)) cjk++;
  const other = [...text].length - cjk;
  return Math.ceil(cjk * 0.7 + other * 0.3);
}

/** 指示文・メモ・考える部分（推論するモデル）・出力の余白に見込むトークン数 */
export const CONTEXT_OVERHEAD_TOKENS = 6144;

/**
 * 清書・要約の 1 回に要りそうなコンテキスト長（1,024 単位で切り上げ）。
 * 清書は入力とほぼ同じ長さを書き出すので入力の 2 倍、要約は入力の分
 */
export function requiredContext(kind: "cleanup" | "summary", inputTokens: number): number {
  const need = (kind === "cleanup" ? inputTokens * 2 : inputTokens) + CONTEXT_OVERHEAD_TOKENS;
  return Math.ceil(need / 1024) * 1024;
}
