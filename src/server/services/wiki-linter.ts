// Wiki Linter
// 既存 Wiki ドキュメント群を LLM で分析し、整合性問題を検出する
// - 矛盾検出（Contradiction）: 異なる Wiki 間の矛盾する主張
// - 孤立ページ（Orphan）: 他の Wiki や元ノートとの接続がないページ
// - 知識ギャップ（Gap）: カバーされていないトピック・発展可能な領域
// - 陳腐化（Stale）: 後から作られた知見に内容を追い越されたページ
// - 重複（Redundant）: 内容が大幅に重なる Claim 同士

export type LintIssueType = "contradiction" | "orphan" | "gap" | "stale" | "redundant" | "missing-source";
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
    /** 資料の一部がゴミ箱・未検出になった新形式トピック（機械判定・LLM 不要） */
    missingSource: number;
  };
  analyzedAt: string;
};

export type WikiSnapshot = {
  id: string;
  title: string;
  kind: "summary" | "claim" | "atom" | "synthesis" | "topic";
  derivedFromNotes: string[];
  relatedClaims: string[];
  /** 本文先頭のプレビュー（1ノート1知見前提で sections は廃止） */
  bodyPreview: string;
  /** Claim のときのみ意味を持つ（principle / finding / bridge） */
  level?: "principle" | "finding" | "bridge";
  /** メンバー知見（Claim）の ID リスト。topic のときのみ意味を持つ（orphan topic 判定に使う） */
  derivedFromClaims?: string[];
  /**
   * 矛盾する既存洞察（Atom）の ID リスト（atom のみ意味を持つ）。
   * resolveAtomDuplicates の contradiction 判定が双方向に書く。detectLocalIssues が
   * これを見て "contradiction" issue を機械的に列挙する（LLM lint とは別経路）。
   */
  conflictsWith?: string[];
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
A Wiki page whose claim has been superseded — a genuine conflict or overwrite by knowledge
written later, not merely the passage of time. Flag only when you can point to a specific
other page (or newer source note) that supersedes it. "It hasn't changed in a while" alone
is NOT a reason to flag — most pages are correctly stable.
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
- For stale: identify the specific newer page or note that supersedes it, and name it in the description — do not flag based on elapsed time alone
- For redundant: compare section headings and content themes between Claim pages. Flag when the pages are about the same concept and assert the same specific claim (allowing for differences in wording or level of detail). **Also apply this to Topic pages** — two Topics whose titles name the same concept despite surface differences (wording variants, presence/absence of particles, word order, or one being a needlessly narrow per-sample/per-composition slice of the other) are redundant even if you haven't read their member Claims; the fix is to merge them via "Organize topics" in Settings, not to edit content. IMPORTANT: in affectedWikiIds, put the page to KEEP first, and the page to MERGE INTO IT second. Prefer keeping the one with more recent updates, more sources, or better quality (for Topics, prefer the more general/reusable title). The suggestion should clearly state which page absorbs which
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
  if (["contradiction", "orphan", "gap", "stale", "redundant", "missing-source"].includes(type)) {
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
 * ローカルで検出可能な Orphan/Redundant 問題をチェックする（LLM 不要）。
 * Stale（後から来た知見に追い越されたか）は日数で機械判定できないため、LLM lint 側でのみ扱う。
 */
export function detectLocalIssues(wikis: WikiSnapshot[]): LintIssue[] {
  const issues: LintIssue[] = [];

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

  // Contradiction チェック（atom）: resolveAtomDuplicates が LLM で "contradiction" と
  // 判定し、双方向に書いた conflictsWith を機械的に列挙する（LLM lint とは別経路。
  // ここは判定済みの事実を表示するだけなので LLM 不要）。id ペアの重複列挙を避けるため
  // id が小さい方を先に処理した時だけ issue を作る。
  for (const w of wikis) {
    if (w.kind !== "atom" || !w.conflictsWith || w.conflictsWith.length === 0) continue;
    for (const otherId of w.conflictsWith) {
      if (w.id >= otherId) continue; // 逆向きの重複を弾く（片方だけ処理）
      const other = wikiById.get(otherId);
      if (!other) continue;
      issues.push({
        type: "contradiction",
        severity: "error",
        title: `"${w.title}" and "${other.title}" contradict each other`,
        description: `These two Insights (Atoms) were judged to conflict in direction/condition/conclusion when discovered — both were kept rather than silently merged.`,
        affectedWikiIds: [w.id, otherId],
        suggestion: `Open both "${w.title}" and "${other.title}" to compare and decide which (if either) still holds.`,
      });
    }
  }

  for (const w of wikis) {
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

    // Orphan チェック（topic）: メンバー知見が 0 件の話題ページ。
    // 知見の削除で 0 件になった話題はそのまま残す設計（本文は書き直さない）ので、
    // ここで検出して点検結果に出す。LLM 不要でローカルに判定できる。
    // 新形式トピック（topicMarkdown あり）は derivedFromClaims を使わず derivedFromNotes
    // （資料 id）にメンバーを持つため、両方が空のときだけ空トピックとみなす。
    if (w.kind === "topic" && (w.derivedFromClaims ?? []).length === 0 && w.derivedFromNotes.length === 0) {
      issues.push({
        type: "orphan",
        severity: "warning",
        title: `"${w.title}" is a topic with no member claims`,
        description: `This topic page has no Claims or sources linked to it (derivedFromClaims and derivedFromNotes are both empty), likely because all member Claims/sources were deleted.`,
        affectedWikiIds: [w.id],
        suggestion: `Delete this topic page, or link existing Claims/sources to it.`,
      });
    }
  }

  // Redundant チェック（topic）: 正規化タイトルが完全一致する話題（表記ゆれの明確なケースのみ。
  // LLM 不要でローカルに判定できる）。語順違い・助詞違いなどの近縁話題は LLM lint 側で拾う —
  // ここでは「同じ文字列としか言えない」ケースだけを機械的に検出する。
  const topicsByNormalizedTitle = new Map<string, WikiSnapshot[]>();
  for (const w of wikis) {
    if (w.kind !== "topic") continue;
    const key = normalizeForDuplicateCheck(w.title);
    const list = topicsByNormalizedTitle.get(key) ?? [];
    list.push(w);
    topicsByNormalizedTitle.set(key, list);
  }
  for (const group of topicsByNormalizedTitle.values()) {
    if (group.length < 2) continue;
    // メンバー数が多い方を残す（同点ならより新しい方）
    const sorted = [...group].sort((a, b) => {
      const memberDiff = (b.derivedFromClaims ?? []).length - (a.derivedFromClaims ?? []).length;
      if (memberDiff !== 0) return memberDiff;
      return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    });
    const keep = sorted[0];
    for (const absorb of sorted.slice(1)) {
      issues.push({
        type: "redundant",
        severity: "warning",
        title: `"${keep.title}" and "${absorb.title}" name the same topic`,
        description: `These two Topic pages have the same normalized title (only whitespace/casing differ), so they should be a single page.`,
        affectedWikiIds: [keep.id, absorb.id],
        suggestion: `Merge "${absorb.title}" into "${keep.title}" via "Organize topics" in Settings.`,
        recommendedAction: { type: "merge", keepId: keep.id, absorbId: absorb.id, reason: `Same normalized title; keeping the one with more members / more recently updated.` },
      });
    }
  }

  return issues;
}

/** 話題の重複判定専用の正規化（NFKC・空白除去・小文字化）。wiki-service.normalizeTopicTitle と同じ規則を
 *  サーバー側で複製する（client/server のバンドル境界をまたがないため）。 */
function normalizeForDuplicateCheck(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 機械的に自動アーカイブできる「空になったナレッジ」の候補 */
export type AutoArchiveCandidate = {
  id: string;
  title: string;
  kind: "topic" | "claim";
  /**
   * empty-topic: メンバー知見 0 件の話題 / orphaned-source: 出どころのノートが全て消失した知見 /
   * sources-gone: 新形式トピックで、資料がすべてノート id かつどれも有効なノートに無い
   */
  reason: "empty-topic" | "orphaned-source" | "sources-gone";
};

/**
 * 機械的に判定できる「空になったナレッジ」を検出する（LLM 不要）。
 *
 * AI の判断（古い・冗長）はここに含めない — 人が点検結果から一括で選んでアーカイブする
 * 操作（WikiLintView 側）に回す。ここで拾うのは次の 2 種類のみ:
 *
 * - 空トピック: derivedFromClaims が空（統合や知見の削除で残った空の入れ物）
 * - 出どころ喪失知見: derivedFromNotes に有効なノート（ゴミ箱でも未検出でもない）が
 *   1 つも無い。validNoteIds は既存のインデックス（getActiveNotes 相当）から作る
 *   前提で、ここでは重いドキュメントロードを行わない。
 *
 * 呼び出し側は返ってきた候補を archive してから、残りの snapshot で通常の lint
 * （detectLocalIssues / LLM lint）を走らせる。fm.wikiFiles は archived/trashed を
 * 除外済みなので、既にアーカイブ済みのエントリはそもそも wikis に含まれず冪等になる。
 */
export function detectAutoArchivable(
  wikis: WikiSnapshot[],
  validNoteIds: Set<string>,
): AutoArchiveCandidate[] {
  const candidates: AutoArchiveCandidate[] = [];
  for (const w of wikis) {
    // 新形式トピック（derivedFromNotes に資料 id を持つ）を誤って空判定しないよう、
    // derivedFromClaims と derivedFromNotes の両方が空のときだけ「空トピック」とみなす。
    if (w.kind === "topic" && (w.derivedFromClaims ?? []).length === 0 && w.derivedFromNotes.length === 0) {
      candidates.push({ id: w.id, title: w.title, kind: "topic", reason: "empty-topic" });
      continue;
    }
    // 新形式トピック（derivedFromClaims が空・derivedFromNotes が 1 件以上）で、資料が
    // すべてノート id（外部プレフィックス無し）かつ、どれも validNoteIds に無いとき。
    // detectAutoArchivable の claim 側（orphaned-source）と同じ理由で、有効なノートが
    // 1 件も渡されない（起動直後で索引が未読込）ときは判定しない。
    if (
      w.kind === "topic"
      && (w.derivedFromClaims ?? []).length === 0
      && w.derivedFromNotes.length > 0
      && validNoteIds.size > 0
    ) {
      const noteSources = w.derivedFromNotes.filter((id) => !id.includes(":"));
      const hasExternalSource = w.derivedFromNotes.length > noteSources.length;
      if (!hasExternalSource) {
        const hasValidSource = noteSources.some((noteId) => validNoteIds.has(noteId));
        if (!hasValidSource) {
          candidates.push({ id: w.id, title: w.title, kind: "topic", reason: "sources-gone" });
          continue;
        }
      }
    }
    // 有効なノートが 1 件も渡されないときは「全部消えた」と「まだ索引が読めていない」を
    // 区別できない（起動直後に noteIndex が null のまま呼ぶと全知見を誤って片付けた、
    // 2026-09-17 に確認）。片付けない側に倒す。
    if (w.kind === "claim" && validNoteIds.size > 0) {
      // 出どころが「ノートだけ」で、そのノートが 1 つも残っていないときだけ片付ける。
      //
      // derivedFromNotes にはノート id 以外も入る（pdf: / url: / document: / chat: /
      // memo: の外部ソース。[[project_lineage_external_source_prefixes]]）。これらは
      // ノート索引に載らないので validNoteIds では引けず、「消えた」とは判定できない。
      // 素材から作った知見はすべてこの形なので、prefix 付きが 1 つでもあれば残す。
      // 出どころが空の知見も、どのフィールドに来歴があるか（derivedFromChats など）を
      // この関数からは見られないため、自動では片付けない（点検の orphan が拾う）。
      const noteSources = w.derivedFromNotes.filter((id) => !id.includes(":"));
      const hasExternalSource = w.derivedFromNotes.length > noteSources.length;
      if (noteSources.length > 0 && !hasExternalSource) {
        const hasValidSource = noteSources.some((noteId) => validNoteIds.has(noteId));
        if (!hasValidSource) {
          candidates.push({ id: w.id, title: w.title, kind: "claim", reason: "orphaned-source" });
        }
      }
    }
  }
  return candidates;
}

/**
 * 資料の一部だけがゴミ箱・未検出になった新形式トピックを検出する（LLM 不要）。
 *
 * detectAutoArchivable の sources-gone（資料が全滅）と違い、こちらは
 * 「1 件以上あるが全部ではない」ケースを拾う — 自動アーカイブはせず、点検の warning
 * として出し、資料の見直し（手入れ画面の「資料から作り直す」等）を人に促す。
 * 旧形式トピック（derivedFromClaims にメンバーを持つ）は対象外。
 * validNoteIds が空（起動直後で索引が未読込）のときは判定しない
 * （detectAutoArchivable と同じ理由 — 全件誤判定を避ける）。
 */
export function detectMissingSourceIssues(
  wikis: WikiSnapshot[],
  validNoteIds: Set<string>,
): LintIssue[] {
  if (validNoteIds.size === 0) return [];
  const issues: LintIssue[] = [];
  for (const w of wikis) {
    if (w.kind !== "topic" || (w.derivedFromClaims ?? []).length > 0) continue;
    const noteSources = w.derivedFromNotes.filter((id) => !id.includes(":"));
    if (noteSources.length === 0) continue;
    const missingCount = noteSources.filter((noteId) => !validNoteIds.has(noteId)).length;
    // 1 件以上・全部ではない（全滅は detectAutoArchivable の sources-gone が拾う）
    if (missingCount === 0 || missingCount >= noteSources.length) continue;
    issues.push({
      type: "missing-source",
      severity: "warning",
      title: `"${w.title}" cites a source that is missing`,
      description: `${missingCount} of ${noteSources.length} source note(s) cited by this topic are in the trash or could not be found.`,
      affectedWikiIds: [w.id],
      suggestion: `${missingCount} source(s) missing`,
    });
  }
  return issues;
}
