// ナレッジ層（トピック / 知見 / 洞察）の索引と、2 ホップの辿り。
//
// Karpathy の LLM Wiki と同じ index 先読み方式: list_topics で索引（タイトル + 1 行）を
// 見せ、get_topic で興味のあるトピック 1 件を「本文 + メンバー知見 + 出どころノート」まで
// 一度に開かせる。GraphRAG のように型ごとの予算を決め打ちしない。
//
// トピックの topicIds / derivedFromClaims / conflictsWith は NoteIndexEntry にミラーされて
// いない（index-file.ts 参照）ため、対象を絞ったうえで readNote() を都度呼んで doc.wikiMeta を
// 直接読む。全 wiki を無条件に読むことはしない。

import type { NoteIndexEntry } from "../features/navigation/index-file";
import { extractOneLiner, noteToMarkdown } from "./note-text";
import { allEntries } from "./search";
import { readNote, resolveGraphiumRoot } from "./vault";

export type TopicListItem = {
  topicId: string;
  title: string;
  oneLiner: string;
  memberCount: number;
};

/** wikiKind === "topic" のエントリだけを対象に、索引（タイトル + 1 行 + 件数）を返す */
export function listTopics(
  options: { limit?: number } = {},
  root = resolveGraphiumRoot(),
): TopicListItem[] {
  const { limit = 100 } = options;
  const topicEntries = allEntries(root).filter((e) => e.wikiKind === "topic");

  const items: TopicListItem[] = [];
  for (const entry of topicEntries) {
    const doc = readNote(entry.noteId, root);
    if (!doc) continue;
    items.push({
      topicId: entry.noteId,
      title: entry.title,
      oneLiner: extractOneLiner(doc),
      memberCount: doc.wikiMeta?.derivedFromClaims?.length ?? 0,
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** topicId（ID そのもの、または完全一致するタイトル）からトピックのエントリを引く */
export function resolveTopicEntry(
  idOrTitle: string,
  root = resolveGraphiumRoot(),
): NoteIndexEntry | null {
  const topicEntries = allEntries(root).filter((e) => e.wikiKind === "topic");
  const byId = topicEntries.find((e) => e.noteId === idOrTitle);
  if (byId) return byId;
  const byTitle = topicEntries.find((e) => e.title === idOrTitle);
  return byTitle ?? null;
}

export type TopicMemberClaim = {
  claimId: string;
  title: string;
  /** この知見が出どころとするノート（id / title） */
  sourceNotes: { noteId: string; title: string }[];
};

export type TopicDetail = {
  topicId: string;
  title: string;
  /** 本文（Markdown） */
  body: string;
  members: TopicMemberClaim[];
};

/**
 * トピック 1 件の本文とメンバー知見、各知見の出どころノートをまとめて返す（2 ホップ）。
 * 見つからなければ null。
 */
export function getTopicDetail(idOrTitle: string, root = resolveGraphiumRoot()): TopicDetail | null {
  const entry = resolveTopicEntry(idOrTitle, root);
  if (!entry) return null;
  const doc = readNote(entry.noteId, root);
  if (!doc) return null;

  const entries = allEntries(root);
  const entryById = new Map(entries.map((e) => [e.noteId, e]));
  const claimIds = doc.wikiMeta?.derivedFromClaims ?? [];

  const members: TopicMemberClaim[] = claimIds.map((claimId) => {
    const claimEntry = entryById.get(claimId);
    const sourceNoteIds = claimEntry?.derivedFromNotes ?? [];
    return {
      claimId,
      title: claimEntry?.title ?? claimId,
      sourceNotes: sourceNoteIds.map((noteId) => ({
        noteId,
        title: entryById.get(noteId)?.title ?? "",
      })),
    };
  });

  return {
    topicId: entry.noteId,
    title: entry.title,
    body: noteToMarkdown(doc),
    members,
  };
}
