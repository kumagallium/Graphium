// 「段落に展開」: 発言を通常の段落ブロックにする（純関数）
//
// 発言ごとに 1 段落 `[14:03] 相手: …`。[mm:ss] は会議開始からの相対時刻。
// 段落 id は BlockNote が振る（挿入後は安定。後続の要約が参照する）。

import { formatSegmentLine, type TranscriptSegment } from "../../features/meeting-recorder/transcript-format";

export type ParagraphBlock = {
  type: "paragraph";
  content: Array<{ type: "text"; text: string; styles: Record<string, never> }>;
};

export function buildTranscriptParagraphs(
  segments: TranscriptSegment[],
  labels: { other: string; self: string },
): ParagraphBlock[] {
  return segments.map((s) => ({
    type: "paragraph" as const,
    content: [{ type: "text" as const, text: formatSegmentLine(s, labels), styles: {} }],
  }));
}
