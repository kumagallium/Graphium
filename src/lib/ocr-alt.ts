// 検索用の「別の読み」（altText）の取り込み口の共通処理。
//
// 共有フォルダの他人のノート JSON など、信用できない入り口からも流れ込むので、
// 文字列でなければ無視し、長さを打ち切る（数 MB の文字列で検索や索引が固まらないように）。

/** 別の読みの最大文字数 */
export const MAX_ALT_TEXT_CHARS = 20_000;

/** 文字列なら前後の空白を落として上限で切って返す。文字列でない・空なら undefined */
export function sanitizeAltText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  let cut = v.slice(0, MAX_ALT_TEXT_CHARS);
  // 上限がサロゲートペアの途中に当たったら、片割れを残さない
  const last = cut.charCodeAt(cut.length - 1);
  if (v.length > MAX_ALT_TEXT_CHARS && last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const t = cut.trim();
  return t || undefined;
}
