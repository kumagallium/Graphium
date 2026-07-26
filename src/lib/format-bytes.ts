// バイト数フォーマット共通ユーティリティ
//
// 受信箱（未取り込みファイルの一覧）と、モバイルの送出シート（共有シートへ渡す前の
// 一覧）が同じ表記を使うため 1 箇所に集約する。format-datetime.ts と同じ立ち位置。

/** バイト数を人が読める単位に。1024 進、小数 1 桁（KB 未満は B のまま）。無効値は空文字。 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
