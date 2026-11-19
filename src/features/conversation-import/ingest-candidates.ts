// 取り込みのあとに「まとめてナレッジ化」を申し出る会話を選ぶ。AI は呼ばない。
//
// 本人の発言が目安の字数以上ある会話だけを候補にする（作業のやり取りだけの会話に費用をかけない）。
// 今回の取り込みで増えた・伸びた会話は候補にし、変わっていない会話は、まだナレッジ化していないものだけを候補にする。

import type { MediaIndexEntry } from "../asset-browser/media-index";
import { conversationSourceId, CONVERSATION_CANDIDATE_MIN_OWN_CHARS } from "../../lib/conversation/types";

export function conversationIngestCandidates(
  importedIds: readonly string[],
  changedIds: ReadonlySet<string>,
  media: readonly MediaIndexEntry[],
  hasKnowledge: (sourceId: string) => boolean,
): MediaIndexEntry[] {
  const byId = new Map(media.map((m) => [m.fileId, m]));
  const out: MediaIndexEntry[] = [];
  for (const id of new Set(importedIds)) {
    const m = byId.get(id);
    if (!m || m.type !== "conversation" || m.archivedAt) continue;
    if ((m.conversation?.ownChars ?? 0) < CONVERSATION_CANDIDATE_MIN_OWN_CHARS) continue;
    if (!changedIds.has(id) && hasKnowledge(conversationSourceId(id))) continue;
    out.push(m);
  }
  return out;
}
