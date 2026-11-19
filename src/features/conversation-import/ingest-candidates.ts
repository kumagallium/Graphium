// 取り込みのあとに「まとめてナレッジ化」を申し出る会話を選ぶ。AI は呼ばない。
//
// 本人の発言が目安の字数以上ある会話だけを候補にする（作業のやり取りだけの会話に費用をかけない）。
// 今回の取り込みで増えた・伸びた会話は候補にし、変わっていない会話は、まだナレッジ化していないものだけを候補にする。

import type { MediaIndexEntry } from "../asset-browser/media-index";
import { conversationSourceId, CONVERSATION_CANDIDATE_MIN_OWN_CHARS } from "../../lib/conversation/types";

//
// 会話の中で create_note が作ったノート（createdNoteIds）が、実在してゴミ箱に無い会話は、もうノートにまとめてあるので
// 候補から外す（両方をナレッジ化すると同じ判断が二重に知見になる）。素材の一覧から 1 本ずつ
// ナレッジ化する操作は、今までどおりできる。

function select(
  importedIds: readonly string[],
  changedIds: ReadonlySet<string>,
  media: readonly MediaIndexEntry[],
  hasKnowledge: (sourceId: string) => boolean,
  noteExists: (noteId: string) => boolean,
): { candidates: MediaIndexEntry[]; leftOut: MediaIndexEntry[] } {
  const byId = new Map(media.map((m) => [m.fileId, m]));
  const candidates: MediaIndexEntry[] = [];
  const leftOut: MediaIndexEntry[] = [];
  for (const id of new Set(importedIds)) {
    const m = byId.get(id);
    if (!m || m.type !== "conversation" || m.archivedAt) continue;
    if ((m.conversation?.ownChars ?? 0) < CONVERSATION_CANDIDATE_MIN_OWN_CHARS) continue;
    if (!changedIds.has(id) && hasKnowledge(conversationSourceId(id))) continue;
    // 実在してゴミ箱に無いノートが 1 件でもあれば、もうノートにまとめてある
    if (m.conversation?.createdNoteIds?.some((n) => noteExists(n))) {
      leftOut.push(m);
      continue;
    }
    candidates.push(m);
  }
  return { candidates, leftOut };
}

export function conversationIngestCandidates(
  importedIds: readonly string[],
  changedIds: ReadonlySet<string>,
  media: readonly MediaIndexEntry[],
  hasKnowledge: (sourceId: string) => boolean,
  noteExists: (noteId: string) => boolean,
): MediaIndexEntry[] {
  return select(importedIds, changedIds, media, hasKnowledge, noteExists).candidates;
}

/** ノートにまとめてあるため、候補から外した会話の本数（ほかの条件は候補と同じ） */
export function conversationIngestLeftOutCount(
  importedIds: readonly string[],
  changedIds: ReadonlySet<string>,
  media: readonly MediaIndexEntry[],
  hasKnowledge: (sourceId: string) => boolean,
  noteExists: (noteId: string) => boolean,
): number {
  return select(importedIds, changedIds, media, hasKnowledge, noteExists).leftOut.length;
}
