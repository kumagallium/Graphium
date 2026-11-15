// PDF ブロックの書き出し HTML に載せる href。
// 取り込んだ .json ノートの url に javascript: が入っていても、書き出したファイルのクリックで動かないようにする。
// http(s) と PDF 素材を指す内部参照（local-media:// / file-media:// / media-server://）だけ通し、ほかは undefined（リンクにしない）。

import { safeExternalHref } from "../../lib/safe-href";

// PDF の素材を指す内部参照だけ href にする。data: / blob: / shared-blob: は
// PDF の参照先として意味が無く、クリックで別の中身を開かせる経路になるので通さない。
const PDF_INTERNAL_PREFIXES = ["local-media://", "file-media://", "media-server://"];

export function pdfExportHref(url: string): string | undefined {
  const safe = safeExternalHref(url);
  // mailto: は PDF の参照先として不要なので通さない
  if (safe) return /^https?:/i.test(safe) ? safe : undefined;
  const lowered = url.trim().toLowerCase();
  return PDF_INTERNAL_PREFIXES.some((p) => lowered.startsWith(p)) ? url : undefined;
}
