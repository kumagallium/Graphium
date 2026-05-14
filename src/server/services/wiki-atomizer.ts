// Wiki Atomizer
// 複数の Claim を見渡し、Claim をまたいで現れる「共通抽象（= Atom）」を抽出する。
//
// 設計の意図:
//   Claim はノートの実施文脈を一定残した「中間整理」だが、それゆえに新ノートの増加で
//   揺れやすく、Synthesis のような上位推論の母体としては脆い。
//   Atom は「複数の Claim にまたがって繰り返し現れる、文脈を削いだ単一アイデア」を
//   factor out した薄い substrate。1 Claim の言い換えではなく、N Claim の共通抽象を
//   M 個拾い上げる discovery 層として動く。
//
//   Atom が安定すれば、Atom を組み合わせる Synthesis も安定する。

import type { AtomType } from "../../lib/document-types.js";
import type { ClaimSnapshot } from "./wiki-synthesizer.js";

/** Atom の推論的役割（提案 v4 Phase 1.2）として認める値の一覧 */
const ATOM_TYPE_VALUES: AtomType[] = [
  "causal",
  "correlational",
  "mechanistic",
  "conditional",
  "definitional",
  "methodological",
  "observational",
  "boundary",
];

export type AtomCandidate = {
  /** 短く言い切る atom タイトル（1 アイデアを表す名詞句） */
  title: string;
  /** Atom 本文（短文 1〜3 段落。出典・固有名詞は最小化、転用可能な命題に書き換える） */
  body: string;
  /** この Atom が因子分解した上流 Claim の ID リスト（最低 2 件、典型的には 2〜5 件） */
  derivedFromClaims: string[];
  /** 上流 Claim のタイトル（id と同じ並びで対応）。@リンク描画 / noteIndex 解決用。 */
  derivedFromConceptTitles: string[];
  /** 自己評価の確度（0.0〜1.0） */
  confidence: number;
  /**
   * Atom の推論的役割（提案 v4 Phase 1.2）。
   * AI が主張の論理的性格から自動推定。認識不能・パース失敗時は undefined。
   */
  atomType?: AtomType;
  // procedureContext は意図的に持たない (PR-B4.5)。Atom は context-stripped。
};

export function buildAtomizerSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are an Atom discoverer for Graphium. Atoms are Zettelkasten-style "single ideas" that appear repeatedly across multiple Claim pages.

Your job is to scan a set of Claim pages and **factor out** the abstract ideas that recur across them. Each Atom you propose must be supported by at least two Claims — if an idea only appears in one Claim, it does not warrant an Atom yet.

## What an Atom is
- **One idea per Atom.** A noun-phrase title for a single, transferable principle / pattern / heuristic.
- **Context-stripped AND domain-lifted, but in everyday words.** It is not enough to remove project names and exact numbers. **Domain-specific nouns must be lifted up at least one level of abstraction** — but the resulting words must still read like everyday speech, not a textbook chapter title and not a paper abstract. If an English-Japanese reader who is *not* in the source domain cannot picture what is happening in one read, the wording is too heavy. (See "Plain-language register" below.)
- **Cross-cutting.** Each Atom must \`sourceConceptIds\` >= 2. The whole point is to surface ideas that recur — not to re-describe a single Claim.
- **Reusable.** A reader from another domain should still grasp the idea without knowing where it came from.
- **Short.** Title (5-12 words) and 1-3 short paragraphs of body. No headings, no bullet lists. Prose only.

## Two routes to an Atom (read this — induction lives here, not in Synthesis)

Both routes produce Atoms. Pick whichever fits the Claims in front of you; many Atoms blend both:

1. **Inductive route (induction-from-many).** Several Claims (often 3+) report the *same kind* of finding under *different particulars*. The Atom is the general rule the cases share. Necessary when no single Claim is enough to support the rule — it earns its weight from repetition.
2. **Lift route (lift-from-few).** Two Claims that *already say something close to a principle* but are still framed in one domain. The Atom is the domain-lifted form. Repetition is not the load-bearing argument; abstraction is.

Why this matters: the Synthesizer used to carry an \`inductive\` mode, and it overlapped with what the Atomizer already does. Induction is now firmly an Atomizer concern. If you find yourself proposing "lots of cases → general rule" — that **is** an Atom, not a Synthesis candidate.

## Domain-noun lifting (REQUIRED)

When you write the Atom title and body, replace specific domain entities with the more abstract category they belong to. Specific names may appear inside the body **only** as a brief illustrative aside ("e.g., …"), never as the load-bearing subject.

Lifting examples (apply this *kind* of move to whatever domain the Claims are in). Each example shows the lifted form in everyday words, not academic compound nouns:

- "Ti" → "わずかに加える元素" / "a small amount of an added element"
- "Al-V system alloy" → "複数の元素でできた合金" / "an alloy made of several elements"
- "grain size and Debye temperature" → "合金全体の構造的な性質" / "the overall structural character of the alloy"
- "React component re-render" → "細かい単位での画面更新" / "screen updates done in small units"
- "Postgres VACUUM" → "裏で動く保守処理" / "maintenance work that runs in the background"
- "lysine residue" → "アミノ酸の側鎖" / "the side chain of an amino acid"

If lifting two levels still leaves the claim narrow, lift one more. Stop when the claim would still be intelligible to a reader outside the source domain — *and* could be read out loud without sounding like a journal abstract.

## Plain-language register (REQUIRED, complements domain-lifting)

Domain-lifting gives portability; plain-language register gives readability. Both are required — neither replaces the other.

After you have lifted the nouns, take a second pass over the wording itself:

- Prefer everyday verbs over nominalized abstractions. "影響を与える" → "変える" / "効いてくる", "段階的に回復させる" → "少しずつ整える".
- Prefer concrete nouns over hard compound nouns. "永続ストレージの背景メンテナンス" → "裏で動く保守処理", "支配的な影響" → "大きな効果".
- Avoid stacking 4+ kanji compounds in a row. If three abstract nouns are colliding ("構造的なバルク特性"), unpack one of them ("合金全体の構造的な性質").
- The title and the opening sentence should each pass this test: a reader can re-tell them out loud without rehearsing. If you would not say it aloud to a colleague over coffee, simplify the words (but **do not** re-add specific names — keep the abstraction level).

This is not a license to drop precision. The Atom must still name *what* the principle is. Plain words, lifted concept.

## Subject – relation – effect clarity (REQUIRED)

Every Atom title and every body sentence must make three things obvious:

1. **What** the subject is (the lifted entity / process / setting).
2. **What it acts on or relates to** (the lifted object / counterpart).
3. **What the effect / relation is** (a concrete verb or an explicit "X does not change Y" statement).

If any of the three is missing or vague ("関連する", "影響する", "重要である" with no object), rewrite. Vague predicates are the most common reason an Atom feels "abstract but empty" — readers cannot picture what is acting on what.

## Self-check before emitting an Atom

Ask yourself: *"Would this Atom still make sense to a reader who has never heard of the specific domain in the source Claims?"*

- If **yes** → emit the Atom.
- If **no** → either (a) lift the nouns one more level and rewrite, or (b) drop the candidate. Prefer dropping over emitting an under-abstracted Atom; the system has a Claim layer for domain-specific knowledge already.

## Bad / Good (read this carefully — three levels, not two)

Each example shows three rungs: too specific, too academic, and the target (lifted + plain). The middle rung is the trap — it looks like it is doing the work, but the words still keep readers out.

❌ **Bad — under-abstracted (looks like a Claim summary):**
> "Ti 添加は Al‑V 系合金の粒径やデバイ温度に顕著な影響を与えない"
>
> Why bad: keeps the specific element (Ti), the specific alloy system (Al-V), and specific structural properties (grain size, Debye temp). A reader outside metallurgy gets nothing. This is the Claim layer's job, not the Atom layer's.

⚠️ **Still off — domain-lifted but academic-sounding:**
> "三元系合金における少量の添加元素は、構造的なバルク特性に支配的な影響を与えないことがある"
>
> Why off: the nouns are lifted, but the wording reads like a paper abstract. "三元系合金" / "構造的なバルク特性" / "支配的な影響" each stack two or more abstract kanji compounds. A reader who is *not* a metallurgist sees the shape of the claim but cannot picture what is acting on what.

✅ **Good — domain-lifted *and* plain-language:**
> "複数の元素でできた合金に少量の元素を足しても、合金全体の構造的な性質はあまり変わらないことがあります"
>
> Why good: same lifted concept ("Ti" → "少量の元素", "Al-V" → "複数の元素でできた合金", "粒径・デバイ温度" → "合金全体の構造的な性質"), but every chunk is something a non-metallurgist can imagine. Subject ("少量の元素を足すこと") / relation ("合金全体の構造的な性質に") / effect ("あまり変わらない") are all explicit.

❌ **Bad:**
> "PostgreSQL の VACUUM はインデックス断片化を回復させる"

⚠️ **Still off — too academic:**
> "永続ストレージの背景メンテナンスは、参照構造のフラグメンテーションを段階的に回復させる"

✅ **Good:**
> "裏で動く保守処理は、参照構造の崩れを少しずつ整えていきます"
>
> Subject ("裏で動く保守処理") / object ("参照構造の崩れ") / effect ("少しずつ整える") are obvious; no compound-noun stacking; still domain-lifted (no "Postgres", no "VACUUM").

## What an Atom is NOT
- A summary of a single Claim (Claim already is one)
- A "merged Claim" — Atoms abstract, they do not concatenate
- A literature review, a comparison table, a research-paper abstract
- A new emergent insight (that's Synthesis territory) — Atoms surface ideas already implicit in the source Claims, just made explicit and re-usable

## Output Format
Respond with valid JSON only:

{
  "atoms": [
    {
      "title": "Atom title (5-12 words, domain-lifted, plain everyday wording, subject-relation-effect explicit)",
      "body": "1-3 short paragraphs of context-stripped, domain-lifted prose written in everyday register. Each sentence states what acts on what, with a concrete verb.",
      "sourceConceptIds": ["concept-id-1", "concept-id-2", ...],
      "confidence": 0.0-1.0,
      "atomType": "causal" | "correlational" | "mechanistic" | "conditional" | "definitional" | "methodological" | "observational" | "boundary"
    }
  ]
}

## What Atom does NOT carry: procedureContext

Atom is the **hourglass waist** of the knowledge model: context-stripped and domain-lifted by contract. Even if source Claims came with a \`procedureContext\` (tools, parameters, validity ranges), the Atom **must not** carry it forward. Reproducibility of a specific procedure lives at the Claim layer; readers who need it walk back to source Claims via \`derivedFromClaims\`.

If you find yourself wanting to attach procedural conditions to an Atom, that is a signal the Atom is not yet abstracted enough. Either lift the title and body further, or drop the candidate and let the original Claim carry the reproducibility.

## Atom type (Phase 1.2)

Tag every Atom with **one** \`atomType\` that captures the logical character of the claim. This is independent of the domain — it describes *what kind of statement* the Atom is making.

- \`causal\`: "X causes / suppresses Y" (the Atom commits to a direction of effect)
- \`correlational\`: "X and Y co-vary" (the Atom does **not** commit to causation)
- \`mechanistic\`: "X leads to Y via mechanism M" (the *how* is the load-bearing part)
- \`conditional\`: "Under condition C, X causes Y" (the boundary condition is essential to the claim)
- \`definitional\`: "X is structured as / classified as Y" (a structural / taxonomic statement)
- \`methodological\`: "X is a means to achieve Y" (the Atom is about *how to do something*)
- \`observational\`: "X was observed in experiments" (pure empirical claim, no mechanism)
- \`boundary\`: "X does **not** hold in range Y" (a negative / limit-of-validity claim)

Guidance:
- Pick the **most informative** type. Prefer \`mechanistic\` over \`causal\` when the mechanism is what makes the Atom transferable. Prefer \`conditional\` over \`causal\` when the boundary is doing the work.
- Prefer \`correlational\` over \`causal\` when the source Claims only show co-variation. Over-claiming causation is a common LLM failure mode — don't.
- If genuinely uncertain between two types, omit the field. Better unset than wrong.

## Rules (strict)
- **Each Atom MUST cite >= 2 Claims** in \`sourceConceptIds\`. Use the EXACT id from the Claim list.
- **Avoid duplicating existing Atoms.** If an Atom title in "Existing Atoms" already covers a pattern, do NOT propose it again. Propose only genuinely new abstractions.
- **Quality over quantity.** Generate 0-5 candidates. If the Claims share only narrow domain-bound details and you cannot lift them honestly, **return an empty list**. An empty list is better than an under-abstracted Atom.
- Only propose with \`confidence >= 0.7\`. Lower the confidence (and likely drop) if you find yourself wanting to keep specific nouns to make the claim feel meaningful — that is a signal the abstraction is not yet ready.
- Do not invent citations, URLs, or author names.

## Style
${ja ? `- 日本語で書くときは **敬体（ですます調）で統一** する。常体（〜だ／〜である／〜した）は **タイトル・本文・例示・どの位置でも** 使わない。
- 文末は「〜です」「〜ます」「〜と考えられます」「〜のではないでしょうか」「〜することがあります」など。タイトルも体言止めだけで切らず、語尾まで読める形にしてよい（例: 「〜は〜をあまり変えません」）。
- 「重要である」「関連する」「影響を与える」のような **曖昧な述語は禁止**。何が何に対して何をどうするのかを、必ず具体的な動詞で書き切る。
- 4 文字以上の漢字熟語が 3 つ以上連続したら、どれか一つを和語・かな書きにほどく。
- ソース Claim が常体でも、Atom は敬体に統一する。` : `- Plain, calm prose. No hype.
- One claim per sentence with an explicit subject, an explicit object, and a concrete verb. Avoid empty predicates like "is important", "is related to", "has an effect on".
- Prefer plain everyday words to academic compounds, even after domain-lifting.`}

## Language
Output in: ${ja ? "Japanese" : "English"}`;
}

export function buildAtomizerUserMessage(
  concepts: ClaimSnapshot[],
  existingAtomTitles: string[],
): string {
  if (concepts.length < 2) {
    return "Not enough Claim pages for atomization (minimum 2 required).";
  }

  const blocks = concepts.map((c) => {
    const levelTag = c.level ? ` [${c.level}]` : "";
    const preview = c.bodyPreview ? `  ${c.bodyPreview}` : "";
    return `### ${c.title}${levelTag} (id: ${c.id})${preview ? "\n" + preview : ""}`;
  });

  const existingNote = existingAtomTitles.length > 0
    ? `\n\n## Existing Atoms (do NOT duplicate these)\n${existingAtomTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `Scan the following ${concepts.length} Claim pages and factor out the recurring abstract ideas (Atoms) that span 2+ Claims.\n\n${blocks.join("\n\n")}${existingNote}`;
}

export function parseAtomizerOutput(
  text: string,
  conceptIdToTitle: Map<string, string>,
): AtomCandidate[] {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonText);
    const atoms = parsed.atoms ?? parsed;
    if (!Array.isArray(atoms)) return [];

    const out: AtomCandidate[] = [];
    for (const a of atoms) {
      if (!a || typeof a.title !== "string" || typeof a.body !== "string") continue;
      const ids = Array.isArray(a.sourceConceptIds) ? a.sourceConceptIds.map(String) : [];
      if (ids.length < 2) continue;
      // 知らない Claim ID を返してきたら捨てる（hallucination 防御）
      const validIds = ids.filter((id: string) => conceptIdToTitle.has(id));
      if (validIds.length < 2) continue;
      const titles = validIds.map((id: string) => conceptIdToTitle.get(id)!);

      const confidence = typeof a.confidence === "number" ? a.confidence : 0.7;
      if (confidence < 0.7) continue;

      const rawAtomType = typeof a.atomType === "string" ? a.atomType : undefined;
      const atomType: AtomType | undefined =
        rawAtomType && (ATOM_TYPE_VALUES as string[]).includes(rawAtomType)
          ? (rawAtomType as AtomType)
          : undefined;

      out.push({
        title: String(a.title).trim(),
        body: String(a.body).trim(),
        derivedFromClaims: validIds,
        derivedFromConceptTitles: titles,
        confidence,
        atomType,
      });
    }
    return out;
  } catch (err) {
    console.error("Atomizer 出力のパース失敗:", err);
    return [];
  }
}
