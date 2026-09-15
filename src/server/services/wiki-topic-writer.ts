// Wiki Topic Writer
// 話題（topic）ページの本文を、メンバー知見（Claim）群だけから生成する。
//
// 設計の意図:
//   話題ページは「メンバー知見の集合から作られる純関数」（LLM Wiki が誤りを積み重ねて
//   伝播させる弱点への回答）。前の本文は入力に渡さない — 触れるたびに member claims から
//   作り直す。本文は短く: 定義 / 要点（知見を [[claim:<id>]] で引用） / 食い違い・未解決。
//   引用はタイトルの転記ミス（LLM が組成名などを書き間違える）を避けるため、タイトル文字列
//   ではなくユーザーメッセージに与えた id をそのまま使わせる。呼び出し元
//   （wiki-service.ts の buildTopicDocument / rebuildTopicDocument）が [[claim:<id>]] を
//   その時点のメンバー知見タイトルへ解決してから parseInlineCitations に渡し、
//   本文末尾に References（メンバー知見一覧）を付ける。
//
// Topic Namer（話題名の保険）:
//   ingester は知見ごとに 1〜3 件の topics を出す想定だが、LLM が項目を無視して空にする
//   ケースがある。そのときはこの Topic Namer で後から話題名だけを推測して埋める
//   （本文は書かない・話題名の命名のみ）。parseTopics（wiki-ingester）と同じサニタイズ規則
//   （非文字列・空・重複を落とし最大 3 件）を再利用する。

import { parseTopics } from "./wiki-ingester.js";

/** 話題ページ生成に渡すメンバー知見（Claim）1 件分 */
export type TopicMemberClaim = {
  id: string;
  title: string;
  /** 本文プレビュー（全文である必要はない。extractBodyPreview 程度の長さを想定） */
  body: string;
};

/**
 * Topic Writer 用のシステムプロンプトを構築する
 */
export function buildTopicWriterSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a topic-page writer for Graphium, a provenance-tracking note editor.

A **Topic** page groups multiple Claims (knowledge pages) that share the same concept into one short landing page. Unlike a Claim, a Topic makes no new argument of its own — it is a pure function of its member Claims, rewritten from scratch every time a member changes. Never invent content that isn't grounded in the member Claims listed below.

## Structure (keep it short)

Write the body as Markdown with these sections (use \`##\` headings so they parse as proper headings downstream):

- **定義 / Definition**: 1-3 sentences stating what this topic is, grounded in the member Claims.
- **要点 / Key points**: The load-bearing points from the member Claims, each citing its source with \`[[claim:<id>]]\` — use the exact \`id\` given in the "(id: ...)" annotation below each Claim, NOT the title (this avoids transcription errors in titles). Place the citation at the END of the sentence, never mid-sentence. Do not just restate every Claim — synthesize into a short list of points.
- **食い違い・未解決 / Disagreements & open questions**: Only include this section if the member Claims genuinely disagree or leave something unresolved. Omit the section entirely if there is nothing genuine to report — do not pad it.

Do NOT add a References / 関連 section — the caller appends that separately.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "body": "## 定義\\n...\\n\\n## 要点\\n...[[claim:abc123]]\\n\\n## 食い違い・未解決\\n..."
}

## Voice

Short sentences. No "This topic discusses..." framing — start with the substance.${ja ? `
**日本語で書くときは必ず常体（である調 / だ調）で統一する。敬体（〜です／〜ます）は使わない。**` : ""}

## Language

Output in: ${ja ? "Japanese" : "English"}`;
}

/**
 * Topic Writer 用のユーザーメッセージを構築する
 */
export function buildTopicWriterUserMessage(
  title: string,
  claims: TopicMemberClaim[],
): string {
  const claimsText = claims
    .map((c) => `### ${c.title} (id: ${c.id})\n\n${c.body}`)
    .join("\n\n---\n\n");

  return `## Topic title: "${title}"

## Member claims (${claims.length})

${claimsText}`;
}

/**
 * LLM の出力をパースして本文 markdown を取り出す。
 * 壊れた JSON / 途中切断時は undefined を返す（呼び出し側で「変更しない」を選べるように、
 * 無理な復旧は試みない — wiki-ingester.parseIngesterOutput と同じ堅牢さの方針）。
 */
export function parseTopicWriterOutput(text: string): { body: string } | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!body) return undefined;
    return { body };
  } catch (err) {
    console.error("Topic writer 出力のパース失敗:", err);
    return undefined;
  }
}

// ── Topic Namer（話題名の保険）──
// topics が空の知見に対し、話題名だけを後から推測して埋める。本文生成（compose-topic）とは
// 別のエンドポイント / プロンプトにする — 命名だけなので compose-topic より軽い出力形式。

/** Topic Namer に渡す知見（Claim）1 件分（本文はプレビュー程度でよい） */
export type TopicNamerClaim = {
  id: string;
  title: string;
  body: string;
};

/**
 * Topic Namer 用のシステムプロンプトを構築する
 */
export function buildTopicNamerSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a topic namer for Graphium, a provenance-tracking note editor.

Each Claim below is missing \`topics\` — short noun phrases naming the concept(s) it belongs to. A topic groups multiple Claims about the same concept into one page (e.g. "pH-dependent reduction kinetics", "SPS sintering conditions"). Your job is only to name the topic(s) for each Claim — do not write any page body.

## Rules

- Tag each Claim with 1-3 \`topics\`, short noun phrases, in the note's own language (${ja ? "Japanese" : "English"}).
- **Reuse an existing topic name exactly** when the Claim belongs to the same concept as one already listed below — do not create a near-duplicate with different wording, and never create a new name that differs from an existing one only by whitespace, symbols, or capitalization.
- Keep phrases short (a few words), not full sentences.
- **Pick the granularity a material/method/phenomenon-level concept sits at — not a per-sample or per-composition slice of it.** A topic should be a unit multiple Claims can plausibly share. Do NOT make a separate topic per composition, sample, or date.
- Every Claim listed must get at least 1 topic — pick the best available concept even if the fit isn't perfect. Use 2-3 only when the Claim genuinely spans distinct concepts.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "topics": {
    "<claim id>": ["topic name", ...],
    ...
  }
}`;
}

/**
 * Topic Namer 用のユーザーメッセージを構築する
 */
export function buildTopicNamerUserMessage(
  existingTopics: string[],
  claims: TopicNamerClaim[],
): string {
  const topicListText = existingTopics.length > 0
    ? existingTopics.map((t) => `- ${t}`).join("\n")
    : "(none yet)";
  const claimsText = claims
    .map((c) => `### ${c.title} (id: ${c.id})\n\n${c.body}`)
    .join("\n\n---\n\n");

  return `## Existing topics

${topicListText}

## Claims needing topics (${claims.length})

${claimsText}`;
}

/**
 * LLM の出力をパースして claimId → topics のマップを取り出す。
 * 各エントリのサニタイズは parseTopics（wiki-ingester）を再利用する（非文字列・空・重複を
 * 落とし最大 3 件）。壊れた JSON / 形が違う場合は undefined を返す（無理な復旧はしない）。
 */
export function parseTopicNamerOutput(text: string): Record<string, string[]> | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.topics ||
      typeof parsed.topics !== "object" ||
      Array.isArray(parsed.topics)
    ) {
      return undefined;
    }

    const out: Record<string, string[]> = {};
    for (const [claimId, raw] of Object.entries(parsed.topics as Record<string, unknown>)) {
      const topics = parseTopics(raw);
      if (topics) out[claimId] = topics;
    }
    return out;
  } catch (err) {
    console.error("Topic namer 出力のパース失敗:", err);
    return undefined;
  }
}
