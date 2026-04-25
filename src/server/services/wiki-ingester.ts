// Wiki Ingester
// ノートコンテンツを LLM に渡して Wiki ドキュメントの構造化データを生成する

import type { ConceptLevel, WikiKind } from "../../lib/document-types.js";

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
  /** Concept の抽象度レベル（concept のみ。summary では undefined） */
  level?: ConceptLevel;
  /** principle 判定時に LLM が指し示したノート内の該当文（自己検証用） */
  evidenceSpan?: string;
  /** 関連する既存 Concept（引用付き） */
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

  const ja = language === "ja";

  return `You are a knowledge developer for Graphium, a provenance-tracking research editor.

You produce two kinds of pages: a private **Summary** of one note (the local context), and one or more public-ready **Concepts** that crystallize knowledge in a transferable form. Concepts may eventually be shared as Knowledge Packs, so Concept content must be PII-free and abstracted from one-off lab specifics.

## Voice (read this first)

Write so a future reader **wants to keep reading**. Most generated notes fail because they read like form-filled reports. Don't do that.

- The first 1-2 sentences are a **hook**, not a meta-summary. State the finding, the tension, or the surprise. Never write "This note discusses..." / "本ノートでは…を扱う" — start with the substance itself.
- Use specific verbs and concrete nouns. Replace "影響を与える" with "速度を 2 倍にする" / "律速段階を変える" when the note supports it.
- One claim per sentence. Short sentences. Mix sentence lengths so the rhythm doesn't flatten.
- The fixed section headings below are a **scaffold, not a checklist**. Skip a section rather than fill it with filler. Merge sections when the content flows that way.
- It is OK — preferred — for a Concept to read like a short essay rather than a structured report.

## Title rule (applies to every wiki)

Titles are the only thing a reader sees in the list. Make them want to click.

- ❌ Descriptive form: "ZnO 薄膜の pH 依存性についての分析" / "Analysis of pH dependency in ZnO films"
- ✅ Declarative claim (preferred for finding/principle): "塩基性条件で還元の律速段階が切り替わる" / "Reduction switches its rate-limiting step under basic conditions"
- ✅ Open question (preferred when the note raised more questions than it answered): "なぜ pH 11 を超えると還元曲線が折れるのか" / "Why does the reduction curve bend above pH 11?"
- Avoid trailing words like "について" / "に関する考察" / "についての分析" / "concerning..." / "regarding...". They add length without information.
- Length: 8〜30 字 (ja) / 4〜12 words (en). If you can't fit it, the title isn't a single claim yet — split or sharpen.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "wikis": [
    {
      "kind": "summary" | "concept",
      "level": "principle" | "finding"   // concept のみ。summary では省略
      "evidenceSpan": "string"           // level=principle の場合のみ。下の Principle threshold 参照
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

## Summary (1 per note, always)

The Summary is **private**. It can keep specific names, dates, sample IDs, paths — anything needed to reconstruct what happened. This is the user's local context layer.

Suggested scaffold (skip / merge as the note dictates):
${ja ? `- **概要**: 何をなぜやったか
- **主な発見**: 具体的な結果・数値
- **洞察**: ノートに明示されていない気づき
- **未解決の問い**: 次に調べるべきこと
- **関連性**: 他の研究や Concept との関係` : `- **Overview**: What was done and why
- **Key Findings**: Specific results, numbers, observations
- **Insights**: What's learnable that the note didn't state explicitly
- **Open Questions**: What to investigate next
- **Connections**: How this relates to other work / existing Concepts`}

The first line must be a hook — the most surprising or load-bearing finding from the note, not a meta-description.

## Concept (0-3 per note)

Concepts are **transferable knowledge**, written so they make sense to a researcher who has never seen this lab. They MUST be PII-free and abstracted:

- ❌ Personal/lab-specific: investigator names, institution names, internal project codenames, sample IDs, instrument serial numbers, file paths, dates of specific experiments. Keep these in the Summary instead.
- ✅ Transferable: the principle / finding, with the specific evidence cited via \`[[note title]]\` so the reader can trace it back.
- Frame as "X happens when Y because Z" — propositional, not autobiographical.

### level: \`finding\` vs \`principle\`

- **\`finding\`** (default, where most Concepts live): a transferable proposition that emerged from the user's own experience. Specific enough to be **the user's** knowledge, abstract enough to combine with other findings. Example: "塩基性条件で酸化膜の還元は律速段階が切り替わる".
- **\`principle\`**: a textbook-knowable general truth that the note's reasoning **explicitly depended on**. Recording these is valuable because (a) the user may not have known it before, (b) it becomes a synthesis hub when other notes also lean on it. But the bar for generation is high — see threshold below.
- \`bridge\` is reserved for cross-update synthesis; do not generate at ingest time.

### Principle threshold (strict — read carefully)

Generate \`level: "principle"\` ONLY if you can pass this test:

> **"Point to a sentence in the note where this principle is used as a load-bearing premise to reach a conclusion. If the principle were false, the note's conclusion would change."**

If you cannot identify such a sentence, the principle is not load-bearing — it is adjacent context. Do not generate it. Adjacent restatements of textbook material are exactly what makes the wiki feel cluttered.

When you do generate a principle, you MUST fill \`evidenceSpan\` with the actual sentence (or close paraphrase) from the note that depends on it. This is a self-check: if you cannot quote it, you cannot generate the principle.

### Concept scaffold (essay-like, scaffold not checklist)

${ja ? `- **一言で**: この Concept を 1 文の命題で（タイトルとセットで命題が立つように）
- **なぜ重要か / どこで効くか**: この知識が他の文脈で何を変えるか
- **メカニズム**: なぜそう言えるか — 因果・推論
- **根拠**: ソースノートからの具体的な観察。インライン引用 \`[[ノートタイトル]]\` を使う
- **未解決の問い**: まだ分からないこと` : `- **In one line**: The Concept stated as a single proposition (paired with the title, the claim should now stand)
- **Why it matters / where it bites**: What this knowledge changes in other contexts
- **Mechanism**: Why it holds — cause and reasoning
- **Evidence**: Concrete observations from the source note. Use inline citation \`[[note title]]\`
- **Open questions**: What remains unknown`}

These are guides. Drop sections that would just be filler. The first paragraph should already deliver the proposition — sections elaborate, not delay.

### Inline citation rule

When citing the source, use **double brackets** with the EXACT note title from the user message:

${ja ? `- ✅ 「[[ZnO 還元実験 2026-04]] では pH 11 で速度が約 2 倍になっている」
- ❌ 「ノートによると…」「先ほどのソースに基づくと…」` : `- ✅ "The rate roughly doubles at pH 11 in [[ZnO reduction 2026-04]]."
- ❌ "According to the note...", "Based on the source above..."`}

Double brackets become clickable links. Generic references that don't name the title break the trace.

### Bad / Good Concepts

- ❌ **Restatement**: A Concept that paraphrases the note in different words. Adds nothing.
- ❌ **Textbook chapter**: A Concept that explains general background the note didn't actually depend on.
- ❌ **Lab-specific log**: A Concept that names specific samples, dates, or instruments — that belongs in the Summary.
- ✅ **Transferable proposition**: A claim of the form "X happens / works / fails when Y, because Z" that another researcher could pick up and apply, with \`[[note title]]\` showing where the evidence came from.

## Merge vs Create

${hasExistingConcepts ? `Existing Concepts are listed below. Before creating a new Concept:
1. If the note EXTENDS an existing Concept → "merge" with that ID. Sections should contain only the **new** content to add, not restate the existing.
2. If the note CONTRADICTS an existing Concept → "create" a new one that addresses the contradiction (don't silently overwrite).
3. If the note provides NEW EVIDENCE for an existing Concept → "merge".
4. Otherwise create new.` : "No existing Concepts yet. Create freely."}

## Existing Wikis

${wikiListText}

## Language

Output in: ${ja ? "Japanese" : "English"}

## Quality Guidelines

- Summary: exactly 1 per note.
- Concepts: 0-3. Quality > quantity. If the note has no transferable claim worth abstracting, generate zero Concepts and just produce the Summary.
- Section content: as long as needed and no longer. A 3-sentence Concept that lands cleanly beats a 10-sentence one with filler.
- relatedConcepts: \`{title, citation}\` pairs for connected existing Concepts. \`citation\` explains the link in one line (e.g., "provides pH-dependency context"). Empty array if none.
- externalReferences: 0-5 per wiki. Prefer stable, well-known URLs. \`citation\` explains what each reference supports.
- confidence: 0.9+ for clear, well-evidenced; 0.6-0.8 for tentative; 0.5 for trivial-note Summaries.
- If the note is too short or trivial, return only a minimal Summary with confidence 0.5 — do not generate Concepts to fill space.${skills && skills.length > 0 ? `

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
      .map((w: any) => {
        const kind: WikiKind = (w.kind === "summary" || w.kind === "concept" || w.kind === "synthesis") ? w.kind : "concept";
        const rawLevel = typeof w.level === "string" ? w.level : undefined;
        const level: ConceptLevel | undefined =
          kind === "concept" && (rawLevel === "principle" || rawLevel === "finding" || rawLevel === "bridge")
            ? rawLevel
            : kind === "concept"
              ? "finding"
              : undefined;
        const rawEvidence = typeof w.evidenceSpan === "string" ? w.evidenceSpan.trim() : "";
        // principle は evidenceSpan 必須。空なら finding に降格させて textbook 流入を防ぐ
        const finalLevel: ConceptLevel | undefined =
          level === "principle" && rawEvidence.length === 0 ? "finding" : level;
        return {
          kind,
          level: finalLevel,
          evidenceSpan: finalLevel === "principle" ? rawEvidence : undefined,
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
        };
      });
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
