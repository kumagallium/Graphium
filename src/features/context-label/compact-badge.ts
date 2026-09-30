// 狭い本文枠で margin バッジに出す 1 文字を決める。
// 表示名は「[ツール]」「[材料]」のように角括弧付きなので、素直に先頭を取るとどのラベルも「[」になり、
// 色でしか見分けられない。括弧・記号を飛ばして、最初の字母か数字を使う。
// 字母も数字も無ければ（記号だけの名前）表示名の先頭をそのまま返す。
export function compactBadgeText(displayLabel: string): string {
  const chars = Array.from(displayLabel);
  return chars.find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? chars[0] ?? displayLabel;
}
