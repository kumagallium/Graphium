// 素材の文字起こしを、探すための 1 本の文章にする。
// 保存の正本は素材のそばの transcript.json（デスクトップ版だけが読める）。

import * as api from "./api";
import { parseTranscriptSegments, type TranscriptSegment } from "./transcript-format";

/** 発言を 1 行ずつ並べる。時刻と話者は入れない（探す言葉に当たるのは発言の中身だけでよい） */
export function segmentsToPlainText(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** 素材の文字起こしを読む。まだ無い・読めないときは null */
export async function loadTranscriptText(fileId: string): Promise<string | null> {
  const segments = parseTranscriptSegments(await api.readTranscript(fileId));
  if (!segments) return null;
  const text = segmentsToPlainText(segments);
  return text || null;
}
