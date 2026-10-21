// 清書・要約で AI に送る本文の形（送る前に長さを見積もるための近似）
//
// サーバーは発言を `[u12] [03:21] 相手: 本文` の行にして送る（meeting-summary の
// buildMeetingSummaryUserMessage）。サーバーのコードを画面に持ち込まず、同じ形の行を作って数える。

import { mmss } from "../../features/meeting-recorder/transcript-format";
import type { SummaryUtterance } from "../../features/meeting-recorder/summary-service";

export function buildMeetingSummaryLines(utterances: SummaryUtterance[]): string {
  return utterances
    .map((u, i) => `[u${i + 1}] [${mmss(u.startMs)}] ${u.track ? "相手: " : ""}${u.text.replace(/\s*\n\s*/g, " ").trim()}`)
    .join("\n");
}
