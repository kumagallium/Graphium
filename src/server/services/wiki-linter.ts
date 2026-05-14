// Wiki Linter
// 既存 Wiki ドキュメント群を LLM で分析し、整合性問題を検出する
// - 矛盾検出（Contradiction）: 異なる Wiki 間の矛盾する主張
// - 孤立ページ（Orphan）: 他の Wiki や元ノートとの接続がないページ
// - 知識ギャップ（Gap）: カバーされていないトピック・発展可能な領域
// - 陳腐化（Stale）: 長期間更新されていないページ
// - 重複（Redundant）: 内容が大幅に重なる Claim 同士

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
  /**
   * 構造化された推奨アクション（PR-B6.2）。
   *
   * UI が ID 直接ではなく LLM の判断を踏まえた推奨を視覚化するためのフィールド。
   * redundant のとき、どれを残しどれを吸収するかを id 単位で指定する。
   * 他の issue type では使わない（contradiction / gap / orphan / stale は
   * 単純な 1-wiki 操作で済む or AI に決めさせない方が安全）。
   */
  recommendedAction?: {
    type: "merge";
    /** 残す wiki id（canonical） */
    keepId: string;
    /** 吸収して archive 推奨の wiki id */
    absorbId: string;
    /** なぜ keepId を canonical に選ぶかの理由（人間向け） */
    reason?: string;
  };
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
  kind: "summary" | "claim" | "atom" | "synthesis";
  derivedFromNotes: string[];
  relatedClaims: string[];
  /** 本文先頭のプレビュー（1ノート1知見前提で sections は廃止） */
  bodyPreview: string;
  /** Claim のときのみ意味を持つ（principle / finding / bridge） */
  level?: "principle" | "finding" | "bridge";
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
**Strict definition.** Flag a page as orphan ONLY when ALL of the following hold:
1. No other Wiki page references it (no incoming links).
2. It does not reference any other Wiki page (no outgoing relatedClaims).
3. It has no source notes in derivedFromNotes.

Do NOT use \`orphan\` for a page that references *something missing* — that is a \`gap\`, not an orphan. A page with valid outgoing references is connected; do not flag it as isolated.

Severity: "warning". Suggestion should explain the page exists in isolation; user choice is typically to archive or wire it up manually.

### gap
A topic that **multiple existing Wiki pages reference but has no dedicated Wiki page of its own**. The referenced topic is implicit in the corpus; the gap is that nobody has written the centralizing page.

When you emit a \`gap\` issue, the \`title\` and \`description\` MUST clearly say *what the missing topic is* (not just an internal ID). Examples:

- ✅ "Multiple pages reference 'multi-band conduction' but no dedicated Claim explains it."
- ❌ "Pages X, Y, Z reference af4189d8-... but no Wiki page exists."

If you can only name the missing topic by ID (no human-readable title is inferable from how it is referenced), do NOT emit the issue — it is not actionable.

Severity: "info".

### stale
A Wiki page that hasn't been updated in a long time while related pages have been updated.
Or a page whose source notes may have changed since the Wiki was generated.
Severity: "warning"

### redundant

**STRICT bar. Only flag when removing one page would lose NOTHING of substance.**

Pages can share a topic without being redundant. Two Claim pages about "substitution in thermoelectrics" can be making *different* specific claims — one about mobility and thermal conductivity, another about Seebeck sign-flip temperature, for example. Same domain, different load-bearing content. **That is NOT redundancy.**

Redundancy requires that the two pages make **the same specific claim** (same load-bearing finding, same mechanism, same parameter regime). A page that overlaps in topic but covers a distinct mechanism, parameter, or finding is **not** redundant.

#### Self-check (run before flagging)

Before emitting a redundant issue, you MUST be able to answer:

1. **Name the shared claim explicitly.** What is the specific finding both pages assert? "Both are about thermoelectrics" is not enough. The shared claim must be at the level of "X causes Y under condition Z" — same X, same Y, same Z.
2. **List what the absorb side carries that the keep side does NOT cover.** If you can name ANY substantive piece of content (a different mechanism, parameter range, observation, citation) unique to the absorb side, the pages are NOT redundant. Do not flag.
3. **Write your \`reason\` in the form "Both pages claim P. The absorb page adds nothing beyond P that is not already in keep."** If you cannot write this sentence honestly, do not flag.

#### Anti-examples (do NOT flag these as redundant)

- ❌ "Both pages are about pH-dependent reduction." → Different specific findings about pH effects are not redundant.
- ❌ "Both pages cover Al5Co2 properties." → Substitution affecting mobility ≠ substitution affecting Seebeck sign-flip. Same compound, different claims.
- ❌ "Both pages mention SPS sintering." → Sharing a method doesn't make claims redundant.

#### Examples that ARE redundant

- ✅ Two pages both titled around "Al5Co2 unit cell parameter is a = 3.62 Å measured by XRD." Identical specific finding.
- ✅ A page that was regenerated with a better model, where the older one carries strictly less detail than the newer one.

Severity: "warning"

**For redundant issues you MUST fill \`recommendedAction\`** with \`keepId\`, \`absorbId\`, and a \`reason\` that satisfies self-check #3 above. If you cannot write a \`reason\` of that form, **drop the issue entirely** — do not emit a redundant flag with vague justification.

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
      "suggestion": "What should be done to resolve this",
      "recommendedAction": {                  // redundant のみ必須。他は省略
        "type": "merge",
        "keepId": "wiki-id-to-keep",
        "absorbId": "wiki-id-to-absorb",
        "reason": "Why keepId is the canonical one (one sentence)"
      }
    }
  ]
}

## CRITICAL: refer to wiki pages by TITLE, not by ID

In \`title\`, \`description\`, and \`suggestion\`:
- **Always use the page title** when referring to a specific wiki. Example: "Keep \"Bandgap engineering of Al5Co2\" and merge \"Al5Co2 reduction kinetics\" into it."
- **Never paste raw UUIDs** like \`af4189d8-...\` in user-facing text — those are unreadable.
- IDs go in \`affectedWikiIds\` and \`recommendedAction\` only (the UI handles ID-to-action wiring).

If two pages have very similar titles, disambiguate with a short distinguishing phrase, not with the ID.

## Guidelines

- Be specific: reference actual Wiki titles and content in descriptions
- Be conservative: only flag clear issues, not speculative ones
- Prioritize actionable issues: each issue should have a concrete suggestion
- For gaps: suggest what kind of Claim page could be created
- For contradictions: quote the conflicting claims
- For stale: compare lastIngestedAt dates with related pages
- For redundant: compare section headings and content themes between Claim pages. If two Claims cover >70% of the same ground, flag them. IMPORTANT: in affectedWikiIds, put the page to KEEP first, and the page to MERGE INTO IT second. Prefer keeping the one with more recent updates, more sources, or better quality. The suggestion should clearly state which page absorbs which
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
    const kindLabel = w.kind === "claim" && w.level ? `concept/${w.level}` : w.kind;
    const lines = [
      `## [${kindLabel}] ${w.title} (id: ${w.id})`,
      `Last updated: ${w.modifiedAt}`,
      w.lastIngestedAt ? `Last ingested: ${w.lastIngestedAt}` : null,
      `Sources: ${w.derivedFromNotes.length} note(s)`,
      w.relatedClaims.length > 0
        ? `Related concepts: ${w.relatedClaims.join(", ")}`
        : null,
      w.bodyPreview ? `Preview: ${w.bodyPreview}` : null,
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
      .map((i: any) => {
        const affectedWikiIds: string[] = Array.isArray(i.affectedWikiIds)
          ? i.affectedWikiIds.map(String)
          : [];
        // PR-B6.2: recommendedAction の取り出し。
        // - type === "merge" 限定
        // - keepId / absorbId は affectedWikiIds に含まれていなければ無効として捨てる
        //   （LLM がノイズの id を返した時の hallucination 防御）
        let recommendedAction: LintIssue["recommendedAction"];
        const ra = i.recommendedAction;
        if (ra && typeof ra === "object" && ra.type === "merge") {
          const keepId = typeof ra.keepId === "string" ? ra.keepId : "";
          const absorbId = typeof ra.absorbId === "string" ? ra.absorbId : "";
          if (
            keepId &&
            absorbId &&
            keepId !== absorbId &&
            affectedWikiIds.includes(keepId) &&
            affectedWikiIds.includes(absorbId)
          ) {
            recommendedAction = {
              type: "merge",
              keepId,
              absorbId,
              reason: typeof ra.reason === "string" ? ra.reason : undefined,
            };
          }
        }
        return {
          type: validateIssueType(i.type),
          severity: validateSeverity(i.severity),
          title: String(i.title),
          description: String(i.description),
          affectedWikiIds,
          suggestion: String(i.suggestion ?? ""),
          recommendedAction,
        };
      });
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

  // 全 Wiki の relatedClaims に含まれている ID セット
  const referenced = new Set<string>();
  for (const w of wikis) {
    for (const rc of w.relatedClaims) {
      // relatedClaims はタイトルなので、ID に変換
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

    // Orphan チェック: Claim で他から参照されておらず、自身も他を参照していない
    if (w.kind === "claim") {
      const isReferenced = referenced.has(w.id);
      const hasOutgoing = w.relatedClaims.length > 0;
      const hasSources = w.derivedFromNotes.length > 0;
      if (!isReferenced && !hasOutgoing && !hasSources) {
        issues.push({
          type: "orphan",
          severity: "warning",
          title: `"${w.title}" is an orphan Claim`,
          description: `This Claim has no connections to other Wiki pages or source notes.`,
          affectedWikiIds: [w.id],
          suggestion: `Consider linking it to related Claims, or delete if no longer relevant.`,
        });
      }
    }
  }

  return issues;
}
