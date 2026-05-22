// PDF テキストレイヤーから取り出した選択文字列を「読みやすい」形に正規化する。
//
// PDF の text layer は視覚的な行ごとに分割されているため、`selection.toString()`
// で得られる文字列には散文の論理段落の途中にも改行が入る。これを後処理で
// クリーンアップする。
//
// 方針:
//   1. 改行コードを `\n` に統一
//   2. ハイフネーション解消（`transi-\nstor` → `transistor`）
//   3. 連続改行は段落区切りとして残す
//   4. 段落内の単一改行は、隣接文字に応じて処理:
//      - 両側 CJK → 改行を消すだけ（半角スペース不要）
//      - それ以外 → 半角スペース 1 個に置換
//   5. 連続スペース・タブを 1 個にまとめる
//
// 注意: これはヒューリスティックなので、リスト・表・コードブロックなど
// 「改行が意味を持つ」レイアウトでは元の意図と異なる結果になることがある。
// 完璧は目指さず、散文の選択を読みやすくする方向に振っている。

const CJK_RE = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch);
}

const PARAGRAPH_PLACEHOLDER = " "; // U+2029 PARAGRAPH SEPARATOR

/**
 * PDF text layer 由来の選択テキストから不要な改行を取り除く。
 *
 * 例:
 *   "transi-\nstor は半導体素子" → "transistor は半導体素子"
 *   "This is a long\nsentence."   → "This is a long sentence."
 *   "これは長い\n文章です。"       → "これは長い文章です。"
 *   "段落1\n\n段落2"              → "段落1\n\n段落2"（段落区切りは保持）
 */
export function normalizePdfSelectionText(raw: string): string {
  if (!raw) return raw;
  let text = raw.replace(/\r\n?/g, "\n");

  // 1) ハイフネーション解消: 英字 + `-` + 改行 + 小文字 → 直結
  //    （行頭が大文字なら別単語の可能性が高いので残す）
  text = text.replace(/([A-Za-z])-\n(?=[a-z])/g, "$1");

  // 2) 連続改行（段落区切り）を一時的なプレースホルダに退避
  text = text.replace(/\n{2,}/g, PARAGRAPH_PLACEHOLDER);

  // 3) 残った単一改行を処理
  text = text.replace(/([^\n])\n([^\n])/g, (_m, a: string, b: string) => {
    // 両側 CJK は改行を消すだけ（日本語等で半角スペースを入れない）
    if (isCjk(a) && isCjk(b)) return a + b;
    // 行末が句読点で終わっていたら改行は意味があるかもしれない
    // …が、散文では段落区切りは連続改行で表現されることが多いので、
    // 単一改行は半角スペースに統一する
    return a + " " + b;
  });

  // 4) スペース・タブをまとめる
  text = text.replace(/[ \t]+/g, " ");

  // 5) 段落プレースホルダを戻す
  text = text.replace(new RegExp(PARAGRAPH_PLACEHOLDER, "g"), "\n\n");

  return text.trim();
}
