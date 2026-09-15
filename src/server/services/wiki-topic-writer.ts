// Wiki Topic Writer
// 話題（topic）ページの本文を、メンバー知見（Claim）群だけから生成する。
//
// 設計の意図:
//   話題ページは「メンバー知見の集合から作られる純関数」（LLM Wiki が誤りを積み重ねて
//   伝播させる弱点への回答）。前の本文は入力に渡さない — 触れるたびに member claims から
//   作り直す。本文は短く: 定義 / 要点（知見を [[知見タイトル]] で引用） / 食い違い・未解決。
//   References は呼び出し元（wiki-service.ts）が既存の仕組み（parseInlineCitations /
//   buildRelationBlocks 相当）で付けるため、ここでは生成しない。

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
- **要点 / Key points**: The load-bearing points from the member Claims, each citing its source with \`[[Claim title]]\` (use the exact title string given below — this becomes a clickable link downstream, so it MUST match exactly). Do not just restate every Claim — synthesize into a short list of points.
- **食い違い・未解決 / Disagreements & open questions**: Only include this section if the member Claims genuinely disagree or leave something unresolved. Omit the section entirely if there is nothing genuine to report — do not pad it.

Do NOT add a References / 関連 section — the caller appends that separately.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "body": "## 定義\\n...\\n\\n## 要点\\n...[[Claim title]]...\\n\\n## 食い違い・未解決\\n..."
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
