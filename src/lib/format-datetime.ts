// 日時フォーマット共通ユーティリティ
//
// 一覧 (NoteListView / WikiListView / AssetGalleryView) で共通する日時表示を
// 1 箇所に集約する。タイムゾーンはユーザーローカル、表記はゼロパディング固定の
// `YYYY-MM-DD HH:MM`（分まで）。秒・タイムゾーンは表示しない（同日内の更新を
// 区別したい・分単位で十分という user の判断 2026-05-21）。
//
// 元の日付（時刻なし）表示は YYYY-MM-DD で、ナレッジ・素材・ノートで重複定義
// されていた。日時化に合わせて util に抽出。

/** `YYYY-MM-DD HH:MM` 形式。無効値は空文字。タイムゾーンはユーザーローカル。 */
export function formatDateTime(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

/** `YYYY-MM-DD` 形式（時刻なし）。無効値は空文字。 */
export function formatDate(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}
