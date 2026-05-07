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
- **material** (span inside paragraph): an input consumed or transformed by the step (ingredient, reagent, precursor, sample, raw data).
  If it is the product of an earlier step, add \`derivedFrom\` to the span.
- **tool** (span): an instrument used by the step but not consumed (pan, oven, potentiostat, XRD, compiler).
- **attribute** (span): a parameter / condition / specification (quantity, concentration, temperature, time, pH, voltage, scan rate).
- **output** (span): an output produced by the step (finished dish, characterization spectrum, measurement value, fabricated device, refined dataset).

Do NOT translate these keys. Do NOT wrap in brackets. Do NOT invent new roles. **Do NOT put procedure on a span** — procedure lives only on the H2 heading block.

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

1. Output MUST be valid JSON with \`title\` (string) and \`blocks\` (array).
2. Mirror the source's own structure and voice (H1 wording, count, ordering). Required structural elements — regardless of the source's shape: a brief intro paragraph at the top, H2 procedure steps with \`stepId\`, the terminal step (or a final summary) carrying the \`role: "output"\` span(s).
3. Every H2 that represents a meaningful action carries \`role: "procedure"\` and a \`stepId\` matching /^[a-z0-9][a-z0-9-]*$/ (kebab-case, unique within the document). Non-action H2s (e.g. a sub-heading inside the intro) do not need procedure.
4. Each H2 step is followed by **one or two prose paragraphs** (\`blockType: "paragraph"\` with \`content\` spans). Inside that prose, the materials / tools / attributes / outputs used by the step appear as **inline spans with role**. Do NOT use bulletListItem to list them.
5. Prefer **3-10 H2 steps** total. Split at meaningful physical actions — not at every sentence.
6. For each role-bearing material span, decide whether it is pristine (first introduction, raw from stock) or the product of an earlier step. Set \`derivedFrom\` on the latter. If a step extends a prior step without a distinct material handoff, add \`dependsOn\` to the H2.
7. \`dependsOn\` / span \`derivedFrom\` MUST reference a stepId defined earlier in the document.
8. Up-front inventory sections (ingredient lists, equipment lists — whatever the source calls them) are READER REFERENCE ONLY. Their spans MUST NOT carry any role; they would otherwise become orphan Entities in the graph.
9. Place \`role: "output"\` spans inside the **terminal H2 step's paragraph** (or, if the source has an explicit results / outcome / finished-product H1, inside that section's terminal step). Do NOT scatter output spans across middle steps unless the source explicitly describes multiple terminal outputs.
10. Prefer post-transformation names for derived materials ("sliced garlic", "dried MnO2 powder") so the text reads naturally and the \`derivedFrom\` link is self-consistent.
11. Span text MUST be the literal phrase as it appears in the surrounding prose (so concatenating all span \`text\` reproduces the paragraph). Plain narrative segments are spans without a role.
12. Language of \`text\`: ${isJa ? "Japanese" : "match the source language, or English if ambiguous"}.
13. Do NOT use numbering prefixes ("1. ", "2. ") in step heading text. If sequencing inside a step matters, use a numberedListItem block (with \`content\` spans) — but prefer flowing prose.
14. Step-wide attributes (heat level, total duration) appear as inline attribute spans inside the step's paragraph, not as separate blocks.
15. Never fabricate dependencies that aren't implied by the source text.
16. **Every \`role: "procedure"\` H2 MUST contain at least one role-bearing span (material / tool / output) in its paragraph(s).** A procedure with no inputs and no outputs produces no graph edges and is useless. If you cannot identify any concrete material / tool / output for a step, drop the step entirely or merge it into an adjacent step.

## Self-check before emitting JSON

Before you finalize the JSON, walk through your output and confirm:

1. **Every role-bearing span lives inside a procedure-scope paragraph.** For each span carrying \`role: "material" | "tool" | "attribute" | "output"\`, trace upward: it must be inside a paragraph that follows an H2 with \`role: "procedure"\` (and stays within that step's scope until the next H2). If a role-tagged span sits under the up-front Materials / Ingredients H1, **remove its \`role\`** — it would otherwise become an isolated graph node.
2. **No empty procedures.** Every \`role: "procedure"\` H2 must include at least one role-bearing span (material / tool / output) in the prose that follows. Drop or merge any that don't.
3. **Dependency chain integrity.** Every span \`derivedFrom\` and every entry in \`dependsOn\` resolves to a \`stepId\` defined earlier in the document. No forward references, no typos.
4. **Pristine vs derived split is correct.** Re-check each material span: if it is the literal product of an earlier step, set \`derivedFrom\`; if it is fresh from inventory, leave it without \`derivedFrom\`. The same raw ingredient appearing in multiple steps is fine — repeat the span, do NOT use \`derivedFrom\` for it.
5. **Paragraph reads as natural prose.** Concatenating all span \`text\` for a paragraph should produce a fluent sentence. No leftover bullet syntax. No "Material: X" prefixes.

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
    console.error("PROV Ingester 出力のパース失敗:", err);
    return { title: "", blocks: [] };
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const blocksInput: unknown = parsed.blocks;
  if (!Array.isArray(blocksInput)) return { title, blocks: [] };

  return { title, blocks: sanitizeBlocks(blocksInput, 0) };
}

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

    const span: ProvSpan = { text };
    if (role) span.role = role;
    const derivedFrom = sanitizeStepId(s.derivedFrom);
    if (derivedFrom) span.derivedFrom = derivedFrom;

    out.push(span);
  }
  return out;
}

function sanitizeStepId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().toLowerCase();
  return STEP_ID_REGEX.test(trimmed) ? trimmed : null;
}
