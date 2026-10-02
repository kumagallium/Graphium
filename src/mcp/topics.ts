// ナレッジ層（トピック / 知見 / 洞察）の索引と、2 ホップの辿り。
//
// Karpathy の LLM Wiki と同じ index 先読み方式: list_topics で索引（タイトル + 1 行）を
// 見せ、get_topic で興味のあるトピック 1 件を「本文 + メンバー知見 + 出どころノート」まで
// 一度に開かせる（資料から作ったトピックは「本文 + 引いている資料」）。GraphRAG のように型ごとの予算を決め打ちしない。
//
// トピックの topicIds / derivedFromClaims / conflictsWith は NoteIndexEntry にミラーされて
// いない（index-file.ts 参照）ため、対象を絞ったうえで readNote() を都度呼んで doc.wikiMeta を
// 直接読む。全 wiki を無条件に読むことはしない。

import type { NoteIndexEntry } from "../features/navigation/index-file";
import { extractOneLiner, noteToMarkdown } from "./note-text";
import { allEntries } from "./search";
import { describeSource, type SourceRef } from "./sources";
import { readNote, resolveGraphiumRoot } from "./vault";

export type TopicListItem = {
  topicId: string;
  title: string;
  oneLiner: string;
  /** 束ねている知見の数（以前の形式のトピック） */
  claimCount: number;
  /** 直接引いている資料の数（資料から作ったトピック） */
  sourceCount: number;
};

export type TopicList = {
  items: TopicListItem[];
  /** limit で切る前の総数。「100 件」と「148 件中 100 件」を言い分けるため */
  total: number;
};

/** wikiKind === "topic" のエントリだけを対象に、索引（タイトル + 1 行 + 件数）を返す */
export function listTopics(
  options: { limit?: number } = {},
  root = resolveGraphiumRoot(),
): TopicList {
  const { limit = 100 } = options;
  const topicEntries = allEntries(root).filter((e) => e.wikiKind === "topic");

  const items: TopicListItem[] = [];
  // 総数は本体が読めたものだけで数える（索引にあってもファイルが無いものを含めると、
  // 「3 件中 2 件」と出て limit を上げても増えない）
  let total = 0;
  for (const entry of topicEntries) {
    const doc = readNote(entry.noteId, root);
    if (!doc) continue;
    total += 1;
    if (items.length >= limit) continue;
    items.push({
      topicId: entry.noteId,
      title: entry.title,
      oneLiner: extractOneLiner(doc),
      // 新形式トピック（資料から作る）は derivedFromClaims を使わず derivedFromNotes に
      // 資料 id を持つ。両者は意味が違う（知見 vs 資料）ので別々に数える。
      claimCount: doc.wikiMeta?.derivedFromClaims?.length ?? 0,
      sourceCount: doc.wikiMeta?.derivedFromNotes?.length ?? 0,
    });
  }
  return { items, total };
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
  /** この知見の出どころ（ノート、または PDF・Word などの資料） */
  sources: SourceRef[];
};

export type TopicDetail = {
  topicId: string;
  title: string;
  /** 本文（Markdown） */
  body: string;
  /** 以前の形式: 束ねている知見と、各知見の出どころ */
  members: TopicMemberClaim[];
  /** 資料から作った形式: 本文が直接引いている資料（ノート・PDF・Word・Web ページ） */
  sources: SourceRef[];
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

  const titles = new Map(entries.map((e) => [e.noteId, e.title]));
  const members: TopicMemberClaim[] = claimIds.map((claimId) => {
    const claimEntry = entryById.get(claimId);
    return {
      claimId,
      title: claimEntry?.title ?? claimId,
      sources: (claimEntry?.derivedFromNotes ?? []).map((id) => describeSource(id, root, titles)),
    };
  });

  // 新形式トピック（derivedFromClaims が空、derivedFromNotes に資料 id を持つ）は
  // 「知見」という間接層を持たず、資料を直接引く。資料 id は pdf:/document:/url: を含むので、
  // 素材インデックスから名前を引いて返す（生の id だけでは出典を示せない）。
  // 旧形式でも再生成で derivedFromNotes を持つものがあり、trace_lineage と揃えるため常に返す
  const sources: SourceRef[] = (doc.wikiMeta?.derivedFromNotes ?? []).map((id) =>
    describeSource(id, root, titles),
  );

  return {
    topicId: entry.noteId,
    title: entry.title,
    body: noteToMarkdown(doc),
    members,
    sources,
  };
}
