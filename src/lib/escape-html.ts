// HTML として文字列を差し込む前のエスケープ（ECharts のツールチップなど innerHTML に入る所用）。

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** テキストと属性値の両方に安全なエスケープ。null / undefined は空文字にする。 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
