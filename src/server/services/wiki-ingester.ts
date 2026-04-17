// Wiki Ingester
// ノートコンテンツを LLM に渡して Wiki ドキュメントの構造化データを生成する

import type { WikiKind } from "../../lib/document-types.js";

export type WikiSection = {
  heading: string;
  content: string;
};

export type IngesterOutput = {
  kind: WikiKind;
  title: string;
  sections: WikiSection[];
  suggestedAction: "create" | "merge";
  mergeTargetId?: string;
  confidence: number;
  /** 関連する既存 Concept のタイトルリスト */
  relatedConcepts: string[];
};

export type ExistingWikiInfo = {
  id: string;
  title: string;
  kind: WikiKind;
};

/**
 * Ingester 用のシステムプロンプトを構築する
 *
 * 知識発展型: ノートの単純な要約ではなく、既存 Concept との関連づけ・
 * 新しい洞察の生成・根拠の提示を行う
 */
export function buildIngesterSystemPrompt(
  language: string,
  existingWikis: ExistingWikiInfo[],
): string {
  const wikiListText = existingWikis.length > 0
    ? existingWikis.map((w) => `- [${w.kind}] ${w.title} (id: ${w.id})`).join("\n")
    : "(none yet)";

  const hasExistingConcepts = existingWikis.some((w) => w.kind === "concept");

  return `You are a knowledge synthesis engine for Graphium, a provenance-tracking research editor.

Your role is NOT to simply summarize notes. You are a **knowledge developer**: you extract insights, connect ideas across contexts, identify patterns, and build a growing knowledge base.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "wikis": [
    {
      "kind": "summary" | "concept",
      "title": "string",
      "sections": [
        { "heading": "string", "content": "string" }
      ],
      "suggestedAction": "create" | "merge",
      "mergeTargetId": "string (only if merge)",
      "confidence": 0.0-1.0,
      "relatedConcepts": ["existing concept title 1", "..."]
    }
  ]
}

## Two Wiki Types

### Summary (1 per note, always generated)
A structured analysis of the note — NOT a copy-paste summary. Include:
- **Overview**: What was done and why (2-3 sentences)
- **Key findings**: Specific results, measurements, observations
- **Insights**: What can be learned from this that wasn't explicitly stated
- **Open questions**: What remains unclear or should be investigated next
- **Connections**: How this relates to other work (reference existing Concepts if any)

### Concept (0-3 per note, knowledge development)
Cross-cutting knowledge pages that **go beyond what the note explicitly says**. A good Concept:
- Synthesizes knowledge that would be useful in OTHER contexts
- Draws connections the researcher might not have made explicit
- Includes reasoning, not just facts (e.g., "X works because Y, which implies Z")
- References the source note as evidence ("Based on [note title]...")
- Suggests related topics or next steps for investigation

**Bad Concept** (avoid): A concept that just repeats what the note says in different words.
**Good Concept**: Takes a specific finding and develops it into broader, reusable knowledge with reasoning.

## Merge vs Create (Critical)

${hasExistingConcepts ? `You have existing Concepts below. Before creating a new Concept:
1. Check if the note's knowledge EXTENDS an existing Concept → suggest "merge" with that ID
2. Check if the note CONTRADICTS an existing Concept → suggest "create" a new one that addresses the contradiction
3. Check if the note provides NEW EVIDENCE for an existing Concept → suggest "merge"
4. Only create a new Concept if the knowledge is genuinely distinct

When merging, your sections should contain the NEW information to ADD to the existing Concept, not duplicate what's already there.` : "No existing Concepts yet. Create new ones freely."}

## Existing Wikis

${wikiListText}

## Language

Output in: ${language === "ja" ? "Japanese" : "English"}

## Quality Guidelines

- Summary: Always generate exactly 1 per note
- Concepts: Generate 0-3. Quality over quantity — only create if there's genuine insight to develop
- Section content: Be substantive (100-500 chars per section). Include reasoning, not just facts
- relatedConcepts: List titles of existing Concepts that are related (empty array if none)
- confidence: 0.9+ for clear, well-evidenced knowledge. 0.6-0.8 for tentative insights
- If the note is too short or trivial (e.g., just a title), generate only a minimal Summary with confidence 0.5`;
}

/**
 * LLM の出力をパースして IngesterOutput 配列に変換する
 */
export function parseIngesterOutput(text: string): IngesterOutput[] {
  try {
    // JSON ブロックの抽出（```json ... ``` でラップされている場合にも対応）
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const wikis = parsed.wikis ?? parsed;

    if (!Array.isArray(wikis)) return [];

    return wikis
      .filter((w: any) => w.title && w.sections && Array.isArray(w.sections))
      .map((w: any) => ({
        kind: (w.kind === "summary" || w.kind === "concept") ? w.kind : "concept" as WikiKind,
        title: String(w.title),
        sections: w.sections.map((s: any) => ({
          heading: String(s.heading ?? ""),
          content: String(s.content ?? ""),
        })),
        suggestedAction: w.suggestedAction === "merge" ? "merge" as const : "create" as const,
        mergeTargetId: w.mergeTargetId ? String(w.mergeTargetId) : undefined,
        confidence: typeof w.confidence === "number" ? w.confidence : 0.7,
        relatedConcepts: Array.isArray(w.relatedConcepts) ? w.relatedConcepts.map(String) : [],
      }));
  } catch (err) {
    console.error("Ingester 出力のパース失敗:", err);
    return [];
  }
}

/**
 * BlockNote ブロック配列からプレーンテキストを抽出する
 */
export function extractPlainText(blocks: any[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const text = extractBlockContent(block);
    if (text) lines.push(text);

    if (block.children?.length) {
      const childText = extractPlainText(block.children);
      if (childText) lines.push(childText);
    }
  }

  return lines.join("\n");
}

function extractBlockContent(block: any): string {
  // インラインコンテンツ
  if (block.content) {
    if (typeof block.content === "string") return block.content;
    if (Array.isArray(block.content)) {
      const text = block.content.map((c: any) => c.text ?? c.content ?? "").join("");
      if (text) return text;
    }
    // テーブル
    if (block.content.type === "tableContent" && Array.isArray(block.content.rows)) {
      return block.content.rows
        .map((row: any) =>
          (row.cells ?? [])
            .map((cell: any) => {
              if (Array.isArray(cell)) {
                return cell.map((c: any) => {
                  if (Array.isArray(c.content)) {
                    return c.content.map((ic: any) => ic.text ?? "").join("");
                  }
                  return c.text ?? "";
                }).join("");
              }
              return "";
            })
            .join(" | ")
        )
        .join("\n");
    }
  }

  // props.text
  if (block.props?.text) return block.props.text;

  return "";
}
