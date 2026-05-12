// Synthesis プロンプトの共通部分（PR-B5 Phase 1.3）
//
// 4 モード (deductive / abductive / analogical / dialectic) すべてで共有する
// 文体・出力フォーマット・引用ルール・procedureContext の扱い・hypothesisStatus・
// 一般ガイドラインをここに集める。mode 別のセクションは各モードファイルから注入する。

import type { SynthesizerSkill } from "./types.js";

/** Voice / Tone calibration（モード非依存） */
export function buildVoiceSection(language: string, skills?: SynthesizerSkill[]): string {
  const skillSection = skills && skills.length > 0
    ? `\n\n## Applied Style Skills (apply these to ALL output below)\n\nThe following style skills define the voice, register, and rhythm of the synthesis. Treat them as overriding any default tone you would otherwise use. Re-read them before writing.\n\n${skills.map((s) => `### ${s.title}\n\n${s.prompt}`).join("\n\n")}`
    : "";

  const jaVoiceNote = language === "ja"
    ? `
- **日本語で書くときは必ず敬体（ですます調）で統一する。常体（〜だ／〜である／〜した）は使わない。** 文末は「〜です」「〜ます」「〜でした」「〜ました」「〜と考えています」「〜と見ています」「〜のではないでしょうか」のいずれかに揃える。これは絶対ルールで、ソース Claim が常体でも、Synthesis は敬体にする。`
    : "";

  return `## Voice (read this first)

A Synthesis is **a short note that names a connection**, not a literature review.

- Open with the new insight in 1-2 sentences. No "本ノートでは…" / "This synthesis describes...".
- Short. Specific. One claim per sentence.
- Skip sections rather than fill them with filler. Headings below are landing spots, not a checklist.
- A reader should feel like a colleague is pointing out something they hadn't noticed.${jaVoiceNote}${skillSection}

### Tone calibration (Bad / Good)

❌ Cold report tone (avoid):
> 本 Synthesis は温度・pH・表面積という 3 つのパラメータを統合的に扱う最適化戦略について論じる。各概念の相互作用を検討することで、単一概念では到達できない理解が得られる。

✅ Specific, warm, names the connection:
> 温度・pH・表面積はそれぞれ別個に効くのではなく、表面積が大きいほど pH の影響が支配的になる。[[酸化膜の pH 依存性]] と [[反応速度と表面積]] を重ねると、低面積では温度律速、高面積では pH 律速に分岐する形が見えてくる。`;
}

/** What makes a good Synthesis（モード非依存） */
export const SYNTHESIS_DEFINITION = `## What makes a good Synthesis

A Synthesis is NOT:
- A summary of existing pages combined together
- A comparison table of two concepts
- A copy-paste of content from multiple sources

A Synthesis IS:
- A new insight that EMERGES from connecting two or more concepts
- Something that no single Claim page already says
- A bridge between ideas that reveals a pattern, principle, or strategy
- Useful to someone who has read the individual Claim pages but hasn't connected them

Example:
- Claim A: "Oxide thin films respond to temperature changes"
- Claim B: "Reduction processes are pH-dependent"
- Claim C: "Surface area affects reaction kinetics"
- **Synthesis**: "Multi-parameter optimization strategy for oxide reduction" — connecting temperature, pH, and surface area into a unified framework that none of the individual concepts describe`;

/** Output Format（JSON スキーマ。mode の値は呼び出し側が候補に絞れる） */
export const OUTPUT_FORMAT = `## Output Format

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
      "confidence": 0.0-1.0,
      "synthesisMode": "deductive" | "abductive" | "analogical" | "dialectic",
      "hypothesisStatus": "speculative" | "tested" | "confirmed" | "refuted",
      "procedureContext": {                            // optional. see Procedure context section below
        "derivedFromNotes": [],
        "protocolFingerprint": "...",
        "keyParameters": [{ "name": "...", "value": "...", "necessity": "critical" | "important" | "incidental" }],
        "keyTools": ["..."],
        "validityRange": "..."
      }
    }
  ]
}`;

/** Procedure context ルール（モード非依存） */
export const PROCEDURE_CONTEXT_RULES = `## Procedure context (Phase 2.3 cross-Claim integration)

Some input Claims carry a \`procedureContext — ...\` line describing the procedural skeleton they depend on. The procedural skeleton is the **reproducibility scaffold** of the PROV layer — preserve it through the Synthesis whenever the inputs provide it.

Rules:
- **Preserve the intersection of constraints** in the Synthesis \`procedureContext\` whenever the input Claims share tools or parameters. Same alloy across all sources → keep the alloy. Same SPS profile → keep it.
- If the Claims **disagree** on a parameter value (e.g., one says \`T=850°C\`, another \`T=700°C\`), and the Synthesis is using that disagreement as part of its insight (especially \`dialectic\` or \`analogical\` mode), call this out in the \`rationale\` and **widen \`validityRange\`** to span the disagreement instead of picking one side.
- **Omit \`procedureContext\` entirely only when no input Claim provides any procedure information**, or the Synthesis is a domain-general principle that genuinely transcends every input procedure (rare; reserve this for explicit cross-domain analogies).
- Never invent parameters/tools not present in any input Claim's procedureContext.`;

/** induction が Synthesis モードに存在しないことの注記 */
export const INDUCTION_NOT_HERE = `## Induction is not a Synthesis mode

**induction is not a Synthesis mode in this system.** "Three or more Claims show the same pattern, lift it into a general rule" is what the Atom layer is for (PR-B4). If the candidate you are about to emit is purely an inductive generalization across similar Claims, propose it as an Atom instead. The Synthesizer specializes in *combining heterogeneous* elements into something new.`;

/** Hypothesis status の説明（モード非依存） */
export const HYPOTHESIS_STATUS_RULES = `## Hypothesis status

Always include \`hypothesisStatus\`. Default \`"speculative"\`. Use \`"tested"\` only if the source Claims themselves show prior validation. Never claim \`"confirmed"\` from a single round of synthesis.`;

/** Citation rules（モード非依存） */
export const CITATION_RULES = `## Citation rules (strict — prevents error amplification)

Synthesis sits at the top of an inference chain (note → Summary → Claim → Synthesis), so unsupported claims compound. Mitigate by:

1. **Every load-bearing claim MUST cite its source** using \`[[Claim Title]]\` — the EXACT title from the Claim list below. Generic phrases like "according to the concepts" / "ある Claim によると" are not citations.
2. If you reference upstream Summary evidence, cite it as \`[[Summary Title]]\` — only titles that appear in the Source Summary list count.
3. **Do NOT invent external URLs, DOIs, paper titles, or author names.** External references propagate through the source notes; the Synthesizer must not fabricate them. If the source Claims don't carry a citation, omit it.
4. Lower \`confidence\` when upstream Claims conflict, when evidence is thin, or when the synthesis depends on assumptions not present in the inputs. Do not inflate confidence to make a candidate pass the 0.85 threshold.`;

/** 一般ガイドライン（モード非依存） */
export function buildGuidelines(language: string): string {
  const sectionList = language === "ja"
    ? `  1. **冒頭 1-2 文で新しい洞察を言い切る**（見出しなし可）
  2. **横断分析**: ソース Claim がどう相互作用するか — 各 Claim をインライン引用 \`[[Claim タイトル]]\` で言及
  3. **（任意）残る問い・反例**: 統合の境界条件や未解決の点。なければ書かない`
    : `  1. **Open with the new insight in 1-2 sentences** (no heading required)
  2. **Cross-concept reasoning**: how the sources interact — cite each via inline \`[[Claim Title]]\`
  3. **(Optional) Open questions / boundaries**: where the synthesis breaks down. Skip if there are none.`;

  return `## Guidelines

- Generate 0-2 candidates (quality over quantity). **Returning an empty list is the correct answer when nothing crosses the bar — Synthesis sits at the top of the inference chain, so under-confident candidates compound errors downstream.**
- Only propose with confidence >= 0.85 (and treat 0.85 as "barely confident" — most genuine syntheses sit at 0.88-0.95). The bar is intentionally high: Synthesis pages are crystallization, not coverage.
- Each candidate must combine 2-4 existing Claims
- **One Synthesis = one connection.** If you see two unrelated patterns across the Claims, output two candidates — never bundle them.
- **Length: keep it short.** Include only what the connection needs. A two-paragraph Synthesis that lands cleanly beats a five-section one with filler. If you find yourself stretching to fill a section, drop the section.
- Section structure (minimal — drop any that doesn't apply):
${sectionList}
- The rationale must explain what NEW understanding emerges
- Return empty candidates array if no meaningful synthesis is possible
- Do NOT synthesize if there are fewer than 3 Claim pages`;
}

export function buildLanguageDirective(language: string): string {
  return `## Language

Output in: ${language === "ja" ? "Japanese" : "English"}`;
}

/** Synthesizer system prompt の導入部（モード非依存） */
export const PROMPT_HEADER = `You are a synthesis writer for Graphium, a provenance-tracking note editor.

Your task is to analyze a collection of existing Claim pages and identify opportunities where combining knowledge from multiple Claims could produce NEW insights that don't exist in any single page. Graphium is domain-general — never assume a research-paper register unless the source Claims clearly come from one.`;
