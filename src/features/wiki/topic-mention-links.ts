// トピックの本文に別のトピックの題が出てきたら、そのトピックへのリンク記録を書く（純関数）。
// AI は使わず、文字列の一致だけで決める。記録は knowledgeLinks に via: "title-mention" の
// 目印つきで置き、索引の outgoingLinks（一覧のリンク／被参照・全体グラフの参照の辺）に流れる。
import type { BlockLink } from "../../lib/block-link-types";
import type { GraphiumDocument } from "../../lib/document-types";
import { extractBlockText } from "../navigation/index-file";

export type TopicCandidate = { id: string; title: string };

type Matcher = { id: string; base: string; ascii: boolean; re: RegExp | null; compact: string };

const MIN_BASE_LENGTH = 3;

/** NFKC にして出典の印 [[...]] を取り除く */
function normalizeBody(body: string): string {
  return body.normalize("NFKC").replace(/\[\[[^\]]*\]\]/g, " ");
}

/** NFKC にして末尾の括弧書き（1 つ）を外した題 */
function baseOfTitle(title: string): string {
  return title.normalize("NFKC").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSpaces(s: string): string {
  return s.replace(/\s+/g, "");
}

/** 結べる候補だけに絞って照合器を作る（同じ base が 2 件以上ある候補は除く） */
function buildMatchers(candidates: TopicCandidate[]): Matcher[] {
  const entries = candidates.map((c) => {
    const base = baseOfTitle(c.title);
    return { id: c.id, base, key: stripSpaces(base).toLowerCase() };
  });
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.key, (count.get(e.key) ?? 0) + 1);
  const out: Matcher[] = [];
  for (const e of entries) {
    if ([...e.base].length < MIN_BASE_LENGTH) continue;
    if ((count.get(e.key) ?? 0) > 1) continue;
    const ascii = /^[\x20-\x7e]+$/.test(e.base);
    out.push({
      id: e.id,
      base: e.base,
      ascii,
      re: ascii ? new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(e.base)}(?![A-Za-z0-9])`, "i") : null,
      compact: stripSpaces(e.base).toLowerCase(),
    });
  }
  return out;
}

/** 正規化済みの文字列に、その題が出てくるか */
function matchesText(normalizedText: string, m: Matcher): boolean {
  if (m.ascii) return m.re!.test(normalizedText);
  return stripSpaces(normalizedText).toLowerCase().includes(m.compact);
}

type SelfOptions = { selfTitle?: string };

function isSelfTitle(title: string, selfTitle?: string): boolean {
  if (selfTitle === undefined) return false;
  return title.normalize("NFKC").trim() === selfTitle.normalize("NFKC").trim();
}

/** 本文で言及されているトピック id（candidates の順・重複なし） */
export function findTopicMentions(
  body: string,
  selfId: string,
  candidates: TopicCandidate[],
  options: SelfOptions = {},
): string[] {
  const text = normalizeBody(body);
  const titleById = new Map(candidates.map((c) => [c.id, c.title]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const m of buildMatchers(candidates)) {
    if (m.id === selfId || seen.has(m.id)) continue;
    if (isSelfTitle(titleById.get(m.id) ?? "", options.selfTitle)) continue;
    if (matchesText(text, m)) {
      seen.add(m.id);
      result.push(m.id);
    }
  }
  return result;
}

/** 言及ごとにリンク記録を作る。元ブロックは、その題が最初に出てくるブロック（無ければ先頭） */
export function buildTopicMentionLinks(
  blocks: any[],
  mentionedIds: string[],
  candidates: TopicCandidate[],
): BlockLink[] {
  if (!blocks.length) return [];
  const matchers = new Map(buildMatchers(candidates).map((m) => [m.id, m]));
  const texts = blocks.map((b) => normalizeBody(extractBlockText(b) ?? ""));
  const links: BlockLink[] = [];
  for (const id of mentionedIds) {
    const m = matchers.get(id);
    let idx = m ? texts.findIndex((t) => matchesText(t, m)) : -1;
    if (idx < 0) idx = 0;
    links.push({
      id: crypto.randomUUID(),
      sourceBlockId: blocks[idx].id,
      targetBlockId: "",
      targetNoteId: id,
      type: "reference",
      layer: "knowledge",
      createdBy: "ai",
      via: "title-mention",
    });
  }
  return links;
}

/**
 * 既存のトピックページの題の言及リンクを、今の本文と候補に合わせて張り直す。
 * 変わらなければ null（保存しない）。modifiedAt は呼び出し側の保存に任せる。
 */
export function relinkTopicMentions(
  doc: GraphiumDocument,
  candidates: TopicCandidate[],
  selfId = "",
): GraphiumDocument | null {
  const meta = doc.wikiMeta;
  if (!meta || meta.kind !== "topic" || typeof meta.topicMarkdown !== "string") return null;
  const page = doc.pages[0];
  if (!page) return null;
  const mentioned = findTopicMentions(meta.topicMarkdown, selfId, candidates, { selfTitle: doc.title });
  const existing = (page.knowledgeLinks ?? []).filter((l) => l.via === "title-mention");
  const existingIds = new Set(existing.map((l) => l.targetNoteId));
  const nextIds = new Set(mentioned);
  if (existingIds.size === nextIds.size && [...nextIds].every((id) => existingIds.has(id))
    && existing.length === nextIds.size) {
    return null;
  }
  const fresh = buildTopicMentionLinks(page.blocks ?? [], mentioned, candidates);
  return {
    ...doc,
    pages: [{
      ...page,
      knowledgeLinks: [...(page.knowledgeLinks ?? []).filter((l) => l.via !== "title-mention"), ...fresh],
    }, ...doc.pages.slice(1)],
  };
}
