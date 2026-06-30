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
import { normalizeUrlForMatch } from "./grounding-search.js";

const VERDICT_VALUES: GroundingValidityVerdict[] = [
  "established",
  "supported",
  "weak",
  "contested",
];

/**
 * 出力 URL の絞り込みモード。
 * - `none`: parametric 判定（モデルの記憶由来）。**URL は一切通さない**（ref テキストのみ）。
 *   記憶由来の URL/DOI は高エントロピー文字列で、解決しても別論文を指すことがある
 *   （実例: opus が Acta Cryst の DOI 末尾だけ捏造 → 無関係の論文に解決）。
 *   検証可能な URL は web-grounding（evidence モード）からのみ出す、という原則に統一。
 * - `evidence`: web-grounding 判定。判定前に実行した検索が実際に返した URL のみ通す。
 *   「取得集合に属するか」で絞るので、任意ドメインでも実在＆出典一致が保証される。
 */
export type ParseUrlMode =
  | { mode: "none" }
  | { mode: "evidence"; allowedUrls: Set<string> };

/** source.url を urlMode に応じて検証する。通らなければ undefined（ref は別途残す）。 */
function resolveSourceUrl(
  url: string | undefined,
  urlMode: ParseUrlMode,
): string | undefined {
  if (!url) return undefined;
  if (urlMode.mode === "none") return undefined; // 記憶由来 URL は出さない
  // evidence モード: http(s) かつ、検索が返した URL 集合に正規化一致するものだけ通す。
  const norm = normalizeUrlForMatch(url);
  if (norm && urlMode.allowedUrls.has(norm)) return url;
  return undefined;
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
    { "ref": "<book / law / classical paper / Wikipedia title — TEXT ONLY, no url>" }
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
- "sources" MAY be empty. Each source is a citation **as TEXT ONLY** (author, year,
  title, journal) so the user can search for it.
- **Do NOT output any URL or DOI.** You have no retrieved evidence here, and a
  recalled URL/DOI is almost always wrong (the high-entropy tail is fabricated
  and can resolve to an unrelated paper). Any "url" field will be discarded.
  Provide the citation text only.
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
 * web-grounding 用 system prompt（検索証拠に基づく判定）。
 *
 * parametric 版との違い:
 * 1. モデルの記憶ではなく、下に注入される SEARCH EVIDENCE に基づいて位置づける
 * 2. sources[].url は証拠に出てきた URL のみ（記憶からの URL 生成を厳禁）
 * 3. 証拠が主張に触れていなければ verdict=null。「検索で先行が見つからなかった」止まりで、
 *    新規性の証明はしない（構造的限界を honest に表現する）
 *
 * 出力スキーマは parametric 版と同一なので parseWorldGroundingOutput をそのまま使える。
 */
export function buildWebGroundedSystemPrompt(language: string): string {
  const langInstruction =
    language === "ja"
      ? "rationale / normalizedClaim は日本語で書く。keywords は日本語と英語の同義語を混ぜる。"
      : "Write rationale / normalizedClaim in English. Mix Japanese and English synonyms in keywords.";
  return `You are a knowledge-base curator with access to fresh web SEARCH EVIDENCE
(real results retrieved just now). Given a user's claim and the evidence, judge how
the claim stands relative to what the evidence shows.

Ground every judgment in the EVIDENCE — do NOT rely on your own memory for specific
facts, sources, or URLs. The verdict reflects how the claim sits against the retrieved
evidence, NOT a judgment of the user's stance. The final call always stays with the user.

You MUST output strict JSON only (a single JSON object, no prose, no markdown text
outside the optional \`\`\`json fence). Schema:

{
  "verdict": "established" | "supported" | "weak" | "contested" | null,
  "rationale": "<one-sentence reason grounded in the evidence>",
  "normalizedClaim": "<rewrite the claim as a single domain-general sentence>",
  "keywords": ["<6-10 retrieval keywords, multilingual ja/en mix>"],
  "sources": [
    { "ref": "<title of the evidence item>", "url": "<a URL copied verbatim from the evidence>" }
  ]
}

Verdict semantics (relative to the EVIDENCE):
- "established": the evidence strongly and consistently supports the claim as well-known.
- "supported":   the evidence supports it but shows known limits / debate.
- "weak":        the evidence is thin, indirect, or mixed.
- "contested":   the evidence shows counter-evidence or a known overgeneralization pattern.
- null:          the evidence does not address this claim. Return null and set rationale to
                 "Searched the web but found no direct prior art — this is not proof of novelty."
                 Do NOT guess from memory.

URL rule (STRICT):
- In "sources[].url", include ONLY URLs that appear verbatim in the EVIDENCE below.
- NEVER invent, autocomplete, or recall a URL from memory. Any URL not present in the
  evidence will be discarded by the parser. If unsure, omit "url" and keep "ref" only.

Rules:
- "normalizedClaim" MUST be domain-general: strip experiment-specific parameters, sample IDs,
  lab names, personal anecdote details. This is what the KB caches as a reusable entry.
- "keywords" should be retrievable terms that another similar claim would contain.

${langInstruction}`;
}

/**
 * web-grounding 用 user message（claim + 検索証拠を注入）。
 */
export function buildWebGroundedUserMessage(input: {
  claimText: string;
  evidenceText: string;
}): string {
  return `Claim to judge:
${input.claimText.trim()}

SEARCH EVIDENCE (retrieved just now — cite ONLY URLs that appear here):
${input.evidenceText.trim()}

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
export function parseWorldGroundingOutput(
  raw: string,
  urlMode: ParseUrlMode = { mode: "none" },
): WorldGroundingResult | null {
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
          // urlMode に応じて URL を絞る:
          // - whitelist: 安全 domain のみ（parametric 判定の幻覚 URL 対策）
          // - evidence: 検索が返した URL のみ（web-grounding の provenance 保証）
          url: resolveSourceUrl(
            typeof s.url === "string" && s.url.trim() ? s.url.trim() : undefined,
            urlMode,
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

// 幻覚 URL 対策の whitelist / 実在検証（sanitizeSourceUrl / verifySourceUrl）は撤去した。
// parametric 経路は URL を一切出さず（ParseUrlMode "none"）、web-grounding 経路は
// 「検索が返した URL のみ」という provenance で絞る（evidence モード）。どちらも
// 記憶由来 URL を出さないので、ドメイン whitelist もネットワーク存在検証も不要になった。
