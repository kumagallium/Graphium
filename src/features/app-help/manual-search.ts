// マニュアル節の検索（MiniSearch + 語彙検索の tokenize）と、AI に渡す文脈の組み立て。

import MiniSearch from "minisearch";
import { tokenize } from "../lexical-search";
import { loadManualSections, type ManualLocale, type ManualSection } from "./manual-corpus";

const DEFAULT_LIMIT = 8;
const MAX_PER_PAGE = 3;
const CONTEXT_TEXT_CHARS = 1800;

// 「〜できる？」「Can I 〜?」のような問いの決まり文句。そのまま探すと「できること」「What the
// assistant can do」のような見出しが上に来て、聞きたい機能の節が押し出される。探す前に落とす
const JA_QUESTION_FILLERS = [
  "できますか", "できない", "できる", "られますか", "られる", "ありますか", "ますか", "ですか",
  "どうやって", "どうすれば", "どこで", "どこに", "には", "って", "したい", "使い方", "Graphium",
];
const EN_STOPWORDS = new Set([
  "a", "an", "the", "i", "my", "me", "you", "your", "it", "is", "are", "be", "can", "could", "do", "does",
  "how", "what", "where", "when", "which", "to", "into", "of", "in", "on", "for", "and", "or", "with",
  "from", "there", "way", "graphium", "possible", "want", "would", "like",
]);

/** 問いから決まり文句を落とした探す語。全部落ちてしまったら元の問いを使う */
export function toManualQuery(question: string): string {
  let q = question.replace(/[？?！!。、,.]/g, " ");
  for (const f of JA_QUESTION_FILLERS) q = q.split(f).join(" ");
  q = q
    .split(/\s+/)
    .filter((w) => w && !EN_STOPWORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
  return q || question;
}

export function createManualSearcher(sections: ManualSection[]): {
  search(query: string, limit?: number): ManualSection[];
} {
  const ms = new MiniSearch<ManualSection>({
    idField: "id",
    fields: ["heading", "pageTitle", "text"],
    tokenize: (s: string) => tokenize(s),
    processTerm: (term: string) => (term ? term : null),
    searchOptions: {
      boost: { heading: 2, pageTitle: 1.5 },
      combineWith: "OR" as const,
    },
  });
  ms.addAll(sections);
  const byId = new Map(sections.map((s) => [s.id, s]));
  return {
    search(query, limit = DEFAULT_LIMIT) {
      if (!query.trim()) return [];
      const perPage = new Map<string, number>();
      const out: ManualSection[] = [];
      for (const r of ms.search(toManualQuery(query))) {
        const sec = byId.get(String(r.id));
        if (!sec) continue;
        const n = perPage.get(sec.page) ?? 0;
        if (n >= MAX_PER_PAGE) continue;
        perPage.set(sec.page, n + 1);
        out.push(sec);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}

export function buildManualContext(sections: ManualSection[]): string {
  if (sections.length === 0) return "";
  const blocks = sections.map(
    (s, i) =>
      `[M${i + 1}] ${s.pageTitle} › ${s.heading}\nURL: ${s.url}\n${s.text.slice(0, CONTEXT_TEXT_CHARS)}`,
  );
  return `<graphium-manual>\n${blocks.join("\n\n")}\n</graphium-manual>`;
}

const searcherCache = new Map<ManualLocale, Promise<ReturnType<typeof createManualSearcher>>>();

export async function retrieveManualContext(
  query: string,
  locale: ManualLocale,
  limit?: number,
): Promise<{ context: string; sections: ManualSection[] }> {
  let p = searcherCache.get(locale);
  if (!p) {
    p = loadManualSections(locale).then(createManualSearcher);
    searcherCache.set(locale, p);
    p.catch(() => searcherCache.delete(locale));
  }
  const searcher = await p;
  const sections = searcher.search(query, limit);
  return { context: buildManualContext(sections), sections };
}

/**
 * 答えに漏れた節の番号（[M1]・【[M2]】・[M1][M3] など）を消す。節の番号は AI に渡すときの
 * 目印で、利用者には意味が無い（出典は節へのリンクで示す）。指示しても書くモデルがある
 */
export function stripManualMarkers(answer: string): string {
  return answer
    // 前後に空白があった番号は空白 1 つに、文字に挟まれた番号は詰める
    .replace(/[（(【]?\s*(?:\[M\d+\]\s*[,、]?\s*)+[】)）]?/g, (m) => (/^\s|\s$/.test(m) ? " " : ""))
    .replace(/[ \t]+\n/g, "\n");
}
