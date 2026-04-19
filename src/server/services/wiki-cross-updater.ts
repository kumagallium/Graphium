// Wiki Cross-Updater
// 新しいソースが Ingest された際に、関連する既存 Wiki ページの更新提案を生成する
// llm-wiki の「15ファイル同時更新」に相当する機能

export type CrossUpdateProposal = {
  /** 更新対象の Wiki ID */
  targetWikiId: string;
  /** 更新対象の Wiki タイトル */
  targetWikiTitle: string;
  /** 更新種別 */
  updateType: "add_section" | "revise_section" | "add_reference";
  /** 更新内容（セクション見出し + 本文） */
  section?: { heading: string; content: string };
  /** 追加する参照 */
  reference?: { noteTitle: string; noteId: string };
  /** 更新理由 */
  reason: string;
  /** 信頼度 */
  confidence: number;
};

export type CrossUpdateResult = {
  proposals: CrossUpdateProposal[];
};

export type ExistingWikiDetail = {
  id: string;
  title: string;
  kind: "summary" | "concept";
  /** 既存セクションの見出しリスト */
  sectionHeadings: string[];
  /** セクション内容のサマリー（先頭200文字ずつ） */
  sectionPreviews: string[];
};

/**
 * 横断更新用のシステムプロンプトを構築する
 */
export function buildCrossUpdateSystemPrompt(language: string): string {
  return `You are a knowledge maintenance engine for Graphium, a provenance-tracking research editor.

A new note has been ingested into the Wiki. Your job is to determine if any EXISTING Wiki pages should be updated based on the new information.

## Update Types

### add_section
The new note contains information that should be added as a new section to an existing Wiki page.
Use when: the existing Concept page covers a topic that the new note provides new evidence, examples, or perspectives on.

### revise_section
The new note contains information that updates, corrects, or enriches an existing section.
Use when: the new note directly relates to content already in a section, providing more current or more detailed information.

### add_reference
The new note should be referenced by an existing Wiki page as a related source.
Use when: the connection is clear but doesn't warrant a full section update.

## Output Format

Respond with valid JSON only (no markdown wrapper):

{
  "proposals": [
    {
      "targetWikiId": "existing-wiki-id",
      "targetWikiTitle": "Existing Wiki Title",
      "updateType": "add_section" | "revise_section" | "add_reference",
      "section": {
        "heading": "New section heading (only for add_section/revise_section)",
        "content": "Section content text"
      },
      "reference": {
        "noteTitle": "Source note title (only for add_reference)",
        "noteId": "source-note-id"
      },
      "reason": "Why this update is needed",
      "confidence": 0.0-1.0
    }
  ]
}

## Guidelines

- Only propose updates with confidence >= 0.7
- Focus on Concept pages (not Summaries — those are tied to specific notes)
- Don't propose trivial updates (just adding a mention without substance)
- Each proposal should add genuine value to the existing page
- Keep section content concise (100-400 chars)
- Return empty proposals array if no updates are warranted

## Language

Output in: ${language === "ja" ? "Japanese" : "English"}`;
}

/**
 * 横断更新用のユーザーメッセージを構築する
 */
export function buildCrossUpdateUserMessage(
  newNoteTitle: string,
  newNoteContent: string,
  newWikiTitles: string[],
  existingWikis: ExistingWikiDetail[],
): string {
  const existingDesc = existingWikis.map((w) => {
    const sections = w.sectionHeadings.map((h, i) => {
      const preview = w.sectionPreviews[i] ?? "";
      return `  - ${h}: ${preview}`;
    }).join("\n");
    return `### [${w.kind}] ${w.title} (id: ${w.id})\n${sections}`;
  }).join("\n\n");

  return `## New Note: "${newNoteTitle}"

${newNoteContent.slice(0, 3000)}

## Wiki pages generated from this note:
${newWikiTitles.map((t) => `- ${t}`).join("\n")}

## Existing Wiki pages to consider updating:

${existingDesc}`;
}

/**
 * 横断更新の LLM 出力をパースする
 */
export function parseCrossUpdateOutput(text: string): CrossUpdateProposal[] {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const proposals = parsed.proposals ?? parsed;

    if (!Array.isArray(proposals)) return [];

    return proposals
      .filter((p: any) => p.targetWikiId && p.updateType && p.reason)
      .filter((p: any) => (typeof p.confidence === "number" ? p.confidence : 0.7) >= 0.7)
      .map((p: any) => ({
        targetWikiId: String(p.targetWikiId),
        targetWikiTitle: String(p.targetWikiTitle ?? ""),
        updateType: validateUpdateType(p.updateType),
        section: p.section ? {
          heading: String(p.section.heading ?? ""),
          content: String(p.section.content ?? ""),
        } : undefined,
        reference: p.reference ? {
          noteTitle: String(p.reference.noteTitle ?? ""),
          noteId: String(p.reference.noteId ?? ""),
        } : undefined,
        reason: String(p.reason),
        confidence: typeof p.confidence === "number" ? p.confidence : 0.7,
      }));
  } catch (err) {
    console.error("Cross-update 出力のパース失敗:", err);
    return [];
  }
}

function validateUpdateType(type: string): "add_section" | "revise_section" | "add_reference" {
  if (["add_section", "revise_section", "add_reference"].includes(type)) {
    return type as "add_section" | "revise_section" | "add_reference";
  }
  return "add_reference";
}
