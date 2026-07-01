// World-model grounding の「キーレス既定ソース」（Phase 5）。
//
// API キー不要・月間ハードキャップなし（polite pool 方式）・出典が検証可能、という
// 公開 API を世界照合の既定証拠ソースにする。BYOK の web 検索（Tavily 等）や MCP 検索
// ツールが無くても、箱から出してすぐ ground できる。
//
//   - Wikipedia (一般・百科事典) … MediaWiki search API
//   - OpenAlex  (学術全分野)     … DOI + 被引用数 + abstract を返す
//
// どちらも「この主張は文献で既知か」という世界照合の問いに直接答える corpus。
// 失敗・タイムアウトは各 provider 単位で握りつぶし、空配列に倒す（呼び出し側は
// 集まった証拠が空なら parametric 判定にフォールバックする）。

export type EvidenceItem = {
  /** 証拠の見出し（記事名 / 論文名） */
  title: string;
  /** 検証可能な URL（Wikipedia 記事 / DOI / OpenAlex landing） */
  url: string;
  /** 要約・抜粋（判定の手がかり） */
  snippet: string;
  /** どの provider 由来か（表示・デバッグ用） */
  source: "wikipedia" | "openalex";
};

const PROVIDER_TIMEOUT_MS = 6000;
const UA =
  "Graphium-world-grounding/1.0 (+https://github.com/kumagallium/Graphium)";
// OpenAlex polite pool: mailto を付けると優先度の高いプールに入る（任意・キーではない）。
// 個人メールはハードコードせず、env 上書き可・既定は project の noreply。
const OPENALEX_MAILTO =
  process.env.GROUNDING_CONTACT_EMAIL ||
  "graphium@users.noreply.github.com";

const MAX_ITEMS_PER_PROVIDER = 5;
const MAX_SNIPPET_CHARS = 320;
const MAX_EVIDENCE_CHARS = 4000;

/** HTML タグを落として 1 行に均す（Wikipedia の snippet は <span> を含む）。 */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, max = MAX_SNIPPET_CHARS): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Wikipedia (MediaWiki) search。claim を全文検索し、上位記事の URL と抜粋を返す。
 * language が ja なら ja.wikipedia、それ以外は en.wikipedia を引く。
 */
export async function searchWikipedia(
  query: string,
  language: string,
): Promise<EvidenceItem[]> {
  const host = language === "ja" ? "ja.wikipedia.org" : "en.wikipedia.org";
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(MAX_ITEMS_PER_PROVIDER),
    srprop: "snippet",
    format: "json",
    origin: "*",
  });
  const url = `https://${host}/w/api.php?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      query?: { search?: { title: string; snippet?: string }[] };
    };
    const hits = json.query?.search ?? [];
    return hits.map((h) => ({
      title: h.title,
      url: `https://${host}/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
      snippet: clip(stripHtml(h.snippet ?? "")),
      source: "wikipedia" as const,
    }));
  } catch {
    return [];
  }
}

/** OpenAlex の abstract_inverted_index を平文に復元する。 */
function reconstructAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string {
  if (!inverted || typeof inverted !== "object") return "";
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) slots[p] = word;
  }
  return slots.filter((w) => typeof w === "string").join(" ");
}

/**
 * OpenAlex works search。学術論文を検索し、DOI（無ければ OpenAlex landing）と
 * 被引用数・abstract を返す。被引用数は established / weak の判定材料になる。
 */
export async function searchOpenAlex(query: string): Promise<EvidenceItem[]> {
  const params = new URLSearchParams({
    search: query,
    per_page: String(MAX_ITEMS_PER_PROVIDER),
    mailto: OPENALEX_MAILTO,
    select: "title,doi,id,cited_by_count,publication_year,abstract_inverted_index",
  });
  const url = `https://api.openalex.org/works?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: {
        title?: string;
        doi?: string | null;
        id?: string;
        cited_by_count?: number;
        publication_year?: number;
        abstract_inverted_index?: Record<string, number[]> | null;
      }[];
    };
    const results = json.results ?? [];
    return results
      .filter((r) => r.title && (r.doi || r.id))
      .map((r) => {
        const cited = r.cited_by_count ?? 0;
        const year = r.publication_year ? `${r.publication_year}, ` : "";
        const abstract = reconstructAbstract(r.abstract_inverted_index);
        const snippet = clip(
          `${year}cited by ${cited}.${abstract ? ` ${abstract}` : ""}`,
        );
        // doi は "https://doi.org/..." 形式で返る。無ければ OpenAlex landing。
        const url = (r.doi && r.doi.startsWith("http") ? r.doi : null) ?? r.id ?? "";
        return {
          title: r.title as string,
          url,
          snippet,
          source: "openalex" as const,
        };
      })
      .filter((it) => it.url);
  } catch {
    return [];
  }
}

/** EvidenceItem 群を判定プロンプト用の証拠テキストに整形する。 */
export function formatEvidence(items: EvidenceItem[]): string {
  const labels: Record<EvidenceItem["source"], string> = {
    wikipedia: "Wikipedia",
    openalex: "OpenAlex",
  };
  let text = "";
  for (const it of items) {
    const block = `[${labels[it.source]}] ${it.title}\n${it.url}\n${it.snippet}\n\n`;
    if (text.length + block.length > MAX_EVIDENCE_CHARS) break;
    text += block;
  }
  return text.trim();
}

export type BuiltinGroundingOutcome = {
  evidenceText: string;
  urls: string[];
  items: EvidenceItem[];
};

/**
 * キーレス既定ソース（Wikipedia + OpenAlex）を並列で引き、証拠テキストと URL 集合を返す。
 * 両方失敗・空なら evidenceText "" を返す（呼び出し側でフォールバック）。
 */
export async function runBuiltinGroundingSearch(
  query: string,
  language: string,
): Promise<BuiltinGroundingOutcome> {
  const [wiki, oa] = await Promise.all([
    searchWikipedia(query, language),
    searchOpenAlex(query),
  ]);
  const items = [...wiki, ...oa];
  const evidenceText = formatEvidence(items);
  // 整形後テキストに残った（= cap 内の）URL だけを許可集合の元にする。
  const urls = items.map((it) => it.url).filter((u) => evidenceText.includes(u));
  return { evidenceText, urls, items };
}
