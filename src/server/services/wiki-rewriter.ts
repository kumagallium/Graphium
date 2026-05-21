// Wiki Rewriter
// 既存 Wiki ページに新情報を統合する際、末尾追記ではなくページ全体を再構成する
// editedSections（ユーザーが手動編集したセクション）は保護する

export type RewriteSection = {
  heading: string;
  content: string;
  /** ユーザーが手動編集済みか */
  isEdited?: boolean;
};

export type RewriteInput = {
  /** 既存ページの全セクション */
  existingSections: RewriteSection[];
  /** 新しく統合する情報 */
  newSections: RewriteSection[];
  /** ユーザーが手動編集したセクション見出しリスト */
  editedSectionHeadings: string[];
};

export type RewriteOutput = {
  sections: { heading: string; content: string }[];
};

/** Rewrite 時に適用するスキル */
export type RewriterSkill = { title: string; prompt: string };

/**
 * Rewriter 用のシステムプロンプトを構築する
 */
export function buildRewriterSystemPrompt(
  language: string,
  skills?: RewriterSkill[],
): string {
  const skillSection = skills && skills.length > 0
    ? `\n\n## Applied Style Skills (apply these to ALL output below)\n\nThe following style skills define the voice, register, and rhythm of every section you rewrite. Treat them as overriding any default tone you would otherwise use. Re-read them before writing.\n\n${skills.map((s) => `### ${s.title}\n\n${s.prompt}`).join("\n\n")}`
    : "";

  return `You are a knowledge page editor for Graphium, a provenance-tracking note editor.

Your task is to **rewrite a Wiki page** by integrating new information into the existing content.
This is NOT a simple append — you should reorganize, merge, and improve the overall structure. Graphium is domain-general — never inject a research-paper register unless the source content clearly is one.${language === "ja" ? `

**重要: 日本語で書くときは必ず常体（である調 / だ調）で統一する。敬体（〜です／〜ます／〜でしょうか）は使わない。** 文末は「〜だ」「〜である」「〜した」「〜になる」「〜と考えられる」「〜のではないか」のいずれかに揃える。これは絶対ルールで、既存セクションの内容が敬体でも、書き直し時には常体に統一する（ただし [EDITED] でマークされたセクションはそのまま保持）。` : ""}${skillSection}

## Rules

1. **Protected sections**: Sections marked with [EDITED] were manually edited by the user. You MUST preserve their content EXACTLY as-is. Do not modify, rephrase, or move them.
2. **Merge related content**: If the new information relates to an existing section, integrate it into that section rather than creating a duplicate.
3. **Reorganize for clarity**: Reorder sections if it improves logical flow. Remove redundant content.
4. **Preserve knowledge**: Never delete existing knowledge. You may rephrase for clarity, but the meaning must be preserved.
5. **Maintain depth**: Keep the same level of detail or improve it. Don't summarize away useful specifics.
6. **Preserve citations**: Keep existing inline citations using double brackets (e.g., "[[ノートタイトル]] によると..." or "Based on [[note title]], ..."). When integrating new information, add inline citations with the specific source title in double brackets \`[[title]]\` — never use generic phrases like "the source" or "the new information".
7. **Prefer fewer, broader sections**: Keep the heading count minimal. Aim for **0-3 sections total**. If the entire content fits in 2-3 short paragraphs, output a single section with an empty heading (\`""\`) — flowing prose with no structure. Only add a heading when it genuinely separates a different topic. **Do not split prose into many small headed sections** ("概要" + "決定" + "理由" + "工夫" + "理念" pattern) — merge into 1-2 wider sections instead.
8. **Compact length**: A Claim should be readable in under 30 seconds. If the rewrite is becoming long, drop the lower-priority sentences rather than splitting them off.

## Output Format

Respond with valid JSON only (no markdown wrapper):

{
  "sections": [
    { "heading": "Section Title", "content": "Section content..." }
  ]
}

## Language

Output in: ${language === "ja" ? "Japanese" : "English"}`;
}

/**
 * Rewriter 用のユーザーメッセージを構築する
 */
export function buildRewriterUserMessage(input: RewriteInput): string {
  const existingText = input.existingSections.map((s) => {
    const editedTag = input.editedSectionHeadings.includes(s.heading) ? " [EDITED]" : "";
    return `## ${s.heading}${editedTag}\n${s.content}`;
  }).join("\n\n");

  const newText = input.newSections.map((s) =>
    `## ${s.heading}\n${s.content}`,
  ).join("\n\n");

  return `# Existing Page Content

${existingText}

---

# New Information to Integrate

${newText}

---

Rewrite the page by integrating the new information. Remember: sections marked [EDITED] must be preserved exactly.`;
}

/**
 * Rewriter の LLM 出力をパースする
 */
export function parseRewriterOutput(text: string): RewriteOutput {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const sections = parsed.sections ?? [];

    if (!Array.isArray(sections)) {
      return { sections: [] };
    }

    return {
      sections: sections
        .filter((s: any) => s.heading && s.content)
        .map((s: any) => ({
          heading: String(s.heading),
          content: String(s.content),
        })),
    };
  } catch (err) {
    console.error("Rewriter 出力のパース失敗:", err);
    return { sections: [] };
  }
}
