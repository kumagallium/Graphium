// Wiki Linter
// 既存 Wiki ドキュメント群を LLM で分析し、整合性問題を検出する
// - 矛盾検出（Contradiction）: 異なる Wiki 間の矛盾する主張
// - 孤立ページ（Orphan）: 他の Wiki や元ノートとの接続がないページ
// - 知識ギャップ（Gap）: カバーされていないトピック・発展可能な領域
// - 陳腐化（Stale）: 長期間更新されていないページ
// - 重複（Redundant）: 内容が大幅に重なる Concept 同士

export type LintIssueType = "contradiction" | "orphan" | "gap" | "stale" | "redundant";
export type LintSeverity = "info" | "warning" | "error";

export type LintIssue = {
  type: LintIssueType;
  severity: LintSeverity;
  title: string;
  description: string;
  /** 関連する Wiki ドキュメント ID */
  affectedWikiIds: string[];
  /** 推奨アクション */
  suggestion: string;
};

export type LintReport = {
  issues: LintIssue[];
  summary: {
    total: number;
    contradictions: number;
    orphans: number;
    gaps: number;
    stale: number;
    redundant: number;
  };
  analyzedAt: string;
};

export type WikiSnapshot = {
  id: string;
  title: string;
  kind: "summary" | "concept" | "synthesis";
  derivedFromNotes: string[];
  relatedConcepts: string[];
  sections: string[];
  lastIngestedAt?: string;
  modifiedAt: string;
};

/**
 * Lint 用のシステムプロンプトを構築する
 */
export function buildLinterSystemPrompt(language: string): string {
  return `You are a knowledge base health checker for Graphium, a provenance-tracking research editor.

Your task is to analyze a collection of Wiki documents (AI-generated knowledge pages) and identify quality issues.

## Issue Types

### contradiction
Two or more Wiki pages make claims that conflict with each other.
Only flag genuine contradictions — different perspectives on the same topic are NOT contradictions.
Severity: "error"

### orphan
A Wiki page with no connections to other pages or source notes.
This may indicate forgotten or poorly integrated knowledge.
Severity: "warning"

### gap
An area of knowledge that is referenced or implied but has no dedicated Wiki page.
Also includes Concepts that could be synthesized from existing pages but haven't been.
Severity: "info"

### stale
A Wiki page that hasn't been updated in a long time while related pages have been updated.
Or a page whose source notes may have changed since the Wiki was generated.
Severity: "warning"

### redundant
Two or more Concept pages that cover substantially the same knowledge.
One could be deleted or merged into the other without losing information.
This often happens when a page is regenerated with a better model — the old version may now be redundant.
Severity: "warning"

## Output Format

Respond with valid JSON only (no markdown wrapper):

{
  "issues": [
    {
      "type": "contradiction" | "orphan" | "gap" | "stale" | "redundant",
      "severity": "info" | "warning" | "error",
      "title": "Short issue title",
      "description": "Detailed explanation of the issue",
      "affectedWikiIds": ["wiki-id-1", "wiki-id-2"],
      "suggestion": "What should be done to resolve this"
    }
  ]
}

## Guidelines

- Be specific: reference actual Wiki titles and content in descriptions
- Be conservative: only flag clear issues, not speculative ones
- Prioritize actionable issues: each issue should have a concrete suggestion
- For gaps: suggest what kind of Concept page could be created
- For contradictions: quote the conflicting claims
- For stale: compare lastIngestedAt dates with related pages
- For redundant: compare section headings and content themes between Concept pages. If two Concepts cover >70% of the same ground, flag them. IMPORTANT: in affectedWikiIds, put the page to KEEP first, and the page to MERGE INTO IT second. Prefer keeping the one with more recent updates, more sources, or better quality. The suggestion should clearly state which page absorbs which
- Return an empty issues array if no issues are found

## Language

Output in: ${language === "ja" ? "Japanese" : "English"}`;
}

/**
 * Lint 用のユーザーメッセージを構築する
 */
export function buildLinterUserMessage(wikis: WikiSnapshot[]): string {
  if (wikis.length === 0) {
    return "No Wiki documents to analyze.";
  }

  const wikiDescriptions = wikis.map((w) => {
    const lines = [
      `## [${w.kind}] ${w.title} (id: ${w.id})`,
      `Last updated: ${w.modifiedAt}`,
      w.lastIngestedAt ? `Last ingested: ${w.lastIngestedAt}` : null,
      `Sources: ${w.derivedFromNotes.length} note(s)`,
      w.relatedConcepts.length > 0
        ? `Related concepts: ${w.relatedConcepts.join(", ")}`
        : null,
      `Sections:`,
      ...w.sections.map((s) => `  - ${s}`),
    ].filter(Boolean);
    return lines.join("\n");
  }).join("\n\n---\n\n");

  return `Analyze the following ${wikis.length} Wiki documents for quality issues:\n\n${wikiDescriptions}`;
}

/**
 * Linter の LLM 出力をパースする
 */
export function parseLinterOutput(text: string): LintIssue[] {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const issues = parsed.issues ?? parsed;

    if (!Array.isArray(issues)) return [];

    return issues
      .filter((i: any) => i.type && i.title && i.description)
      .map((i: any) => ({
        type: validateIssueType(i.type),
        severity: validateSeverity(i.severity),
        title: String(i.title),
        description: String(i.description),
        affectedWikiIds: Array.isArray(i.affectedWikiIds)
          ? i.affectedWikiIds.map(String)
          : [],
        suggestion: String(i.suggestion ?? ""),
      }));
  } catch (err) {
    console.error("Linter 出力のパース失敗:", err);
    return [];
  }
}

function validateIssueType(type: string): LintIssueType {
  if (["contradiction", "orphan", "gap", "stale", "redundant"].includes(type)) {
    return type as LintIssueType;
  }
  return "gap";
}

function validateSeverity(severity: string): LintSeverity {
  if (["info", "warning", "error"].includes(severity)) {
    return severity as LintSeverity;
  }
  return "info";
}

/**
 * ローカルで検出可能な Stale/Orphan 問題をチェックする（LLM 不要）
 */
export function detectLocalIssues(
  wikis: WikiSnapshot[],
  staleDays: number = 30,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const now = Date.now();
  const staleThreshold = staleDays * 24 * 60 * 60 * 1000;

  // Wiki ID → Wiki のマップ
  const wikiById = new Map(wikis.map((w) => [w.id, w]));

  // 全 Wiki の relatedConcepts に含まれている ID セット
  const referenced = new Set<string>();
  for (const w of wikis) {
    for (const rc of w.relatedConcepts) {
      // relatedConcepts はタイトルなので、ID に変換
      const target = wikis.find((t) => t.title === rc);
      if (target) referenced.add(target.id);
    }
    // derivedFromNotes で参照している Wiki も含む
    for (const noteId of w.derivedFromNotes) {
      if (wikiById.has(noteId)) referenced.add(noteId);
    }
  }

  for (const w of wikis) {
    // Stale チェック: 最終更新から staleDays 日以上経過
    const lastUpdate = new Date(w.lastIngestedAt ?? w.modifiedAt).getTime();
    if (now - lastUpdate > staleThreshold) {
      const daysSince = Math.floor((now - lastUpdate) / (24 * 60 * 60 * 1000));
      issues.push({
        type: "stale",
        severity: "warning",
        title: `"${w.title}" has not been updated for ${daysSince} days`,
        description: `This ${w.kind} was last updated on ${new Date(lastUpdate).toISOString().slice(0, 10)}. It may contain outdated information.`,
        affectedWikiIds: [w.id],
        suggestion: `Review and re-ingest the source notes, or mark as still valid.`,
      });
    }

    // Orphan チェック: Concept で他から参照されておらず、自身も他を参照していない
    if (w.kind === "concept") {
      const isReferenced = referenced.has(w.id);
      const hasOutgoing = w.relatedConcepts.length > 0;
      const hasSources = w.derivedFromNotes.length > 0;
      if (!isReferenced && !hasOutgoing && !hasSources) {
        issues.push({
          type: "orphan",
          severity: "warning",
          title: `"${w.title}" is an orphan Concept`,
          description: `This Concept has no connections to other Wiki pages or source notes.`,
          affectedWikiIds: [w.id],
          suggestion: `Consider linking it to related Concepts, or delete if no longer relevant.`,
        });
      }
    }
  }

  return issues;
}
