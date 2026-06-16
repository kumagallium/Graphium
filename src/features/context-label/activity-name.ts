/**
 * 見出しテキストから activity 名を導出する正規化ユーティリティ。
 *
 * 見出しには順序付けのための連番プレフィックスが付くことがある
 * （例: "1. " / "1.1 " / "2) " / "a. " / "①" / "一、"）。
 * これらは見出しの並び順を示す装飾であって activity の名前そのもの
 * ではないため、activity 名として扱うときだけ先頭の連番を取り除く。
 *
 * 非破壊: 見出しブロックの本文は書き換えない。PROV-DM の activity
 * ラベルやグラフのノード名など「名前を導出する瞬間」にのみ適用する。
 */

// 先頭の連番プレフィックスにマッチする正規表現。
// 誤除去を避けるため保守的に組む:
//   - 数字・英字は「区切り記号」を伴う場合のみ連番とみなす
//     （"2026 結果" のような区切りなしの数字は名前として残す）
//   - 丸数字（①②…）はそれ自体が連番なので区切り不要
//   - 漢数字は区切り付き（"一、" など）のみ連番とみなす（"一階" 等の誤除去回避）
// 並び順が重要: ドット連番（1.1）を単独数字（1.）より先に試す。
const ENUMERATOR_PREFIX =
  /^\s*(?:[①-⑳⓪❶-❿]|\d+(?:\.\d+)+\.?|\d+[.)）：:、]|[A-Za-z][.)）]|[一二三四五六七八九十百千〇零]+[.、)）])\s*/;

/** 先頭の連番プレフィックスを 1 つだけ取り除く（純粋な文字列変換）。 */
export function stripEnumeratorPrefix(text: string): string {
  return text.replace(ENUMERATOR_PREFIX, "");
}

/**
 * 見出しテキストから activity 名を導出する。
 *
 * 連番プレフィックスを除いた結果が空になる場合（例: "1." だけの見出し）は、
 * 名前が消えてしまわないよう元のテキストをそのまま返す。
 */
export function deriveActivityName(rawText: string): string {
  const trimmed = rawText.trim();
  const stripped = stripEnumeratorPrefix(trimmed).trim();
  return stripped.length > 0 ? stripped : trimmed;
}
