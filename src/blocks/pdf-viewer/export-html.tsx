// PDF ブロックの書き出し HTML（toExternalHTML の中身）。
// view.tsx から切り出し、単体で描画して確かめられるようにしたもの。書き出し結果は変えない。

import { pdfExportHref } from "./export-href";

export function PdfExportHtml({ url, name }: { url: string; name?: string }) {
  // URL 未設定のブロックは書き出す中身を持たない
  if (!url) return <p />;
  // 危険なスキーム（javascript: 等）はリンクにせず文字だけ出す
  const href = pdfExportHref(url);
  return <p>{href ? <a href={href}>{name || url}</a> : name || url}</p>;
}
