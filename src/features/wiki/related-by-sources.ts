// 同じ資料を引いているナレッジページ（話題・問答・資料の要約）を機械的に結ぶ。
//
// カーパシー LLM Wiki の「ページ間の相互参照」に相当する。Graphium のトピック本文は資料だけを
// 引用し（[[source:<id>]]）、トピック同士を直接リンクする構文を持たないので、相互参照は
// 「同じ資料を出典に持つか」から機械的に導く — AI 呼び出しも判断のぶれも無い。
// 点検の「欠けた相互参照」を LLM に探させる代わりに、常にここで出す（2026-10-20 決定）。

import type { WikiKind, WikiMetaSummary } from "../../lib/document-types";

export type RelatedPage = {
  id: string;
  title: string;
  kind: WikiKind;
  /** 共有している資料の本数 */
  shared: number;
};

/** 相互参照の対象にする種類（資料を出典に持つ新形式のページ） */
const RELATED_KINDS: ReadonlySet<WikiKind> = new Set(["topic", "answer", "summary"]);

/**
 * targetId のページと同じ資料を 1 本以上共有しているページを、共有本数の多い順（同数ならタイトル順）
 * に返す。wikiFiles はゴミ箱・アーカイブを除外済みの一覧（fm.wikiFiles）を渡すこと。
 * 自分自身は含めない。資料を持たないページ（旧形式のトピック・要約）は結ばない。
 */
export function findRelatedBySharedSources(
  targetId: string,
  wikiFiles: { id: string }[],
  wikiMetas: Map<string, WikiMetaSummary>,
): RelatedPage[] {
  const target = wikiMetas.get(targetId);
  if (!target || !RELATED_KINDS.has(target.kind)) return [];
  const sources = new Set(target.derivedFromNotes ?? []);
  if (sources.size === 0) return [];

  const out: RelatedPage[] = [];
  for (const f of wikiFiles) {
    if (f.id === targetId) continue;
    const meta = wikiMetas.get(f.id);
    if (!meta || !RELATED_KINDS.has(meta.kind)) continue;
    let shared = 0;
    for (const s of meta.derivedFromNotes ?? []) if (sources.has(s)) shared++;
    if (shared === 0) continue;
    out.push({ id: f.id, title: meta.title, kind: meta.kind, shared });
  }
  out.sort((a, b) => b.shared - a.shared || a.title.localeCompare(b.title));
  return out;
}
