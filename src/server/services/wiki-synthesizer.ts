// Wiki Synthesizer
// 既存の Concept ページ群を分析し、複数ページを統合した
// 新しい洞察（Synthesis ページ）を生成する

export type SynthesisCandidate = {
  /** 統合対象の Concept ID リスト（2-4 個） */
  sourceConceptIds: string[];
  /** 統合対象の Concept タイトル */
  sourceConceptTitles: string[];
  /** 生成する Synthesis のタイトル */
  title: string;
  /** Synthesis のセクション */
  sections: { heading: string; content: string }[];
  /** なぜこの統合が価値あるか */
  rationale: string;
  /** 信頼度 */
  confidence: number;
};

export type ConceptSnapshot = {
  id: string;
  title: string;
  /** セクション見出しとプレビュー */
  sections: { heading: string; preview: string }[];
  /** 関連 Concept タイトル */
  relatedConcepts: string[];
};

/**
 * Synthesis 生成用のシステムプロンプトを構築する
 */
export function buildSynthesizerSystemPrompt(language: string): string {
  return `You are a knowledge synthesis engine for Graphium, a provenance-tracking research editor.

Your task is to analyze a collection of existing Concept pages and identify opportunities where combining knowledge from multiple Concepts could produce NEW insights that don't exist in any single page.

## What makes a good Synthesis

A Synthesis is NOT:
- A summary of existing pages combined together
- A comparison table of two concepts
- A copy-paste of content from multiple sources

A Synthesis IS:
- A new insight that EMERGES from connecting two or more concepts
- Something that no single Concept page already says
- A bridge between ideas that reveals a pattern, principle, or strategy
- Useful to someone who has read the individual Concept pages but hasn't connected them

Example:
- Concept A: "Oxide thin films respond to temperature changes"
- Concept B: "Reduction processes are pH-dependent"
- Concept C: "Surface area affects reaction kinetics"
- **Synthesis**: "Multi-parameter optimization strategy for oxide reduction" — connecting temperature, pH, and surface area into a unified framework that none of the individual concepts describe

## Output Format

Respond with valid JSON only (no markdown wrapper):

{
  "candidates": [
    {
      "sourceConceptIds": ["id1", "id2"],
      "sourceConceptTitles": ["Title 1", "Title 2"],
      "title": "Synthesis page title",
      "sections": [
        { "heading": "Section heading", "content": "Section content" }
      ],
      "rationale": "Why this synthesis adds value beyond the individual concepts",
      "confidence": 0.0-1.0
    }
  ]
}

## Guidelines

- Generate 0-2 candidates (quality over quantity)
- Only propose with confidence >= 0.75
- Each candidate must combine 2-4 existing Concepts
- Section content should be thorough — include reasoning, evidence, and implications without length constraints
- Use these section headings (in this order, skip any that don't apply):
${language === "ja" ? `  - **概要**: この統合が何をまとめ、なぜ重要か（2-3文）
  - **核心的洞察**: これらの概念を結びつけることで生まれる新しい理解
  - **横断分析**: ソース Concept がどう相互作用するか — 各 Concept をインライン引用: 「[Concept タイトル] によると...」
  - **示唆**: この統合的理解から何が導かれるか
  - **未解決の問い**: これらの概念の交差点でまだ分からないこと` : `  - **Overview**: What this synthesis brings together and why (2-3 sentences)
  - **Key Insight**: The new understanding that emerges from connecting these concepts
  - **Cross-Concept Analysis**: How the source concepts interact — cite each source concept inline: "According to [Concept Title], ..."
  - **Implications**: What follows from this combined understanding
  - **Open Questions**: What's still unknown at the intersection of these concepts`}
- The rationale must explain what NEW understanding emerges
- Return empty candidates array if no meaningful synthesis is possible
- Do NOT synthesize if there are fewer than 3 Concept pages

## Language

Output in: ${language === "ja" ? "Japanese" : "English"}`;
}

/**
 * Synthesis 用のユーザーメッセージを構築する
 */
export function buildSynthesizerUserMessage(
  concepts: ConceptSnapshot[],
  existingSynthesisTitles: string[],
): string {
  if (concepts.length < 3) {
    return "Not enough Concept pages for synthesis (minimum 3 required).";
  }

  const conceptDescriptions = concepts.map((c) => {
    const sections = c.sections
      .map((s) => `  - ${s.heading}: ${s.preview}`)
      .join("\n");
    const related = c.relatedConcepts.length > 0
      ? `  Related to: ${c.relatedConcepts.join(", ")}`
      : "";
    return `### ${c.title} (id: ${c.id})\n${sections}${related ? "\n" + related : ""}`;
  }).join("\n\n");

  const existingNote = existingSynthesisTitles.length > 0
    ? `\n\n## Existing Syntheses (avoid duplicating these)\n${existingSynthesisTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `Analyze the following ${concepts.length} Concept pages and propose synthesis opportunities:\n\n${conceptDescriptions}${existingNote}`;
}

/**
 * Synthesizer の LLM 出力をパースする
 */
export function parseSynthesizerOutput(text: string): SynthesisCandidate[] {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const candidates = parsed.candidates ?? parsed;

    if (!Array.isArray(candidates)) return [];

    return candidates
      .filter((c: any) =>
        c.title &&
        Array.isArray(c.sourceConceptIds) &&
        c.sourceConceptIds.length >= 2 &&
        Array.isArray(c.sections) &&
        c.sections.length > 0 &&
        (typeof c.confidence === "number" ? c.confidence : 0.7) >= 0.75,
      )
      .map((c: any) => ({
        sourceConceptIds: c.sourceConceptIds.map(String),
        sourceConceptTitles: Array.isArray(c.sourceConceptTitles) ? c.sourceConceptTitles.map(String) : [],
        title: String(c.title),
        sections: c.sections.map((s: any) => ({
          heading: String(s.heading ?? ""),
          content: String(s.content ?? ""),
        })),
        rationale: String(c.rationale ?? ""),
        confidence: typeof c.confidence === "number" ? c.confidence : 0.75,
      }));
  } catch (err) {
    console.error("Synthesizer 出力のパース失敗:", err);
    return [];
  }
}
