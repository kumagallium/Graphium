// Synthesis プロンプトの共通部分（PR-B5 Phase 1.3）
//
// 4 モード (deductive / abductive / analogical / dialectic) すべてで共有する
// 文体・出力フォーマット・引用ルール・hypothesisStatus・一般ガイドラインを
// ここに集める。mode 別のセクションは各モードファイルから注入する。
// PR-B4.5 で Synthesis は procedureContext を持たない契約になったため、
// 出力スキーマからもプロンプトの procedure ルールからも撤去している。

import type { SynthesizerSkill } from "./types.js";

/** Voice / Tone calibration（モード非依存） */
export function buildVoiceSection(language: string, skills?: SynthesizerSkill[]): string {
  const skillSection = skills && skills.length > 0
    ? `\n\n## Applied Style Skills (apply these to ALL output below)\n\nThe following style skills define the voice, register, and rhythm of the synthesis. Treat them as overriding any default tone you would otherwise use. Re-read them before writing.\n\n${skills.map((s) => `### ${s.title}\n\n${s.prompt}`).join("\n\n")}`
    : "";

  const jaVoiceNote = language === "ja"
    ? `
- **日本語で書くときは必ず敬体（ですます調）で統一する。常体（〜だ／〜である／〜した）は、タイトル・本文・見出し・例示・引用直前のどこでも使わない。** 文末は「〜です」「〜ます」「〜でした」「〜ました」「〜と考えています」「〜と見ています」「〜のではないでしょうか」「〜のように見えてきます」のいずれかに揃える。これは絶対ルールで、ソース Claim が常体でも、Synthesis は敬体にする。
- **タイトルも敬体寄りでよい。** 体言止めだけにこだわらず、必要なら語尾まで読める形（「〜は〜を〜します」「〜が〜に〜してきます」）にする。タイトルだけ常体・本文だけ敬体、という温度差は避ける。`
    : "";

  return `## Voice (read this first)

A Synthesis is **a short note that names a connection**, not a literature review.

- Open with the new insight in 1-2 sentences. No "本ノートでは…" / "This synthesis describes...".
- Short. Specific. One claim per sentence.
- Skip sections rather than fill them with filler. Headings below are landing spots, not a checklist.
- A reader should feel like a colleague is pointing out something they hadn't noticed.${jaVoiceNote}${skillSection}

### Plain-language register (REQUIRED)

The connection should be visible on the first read, not after a second pass. The same plainness applies to title and body:

- Prefer everyday verbs over nominalized academic predicates. "支配的な影響を与える" → "強く効いてくる", "統合的に扱う" → "重ねて考える", "顕著に変化する" → "目に見えて変わる".
- Prefer concrete nouns over stacked kanji compounds. "多変量最適化戦略" → "複数の条件をまとめて整える進め方", "相互作用構造" → "互いの効き方".
- Don't stack 4+ kanji compounds in a row. If three abstract nouns collide ("構造的なバルク特性"), unpack one of them ("合金全体の構造的な性質").
- The opening sentence should be re-tellable out loud. If you wouldn't say it that way to a colleague, simplify the words — but **do not** re-add specific names that the source Claims already abstracted away.

This is style only; it does not lower the precision bar. The connection still has to name a real, specific bridge between the source Claims.

### Subject – relation – effect clarity (REQUIRED)

Every title and every sentence must make three things obvious:

1. **What** is acting or changing (subject).
2. **What it acts on or relates to** (object / counterpart).
3. **What the effect or relation is** (a concrete verb, or an explicit "X does not change Y").

Empty predicates ("関連する", "影響する", "重要である" with no object) are the most common failure. Rewrite them. If you can't say what acts on what with a concrete verb, the candidate isn't a Synthesis — drop it.

### Tone calibration (Bad / Good — three rungs)

❌ Cold report tone (avoid):
> 本 Synthesis は温度・pH・表面積という 3 つのパラメータを統合的に扱う最適化戦略について論じる。各概念の相互作用を検討することで、単一概念では到達できない理解が得られる。

⚠️ Still off — names the connection but in academic register:
> 温度・pH・表面積はそれぞれ別個に効くのではなく、表面積が大きいほど pH の影響が支配的になる。[[酸化膜の pH 依存性]] と [[反応速度と表面積]] を重ねると、低面積では温度律速、高面積では pH 律速に分岐する形が見えてくる。
>
> Why off: "支配的になる" / "温度律速" / "pH 律速" are domain-correct but heavy. A reader who hasn't seen those phrases stalls on the wording instead of seeing the connection.

✅ Specific, plain register, names the connection:
> 温度・pH・表面積はそれぞれ単独で効くのではなく、表面積が大きくなるほど pH の効き方の方が強く出てきます。[[酸化膜の pH 依存性]] と [[反応速度と表面積]] を重ねると、表面積が小さいうちは温度で決まり、大きくなると pH で決まる、という分かれ方が見えてきます。
>
> Why good: same connection, but each chunk is something a non-specialist can picture. Subject (表面積) / object (pH と温度の効き方) / verb (強く出てくる・決まる) are explicit, and the whole passage is 敬体 — including the opening sentence.`;
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
      "title": "Synthesis page title — plain everyday wording, subject-relation-effect explicit, 敬体 if Japanese",
      "sections": [
        { "heading": "Section heading", "content": "Section content" }
      ],
      "rationale": "Why this synthesis adds value beyond the individual concepts",
      "confidence": 0.0-1.0,
      "synthesisMode": "deductive" | "abductive" | "analogical" | "dialectic",
      "hypothesisStatus": "speculative" | "tested" | "confirmed" | "refuted"
    }
  ]
}`;

/** PR-B4.5: Synthesis は procedureContext を持たない契約 */
export const SYNTHESIS_NO_PROCEDURE_CONTEXT = `## What Synthesis does NOT carry: procedureContext

Like Atom, the Synthesis layer is **procedure-independent by contract**. Source Claims may carry a \`procedureContext\` documenting the procedure they depend on, but a Synthesis re-combines context-stripped insights — it should not bind itself back to a specific procedural regime. Reproducibility lives at the Claim layer; \`derivedFromNotes\` lets a reader walk back when they need it.

If the candidate Synthesis only makes sense under a specific procedural regime, that is a signal the candidate is closer to a re-stated Claim than a genuine cross-Claim insight. Either widen it or drop it.`;

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
4. Lower \`confidence\` when upstream Claims conflict, when evidence is thin, or when the synthesis depends on assumptions not present in the inputs. Do not inflate confidence to make a candidate pass the per-mode threshold (deductive 0.92 / others 0.70).`;

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

- Generate 0-4 candidates (quality over quantity, but **don't artificially cap at 1-2 when multiple genuine connections exist**). Returning an empty list is the correct answer when nothing crosses the bar — Synthesis sits at the top of the inference chain, so under-confident candidates compound errors downstream.
- Confidence thresholds are **per-mode**:
  - \`deductive\` requires \`confidence >= 0.92\` (this is the most permissive mode and tends to "merge whatever fits", so the bar is intentionally high)
  - \`abductive\` / \`analogical\` / \`dialectic\` require \`confidence >= 0.70\` (these modes have firing conditions enforced upstream by the router, so the structural bar is already there; the score bar can be lower)
  - Treat the per-mode threshold as "barely confident" — most genuine syntheses sit well above. Inflating confidence to pass is dishonest.
- Each candidate must combine 2-4 existing Claims
- **One Synthesis = one connection.** If you see two unrelated patterns across the Claims, output two candidates — never bundle them.
- **Mode diversity preference (Phase synth-diversity).** If you produce 2+ candidates and the router offered multiple candidate modes, **prefer covering different modes** rather than emitting two candidates in the same mode. Two abductive-mode Syntheses on the same Atom set rarely tell the reader more than one — but one abductive + one analogical (or + dialectic) surfaces structurally different connections. Same-mode duplicates should be dropped or merged.
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
