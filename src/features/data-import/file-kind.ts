// 「取り込みダイアログを開くべきファイル」の判定
//
// MIME では区別できない（装置ファイルはたいてい text/plain か空）ので拡張子で見る。
// ここを 1 箇所にして、スラッシュメニュー・ドロップ・素材ギャラリーの 3 経路が
// 同じ判断を使う。

const DELIMITED_EXTENSIONS = [".csv", ".tsv", ".txt", ".dat", ".log", ".asc"];

export const DELIMITED_FILE_ACCEPT = DELIMITED_EXTENSIONS.join(",");

/** その名前のファイルを区切りテキストとして扱うか */
export function isDelimitedDataFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return DELIMITED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
