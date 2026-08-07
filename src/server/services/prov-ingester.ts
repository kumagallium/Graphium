// PROV Ingester
// URL から取得したテキストを LLM に渡し、
// Graphium の PROV グラフ自動生成と整合する階層ブロック構造を作らせる。
//
// 重要: Graphium の prov-generator は以下の規則でグラフを作る（generator.ts 参照）:
//   - H2 見出しに role: "procedure" → prov:Activity（ステップ）
//   - その H2 スコープ内にある role: "material" | "tool" → prov:used（Activity から）
//   - その H2 スコープ内にある role: "output" → prov:wasGeneratedBy（Activity から）
//   - role: "attribute" は最も近い祖先の material/tool/output に埋め込み、無ければ Activity に埋め込み
//   - informed_by リンク（次手順→前手順）で手順間を繋ぐと「前手順の結果を次手順が used」になる
//
// 平坦な出力では graph が繋がらない。LLM には階層構造 + 依存関係を出させる。
//
// NOTE (Phase A): 旧 role "result" は内部キー再編で "output"（Output Entity 意味）に変更。
//   後方互換のため、ingester は LLM 出力の "result" も受け入れて "output" に正規化する。

import { jsonrepair } from "jsonrepair";

export type ProvRole = "material" | "procedure" | "tool" | "attribute" | "output";

export type ProvBlockType = "paragraph" | "heading" | "bulletListItem" | "numberedListItem";

/**
 * Phase F (2026-05-07): 散文段落の中で個々の語句にインラインハイライトを当てるための
 * spans 表現。1 段落 = 複数 span の連なり。role を持つ span だけがインラインハイライト
 * の対象（material / tool / attribute / output）。
 */
export type ProvSpan = {
  text: string;
  /** material / tool / attribute / output。procedure は span には書かない（block-level） */
  role?: ProvRole;
  /** material / tool span が前手順 X の成果物であれば stepId を指す */
  derivedFrom?: string;
};

export type ProvIngesterBlock = {
  /** 単一テキスト（heading、または span 表現を使わない旧形式） */
  text?: string;
  /**
   * 散文の本文を span の連なりで表現する。span 単位で role を当てて
   * インラインハイライト化する。paragraph / bulletListItem / numberedListItem で使う。
   * heading では使わない（heading は text を使う）。
   */
  content?: ProvSpan[];
  /** procedure heading 専用の block-level role（span 表現には書かない） */
  role?: ProvRole;
  blockType?: ProvBlockType;
  /** heading の場合のレベル（1-3） */
  level?: 1 | 2 | 3;
  /** ネスト構造。bullet の入れ子 = Graphium の block.children に対応 */
  children?: ProvIngesterBlock[];
  /**
   * procedure heading 専用: その手順を参照する一意 ID（英数ハイフン）。
   * 他の span / procedure の derivedFrom / dependsOn から参照される。
   */
  stepId?: string;
  /**
   * 旧 schema 互換: block-level に role + derivedFrom を直接書いていた時代の互換フィールド。
   * 新 schema では span の derivedFrom を使う。
   */
  derivedFrom?: string;
  /**
   * procedure heading 専用: この手順が明示的に依存する前手順の stepId リスト。
   * 材料として書きにくい暗黙の引き継ぎ（「前手順の仕上がりをそのまま使う」）を表す。
   */
  dependsOn?: string[];
};

export type ProvIngesterOutput = {
  title: string;
  blocks: ProvIngesterBlock[];
};

const VALID_ROLES: ProvRole[] = ["material", "procedure", "tool", "attribute", "output"];
const VALID_BLOCK_TYPES: ProvBlockType[] = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
];
const MAX_DEPTH = 4;
const STEP_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * PROV Ingester 用システムプロンプト
 *
 * 階層構造（H2 procedure / 配下 material / ネスト attribute）に加え、
 * stepId / derivedFrom / dependsOn で手順間の実質的な依存関係を LLM に判定させる。
 */
export function buildProvIngesterSystemPrompt(language: string): string {
  const isJa = language === "ja";

  return `You are a PROV-DM structural analyzer for Graphium, a provenance-tracking note editor.

Your task: read a webpage's text — typically **structured procedural content** (cooking recipe, laboratory protocol, manufacturing instruction, fabrication guide, etc.) — and output a **prose document with inline-highlighted spans** plus explicit step dependency links, so Graphium can build a correct PROV-DM graph.

The same template works for any procedural domain: the abstract shape (inputs → operations → outputs) is identical whether the subject is a dish, a chemical synthesis, a circuit assembly, or a data pipeline. Use the same JSON schema regardless of domain; only the vocabulary and examples differ.

## Output contract — read FIRST (most important constraint)

The output is **a JSON document whose \`blocks\` array alternates H2 procedure headings with paragraph blocks that contain the actual content as inline-role spans**. A bare list of H2 headings without paragraph blocks under them is **NOT a valid output** — it carries zero PROV information and will be rejected.

Concretely, after every \`{"blockType":"heading", "level":2, "role":"procedure", ...}\` block, you MUST emit at least one \`{"blockType":"paragraph", "content":[ ... spans ... ]}\` block whose \`content\` includes inline spans with roles (\`material\` / \`tool\` / \`attribute\` / \`output\`). Two consecutive H2 procedures with nothing between them is forbidden.

If a step legitimately has no role-bearing content (no inputs, no tools, no outputs), **drop the step** — do NOT emit a bare H2 heading for it. The headings are not a table of contents; they are the spine that paragraphs hang from.

## Critical: How Graphium builds the PROV graph

Graphium derives the graph from (1) block order, (2) heading hierarchy, (3) **inline span roles inside paragraphs**, and (4) dependency links you declare:

- An **H2 heading with role: "procedure"** becomes a **prov:Activity** (a step) and opens a scope.
- Inside that H2 scope, the prose paragraphs that follow contain **inline spans** with role:
  - span role: "material" / "tool" → Activity \`prov:used\` Entity
  - span role: "output" → Entity \`prov:wasGeneratedBy\` Activity
  - span role: "attribute" → attaches to its nearest material/tool/output Entity in the same step, else to the enclosing Activity.
- **A material span with \`derivedFrom: "<stepId>"\`** tells Graphium: "this material is the product of that prior step." Graphium will link **step-containing-this-span \`wasInformedBy\` <stepId>**.
- **A procedure with \`dependsOn: ["<stepId>", ...]\`** tells Graphium this step extends those prior steps. Same \`wasInformedBy\` link is produced.

Without \`derivedFrom\` / \`dependsOn\`, steps remain disconnected — so **always populate these whenever a step actually consumes a prior step's product**.

## Phase F (2026-05-07): prose with inline-highlighted spans

The wire format produces **prose paragraphs** whose body is a list of \`content\` spans. Each span may carry a role; only role-bearing spans get an inline highlight in Graphium. Plain narrative text is just a span without a role.

Do NOT emit a separate bulletListItem block for every ingredient or condition. The procedure paragraph itself describes the action and embeds the materials / tools / attributes / outputs as inline spans. This reads like a natural protocol or recipe paragraph — not a checklist.

## Output Format

Respond with valid JSON only (no markdown wrapper, no prose outside JSON):

{
  "title": "string — concise note title",
  "blocks": [ /* array of Block */ ]
}

Block schema:

{
  // headings use flat text:
  "text": "string — heading text",                  // for blockType "heading" only
  "blockType": "heading" | "paragraph" | "bulletListItem" | "numberedListItem",
  "level": 1 | 2 | 3,                                // only when blockType === "heading"

  // body blocks (paragraph / bulletListItem / numberedListItem) use content spans:
  "content": [
    { "text": "plain narrative …" },
    { "text": "olive oil", "role": "material" },
    { "text": " over ", },
    { "text": "low heat", "role": "attribute" },
    { "text": ".", }
  ],

  // --- heading only ---
  "role": "procedure",                               // ONLY for H2 procedure headings
  "stepId": "kebab-case-id",                         // REQUIRED for every role:"procedure" H2
  "dependsOn": ["<stepId>", ...],                    // optional — prior steps this step extends

  "children": [ /* nested Block array, same schema */ ]   // optional
}

Span schema (entries inside \`content\`):

{
  "text": "string — the literal phrase as it appears in prose",
  "role": "material" | "tool" | "attribute" | "output",   // optional; omit for plain narrative text
  "derivedFrom": "<stepId>"                                // optional, only on material / tool spans
}

## Role definitions (use these EXACT lowercase internal keys, regardless of domain)

- **procedure** (block-level on an H2 heading only): an action / step / operation. Carries a \`stepId\`.
  Cooking: "sauté garlic" · Lab: "run cyclic voltammetry" · Manufacturing: "anneal at 400°C".
- **material** (span inside paragraph): a substance that **becomes part of the product** of this step — it is consumed, transformed, or integrated into what the step generates. Includes precursors, reagents, raw ingredients, intermediate samples, input datasets, prior-step products.
  If it is the product of an earlier step, add \`derivedFrom\` to the span.
- **tool** (span): an instrument or apparatus that **facilitates the operation without becoming part of the product**. It stays separate from what is being produced and is typically reusable across runs. Examples: pan, oven, mold, crucible, tube, potentiostat, XRD, compiler, sealing fixture.
  **Edge cases — read carefully:**
  - A **quench medium** (ice water, oil, liquid nitrogen — anything the sample is dunked into to cool it and then removed from) is a **tool**, not a material: the cooling fluid does not end up in the final product.
  - An **anti-contamination coating** (e.g., BN layers sprayed onto a die to prevent current leakage, parchment paper under cookies) is a **tool** for the apparatus, not a material that joins the product.
  - A **container or carrier** (silica tube holding the sample, crucible holding the powder, baking tray holding the dough) is a **tool**.
  - Test: "Does this substance end up inside the thing the step produces?" Yes → material. No → tool.
- **attribute** (span): a parameter / condition / specification (quantity, concentration, temperature, time, pH, voltage, scan rate).
- **output** (span): an output produced by the step (finished dish, characterization spectrum, measurement value, fabricated device, refined dataset).

Do NOT translate these keys. Do NOT wrap in brackets. Do NOT invent new roles. **Do NOT put procedure on a span** — procedure lives only on the H2 heading block.

## Atomicity rule (CRITICAL — every node represents ONE concept)

Each role-bearing node — whether an H2 procedure or a role-tagged span — MUST represent a single atomic concept. The graph collapses to noise when one node tries to mean two things at once.

- **Activity (H2 procedure heading)**: **a single gerund verb (\`-ing\`) — only the verb, no object, no modifier, no continuation**. The heading text MUST be one gerund word (or a multi-word gerund verb name like \`"Spark plasma sintering"\`) and nothing else. It MUST NOT contain objects (\`"the garlic"\`, \`"BN layers"\`, \`"ingot"\`), prepositional phrases (\`"in fused silica tubes"\`, \`"into powder"\`), or conjunctions (\`"and"\`, \`"&"\`, \`"、"\`, \`","\`, \`"+"\`, \`"then"\`, \`"plus"\`).
  - ✅ \`"Sealing"\`, \`"Quenching"\`, \`"Annealing"\`, \`"Crushing"\`, \`"Weighing"\`, \`"Spark plasma sintering"\` (compound verb name — OK), \`"Slicing"\`, \`"Training"\`
  - ❌ \`"Sealing in fused silica tubes"\` → \`"Sealing"\` (object/PP goes into the paragraph spans, not the heading)
  - ❌ \`"Annealing ingot"\` → \`"Annealing"\` (the ingot becomes a \`material\` span in the paragraph)
  - ❌ \`"Crushing into powder"\` → \`"Crushing"\` (powder is a material output span)
  - ❌ \`"Load and seal"\` → split into two H2s: \`"Loading"\` and \`"Sealing"\` (or drop \`"Loading"\` if it has no own inputs/outputs)
  - ❌ \`"Melt and quench"\` → \`"Melting"\` + \`"Quenching"\`
  - ❌ \`"Crush, coat, and sinter"\` → \`"Crushing"\` + \`"Coating"\` + \`"Sintering"\`
  - ❌ \`"Mix and heat"\` → \`"Mixing"\` + \`"Heating"\`
  Drop any sub-action that has no own role-bearing spans rather than merging it into a sibling.
- **material / tool / output spans**: one substance / instrument / product per span. Never "salt and pepper" as a single material span — emit two adjacent spans \`{"text":"salt","role":"material"}\` and \`{"text":"pepper","role":"material"}\` with the joining word ("and", "や", "、") as a plain narrative span between them.
- **attribute spans**: one parameter per span. Combine values only when the source itself groups them ("100, 200, and 300 °C" stays one span); separate parameters ("100 °C, 1 hour") become two spans. **ALWAYS use the \`<key>: <value>\` format** (e.g., \`"temperature: 80 °C"\`, \`"purity: 99.999%"\`, \`"form: shot"\`, \`"atmosphere: vacuum"\`, \`"learning_rate: 0.001"\`). Even when the source gives only a bare value, infer a key from context: \`"shot"\` → \`"form: shot"\`, \`"99.999%"\` → \`"purity: 99.999%"\`, \`"under vacuum"\` → \`"atmosphere: vacuum"\`, \`"in argon"\` → \`"atmosphere: argon"\`. See "Object descriptors → attribute spans" below for the recommended key vocabulary.
- **No role on punctuation, whitespace, or symbol-only spans.** Commas, periods, parentheses, "、", "。", "(", ")", em-dashes, and bare spaces never carry a role — they would create ghost graph nodes that mean nothing. Punctuation lives in plain narrative spans between role-bearing spans. Example: write \`{"text":"olive oil","role":"material"}, {"text":", "}, {"text":"garlic","role":"material"}\`, NOT a comma-tagged material span between them.

Span concatenation rule still applies: stitching all \`text\` fields back together must reproduce the original prose. Use plain narrative spans for connectors so the sentence stays readable.

## Material vs Attribute split (CRITICAL — what is a thing vs. what describes a thing)

Source prose often glues a substance to its descriptor — "an aluminum chip", "powdered sugar", "frozen peas", "200 mg of KCl pellet", "1 cm sliced bamboo". Treat the substance itself as **material** and every descriptor (form / shape / state / quantity / dimension / purity / temperature) as a separate **attribute** span.

Heuristic: ask "what is the noun that names the underlying substance or object?" — that is the material. Anything that further constrains it (how much, what shape, what condition, which grade) is an attribute.

Examples (apply across any domain):

- "an aluminum chip" → material span \`"aluminum"\` + plain " " + attribute span \`"chip"\`. NOT one material span "aluminum chip" — that conflates substance identity with its physical form.
- "100 mg of high-purity NaCl powder" → attribute "100 mg" + material "NaCl" + attribute "high-purity" + attribute "powder".
- "1 cm sliced boiled bamboo" → material "bamboo" + attribute "1 cm" + attribute "sliced" + attribute "boiled" (or, if the slicing is the literal product of an earlier step, use a single material span "sliced boiled bamboo" with \`derivedFrom\` — see derivedFrom rules below).
- "thinly sliced garlic" inside the step that performs the slicing → attributes "thinly" and "sliced" + material "garlic". In a *later* step that consumes the product, prefer the post-transformation form "sliced garlic" with \`derivedFrom: "<prior-stepId>"\`.

When the descriptor is the same word in many domains, the same split applies: use form/shape/state words ("chip", "powder", "pellet", "ingot", "slice", "cube", "frozen", "dried", "raw", "diluted") as attribute, not as part of the material label.

Counter-rule (do NOT over-split): chemical formulas, compound names, and brand-style identifiers stay whole — "MnSO4·H2O", "PVDF binder", "olive oil", "carbon black" are single material spans. The split applies only when a **substance noun** is paired with an **independent descriptor word**.

## Post-transformation material naming (CRITICAL — products of earlier steps)

When a material span refers to the **product of an earlier step** (and you would set its \`derivedFrom\` to that step's \`stepId\`), name the span using a **post-transformation form** so that the text alone makes the derivation explicit. The pattern is universal across domains:

- **\`<past-participle> sample\`** — generic fallback when no specific noun is natural: \`"sealed sample"\`, \`"annealed sample"\`, \`"quenched sample"\`, \`"crushed sample"\`, \`"spark plasma sintered sample"\`
- **\`<past-participle> <substance>\`** — when the underlying noun is clear: \`"sliced garlic"\`, \`"trained model"\`, \`"preprocessed dataset"\`, \`"amplified DNA"\`, \`"calcined powder"\`
- **\`<state> <substance>\`** — for state-of-being changes: \`"cooled mixture"\`, \`"dried powder"\`, \`"frozen sample"\`

The past-participle / state word should match the **gerund of the producing Activity's H2 heading**: an Activity titled \`"Annealing"\` produces an \`"annealed sample"\`; an Activity titled \`"Slicing the garlic"\` produces \`"sliced garlic"\`.

**For multi-word Activity verbs, keep the full verb in the post-transformation name**. Do not shorten:
- Activity \`"Spark plasma sintering"\` → product \`"spark plasma sintered sample"\` (NOT just \`"sintered sample"\`)
- Activity \`"Ball-milling"\` → product \`"ball-milled sample"\` (NOT \`"milled sample"\`)
- Activity \`"Co-precipitating"\` → product \`"co-precipitated sample"\` (NOT \`"precipitated sample"\`)
- Activity \`"Spark-erosion machining"\` → product \`"spark-erosion machined sample"\`

The full multi-word past participle preserves which Activity produced this material, which the graph consumer relies on.

Why this matters: without the post-transformation form, downstream readers (and graph consumers) can't tell that \`"ingot"\` in step 5 is the product of step 3 just from reading the text. The \`derivedFrom\` field carries the link, but the prose should reinforce it.

Counter-rule: when the source itself uses a domain-specific named product ("the precipitate", "the pellet", "the slurry"), keep the source's term but prefer compound forms that still echo the transformation: \`"the calcined precipitate"\`, \`"the pressed pellet"\`. Never invent a transformation that didn't happen.

## Procedure granularity (CRITICAL — decompose multi-stage actions)

When the source describes a procedure that proceeds through **distinct stages with different parameters**, emit **a separate H2 procedure for each named stage**. Do not merge them into one broad H2 just because the source narrates them in a single sentence.

The clearest signal of distinct stages is a **change of parameter values**. If a sentence describes the temperature being raised to X, then held at X, then cooled to Y, each stage has its own temperature/duration profile and is its own H2.

Examples (universal across domains):
- ❌ \`"Heat treatment"\` covering "raised to 1423 K in 6 h, maintained at 1423 K for 12 h, quenched into ice water"
- ✅ Three H2s: \`"Raising"\` (\`temperature: 1423 K\`, \`duration: 6 h\`), \`"Maintaining"\` (\`temperature: 1423 K\`, \`duration: 12 h\`), \`"Quenching"\` (with ice water as the tool span)

- ❌ \`"Marinating and searing"\`
- ✅ \`"Marinating"\` and \`"Searing"\`, each with their own time/temperature

- ❌ \`"Training"\` covering "warmup for 100 steps then main training for 10000 steps then fine-tune for 1000 steps"
- ✅ \`"Warming up"\`, \`"Training"\`, \`"Fine-tuning"\`, each with its own learning_rate / steps

Each subsequent stage should consume the previous stage's product via a \`material\` span with \`derivedFrom: "<prior-stepId>"\`, using a post-transformation noun (the produced \`"raised sample"\` is consumed by the next stage as a material with \`derivedFrom: "raising"\`).

Source sentence example: "The mixture was raised to 1423 K in 6 h and then maintained at this temperature for 12 h before quenching into ice water."

This is **three** distinct stages with different parameter values (ramp duration, holding duration, quench medium). Emit one H2 procedure per stage — \`"Raising"\`, \`"Maintaining"\`, \`"Quenching"\` — each with its own paragraph containing the appropriate \`material\` / \`tool\` / \`attribute\` / \`output\` spans, and each consuming the previous stage's product via a material span with \`derivedFrom\` linking to the prior \`stepId\`. The quench medium (\`"ice water"\`) is a \`tool\` because the sample is removed from it; see the role definitions for the material-vs-tool test.

## Object descriptors → attribute spans (CRITICAL — capture purity, form, grade, etc.)

When the source attaches a descriptor to a material — purity (\`"99.999%"\`), physical form (\`"shot"\`, \`"powder"\`, \`"pellet"\`, \`"ingot"\`, \`"foil"\`, \`"piece"\`), grade, particle size, etc. — emit each descriptor as a **separate attribute span next to the material**, not folded into the material's text.

Examples:
- \`"Cu (shot, 99.999%, Alfa Aesar)"\` → material \`"Cu"\` + attribute \`"form: shot"\` + attribute \`"purity: 99.999%"\` (drop supplier name, see "do NOT extract" below)
- \`"high-purity NaCl powder"\` → material \`"NaCl"\` + attribute \`"purity: high"\` + attribute \`"form: powder"\`
- \`"under vacuum"\` next to a step → attribute \`"atmosphere: vacuum"\` on the Activity's paragraph
- \`"in an inert atmosphere of argon"\` → attribute \`"atmosphere: argon"\`

Recommended \`<key>\` values for object descriptors when the source doesn't name them explicitly: \`purity\`, \`form\`, \`grade\`, \`atmosphere\`, \`temperature\`, \`pressure\`, \`duration\`, \`mass\`, \`concentration\`, \`rotation\`, \`size\`, \`thickness\`, \`diameter\`. Use these as canonical keys when applicable. Other open-set keys are fine when no canonical key fits.

**Always extract physical form** when the source names one — even for derived materials. Form words: \`shot\`, \`shots\`, \`piece\`, \`pieces\`, \`powder\`, \`pellet\`, \`ingot\`, \`foil\`, \`rod\`, \`flake\`, \`granule\`, \`crystal\`, \`chip\`, \`slice\`, \`block\`, \`paste\`, \`slurry\`. Examples:
- \`"shots"\` next to a material → attribute \`"form: shot"\`
- \`"annealed ingot"\` → material \`"annealed sample"\` + attribute \`"form: ingot"\` (the form is information about the sample, the post-transformation noun goes into the material span)
- \`"powdered NaCl"\` → material \`"NaCl"\` + attribute \`"form: powder"\`
- The post-transformation rule and the form-attribute rule **work together**: emit both the canonical \`"<past-participle> sample"\` material span AND a \`"form: <noun>"\` attribute when the source provides the physical state.

What NOT to extract as attribute: supplier names ("Alfa Aesar", "Sigma-Aldrich"), catalog numbers, brand-only identifiers without parameter meaning — these are reader-reference, not provenance-relevant attributes.

## Attribute key consistency (lightweight)

Attribute spans live in open-set vocabulary — there is no fixed list of allowed parameter names. To keep the output usable across many notes, follow three light rules whenever you write a \`<key>: <value>\` attribute span:

- **\`snake_case\` for keys.** \`incubation_time\`, \`learning_rate\`, \`magnetic_field_strength\` — not camelCase, not Title Case, not hyphenated.
- **Respect the source's wording.** Mirror the parameter name as the source uses it. Do not invent a fancier name, do not translate into another language, do not collapse "incubation time" and "incubation period" into one canonical form if the source distinguishes them.
- **Same concept → same key inside one document.** If a paper uses "temperature" in step 3 and "T" in step 5 for the same physical quantity, pick one (prefer the more explicit \`temperature\`) and use it for both — within this document only. Do not normalize across documents.

These rules apply to attribute spans only. material / tool / output span text is the literal phrase from the prose and is not subject to snake_case or key consistency rules.

## Connectivity rule (CRITICAL — one connected graph, no isolated steps)

The output must form a **single connected provenance chain**. Every H2 procedure step must be reachable from every other step through directed edges (Activity → Entity → Activity ...). Disconnected sub-graphs and orphan steps are a failure mode.

How edges actually appear in the graph:

- A material span without \`derivedFrom\` is a **fresh input** — it does NOT connect this step to any prior step.
- A material span with \`derivedFrom: "<stepId>"\` connects this step to that prior step (this step \`wasInformedBy\` it).
- An H2 procedure with \`dependsOn: ["<stepId>", ...]\` connects to those prior steps.
- The terminal step's \`role: "output"\` span finishes the chain.

Therefore: **every non-initial step MUST carry at least one \`derivedFrom\` (on a material span) or one \`dependsOn\` (on the H2)**. Exactly one step — typically the very first procedural action — is allowed to have neither, because it consumes only fresh inputs.

How to satisfy this without inventing dependencies:

1. After drafting the steps, list them in order and ask: "what concrete substance / state does step N take from step N-k?" If the source clearly implies a handoff, encode it: prefer \`derivedFrom\` on a material span when the handoff is a named product ("the dried powder", "the sealed sample", "the sliced garlic"); use \`dependsOn\` only when the handoff is implicit ("continue heating", "in the same vessel after cooling").
2. If step N's prose only names fresh inputs but the procedure logically continues from a prior state described earlier, surface that state as a material span with \`derivedFrom\` — using a post-transformation noun phrase like "the resulting solution", "the cooled mixture", "the prepared substrate". This is encouraged, not fabrication, as long as the source text actually describes that prior state.
3. Parallel branches (e.g. preparing two components separately) may join at a later step — that joining step should carry \`derivedFrom\` on materials from BOTH branches, or \`dependsOn\` covering both prior step ids. The graph then becomes a DAG that converges, still connected.
4. If after the above any step still has no inbound link AND it is not the very first step, you have one of three options: (a) merge it into the prior step, (b) drop it if it is not graph-meaningful, or (c) add a \`dependsOn\` to whichever earlier step it actually continues from.

Never invent a dependency that contradicts the source. If the source genuinely describes two unrelated procedures sharing only the page, prefer merging them into one wider procedure or extracting only the dominant chain. Output exactly one connected DAG per JSON document.

## Document shape — mirror the source

Reflect the source's own structure and voice. Do NOT impose a fixed template. If the source has 6 sections, keep 6. If it is one continuous narrative with no headings, you may use just a brief intro paragraph followed by H2 procedure steps. The H1 headings, their wording, and their order should read like the original page would, not like a generic protocol form.

What you MUST keep regardless of the source's shape:

- Open with a short intro paragraph (1-3 sentences) of plain prose that says what this procedure does. No role spans here.
- Express each meaningful action as an **H2 heading** with \`role: "procedure"\` and a \`stepId\`. These H2s are what Graphium turns into Activities in the PROV graph.
- Under each H2, write **one or two paragraphs of natural prose**. Do not switch into bullet-list mode. Inside that prose, the specific materials / tools / attributes / outputs used by that step appear as **inline spans with role**.
  - Prefer **post-transformation names** for derived materials ("sliced garlic", "calcined powder", "amplified DNA"). Pair that with span \`derivedFrom: "<stepId>"\` so text and graph agree.
- Place the **final \`role: "output"\` span(s)** inside the prose of the **terminal step** (or a final summary paragraph) — not scattered across middle steps.

What you should match to the source — without forcing them in:

- An up-front ingredient / tool / equipment inventory section. Keep it as plain prose spans **without any \`role\`** (see the next section). Skip it if the source has none.
- An explicit "results" / "outcome" / "finished" section. Use it if the source does, otherwise the terminal step's prose carries the output span.

In short: the H2 procedure steps + inline role spans are the structural commitment. Everything around them — H1 wording, H1 count, ordering of intro / inventory / wrap-up — should follow the source.

## IMPORTANT: DO NOT role-tag the up-front ingredient/tool list

Source pages typically open with an "Ingredients" / "Tools" / "材料" / "道具" catalogue BEFORE the step-by-step instructions. This is reader-facing inventory, not part of the PROV graph.

If you include such a section, keep its content as **plain prose spans WITHOUT any role**. Do NOT put \`role: "material"\` or \`role: "tool"\` there — those spans would become orphan Entities (no procedure uses them) and pollute the graph.

Instead, role-tag spans **only inside H2 procedure step paragraphs**, naming exactly what that step actually uses. The same raw ingredient may appear as a material span in multiple steps — that is correct and expected.

## The derivedFrom / dependsOn rule (MOST IMPORTANT)

Recipes (and most procedures) are NOT strictly linear. Step N does not automatically consume step N-1's output. A dependency exists ONLY when a **material / product physically flows** from an earlier step into the current step.

### What IS a dependency

- Step X produced a transformed substance (chopped, boiled, fried, etc.) and step Y literally puts that substance into its process.
- Step Y needs the state established by step X (e.g., "pan is now hot", "sauce has reduced") as its starting condition, AND no separate material block represents that state.

### What IS NOT a dependency (common traps — do NOT create edges for these)

- ❌ "Two steps use the same frying pan / the same bowl." Sharing a tool is NOT a dependency. The tool is reset each time.
- ❌ "Step Y happens immediately after step X in the text." Textual adjacency is NOT a dependency.
- ❌ "Both steps are in the same recipe." Sibling steps that independently prepare different components are PARALLEL, not sequential. E.g., slicing onions and slicing carrots while boiling water.
- ❌ "Step X produced something, but step Y uses only fresh, unrelated ingredients." No flow of matter → no dependency.

### How to decide

For each H2 step, before writing its JSON, answer:

  1. **What concrete materials enter this step?** List them.
  2. **For each material: is it pristine (first appearance, raw from pantry, fresh tool) or transformed (the literal output of a specific earlier step)?**
     - Pristine → write the material without \`derivedFrom\`.
     - Transformed → write the material with \`derivedFrom: "<producing-stepId>"\`.
  3. **Is there an implicit carryover** — a prior step's product that the current step extends but which you did NOT list as a separate material block? (E.g., "continue simmering" without naming what is simmering.)
     - If YES → add that one prior stepId to the step's \`dependsOn\`.
     - If NO → leave \`dependsOn\` off. Do NOT invent dependencies to "connect" the graph.

### Worked example: a parallel-prep recipe

Flow:
1. Slice bamboo shoots
2. Slice garlic
3. Sauté the sliced garlic in oil (take it out when done)
4. Sear the sliced bamboo in the same pan
5. Add soy sauce to the bamboo in the pan
6. Plate: place the bamboo, top with the sautéed garlic, finish with butter and pepper

Correct dependencies:
- Step 3 material "sliced garlic" → \`derivedFrom: "slice-garlic"\`. Step 3 does NOT depend on step 1 (bamboo has nothing to do with garlic here).
- Step 4 material "sliced bamboo" → \`derivedFrom: "slice-bamboo"\`. Step 4 does NOT depend on step 3 (only the pan is shared, and the garlic was removed).
- Step 5 uses \`dependsOn: ["sear-bamboo"]\` — the seared bamboo is still in the pan.
- Step 6 lists two \`derivedFrom\` materials: the "seasoned bamboo" from step 5 and the "sautéed garlic" from step 3. These two branches join here.

The resulting graph is a **DAG with two parallel chains (bamboo-side, garlic-side) that meet at the final plating step**. It is NOT a straight line through steps 1→2→3→4→5→6.

## Full JSON example 1 — cooking (prose with inline spans, parallel branches)

Note: a recipe page typically opens with a one-paragraph intro, an ingredient list, and the steps — no formal "Outcome" section. This example follows that real-world shape rather than imposing a generic four-section form.

{
  "title": "Garlic Soy Bamboo Steak",
  "blocks": [
    { "text": "About this dish", "blockType": "heading", "level": 1 },
    { "blockType": "paragraph", "content": [
      { "text": "A simple bamboo shoot steak finished with garlic-infused soy sauce and butter." }
    ]},

    { "text": "Ingredients", "blockType": "heading", "level": 1 },
    { "blockType": "paragraph", "content": [
      { "text": "Boiled bamboo shoots, garlic, olive oil, soy sauce, and optional butter and black pepper." }
    ]},

    { "text": "How to make", "blockType": "heading", "level": 1 },

    { "text": "Slice the bamboo", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "slice-bamboo" },
    { "blockType": "paragraph", "content": [
      { "text": "Cut the " },
      { "text": "boiled bamboo shoots", "role": "material" },
      { "text": " into " },
      { "text": "1 cm slabs", "role": "attribute" },
      { "text": " with a " },
      { "text": "knife", "role": "tool" },
      { "text": "." }
    ]},

    { "text": "Slice the garlic", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "slice-garlic" },
    { "blockType": "paragraph", "content": [
      { "text": "Slice the " },
      { "text": "garlic", "role": "material" },
      { "text": " " },
      { "text": "thinly", "role": "attribute" },
      { "text": "." }
    ]},

    { "text": "Sauté the garlic", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "saute-garlic" },
    { "blockType": "paragraph", "content": [
      { "text": "Warm " },
      { "text": "olive oil", "role": "material" },
      { "text": " in a " },
      { "text": "frying pan", "role": "tool" },
      { "text": " with the " },
      { "text": "sliced garlic", "role": "material", "derivedFrom": "slice-garlic" },
      { "text": " over " },
      { "text": "low heat", "role": "attribute" },
      { "text": " " },
      { "text": "until fragrant", "role": "attribute" },
      { "text": ", then remove the garlic." }
    ]},

    { "text": "Sear the bamboo", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "sear-bamboo" },
    { "blockType": "paragraph", "content": [
      { "text": "In the same pan, sear the " },
      { "text": "sliced bamboo", "role": "material", "derivedFrom": "slice-bamboo" },
      { "text": " over " },
      { "text": "medium-high heat", "role": "attribute" },
      { "text": " " },
      { "text": "until browned on both sides", "role": "attribute" },
      { "text": "." }
    ]},

    { "text": "Season", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "season", "dependsOn": ["sear-bamboo"] },
    { "blockType": "paragraph", "content": [
      { "text": "Add " },
      { "text": "soy sauce", "role": "material" },
      { "text": " to the pan and finish the bamboo." }
    ]},

    { "text": "Plate", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "plate" },
    { "blockType": "paragraph", "content": [
      { "text": "Arrange the " },
      { "text": "seasoned bamboo", "role": "material", "derivedFrom": "season" },
      { "text": " on a plate, top with the " },
      { "text": "sautéed garlic", "role": "material", "derivedFrom": "saute-garlic" },
      { "text": ", and finish with " },
      { "text": "butter", "role": "material" },
      { "text": " and " },
      { "text": "black pepper", "role": "material" },
      { "text": " to plate the " },
      { "text": "garlic soy bamboo steak", "role": "output" },
      { "text": "." }
    ]}
  ]
}

## Full JSON example 2 — laboratory protocol (same template, different vocabulary)

The same approach (mirror the source's structure, anchor the graph with H2 procedure + spans) works for any procedural content. Here is a lab protocol where the source itself uses the formal Overview / Materials / Procedure / Outcome shape:

{
  "title": "Cyclic voltammetry of MnO2 electrode",
  "blocks": [
    { "text": "Overview", "blockType": "heading", "level": 1 },
    { "blockType": "paragraph", "content": [
      { "text": "Synthesize MnO2 by co-precipitation, cast it onto a current collector, and measure its cyclic voltammetry in 1 M KOH to evaluate supercapacitor behavior." }
    ]},

    { "text": "Materials", "blockType": "heading", "level": 1 },
    { "blockType": "paragraph", "content": [
      { "text": "KMnO4, MnSO4·H2O, deionized water, carbon black, PVDF binder, 1 M KOH electrolyte; potentiostat, three-electrode cell, drying oven, and magnetic stirrer." }
    ]},

    { "text": "Procedure", "blockType": "heading", "level": 1 },

    { "text": "Prepare precursor solutions", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "prep-precursors" },
    { "blockType": "paragraph", "content": [
      { "text": "Dissolve " },
      { "text": "KMnO4", "role": "material" },
      { "text": " (" },
      { "text": "1.58 g", "role": "attribute" },
      { "text": ") and " },
      { "text": "MnSO4·H2O", "role": "material" },
      { "text": " (" },
      { "text": "0.85 g", "role": "attribute" },
      { "text": ") separately in " },
      { "text": "50 mL water", "role": "attribute" },
      { "text": " each, on a " },
      { "text": "magnetic stirrer", "role": "tool" },
      { "text": "." }
    ]},

    { "text": "Co-precipitate MnO2", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "coprecipitate", "dependsOn": ["prep-precursors"] },
    { "blockType": "paragraph", "content": [
      { "text": "Combine the two solutions at " },
      { "text": "60 °C", "role": "attribute" },
      { "text": " with " },
      { "text": "stirring", "role": "attribute" },
      { "text": " for " },
      { "text": "30 min", "role": "attribute" },
      { "text": "; brown MnO2 precipitates." }
    ]},

    { "text": "Filter and dry", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "filter-dry" },
    { "blockType": "paragraph", "content": [
      { "text": "Vacuum-filter the " },
      { "text": "precipitated MnO2", "role": "material", "derivedFrom": "coprecipitate" },
      { "text": " through " },
      { "text": "filter paper", "role": "tool" },
      { "text": " and dry " },
      { "text": "overnight", "role": "attribute" },
      { "text": " at " },
      { "text": "80 °C", "role": "attribute" },
      { "text": " in a " },
      { "text": "drying oven", "role": "tool" },
      { "text": "." }
    ]},

    { "text": "Cast the electrode", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "cast-electrode" },
    { "blockType": "paragraph", "content": [
      { "text": "Mix the " },
      { "text": "dried MnO2 powder", "role": "material", "derivedFrom": "filter-dry" },
      { "text": " with " },
      { "text": "carbon black", "role": "material" },
      { "text": " and " },
      { "text": "PVDF binder", "role": "material" },
      { "text": ", then cast the slurry onto a " },
      { "text": "current collector", "role": "tool" },
      { "text": "." }
    ]},

    { "text": "Outcome", "blockType": "heading", "level": 1 },

    { "text": "Run cyclic voltammetry", "blockType": "heading", "level": 2, "role": "procedure", "stepId": "cv" },
    { "blockType": "paragraph", "content": [
      { "text": "With the " },
      { "text": "cast MnO2 electrode", "role": "material", "derivedFrom": "cast-electrode" },
      { "text": " in " },
      { "text": "1 M KOH electrolyte", "role": "material" },
      { "text": ", sweep the potential " },
      { "text": "0–1 V vs. Ag/AgCl", "role": "attribute" },
      { "text": " at " },
      { "text": "10 mV/s", "role": "attribute" },
      { "text": " on a " },
      { "text": "potentiostat", "role": "tool" },
      { "text": " with a " },
      { "text": "three-electrode cell", "role": "tool" },
      { "text": " to record a " },
      { "text": "cyclic voltammogram", "role": "output" },
      { "text": "." }
    ]}
  ]
}

## Rules

0. **OUTPUT CONTRACT (HIGHEST PRIORITY)**: every \`role: "procedure"\` H2 heading MUST be immediately followed by **at least one \`blockType: "paragraph"\` block whose \`content\` array contains one or more role-bearing spans** (\`material\` / \`tool\` / \`attribute\` / \`output\`). A sequence of consecutive H2 procedure headings with no paragraph between them is **invalid and will be rejected**. If you cannot find concrete material / tool / output content for a step, DROP the step entirely — never emit a bare procedure heading.
1. Output MUST be valid JSON with \`title\` (string) and \`blocks\` (array).
2. Mirror the source's own structure and voice (H1 wording, count, ordering). Required structural elements — regardless of the source's shape: a brief intro paragraph at the top, H2 procedure steps with \`stepId\`, the terminal step (or a final summary) carrying the \`role: "output"\` span(s).
3. Every H2 that represents a meaningful action carries \`role: "procedure"\` and a \`stepId\` matching /^[a-z0-9][a-z0-9-]*$/ (kebab-case, unique within the document). Non-action H2s (e.g. a sub-heading inside the intro) do not need procedure.
4. Each H2 step is followed by **one or two prose paragraphs** (\`blockType: "paragraph"\` with \`content\` spans). Inside that prose, the materials / tools / attributes / outputs used by the step appear as **inline spans with role**. Do NOT use bulletListItem to list them. (See Rule 0 — this is the highest-priority output contract.)
5. Prefer **3-10 H2 steps** total. Split at meaningful physical actions — not at every sentence.
6. For each role-bearing material span, decide whether it is pristine (first introduction, raw from stock) or the product of an earlier step. Set \`derivedFrom\` on the latter. If a step extends a prior step without a distinct material handoff, add \`dependsOn\` to the H2.
7. \`dependsOn\` / span \`derivedFrom\` MUST reference a stepId defined earlier in the document.
8. Up-front inventory sections (ingredient lists, equipment lists — whatever the source calls them) are READER REFERENCE ONLY. Their spans MUST NOT carry any role; they would otherwise become orphan Entities in the graph.
9. Place \`role: "output"\` spans inside the **terminal H2 step's paragraph** (or, if the source has an explicit results / outcome / finished-product H1, inside that section's terminal step). Do NOT scatter output spans across middle steps unless the source explicitly describes multiple terminal outputs.
10. Prefer post-transformation names for derived materials ("sliced garlic", "dried MnO2 powder") so the text reads naturally and the \`derivedFrom\` link is self-consistent.
11. Span text MUST be the literal phrase as it appears in the surrounding prose (so concatenating all span \`text\` reproduces the paragraph). Plain narrative segments are spans without a role.
12. Language of ALL human-readable text — the document title, every heading (including H2 step headings), and every span \`text\`: ${isJa ? 'Japanese. Do NOT reuse the English stepId as the heading text — headings are Japanese prose (e.g. stepId "arc-melting" → heading "アーク溶解"). Only stepId / derivedFrom / dependsOn stay in lowercase English kebab-case' : "match the source language, or English if ambiguous"}.
13. Do NOT use numbering prefixes ("1. ", "2. ") in step heading text. If sequencing inside a step matters, use a numberedListItem block (with \`content\` spans) — but prefer flowing prose.
14. Step-wide attributes (heat level, total duration) appear as inline attribute spans inside the step's paragraph, not as separate blocks.
15. Never fabricate dependencies that aren't implied by the source text.
16. **Every \`role: "procedure"\` H2 MUST contain at least one role-bearing span (material / tool / output) in its paragraph(s).** A procedure with no inputs and no outputs produces no graph edges and is useless. If you cannot identify any concrete material / tool / output for a step, drop the step entirely or merge it into an adjacent step.
17. **Atomic nodes**: Every H2 procedure heading and every role-bearing span represents exactly one concept. Split conjunctive phrases ("salt and pepper", "mix and heat") into separate adjacent spans / separate H2 steps. Use a plain narrative span for the connector word.
18. **Material vs attribute split**: When the source pairs a substance noun with a descriptor word (form, shape, state, quantity, dimension, purity, temperature), emit them as two spans — material for the substance, attribute for the descriptor. Do not absorb descriptors into the material label. Compound names / formulas / well-known multi-word ingredients stay whole.

## Self-check before emitting JSON

Before you finalize the JSON, walk through your output and confirm:

1. **Every role-bearing span lives inside a procedure-scope paragraph.** For each span carrying \`role: "material" | "tool" | "attribute" | "output"\`, trace upward: it must be inside a paragraph that follows an H2 with \`role: "procedure"\` (and stays within that step's scope until the next H2). If a role-tagged span sits under the up-front Materials / Ingredients H1, **remove its \`role\`** — it would otherwise become an isolated graph node.
2. **No empty procedures.** Every \`role: "procedure"\` H2 must include at least one role-bearing span (material / tool / output) in the prose that follows. Drop or merge any that don't.
3. **Dependency chain integrity.** Every span \`derivedFrom\` and every entry in \`dependsOn\` resolves to a \`stepId\` defined earlier in the document. No forward references, no typos.
4. **Pristine vs derived split is correct.** Re-check each material span: if it is the literal product of an earlier step, set \`derivedFrom\`; if it is fresh from inventory, leave it without \`derivedFrom\`. The same raw ingredient appearing in multiple steps is fine — repeat the span, do NOT use \`derivedFrom\` for it.
5. **Paragraph reads as natural prose.** Concatenating all span \`text\` for a paragraph should produce a fluent sentence. No leftover bullet syntax. No "Material: X" prefixes.
6. **Atomicity audit.** No H2 procedure heading text contains "and" / "&" / "、" joining two operations. No role-bearing span contains "and" / "or" / "、" / "や" joining two substances or two parameters. Re-emit as separate nodes if you find any.
7. **Material vs attribute audit.** For each \`role: "material"\` span, verify the text names a substance or object — not a form/shape/state ("chip", "powder", "slice", "frozen"). If the original phrase was "<substance> <descriptor>", split into a material span for the substance and an attribute span for the descriptor.
8. **Connectivity audit.** Walk through the H2 steps in order. The first step may have no \`derivedFrom\` / \`dependsOn\`. Every subsequent step MUST have at least one — through a material span's \`derivedFrom\`, through the H2's \`dependsOn\`, or both. If any later step has neither, fix it (add a derived-material span naming the prior product, add a \`dependsOn\`, or merge / drop the step). Verify the final \`role: "output"\` span is in a step that transitively connects back to step 1 — there must be no break in the chain.

If any check fails, fix the JSON before emitting.
`;
}

/**
 * ユーザーメッセージを構築する（fetch 済みのページ本文・タイトル・URL を渡す）
 */
export function buildProvIngesterUserMessage(input: {
  url: string;
  title: string;
  description?: string;
  text: string;
}): string {
  const { url, title, description, text } = input;
  const lines = [`Source URL: ${url}`, `Page title: ${title}`];
  if (description) lines.push(`Description: ${description}`);
  lines.push("", "--- page text ---", text);
  return lines.join("\n");
}

/**
 * LLM 出力を ProvIngesterOutput にパースする（再帰対応）。
 *
 * - 不正な role は undefined 扱い
 * - 不正な blockType は paragraph フォールバック
 * - heading の level は 1-3、範囲外は 2
 * - children は再帰的にパース、深さ制限 MAX_DEPTH
 * - text が空のブロックは除外
 * - stepId / derivedFrom は STEP_ID_REGEX 合致のみ採用（不正値は捨てる）
 * - dependsOn は文字列配列のみ採用し、各要素も同じく regex 検証
 */
export function parseProvIngesterOutput(raw: string): ProvIngesterOutput {
  let jsonText = raw.trim();
  const fenced = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) jsonText = fenced[1].trim();

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    // gpt-oss 等のローカル系モデルは、論文 PDF のように出力が数千トークン級に
    // 伸びるとクォート漏れ・カンマ余りなど軽微な構文エラーを確率的に混ぜる。
    // 捨てる前に jsonrepair で機械修復を試み、それでもダメなら空を返す
    // （呼び出し側ルートが 1 回だけ生成をやり直す）。
    try {
      parsed = JSON.parse(jsonrepair(jsonText));
      console.warn(
        "PROV Ingester: LLM 出力の JSON を jsonrepair で修復してパースした",
      );
    } catch {
      console.error("PROV Ingester 出力のパース失敗:", err);
      return { title: "", blocks: [] };
    }
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const blocksInput: unknown = parsed.blocks;
  if (!Array.isArray(blocksInput)) return { title, blocks: [] };

  return { title, blocks: sanitizeBlocks(blocksInput, 0) };
}

/**
 * 出力言語の遵守チェック（現状 ja のみ対応）。
 *
 * gpt-oss 系ローカルモデルは、stepId（英語 kebab-case 必須）に引きずられて
 * H2 見出しだけを英語で書くことがある（本文 span は日本語で書けている。
 * 2026-08 の論文 PDF 実測で約 6 割）。見出し単位の判定は二峰性がきれいに出る
 * （英語時 0.00-0.14 / 日本語時 0.78-1.00）ため、閾値 0.5 で誤判定なく分離できる。
 * 見出しが 1 個以下のときは判定材料不足として不一致にしない。
 */
export function hasHeadingLanguageMismatch(
  language: string,
  blocks: ProvIngesterBlock[],
): boolean {
  if (language !== "ja") return false;
  const headings: string[] = [];
  const walk = (list: ProvIngesterBlock[]) => {
    for (const b of list) {
      if (b.blockType === "heading") {
        const text = (b.text ?? (b.content ?? []).map((s) => s.text).join("")).trim();
        if (text) headings.push(text);
      }
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);
  if (headings.length < 2) return false;
  const ja = headings.filter((t) => /[぀-ヿ一-鿿]/.test(t)).length;
  return ja / headings.length < 0.5;
}

/**
 * 言語不一致時の追い打ちメッセージ。1 回目の出力を assistant メッセージとして
 * 見せた上でこれを user として送ると、gpt-oss-120b でも見出しが日本語化する
 * （2026-08 実測 3/3）。stepId まで日本語化して参照が壊れないよう据え置きを明示する。
 */
export const PROV_LANGUAGE_RETRY_NUDGE =
  "Your previous output ignored the language instruction: step headings were written in English. " +
  "Regenerate the SAME structure, but write ALL headings, titles, and body text in Japanese (日本語). " +
  "Keep stepId values in lowercase English kebab-case as required. Output only the JSON.";

function sanitizeBlocks(input: any[], depth: number): ProvIngesterBlock[] {
  if (depth >= MAX_DEPTH) return [];
  const out: ProvIngesterBlock[] = [];
  for (const b of input) {
    if (!b || typeof b !== "object") continue;

    // text と content の両方を許す。両方無いブロックは捨てる。
    const text = typeof b.text === "string" ? b.text.trim() : "";
    const content = Array.isArray(b.content) ? sanitizeSpans(b.content) : undefined;
    if (!text && (!content || content.length === 0)) continue;

    // 後方互換: LLM が旧 role "result" を出力した場合は "output" に正規化
    const rawRole = typeof b.role === "string" && b.role === "result" ? "output" : b.role;
    const role: ProvRole | undefined =
      typeof rawRole === "string" && VALID_ROLES.includes(rawRole as ProvRole)
        ? (rawRole as ProvRole)
        : undefined;

    const rawBlockType = b.blockType;
    const blockType: ProvBlockType =
      typeof rawBlockType === "string" && VALID_BLOCK_TYPES.includes(rawBlockType as ProvBlockType)
        ? (rawBlockType as ProvBlockType)
        : "paragraph";

    let level: 1 | 2 | 3 | undefined;
    if (blockType === "heading") {
      const raw = b.level;
      level = raw === 1 || raw === 2 || raw === 3 ? raw : 2;
    }

    const children = Array.isArray(b.children) ? sanitizeBlocks(b.children, depth + 1) : undefined;

    const node: ProvIngesterBlock = { blockType, level };
    // heading は spans を使わない（procedure ラベルは block-level） → text を採用
    if (blockType === "heading") {
      node.text = text;
    } else if (content && content.length > 0) {
      node.content = content;
    } else {
      node.text = text;
    }
    if (role) node.role = role;
    if (children && children.length > 0) node.children = children;

    const stepId = sanitizeStepId(b.stepId);
    if (stepId) node.stepId = stepId;

    const derivedFrom = sanitizeStepId(b.derivedFrom);
    if (derivedFrom) node.derivedFrom = derivedFrom;

    if (Array.isArray(b.dependsOn)) {
      const deps = b.dependsOn
        .map((d: any) => sanitizeStepId(d))
        .filter((d: string | null): d is string => !!d);
      if (deps.length > 0) node.dependsOn = deps;
    }

    out.push(node);
  }
  return out;
}

// 句読点・記号・空白だけで構成された span は role を剥がす（実体を持たない grapheme は
// PROV グラフ上で「。」「,」のような孤立 Entity ノードを作るので、サニタイザで防ぐ）。
// 範囲: ASCII 句読点・全角句読点・各種スペース・記号類。日本語/英語/欧文記号を一括カバー。
const PUNCTUATION_ONLY_REGEX =
  /^[\s\p{P}\p{S}　 ]+$/u;

function isPunctuationOnly(text: string): boolean {
  return PUNCTUATION_ONLY_REGEX.test(text);
}

function sanitizeSpans(input: any[]): ProvSpan[] {
  const out: ProvSpan[] = [];
  for (const s of input) {
    if (!s || typeof s !== "object") continue;
    const text = typeof s.text === "string" ? s.text : "";
    if (!text) continue; // 空 span は捨てる（前後空白だけのテキストは段落整形で潰れる）

    const rawRole = typeof s.role === "string" && s.role === "result" ? "output" : s.role;
    let role: ProvRole | undefined;
    if (typeof rawRole === "string" && VALID_ROLES.includes(rawRole as ProvRole)) {
      // span に procedure を書くのは設計外なので無視する
      role = rawRole === "procedure" ? undefined : (rawRole as ProvRole);
    }

    // 句読点・記号のみの span は role を持たないプレーン span に降格する
    if (role && isPunctuationOnly(text)) {
      role = undefined;
    }

    const span: ProvSpan = { text };
    if (role) span.role = role;
    const derivedFrom = sanitizeStepId(s.derivedFrom);
    // derivedFrom も role を失った時点で意味を失うので落とす
    if (role && derivedFrom) span.derivedFrom = derivedFrom;

    out.push(span);
  }
  return out;
}

function sanitizeStepId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().toLowerCase();
  return STEP_ID_REGEX.test(trimmed) ? trimmed : null;
}
