// 「中身が無い」テキストの判定
//
// `trim()` は ECMA-262 の WhiteSpace / LineTerminator しか取り除かない。ゼロ幅スペース
// （U+200B）などの不可視な書式文字は trim() をすり抜けて残り、見た目は空でも
// truthy になってしまう。ナレッジ化の各入口（ノート・URL・PDF・Word・チャット）は
// 「本文が空なら AI を呼ばない」を前提にしており、判定がずれると AI をむだに呼んだり、
// 空同然の本文が知見抽出に回ったりする。この関数で判定を 1 つに揃える。
//
// 本文そのものは書き換えない（不可視文字を取り除いた文字列を返したりはしない）。
// 「空かどうか」の判定にのみ使う。

// trim() が落とさない不可視の書式文字。仕分けで確認済みの範囲のみを対象にする。
//   U+200B ZERO WIDTH SPACE
//   U+200C ZERO WIDTH NON-JOINER
//   U+200D ZERO WIDTH JOINER
//   U+2060 WORD JOINER
//   U+FEFF ZERO WIDTH NO-BREAK SPACE（BOM）
//   U+180E MONGOLIAN VOWEL SEPARATOR
//   U+00AD SOFT HYPHEN
const INVISIBLE_FORMATTING_CHARS = /[\u200B\u200C\u200D\u2060\uFEFF\u180E\u00AD]/g;

/** 空白（trim() が落とすもの）と、上記の不可視な書式文字だけでできているかを判定する */
export function isBlankText(text: string): boolean {
  return text.replace(INVISIBLE_FORMATTING_CHARS, "").trim().length === 0;
}

/**
 * 「見える文字」の数を返す。上記の不可視な書式文字だけを取り除いた長さで数える
 * （空白は見た目上の間隔を作るため、trim() のような除去はしない）。
 * 「本文が短すぎる」しきい値（50 文字など）の判定に使う。isBlankText と違い、
 * こちらは長さの下限を測るためのもので「空かどうか」の判定ではない。
 */
export function visibleTextLength(text: string): number {
  return text.replace(INVISIBLE_FORMATTING_CHARS, "").length;
}
