// 読み込み済みの発言を fileId ごとに覚えておく小さなキャッシュ。
// Markdown 書き出しは同期の純関数で素材を読めないため、ブロックが描画時に読んだ結果を借りる。
// 保存の正本は素材側（transcript.json）で、ここは書き出しのための一時置き場。

import type { TranscriptSegment } from "../../features/meeting-recorder/transcript-format";

const MAX_FILES = 10;
const cache = new Map<string, TranscriptSegment[]>();

export function rememberTranscript(fileId: string, segments: TranscriptSegment[]): void {
  if (!fileId) return;
  cache.delete(fileId);
  cache.set(fileId, segments);
  while (cache.size > MAX_FILES) cache.delete(cache.keys().next().value as string);
}

export function recallTranscript(fileId: string): TranscriptSegment[] | undefined {
  return cache.get(fileId);
}
