// Wiki Reconciler
// 資料どうしで内容が食い違うページに、AI が「どちらが正しいか」を決めずに
// 両方の側を出典つきで本文に書く（併記）ためのプロンプトとパーサ

import type { ReconcileInput, ReconcileSide } from "../../features/wiki/reconcile-types";
import { generationLanguageName } from "../../lib/language.js";

export type ReconcilerFormat = "sections" | "body";
export type ReconcilerOutput = {
  sections?: { heading: string; content: string }[];
  body?: string;
};

/**
 * Reconciler 用のシステムプロンプトを構築する
 */
export function buildReconcilerSystemPrompt(
  language: string,
  format: ReconcilerFormat,
  kind?: string,
): string {
  const ja = language === "ja";
  const citation = format === "body"
    ? "Cite with `[[source:<id>]]` placed at the END of the sentence, using the exact id given in the input."
    : "Cite with `[[source title]]` (double brackets), using the exact sourceTitle given in the input.";
  const bodyRules = format === "body"
    ? `
9. **Disagreements section** (only when at least one disagreement is given; never add an empty section): Gather the disagreements under a \`## 食い違い・未解決\` heading (Japanese) / \`## Disagreements & open questions\` heading (English). Add the heading if it does not exist yet. Rewrite the sentence on the key-point side into the form "According to A, X; according to B, Y" so both sides sit together.${language === "ko" ? " In Korean, use the heading `## 견해 차이·미해결`." : ""}`
    : "";
  const output = format === "sections"
    ? `{
  "sections": [
    { "heading": "Section Title", "content": "Section content..." }
  ]
}`
    : `{
  "body": "${ja ? "## 定義\\n...\\n\\n## 食い違い・未解決\\n..." : language === "ko" ? "## 정의\\n...\\n\\n## 견해 차이·미해결\\n..." : "## Definition\\n...\\n\\n## Disagreements & open questions\\n..."}"
}`;

  return `You are a knowledge page editor for Graphium, a provenance-tracking note editor.

Your task is to **reconcile disagreements** on a ${kind ?? "knowledge"} page, and to **fix statements no source backs**. Some sources support a statement and other sources contradict it: you do NOT decide which side is right — you write BOTH sides into the page, each attributed to its own source. Some statements are backed by no source at all: those you rewrite to what the source actually says, or remove.${ja ? `

**重要: 日本語で書くときは必ず常体（である調 / だ調）で統一する。敬体（〜です／〜ます）は使わない。**` : ""}

## Rules

1. **Write both sides**: For each disagreement given, state what the supporting sources say AND what the contradicting sources say, each attributed to its own source. Never decide which is correct. Never drop one side.
2. **Minimal rewrite**: Do not change any other sentence, citation, or the structure of the page beyond what is needed to place both sides and to fix the statements listed under "Statements no source backs". Do not delete existing knowledge that is not listed there.
3. **Citations**: ${citation} Preserve every existing citation, except the citation of a statement that rule 7 removes.
4. **Attribute, don't judge**: Use phrasing like "according to X ... whereas Y reports ...". Do not use words that rank one side above the other.
5. **Preserve hedging**: Keep the epistemic strength of each source's claim. Do not add facts that no source states.
6. **Conflicts with other pages**: For each item in "Conflicts with other pages", add ONE sentence to the body stating that the page 「<otherTitle>」 holds a view that conflicts with this one (e.g. "『<otherTitle>』では…とされ、この見方と対立する"). Do not make it a link — wrap the title in 「」 only. The summary field describes the other page's point.
   - If an item is marked "(newer page — supersedes this page)", the page 「<otherTitle>」 was written later and supersedes this page's statement on this point: rewrite the superseded statement so it states the newer view as reported by 「<otherTitle>」, and keep what this page previously said as the earlier view, attributed (e.g. "以前は…とされていたが、『<otherTitle>』では…とされる"). Never delete the earlier view. Wrap the title in 「」, no link. Do not judge which is correct.
7. **Statements no source backs**: For each item in "Statements no source backs", find the statement in the current content (it is quoted verbatim, or, when no statement is given, the whole page was checked) and fix ONLY that statement:
   - If it is marked "contradicted", the cited source says something else — the quote shows what. Rewrite the statement so it states what the source says, keep its citation, and do not keep the unbacked wording as a second view. Do not go beyond what the quote and rationale state.
   - If it is marked "not in any source", no cited source says it — remove the statement together with its citation. If a heading is left with nothing under it, remove the heading too. Do not replace it with new content.
   - Never touch a statement that is not listed. Never invent facts to fill the gap.
8. **If nothing needs to change**: return the current content unchanged.${bodyRules}

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

${output}

## Language

Output in: ${generationLanguageName(language)}`;
}

function formatSide(s: ReconcileSide, withRationale: boolean): string {
  const parts = [`- ${s.sourceTitle} (id: ${s.sourceId})`];
  if (s.quote) parts.push(`  quote: ${s.quote}`);
  if (withRationale && s.rationale) parts.push(`  rationale: ${s.rationale}`);
  return parts.join("\n");
}

/**
 * Reconciler 用のユーザーメッセージを構築する
 */
export function buildReconcilerUserMessage(input: ReconcileInput): string {
  const current = input.format === "sections"
    ? (input.currentSections ?? []).map((s) => `## ${s.heading}\n${s.content}`).join("\n\n")
    : (input.currentBody ?? "");

  const disagreements = input.disagreements.map((d, i) => {
    const lines = [`### Disagreement ${i + 1}`];
    if (d.statement) lines.push(`Statement: ${d.statement}`);
    lines.push("Supporting sources:");
    lines.push(d.supporting.length > 0 ? d.supporting.map((s) => formatSide(s, false)).join("\n") : "(none)");
    lines.push("Contradicting sources:");
    lines.push(d.contradicting.length > 0 ? d.contradicting.map((s) => formatSide(s, true)).join("\n") : "(none)");
    return lines.join("\n");
  }).join("\n\n");

  const conflicts = input.conflicts ?? [];
  const conflictText = conflicts.length > 0
    ? `\n\n---\n\n# Conflicts with other pages\n\n${conflicts.map((c) => `- 「${c.otherTitle}」${c.relation === "newer" ? " (newer page — supersedes this page)" : ""}: ${c.summary}`).join("\n")}`
    : "";

  const unbacked = input.unbacked ?? [];
  const unbackedText = unbacked.length > 0
    ? `\n\n---\n\n# Statements no source backs\n\n${unbacked.map((u, i) => {
      const lines = [`### Unbacked ${i + 1} (${u.verdict === "contradicted" ? "contradicted" : "not in any source"})`];
      lines.push(u.statement ? `Statement: ${u.statement}` : "Statement: (not recorded — the whole page was checked)");
      lines.push("Sources checked:");
      lines.push(u.sources.length > 0 ? u.sources.map((s) => formatSide(s, true)).join("\n") : "(none)");
      return lines.join("\n");
    }).join("\n\n")}`
    : "";

  const task = [
    disagreements || conflicts.length > 0 ? "Write both sides into the page, attributed to their sources, without deciding which is correct." : "",
    unbacked.length > 0 ? "Fix the statements no source backs: rewrite a contradicted one to what its source says, remove one found in no source." : "",
  ].filter(Boolean).join(" ");

  return `# Title

${input.title}

# Current content

${current}

---

# Disagreements

${disagreements || "(none)"}${conflictText}${unbackedText}

---

${task}`;
}

/**
 * Reconciler の LLM 出力をパースする。壊れていれば undefined
 */
export function parseReconcilerOutput(text: string, format: ReconcilerFormat): ReconcilerOutput | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonText);
    if (format === "body") {
      if (typeof parsed?.body !== "string" || !parsed.body.trim()) return undefined;
      return { body: parsed.body };
    }
    if (!Array.isArray(parsed?.sections)) return undefined;
    const sections = parsed.sections
      .filter((s: any) => s && typeof s.content === "string" && s.content.trim())
      .map((s: any) => ({ heading: String(s.heading ?? ""), content: String(s.content) }));
    if (sections.length === 0) return undefined;
    return { sections };
  } catch (err) {
    console.error("Reconciler 出力のパース失敗:", err);
    return undefined;
  }
}
