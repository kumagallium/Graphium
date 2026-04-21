// Wiki Ingester
// ノートコンテンツを LLM に渡して Wiki ドキュメントの構造化データを生成する

import type { WikiKind } from "../../lib/document-types.js";

export type WikiSection = {
  heading: string;
  content: string;
};

export type RelatedConceptRef = {
  title: string;
  /** この Concept との関連を説明する一�� */
  citation: string;
};

export type ExternalRef = {
  url: string;
  title: string;
  /** この参照が何を裏付けるかの一文 */
  citation: string;
};

export type IngesterOutput = {
  kind: WikiKind;
  title: string;
  sections: WikiSection[];
  suggestedAction: "create" | "merge";
  mergeTargetId?: string;
  confidence: number;
  /** 関連する���存 Concept（引用付き） */
  relatedConcepts: RelatedConceptRef[];
  /** 根拠となる外部参照 URL（引用付き） */
  externalReferences: ExternalRef[];
};

export type ExistingWikiInfo = {
  id: string;
  title: string;
  kind: WikiKind;
};

/** Ingest 時に適用する Skill の情報 */
export type IngestSkill = {
  title: string;
  prompt: string;
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
  skills?: IngestSkill[],
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
      "relatedConcepts": [
        { "title": "existing concept title", "citation": "one-sentence summary of what this concept contributes" }
      ],
      "externalReferences": [
        { "url": "https://...", "title": "Reference description", "citation": "what this reference supports or evidences" }
      ]
    }
  ]
}

## Two Wiki Types

### Summary (1 per note, always generated)
A structured analysis of the note — NOT a copy-paste summary.
Use these section headings (in this order, skip any that don't apply):
${language === "ja" ? `- **概要**: 何をなぜ行ったか（2-3文）
- **主な発見**: 具体的な結果・測定値・観察
- **洞察**: ノートに明示されていない学びや気づき
- **未解決の問い**: 不明点・次に調べるべきこと
- **関連性**: 他の研究やConceptとの関係` : `- **Overview**: What was done and why (2-3 sentences)
- **Key Findings**: Specific results, measurements, observations with concrete data
- **Insights**: What can be learned that wasn't explicitly stated in the note
- **Open Questions**: What remains unclear or should be investigated next
- **Connections**: How this relates to other work (reference existing Concepts if any)`}

### Concept (0-3 per note, knowledge development)
Cross-cutting knowledge pages that **go beyond what the note explicitly says**.
Use these section headings (in this order, skip any that don't apply):
${language === "ja" ? `- **定義**: この概念が何であるか、1段落で明確に
- **メカニズム**: どう機能するか — 推論・因果関係・原理（最重要セクション）
- **根拠**: ソースノートからの具体的な知見。インライン引用を使う: 「[[ノートタイトル]] によると...」
- **示唆**: この知識が他の研究に何を意味するか
- **未解決の問い**: まだ分からないこと、次に調べるべきこと` : `- **Definition**: What this concept is, in one clear paragraph
- **Mechanism**: How it works — reasoning, cause-effect, principles (the most important section)
- **Evidence**: Concrete findings from the source note that support this concept. Use inline citations: "According to [[note title]], ..." or "Based on [[note title]], ..."
- **Implications**: What this means for other work, what follows from this knowledge
- **Open Questions**: What's still unknown, what to investigate next`}

**Inline citation rule**: When referencing knowledge from a specific source, cite it inline using **double brackets** \`[[title]]\`:
${language === "ja" ? `- 「[[ノートタイトル]] によると、pH > 10 で還元速度が増加する。」
- 「[[ノートタイトル]] に基づくと、酸化膜は温度依存的な導電性を示す。」` : `- "The reduction rate increases at pH > 10 (from [[note title]])."
- "Based on [[note title]], oxide films show temperature-dependent conductivity."`}
Double brackets \`[[ ]]\` are automatically converted to clickable links. This helps readers trace each claim back to its origin.
**IMPORTANT**: Use the EXACT source note title provided in the user message. Do NOT write generic phrases like "Based on the new source" or "According to the note" — always use the specific title in double brackets.

**Bad Concept** (avoid): A concept that just repeats what the note says in different words.
**Good Concept**: Takes a specific finding and develops it into broader, reusable knowledge with reasoning and citations.

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
- Section content: Be thorough. Include reasoning, evidence, and concrete examples — not just facts. Write as much as needed to fully develop the insight
- relatedConcepts: Array of {title, citation} for existing Concepts that are related. The citation should explain WHY this concept is related (e.g., "provides pH-dependency context"). Empty array if none
- confidence: 0.9+ for clear, well-evidenced knowledge. 0.6-0.8 for tentative insights
- externalReferences: Array of {url, title, citation}. The citation explains what this reference supports (e.g., "general framework for reaction kinetics"). Prioritize well-known, stable URLs. 0-5 per wiki
- If the note is too short or trivial (e.g., just a title), generate only a minimal Summary with confidence 0.5${skills && skills.length > 0 ? `

## Applied Skills

The following skills should guide your analysis and output generation:

${skills.map((s) => `### ${s.title}\n\n${s.prompt}`).join("\n\n")}` : ""}`;
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
        kind: (w.kind === "summary" || w.kind === "concept" || w.kind === "synthesis") ? w.kind : "concept" as WikiKind,
        title: String(w.title),
        sections: w.sections.map((s: any) => ({
          heading: String(s.heading ?? ""),
          content: String(s.content ?? ""),
        })),
        suggestedAction: w.suggestedAction === "merge" ? "merge" as const : "create" as const,
        mergeTargetId: w.mergeTargetId ? String(w.mergeTargetId) : undefined,
        confidence: typeof w.confidence === "number" ? w.confidence : 0.7,
        relatedConcepts: Array.isArray(w.relatedConcepts)
          ? w.relatedConcepts.map((rc: any) =>
              typeof rc === "string"
                ? { title: rc, citation: "" }  // 後方互換: 旧形式の文字列
                : { title: String(rc.title ?? ""), citation: String(rc.citation ?? "") }
            )
          : [],
        externalReferences: Array.isArray(w.externalReferences)
          ? w.externalReferences
              .filter((r: any) => r.url && typeof r.url === "string")
              .map((r: any) => ({
                url: String(r.url),
                title: String(r.title ?? r.url),
                citation: String(r.citation ?? ""),
              }))
          : [],
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
