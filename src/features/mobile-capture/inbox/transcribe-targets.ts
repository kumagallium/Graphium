// 受信箱から取り込んだ素材のうち、裏で文字起こしする対象を選ぶ（純関数）
//
// 写真の自動読み取り（ocr-targets）と同じ考え方: 音声で、まだ文字が無いもの。
// メモ / URL（kind あり）は素材ではないので対象外。重複で skip されたものは
// imported に入らないので、そもそも渡ってこない。

import type { MediaIndexEntry } from "../../asset-browser/media-index";
import type { InboxImportResult } from "./importer";

export function selectInboxTranscribeTargets(
  imported: InboxImportResult["imported"],
  media: readonly Pick<MediaIndexEntry, "fileId" | "type" | "mimeType" | "ocrText">[] | undefined,
): string[] {
  if (!media) return [];
  const byId = new Map(media.map((m) => [m.fileId, m]));
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const item of imported) {
    if (item.kind) continue;
    if (seen.has(item.fileId)) continue;
    const entry = byId.get(item.fileId);
    if (!entry || entry.type !== "audio" || !entry.mimeType?.startsWith("audio/") || entry.ocrText) continue;
    seen.add(item.fileId);
    targets.push(entry.fileId);
  }
  return targets;
}
