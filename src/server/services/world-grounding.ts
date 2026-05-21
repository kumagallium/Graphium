// World-model grounding service (Phase 2 / PR 2B + 2C).
//
// LLM 判定エンジン: 主張を渡し、KB の見地から verdict (4 値) と
// 正規化主張・keywords・rationale・sources を返させる。
// 出力はクライアント側 KB cache (appdata) に沈殿される。
//
// kickoff §1 / PR 2A 方針 §3 を実装:
// - LLM は「判定エンジン」、KB は前段キャッシュ
// - verdict は KB の位置づけ。「ユーザーの主張への評価」ではない
// - 判定不能なら null を返し、null は沈殿させない（鉄則）
//
// PR 2C: domain 分割と tags 生成を撤廃。Graphium は汎用ノートエディタなので、
// LLM が単一 domain / tag に分類できない claim を抱えると無駄な分類問題が増えるだけ。
// null verdict の意味も「out-of-domain」から「自身の知識ベースで信頼できる根拠なし」に純化。

import type { GroundingValidityVerdict } from "../../lib/document-types.js";

const VERDICT_VALUES: GroundingValidityVerdict[] = [
  "established",
  "supported",
  "weak",
  "contested",
];

/**
 * LLM が source URL に幻覚を入れがちなので、確証あるドメインだけ通す。
 * - Wikipedia 記事は記事ページ自体が存在しなくても妥当な検索結果になる
 * - DOI は resolver が必ず実体に解決する
 * - arXiv は abstract ページが安定して存在する
 * これら以外の URL（出版社サイト / 論文 PDF 直リンク / lab page など）は
 * パスが幻覚で生成されがちなので捨てる。"ref" テキストだけは残す。
 */
const SAFE_URL_HOSTS = new Set([
  "en.wikipedia.org",
  "ja.wikipedia.org",
  "doi.org",
  "arxiv.org",
]);

function sanitizeSourceUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    // http(s) のみ許容
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (SAFE_URL_HOSTS.has(u.hostname)) return url;
    return undefined;
  } catch {
    return undefined;
  }
}

export type WorldGroundingResult = {
  /** verdict が null の場合は「判定不能」= 沈殿させない（鉄則 1） */
  verdict: GroundingValidityVerdict | null;
  rationale: string;
  /** ドメイン一般化された主張（cache key に使う。実験パラメータや lab 名は剥がす） */
  normalizedClaim?: string;
  /** retriever 用キーワード（多言語可、6-10 件） */
  keywords?: string[];
  sources?: { ref: string; url?: string }[];
};

/**
 * 世界モデル照合用 system prompt を構築する。
 *
 * 強制 contract:
 * 1. 必ず JSON のみを返す（``` ブロック許容）
 * 2. verdict は 4 値のいずれか、または null（判定不能）
 * 3. normalizedClaim は domain-general（実験具体を剥がす）
 */
export function buildWorldGroundingSystemPrompt(language: string): string {
  const langInstruction =
    language === "ja"
      ? "rationale / normalizedClaim は日本語で書く。keywords は日本語と英語の同義語を混ぜる。"
      : "Write rationale / normalizedClaim in English. Mix Japanese and English synonyms in keywords.";
  return `You are a knowledge-base curator. Given a user's claim sentence,
judge how it stands against established knowledge in the literature you know.

The verdict is from the KB's view of the literature — NOT a judgment of the
user's stance. The final call always stays with the user.

You MUST output strict JSON only (a single JSON object, no prose, no markdown
text outside the optional \`\`\`json fence). Schema:

{
  "verdict": "established" | "supported" | "weak" | "contested" | null,
  "rationale": "<one-sentence reason — cite a textbook concept or law name>",
  "normalizedClaim": "<rewrite the claim as a single domain-general sentence>",
  "keywords": ["<6-10 retrieval keywords, multilingual ja/en mix>"],
  "sources": [
    { "ref": "<book / law / classical paper / Wikipedia title>", "url": "<https url or omit>" }
  ]
}

Verdict semantics:
- "established": The claim aligns with textbook-confirmed knowledge.
- "supported":   The claim is broadly supported but has known limits / debate.
- "weak":        The claim has thin grounding or relies on contested mechanisms.
- "contested":   Established literature has counter-evidence or known overgeneralization patterns.
- null:          Your knowledge base does not contain reliable evidence for or against this claim — return null rather than guessing. **Do not stretch the verdict to fit.**

Subject coverage: Treat the claim across ALL human knowledge — natural science,
engineering, social science, humanities, daily life (cooking, learning, craft),
mathematics, software. Do not constrain yourself to any single field.

Rules:
- "normalizedClaim" MUST be domain-general: strip experiment-specific parameters,
  sample IDs, lab names, personal anecdote details. This is what the KB caches
  as a reusable entry.
- "keywords" should be retrievable terms that another similar claim would contain.
- "sources" MAY be empty. Only include sources you are confident exist.
- **URL whitelist** — In "sources[].url", only include URLs from these safe
  domains (other domains will be discarded by the parser):
    - en.wikipedia.org / ja.wikipedia.org (Wikipedia)
    - doi.org (DOI resolver, e.g. https://doi.org/10.1126/science.1156391)
    - arxiv.org (arXiv abstract pages, e.g. https://arxiv.org/abs/2403.12345)
  **Never invent URLs from publisher sites, journal homepages, lab pages, or
  paper PDFs.** If you do not know an exact safe URL for a source, OMIT the
  "url" field — only the "ref" text. A missing URL is far better than a broken
  one.
- If verdict is null, "rationale" should explain why (insufficient knowledge
  for or against), and normalizedClaim / keywords / sources MAY be omitted.

${langInstruction}`;
}

/**
 * 世界モデル照合用 user message を構築する。
 */
export function buildWorldGroundingUserMessage(input: {
  claimText: string;
}): string {
  return `Claim to judge:
${input.claimText.trim()}

Output strict JSON now.`;
}

/**
 * LLM 出力をパースして WorldGroundingResult に正規化する。
 *
 * 失敗時の挙動:
 * - JSON パース失敗 → verdict: null 相当として扱う（呼び出し元で degrade）
 * - verdict が 4 値以外 → null に丸める
 * - normalizedClaim / keywords が無く verdict 有 → そのまま返す（呼び出し元 cache で reject）
 */
export function parseWorldGroundingOutput(raw: string): WorldGroundingResult | null {
  // ``` ブロック剥がし（既存 parser と同じ流儀）
  let jsonText = raw.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error("[world-grounding] JSON parse failed:", err, raw.slice(0, 200));
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // verdict を 4 値 / null に正規化
  const rawVerdict = parsed.verdict;
  const verdict: GroundingValidityVerdict | null =
    typeof rawVerdict === "string" && (VERDICT_VALUES as string[]).includes(rawVerdict)
      ? (rawVerdict as GroundingValidityVerdict)
      : null;

  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : "";
  const normalizedClaim =
    typeof parsed.normalizedClaim === "string" && parsed.normalizedClaim.trim()
      ? parsed.normalizedClaim.trim()
      : undefined;
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .filter((k: unknown): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k: string) => k.trim())
    : undefined;
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter(
          (s: any) => s && typeof s === "object" && typeof s.ref === "string" && s.ref.trim(),
        )
        .map((s: any) => ({
          ref: String(s.ref).trim(),
          // URL whitelist: 安全な domain のみ残す。それ以外は LLM 幻覚として捨てる（ref は残す）。
          url: sanitizeSourceUrl(
            typeof s.url === "string" && s.url.trim() ? s.url.trim() : undefined,
          ),
        }))
    : undefined;

  return {
    verdict,
    rationale,
    normalizedClaim,
    keywords: keywords && keywords.length > 0 ? keywords : undefined,
    sources: sources && sources.length > 0 ? sources : undefined,
  };
}
