// 外部由来の HTML の id が、アプリや同梱ライブラリの「存在確認」を狂わせないかの検査。
//
// id="__TAURI_INTERNALS__" の要素が本文にあると、`"__TAURI_INTERNALS__" in window` が true になり
// isTauri() が誤判定して API の向き先が変わる。
// HTML の名前付きアクセスは window / document に元からあるプロパティ（location・history・name など）を
// 上書きしないので、それらは守らなくてよい。記事の見出し id（History・Origin・Top など）や
// 脚注のアンカー（fn1 / cite_note-1）は残し、落とすのは次の 2 種類だけ。
//   (a) "__" で始まる id
//   (b) ブラウザの window に元から無く、コードが typeof X / window.X の有無で分岐しうる名前
// 判定は大文字小文字を区別する（名前付きアクセスも区別するため）。
// 純関数（window を参照しない）なのでサーバーとブラウザの両方から使える。

const RESERVED_IDS = new Set([
  "process", "global", "module", "require", "exports", "Buffer", "define",
]);

/** 存在確認を狂わせうる id なら true（その id は落とす）。 */
export function isClobberingId(id: string): boolean {
  const v = id.trim();
  if (!v) return false;
  if (v.startsWith("__")) return true;
  return RESERVED_IDS.has(v);
}
