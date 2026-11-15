// 受信箱から取り込んだ素材のうち、裏で文字を読み取る対象を選ぶ（純関数）
//
// 一括取り込み（run-intake）と同じ基準: 画像で、まだ文字が読めていないもの。
// メモ / URL（kind あり）は素材ではないので対象外。重複で skip されたものは
// imported に入らないので、そもそも渡ってこない（読み済みを読み直さない）。

import type { BulkOcrTarget } from "../../media-ocr/bulk-ocr";
import type { MediaIndexEntry } from "../../asset-browser/media-index";
import type { InboxImportResult } from "./importer";

export function selectInboxOcrTargets(
  imported: InboxImportResult["imported"],
  media: readonly Pick<MediaIndexEntry, "fileId" | "type" | "url" | "name" | "ocrText">[] | undefined,
): BulkOcrTarget[] {
  if (!media) return [];
  const byId = new Map(media.map((m) => [m.fileId, m]));
  const seen = new Set<string>();
  const targets: BulkOcrTarget[] = [];
  for (const item of imported) {
    if (item.kind) continue;
    if (seen.has(item.fileId)) continue;
    const entry = byId.get(item.fileId);
    if (!entry || entry.type !== "image" || entry.ocrText) continue;
    seen.add(item.fileId);
    targets.push({ fileId: entry.fileId, url: entry.url, name: entry.name });
  }
  return targets;
}
