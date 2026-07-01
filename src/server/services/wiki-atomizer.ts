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

import type { AtomRelation, AtomType, AtomShape, AtomTransfer, EpistemicStatus } from "../../lib/document-types.js";
import {
  ATOM_RELATION_TYPE_VALUES,
  lowestEpistemicStatus,
  EPISTEMIC_STATUS_ORDER,
} from "../../lib/document-types.js";
import type { ClaimSnapshot } from "./wiki-types.js";

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

/** Atom の関係の形（構造写像の軸）として認める固定語彙 */
const ATOM_SHAPE_VALUES: AtomShape[] = [
  "monotonic-increase",
  "monotonic-decrease",
  "optimal-middle",
  "threshold",
  "trade-off",
  "enabling-condition",
  "composition-structure",
  "reinforcing-loop",
  "balancing-loop",
  "other",
];

/** Phase η: EpistemicStatus として認める値（順序 = 低→高） */
const EPISTEMIC_STATUS_VALUES = EPISTEMIC_STATUS_ORDER;

// ─── Post-emit rung-1 guard (Atomizer-strengthen 2026-05) ──────────────────────
//
// 設計判断:
//   prompt で「rung-1 を出すな」と何度言っても、LLM は corpus 固有の固有名詞
//   ("Al3V", "Klemens-Callaway", "PROV-DM", "ローレンツ数" 等) を捨てきれない。
//   これは前 baseline (lift_score median 0.714) で目視確認 + bench で再現済。
//
//   そこで parse 後に programmatic guard を挟む。LLM が rung-1 で押し通そうと
//   しても、emit する前に title を pattern にかけて以下のいずれかが残っていれば
//   drop する。**An empty atoms array is better than an under-abstracted Atom**
//   という prompt の原則を、コード側で強制する形。
//
//   pattern は corpus-agnostic (化学式・3+char 略語・hyphenated 人名物理式 etc.)
//   にとどめ、コーパス固有の jargon 辞書は持たない。これにより μ-2 で生物 / 経済 /
//   人文に corpus が広がっても判定が破綻しない。jargon らしさの最終判定は LLM judge
//   (bench/judge.ts の LIFT_RUBRIC) が引き受ける。
//
//   一致した token は title-only でなく body 冒頭も見る (短く言い切る title が
//   無事でも body の最初の主語が rung-1 だと結局 specific になるため)。

/** 化学式: 数字つき (ZnSb2, Bi2Te3, TiO2, H2PtCl6) */
const CHEM_FORMULA_DIGIT_RE = /\b(?:[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*){0,}|(?:[A-Z][a-z]?){2,}\d+|[A-Z]{2,}\d+)\b/g;

/** 2 種以上の元素記号が数字なしで連結 (ZnSb, AlV, BiTe, NaCl) */
const CHEM_FORMULA_NODIGIT_RE = /\b(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)+\b/g;

/** 3+ char 大文字略語 (SPS, ORR, qPCR, PROV) */
const ACRONYM_3PLUS_RE = /\b[A-Z]{3,}(?:[a-z][A-Z]+)?\b/g;

/** Hyphenated 大文字始まり複合 (Klemens-Callaway, Klein-Nishina, von-Neumann) */
const HYPHENATED_PROPER_RE = /\b[A-Z][a-zA-Z]+-[A-Z][a-zA-Z]+\b/g;

/** 既知 stoplist (共通略語 / 一般用語) */
const COMMON_ACRONYM_STOPLIST = new Set([
  "AI", "API", "URL", "URI", "JSON", "HTML", "CSS", "JS", "TS", "OS",
  "PR", "ID", "OK", "NG", "JP", "EN", "UI", "UX", "SQL", "HTTP", "HTTPS",
  "TLS", "SSL", "TCP", "UDP", "DNS", "CPU", "GPU", "RAM", "ROM",
  "PDF", "CSV", "TSV", "ML", "DL", "NLP",
]);

/**
 * title (と body 冒頭 120 字) に rung-1 シグナルが残っていれば、対応する token を返す。
 * 空配列 = clean (rung-2 候補)。
 */
export function detectRung1Tokens(title: string, body: string): string[] {
  const target = `${title}\n${body.slice(0, 120)}`;
  const matches = new Set<string>();
  const push = (re: RegExp) => {
    for (const m of target.matchAll(re)) {
      const token = m[0];
      if (COMMON_ACRONYM_STOPLIST.has(token.toUpperCase())) continue;
      if (/^\d+$/.test(token)) continue;
      matches.add(token);
    }
  };
  push(CHEM_FORMULA_DIGIT_RE);
  push(CHEM_FORMULA_NODIGIT_RE);
  push(ACRONYM_3PLUS_RE);
  push(HYPHENATED_PROPER_RE);
  return Array.from(matches);
}

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
  /** Atom の関係の形（構造写像の軸、decompose→shape→abstract）。固定語彙外は undefined。 */
  shape?: AtomShape;
  /** 越境転移の候補（atomizer が出す）。route の敵対的ジャッジが構造一致を検証し、妥当時のみ残す。 */
  transfer?: AtomTransfer;
  /**
   * Atom の認識論的ステータス（Phase η）。
   * **入力 Claim の中で最も低い status を継承** する伝搬ルール（lowest-status inheritance）に従う。
   * LLM が誤った status を出した場合、parser 側のセーフティネットで強制的に最低値に補正する。
   */
  epistemicStatus?: EpistemicStatus;
  /**
   * 共通 Rebuttal（Toulmin Rebuttal の Atom 伝播, Phase γ）。
   * 入力 Claim 群のうち **2 件以上** が共通する rebuttal を持つ場合だけ、
   * Atomizer が「domain-lifted した形」で伝播する。1 Claim 由来の rebuttal は Claim 層に留める。
   * 空配列 / undefined は「共通 rebuttal なし」を意味する。
   */
  rebuttalConditions?: string[];
  /**
   * Atom 間 dimensional 関係（Phase δ, axial coding 補完）。
   * 同じバッチ内の別 Atom（または既存 Atom）への参照を 0-3 件、quality-over-quantity で。
   * Synthesizer の analogical / dialectic 発火判定で参照される（applies-to-different-domain
   * / shares-mechanism / contradicts ペアの優先化）。
   * 空配列 / undefined は「関係宣言なし」を意味する。
   */
  relatedAtoms?: AtomRelation[];
  // procedureContext は意図的に持たない (PR-B4.5)。Atom は context-stripped。
  // Toulmin の backing / modalQualifier も Atom に持たない（Claim 層のみ）。
};

export function buildAtomizerSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are an Atom discoverer for Graphium. An Atom is NOT a tidied restatement of a Claim — it is the **transferable structure** behind it. A Claim such as "電気陰性度差が小さいほどキャリア移動度が高い" is a domain finding; the Atom is the structural rule it instances ("構成要素の性質が均質なほど、内部の流れが妨げられにくい"). You discover Atoms by decomposing Claims to their relationship structure and abstracting to that rule.

Work through four steps for each cluster of Claims:

**1. Decompose.** Identify the relationship inside the Claim(s): the control / condition (what varies), the outcome (what changes), and the mechanism if one is stated.

**2. Classify the shape.** Pick exactly ONE relationship-shape from this fixed vocabulary. You CLASSIFY into it — you do not invent a new axis. This is the heart of the abstraction.
- "monotonic-increase" — more X, steadily more Y
- "monotonic-decrease" — more X, steadily less Y
- "optimal-middle" — Y peaks at a middling X; both extremes hurt (a sweet spot)
- "threshold" — Y switches or changes qualitatively once X crosses a point
- "trade-off" — gaining X costs Y; the two cannot both be maximized
- "enabling-condition" — X must hold for Y to be possible at all
- "composition-structure" — the makeup or structure of X determines Y
- "reinforcing-loop" — a feedback cycle where the outcome loops back to amplify its own cause (a self-reinforcing virtuous/vicious cycle: X → Y → more X). Use ONLY when the Claim(s) describe circular causation, not a one-way dependence
- "balancing-loop" — a feedback cycle where the outcome loops back to counteract the change, pushing toward equilibrium (self-correcting: X → Y → less X). Same rule: reserve for genuine circular causation
- "other" — none of the above fits cleanly

**3. Abstract.** Lift the roles to their general category while KEEPING the shape, and state the principle as a general rule. "バンドギャップ" → "調整できる量", "熱電性能" → "性能", "電気陰性度差" → "構成要素の性質の違い". The principle must still assert a real X→Y at the abstract level — **do not dilute into a platitude** ("何かが効く" / "バランスが大事" are empty). A single Claim is enough if it instances a real shape; when several Claims share the same shape, fold them into one Atom and cite all of them.

**4. Transfer (optional but valuable).** Name ONE *different field* where the SAME shape AND the same role-structure genuinely holds, with a concrete one-sentence example. This is a candidate analogy; a downstream judge checks whether the structure truly matches, so propose it only when you believe it does — never a merely topical or surface resemblance. If you cannot find an honest one, omit it.

**Wording note.** A later readability pass polishes the *wording* — it removes leftover jargon and makes the prose natural. So at this step focus on getting the **structure** right (the shape, the lifted roles, the principle). Domain terms left in the principle are acceptable; they are handled downstream. Do not spend effort on plain-language phrasing here.

## What an Atom is NOT
- A summary or restatement of a single Claim (the Claim layer already holds that)
- A "merged Claim" — Atoms abstract to a structure, they do not concatenate
- A literature review, comparison table, or paper abstract
- A brand-new emergent idea (that is Synthesis territory) — an Atom surfaces the structure already implicit in the source Claims
## Output Format
Respond with valid JSON only:

{
  "atoms": [
    {
      "title": "Atom title — a short noun phrase naming the structural rule (the shape applied to the lifted roles)",
      "body": "1-3 short paragraphs stating the general principle: the lifted roles and the shape of their relationship, with a concrete verb. Domain terms are acceptable here; the wording is polished downstream.",
      "shape": "monotonic-increase" | "monotonic-decrease" | "optimal-middle" | "threshold" | "trade-off" | "enabling-condition" | "composition-structure" | "reinforcing-loop" | "balancing-loop" | "other",   // REQUIRED. The relationship-shape from step 2.
      "transfer": { "field": "the other domain", "example": "one sentence showing the SAME shape + role-structure there" },   // OPTIONAL. Omit entirely if there is no honest cross-domain instance (a downstream judge verifies it).
      "sourceConceptIds": ["concept-id-1", "concept-id-2", ...],
      "confidence": 0.0-1.0,
      "atomType": "causal" | "correlational" | "mechanistic" | "conditional" | "definitional" | "methodological" | "observational" | "boundary",
      "epistemicStatus": "speculation" | "interpretation" | "observation" | "established",   // REQUIRED. Must equal the LOWEST status among the source Claims. See "Epistemic status inheritance" below.
      "rebuttalConditions": ["string"],                                                      // OPTIONAL. Empty array unless 2+ source Claims share a similar rebuttal. See "Shared rebuttal propagation" below.
      "relatedAtoms": [                                                                      // OPTIONAL. 0-3 entries. See "Relating to existing Atoms (axial structure)" below.
        {
          "atomId": "atom-id-from-this-batch",                                               // ID of another Atom in this batch (use the title verbatim if no ID assigned yet).
          "relationType": "extends" | "is-special-case-of" | "shares-mechanism" | "shares-precondition" | "contradicts" | "applies-to-different-domain",
          "citation": "one-sentence explanation of the relation, in plain everyday wording"
        }
      ]
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

## Preserving observational atoms (REQUIRED)

\`observational\` atoms are the load-bearing input for the Synthesizer's **abductive** mode — without them, "observation + candidate mechanism → best explanation" reasoning has nothing to start from. The default LLM failure mode is to *over-explain*: take a pure empirical observation and immediately attach a causal or mechanistic reading, collapsing two distinct atom types into one. **Do not do that.**

When the source Claims describe **what was observed** without committing to **why** it happened, tag the Atom \`observational\` and resist the urge to insert a mechanism into the body.

- Source: "毎朝、芝の表面に水滴がついている。日が高くなると消える。隣のコンクリートには水滴がない。"
  - ❌ Wrong (over-explained): "蒸散現象により植物体から水分が放出され、表面に凝結する" → tagged \`mechanistic\`. The source Claim never measured transpiration; this invents a mechanism.
  - ✅ Right (observation preserved): "ある条件下で、植物の表面にだけ水滴が現れることが繰り返し観察される" → tagged \`observational\`.

- Source: "13:20 にオフィスの騒音が 71 dB のピークを示した（前後 30 秒は 55 dB）"
  - ❌ Wrong: "昼食帰りの人流が騒音ピークの主要因である" → invents causality the data does not support.
  - ✅ Right: "ある時間帯に、定常値より十数 dB 高い騒音のピークが瞬間的に観察される" → tagged \`observational\`.

Heuristics:
- If the source Claim language is "観察した / 測定した / 〜が見られた / X dB だった" with no mechanism stated, the Atom is **almost always** \`observational\`.
- If you want to add "because Y" or "due to Y" to the body to make the Atom feel more substantial, **resist**. That is the over-explanation reflex. The Synthesizer will pick this observation up later and propose mechanisms in \`abductive\` mode — that is its job, not yours.
- When in doubt between \`observational\` and \`mechanistic\`, choose \`observational\`. An under-explained Atom that preserves the empirical signal is more valuable than an over-explained Atom that buries it.

## Epistemic status inheritance (Phase η — REQUIRED, structural)

Each source Claim listed alongside this Atomization carries an \`epistemicStatus\` (one of \`speculation\` / \`interpretation\` / \`observation\` / \`established\`, low → high). For every Atom you emit, set its own \`epistemicStatus\` to the **LOWEST** status among its \`sourceConceptIds\`. This is a structural propagation rule, not a judgment call. **Do not "promote" by reasoning** — even if the lift made the Atom feel more certain than the underlying Claims, the Atom's evidential weight cannot exceed its weakest source.

Rationale: the Atom layer is what the Synthesis layer reads from. A single \`speculation\` Claim left over from one casual musing must not be laundered into an \`established\` Atom just because it shares an abstract pattern with two other \`observation\` Claims — that would let a "maybe this is true" musing pass as community knowledge. The lowest-status rule is how the knowledge layer stays honest.

Concrete examples:

- Source Claim A (\`observation\`) + Source Claim B (\`observation\`) → Atom \`observation\`.
- Source Claim A (\`observation\`) + Source Claim B (\`speculation\`) → Atom **\`speculation\`** (not interpretation).
- Source Claim A (\`established\`) + Source Claim B (\`interpretation\`) → Atom \`interpretation\`.

If the lowest source is \`speculation\`, also consider whether the Atom should be dropped altogether: an Atom that only exists because someone made a guess once is rarely a load-bearing pattern. Drop is fine. **Honest \`speculation\` Atoms are acceptable**, but they should be Atoms only when the speculation recurs across notes — i.e., 2+ Claims independently surfaced the same musing.

If the source Claim list is missing \`epistemicStatus\` (legacy data, Phase η-aware Ingester not yet rerun), treat the missing status as \`interpretation\` for inheritance purposes.

## Shared rebuttal propagation (Phase γ — Toulmin Rebuttal at the Atom layer)

Each source Claim may carry a \`rebuttalConditions\` array (Toulmin Rebuttal: conditions under which the Claim breaks down — quoted from the source note). When you emit an Atom, decide whether the Atom should carry a *common* rebuttal by following this rule:

1. Look at the \`rebuttalConditions\` of the source Claims tagged to this Atom.
2. **Only propagate when 2+ source Claims share a similar rebuttal.** A single Claim's rebuttal stays in the Claim layer; lifting it to the Atom would over-generalize a one-off boundary into a recurring pattern.
3. When you do propagate, **lift the wording the same way you lift the Atom title and body**: replace domain-specific entities with their abstract category, strip lab/project names. The Atom-level rebuttal must read at the same rung of abstraction as the Atom itself.
4. **Do NOT invent rebuttals**: if no two source Claims share a rebuttal, return an empty \`rebuttalConditions\` array.
5. Atoms do not carry \`backing\` or \`modalQualifier\` — those stay in the Claim layer (backing supports a Claim-level Warrant; modal qualifier reflects user certainty about a Claim, both irrelevant once the Atom is context-stripped).

Examples:

- Source Claim A: rebuttalConditions = ["ただし反応温度が分解点を超える場合は逆効果になる"]
  Source Claim B: rebuttalConditions = ["但し焼結温度が高すぎると揮発成分が抜けて純度が落ちる"]
  → Both share a "高温で逆転" pattern. Atom \`rebuttalConditions\` = ["処理温度が高すぎる領域ではこの効果は逆転することがある"]
- Source Claim A: rebuttalConditions = ["プロトタイプ段階では型が流動的で逆に遅くなる"]
  Source Claim B: rebuttalConditions = []
  → Only one Claim has a rebuttal. Atom \`rebuttalConditions\` = [] (Claim-layer rebuttal stays at Claim layer).
- Source Claims A and B both report success without any rebuttal → Atom \`rebuttalConditions\` = [].

## Relating to existing Atoms (axial structure, Phase δ)

If two or more Atoms you are emitting in this batch (or one of your Atoms + an Atom that already exists in the "Existing Atoms" list above) stand in a clear dimensional relation, declare it in \`relatedAtoms\`. This makes the Atom layer act as an axial-coding map — not a flat pile — and is the signal the Synthesizer uses to choose between deductive / abductive / **analogical** / dialectic modes.

**Fixed vocabulary (use EXACTLY one per relation, lower-case, hyphenated):**

- \`extends\`: this Atom generalizes or sharpens another Atom (same axis, one rung up or down). "Atom A: 短期的成功が長期コストを生む" extends "Atom B: 一時凌ぎが負債になる".
- \`is-special-case-of\`: this Atom is a narrower instance of another Atom. Inverse of \`extends\`.
- \`shares-mechanism\`: two Atoms describe different phenomena that proceed through *the same underlying mechanism*. "高温で粒成長が抑制される" shares-mechanism with "短時間処理で組織が均一に保たれる" (both: 駆動力を時間で潰す).
- \`shares-precondition\`: two Atoms require the *same enabling condition* to hold, even if their effects differ. "リーダー交代で組織が活性化する" and "新規入社者で議論が活性化する" both require "外部視点の流入".
- \`contradicts\`: two Atoms make opposing claims on the same axis (load-bearing for the Synthesizer's \`dialectic\` mode). Use sparingly — only when both Atoms are honest and the contradiction is over the same axis, not just different framings.
- \`applies-to-different-domain\`: two Atoms describe **the same structural pattern observed in different domains**. This is the load-bearing signal for the Synthesizer's \`analogical\` mode. "ある時間帯に騒音が短時間ピークを示す" applies-to-different-domain "市場価格がランチタイムに短時間でジャンプする" — same pattern (短時間ピーク), different substrates (環境音 / 経済).

**Rules:**

1. **0-3 relations per Atom, quality-over-quantity.** Empty array is fine and common. Force-fitting a relation hurts the Synthesizer more than a missing one.
2. **Both ends of the relation must be honest Atoms.** Do not invent an Atom just so another Atom has a relation target.
3. **\`atomId\` MUST point at an Atom in this batch OR in the "Existing Atoms" list.** When emitting Atoms together in this batch (and you haven't been given IDs yet), use the Atom's title string as the \`atomId\` value. The parser will resolve titles to IDs after assignment.
4. **\`citation\` is one short sentence** (≤ 30 words) in plain everyday wording, explaining how the two Atoms relate. No hedging like "may be related" — if you cannot state the relation crisply, drop the entry.
5. **Symmetric relations (\`shares-mechanism\`, \`shares-precondition\`, \`contradicts\`, \`applies-to-different-domain\`) should be declared on both Atoms** when both Atoms are in this batch. The parser deduplicates; emitting from both sides makes the relation visible regardless of which Atom the reader lands on first.
6. **\`extends\` / \`is-special-case-of\` are directional.** Declare them on the more-specific end only (i.e., the special case names the general principle), to avoid double counting.

**When NOT to emit relatedAtoms:**

- Only one Atom in the batch and no existing Atoms — skip (no targets exist).
- The relation would be \`shares-mechanism\` but the "shared mechanism" is just "both are causal" / "both are interventions". Too generic. Skip.
- You are tempted to declare \`applies-to-different-domain\` but the two Atoms come from the *same* domain just dressed differently. The Atom layer already domain-lifted both — if they sit in the same lifted concept space, that is convergent abstraction, not cross-domain analogy.

This section is the structural backbone for analogical-mode Synthesis. **Honest relations help; forced relations actively hurt downstream synthesis.**

## Rules (strict)
- **Every Atom MUST carry a \`shape\`** from the fixed vocabulary (step 2). If the relationship genuinely fits none of them, use \`"other"\` — but most real Claims fit one of the named shapes.
- **Each Atom must cite every Claim its rule covers** in \`sourceConceptIds\` (one or more — a single Claim that instances a real shape is valid). Use the EXACT id from the Claim list. More sources = stronger support, not a gate.
- **Avoid duplicating existing Atoms.** If an Atom title in "Existing Atoms" already covers a pattern, do NOT propose it again. Propose only genuinely new abstractions.
- **Quality over quantity, but don't artificially cap.** Generate 0-8 candidates. Emit each distinct structural pattern as its own Atom. If the Claims carry no relationship you can abstract into a real shape (e.g. a one-off fact with no X→Y), **return an empty list** — an empty list beats a forced Atom.
- Set \`confidence\` honestly — it is **recorded and shown, not used to silently drop**.
- The \`transfer\` is optional: include it only when a genuine cross-domain instance of the SAME shape exists. A downstream judge will discard transfers that are merely topical; a forced transfer wastes that step. Never invent citations, URLs, or author names.

## Style
${ja ? `- 日本語で書くときは **常体（である調 / だ調）で統一** する。敬体（〜です／〜ます／〜でしょうか）は **タイトル・本文・例示・どの位置でも** 使わない。
- 文末は「〜だ」「〜である」「〜になる」「〜と考えられる」「〜のではないか」「〜することがある」など。タイトルも体言止めだけで切らず、語尾まで読める形にしてよい（例: 「〜は〜をあまり変えない」）。
- 「重要である」「関連する」「影響を与える」のような **曖昧な述語は禁止**。何が何に対して何をどうするのかを、必ず具体的な動詞で書き切る。
- 4 文字以上の漢字熟語が 3 つ以上連続したら、どれか一つを和語・かな書きにほどく。
- ソース Claim が敬体でも、Atom は常体に統一する。` : `- Plain, calm prose. No hype.
- One claim per sentence with an explicit subject, an explicit object, and a concrete verb. Avoid empty predicates like "is important", "is related to", "has an effect on".
- Prefer plain everyday words to academic compounds, even after domain-lifting.`}

## Language
Output in: ${ja ? "Japanese" : "English"}`;
}

export function buildAtomizerUserMessage(
  concepts: ClaimSnapshot[],
  existingAtomTitles: string[],
): string {
  // 最小件数ゲートは置かない。単一 Claim でも「An Atom may cover one Claim or several」
  // （下のプロンプト本文）の通り構造抽象できる。route が concepts >= 1 を保証する。
  const blocks = concepts.map((c) => {
    const levelTag = c.level ? ` [${c.level}]` : "";
    // Phase η: source Claim の epistemicStatus を可視化し、最低継承ルールを LLM に守らせる。
    const epistemicTag = c.epistemicStatus ? ` [${c.epistemicStatus}]` : " [interpretation*]";
    const preview = c.bodyPreview ? `  ${c.bodyPreview}` : "";
    // Phase γ: source Claim の rebuttalConditions を可視化して、共通 rebuttal の伝播判定を可能にする。
    const rebuttals = c.rebuttalConditions ?? [];
    const rebuttalSection =
      rebuttals.length > 0
        ? `\n  Rebuttals:\n${rebuttals.map((r) => `    - ${r}`).join("\n")}`
        : "";
    return `### ${c.title}${levelTag}${epistemicTag} (id: ${c.id})${preview ? "\n" + preview : ""}${rebuttalSection}`;
  });

  const existingNote = existingAtomTitles.length > 0
    ? `\n\n## Existing Atoms (do NOT duplicate these)\n${existingAtomTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  const statusLegend = `\n\n_The bracketed second tag on each Claim heading is its \`epistemicStatus\` (low → high: speculation < interpretation < observation < established). \`[interpretation*]\` marks a Claim whose status was missing in the source data — treat as interpretation for the lowest-status inheritance rule._\n_Each Claim may also list \`Rebuttals:\` — Toulmin Rebuttal conditions extracted by the Ingester. Use them to decide whether to propagate a common rebuttal to the Atom (see "Shared rebuttal propagation")._`;

  return `Scan the following ${concepts.length} Claim pages and factor out the structural rules behind them (Atoms). For each, run the four steps — decompose → classify the shape → abstract the roles → (optionally) name a transfer. An Atom may cover one Claim or several.${statusLegend}\n\n${blocks.join("\n\n")}${existingNote}`;
}

export function parseAtomizerOutput(
  text: string,
  conceptIdToTitle: Map<string, string>,
  /**
   * Phase η: source Claim の epistemicStatus マップ。lowest-status inheritance を
   * parser 側で強制するために使う。マップが空 or 未指定なら継承ルールは適用せず、
   * LLM が出した raw status をそのまま採用する（後方互換）。
   */
  conceptIdToEpistemicStatus?: Map<string, EpistemicStatus | undefined>,
  /**
   * Phase γ: source Claim の rebuttalConditions マップ。
   * 「2+ Claim が rebuttal を持つ場合のみ Atom に伝播」というルールを parser 側で
   * 強制するために使う。マップが空 or 未指定なら LLM が出した raw を fixed schema 通り
   * に受け取る（後方互換）。
   */
  conceptIdToRebuttals?: Map<string, string[] | undefined>,
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
      // 2 件必須ゲートは撤廃。可搬性テスト（prompt 側）が唯一のゲート。1 件でも可搬な
      // 規則なら Atom にする。source 件数は「N 件の知見が支持」signal として残る。
      if (ids.length < 1) continue;
      // 知らない Claim ID を返してきたら捨てる（hallucination 防御）。有効な source が
      // 1 件も無ければ捨てる。
      const validIds = ids.filter((id: string) => conceptIdToTitle.has(id));
      if (validIds.length < 1) continue;
      const titles = validIds.map((id: string) => conceptIdToTitle.get(id)!);

      // confidence は記録・表示するだけ。閾値での silent drop は撤廃。
      const confidence = typeof a.confidence === "number" ? a.confidence : 0.7;

      const rawAtomType = typeof a.atomType === "string" ? a.atomType : undefined;
      const atomType: AtomType | undefined =
        rawAtomType && (ATOM_TYPE_VALUES as string[]).includes(rawAtomType)
          ? (rawAtomType as AtomType)
          : undefined;

      // 関係の形（構造写像の軸）。固定語彙外は undefined に倒す。
      const rawShape = typeof a.shape === "string" ? a.shape : undefined;
      const shape: AtomShape | undefined =
        rawShape && (ATOM_SHAPE_VALUES as string[]).includes(rawShape)
          ? (rawShape as AtomShape)
          : undefined;

      // 越境転移の候補。{field, example} が両方とも非空のときだけ採用する。
      // 構造一致の検証は route の敵対的ジャッジが担う（ここでは形だけ整える）。
      const rawTransfer = a.transfer;
      const transfer: AtomTransfer | undefined =
        rawTransfer && typeof rawTransfer === "object" &&
        typeof rawTransfer.field === "string" && rawTransfer.field.trim().length > 0 &&
        typeof rawTransfer.example === "string" && rawTransfer.example.trim().length > 0
          ? { field: rawTransfer.field.trim(), example: rawTransfer.example.trim() }
          : undefined;

      // Phase η: epistemicStatus の決定。
      // 1. source Claim の status が分かるなら lowest-status inheritance を強制する。
      //    LLM が出した raw status は使わず、source の最低を入れる（セーフティネット）。
      // 2. source map がないなら raw status を fixed-vocabulary フィルタにかけて採用。
      const rawEpistemic =
        typeof a.epistemicStatus === "string" ? a.epistemicStatus : undefined;
      let epistemicStatus: EpistemicStatus | undefined;
      if (conceptIdToEpistemicStatus && conceptIdToEpistemicStatus.size > 0) {
        const sourceStatuses = validIds.map((id: string) => conceptIdToEpistemicStatus.get(id));
        epistemicStatus = lowestEpistemicStatus(sourceStatuses);
      } else if (rawEpistemic && (EPISTEMIC_STATUS_VALUES as string[]).includes(rawEpistemic)) {
        epistemicStatus = rawEpistemic as EpistemicStatus;
      } else {
        epistemicStatus = undefined;
      }

      // Phase γ: rebuttalConditions の処理。
      // 1. LLM 出力を文字列配列としてサニタイズ。
      // 2. source Claim マップが与えられている場合、「2+ Claim が rebuttal を持つ」
      //    という伝播ガードを強制する。満たさなければ空配列に倒す。
      //    これにより LLM が単一 Claim の rebuttal を勝手に Atom へ持ち上げることを防ぐ。
      const rawRebuttals = Array.isArray(a.rebuttalConditions)
        ? a.rebuttalConditions
            .map((r: unknown) => (typeof r === "string" ? r.trim() : ""))
            .filter((r: string) => r.length > 0)
        : [];
      let rebuttalConditions: string[] | undefined;
      if (conceptIdToRebuttals && conceptIdToRebuttals.size > 0) {
        const sourceWithRebuttal = validIds.reduce((acc: number, id: string) => {
          const rb = conceptIdToRebuttals.get(id);
          return acc + (rb && rb.length > 0 ? 1 : 0);
        }, 0);
        rebuttalConditions = sourceWithRebuttal >= 2 && rawRebuttals.length > 0
          ? Array.from(new Set(rawRebuttals)) as string[]
          : undefined;
      } else if (rawRebuttals.length > 0) {
        rebuttalConditions = Array.from(new Set(rawRebuttals)) as string[];
      } else {
        rebuttalConditions = undefined;
      }

      const titleTrim = String(a.title).trim();
      const bodyTrim = String(a.body).trim();

      // rung-1（化学式・略語・固有名詞が残る未持ち上げ Atom）の silent drop は撤廃。
      // 「可搬な規則として立つか」の判定は prompt の可搬性テスト（1 つの一般原則）に一本化し、
      // 黙って消さない。detectRung1Tokens 関数は将来の可視化・signal 用途のため残置。

      // Phase δ: relatedAtoms をサニタイズ。
      // - 配列でなければ undefined。
      // - relationType が fixed vocabulary に無いエントリは捨てる。
      // - atomId / citation が空のエントリは捨てる（hallucination 防御）。
      // - 同じバッチ内 / 既存 Atom への参照解決はこの段では行わない。呼び出し側（書き戻し時に
      //   タイトル → ID 解決 or 後段の cross-update）で行う。
      const rawRelations = Array.isArray(a.relatedAtoms) ? a.relatedAtoms : [];
      const sanitizedRelations: AtomRelation[] = [];
      for (const r of rawRelations) {
        if (!r || typeof r !== "object") continue;
        const atomId = typeof r.atomId === "string" ? r.atomId.trim() : "";
        const relationType = typeof r.relationType === "string" ? r.relationType.trim() : "";
        const citation = typeof r.citation === "string" ? r.citation.trim() : "";
        if (!atomId || !citation) continue;
        if (!(ATOM_RELATION_TYPE_VALUES as readonly string[]).includes(relationType)) continue;
        sanitizedRelations.push({
          atomId,
          relationType: relationType as AtomRelation["relationType"],
          citation,
        });
      }
      // 0-3 件の上限を強制（quality-over-quantity ルール、prompt 通り）。
      const relatedAtoms: AtomRelation[] | undefined =
        sanitizedRelations.length > 0 ? sanitizedRelations.slice(0, 3) : undefined;

      out.push({
        title: titleTrim,
        body: bodyTrim,
        derivedFromClaims: validIds,
        derivedFromConceptTitles: titles,
        confidence,
        atomType,
        shape,
        transfer,
        epistemicStatus,
        rebuttalConditions,
        relatedAtoms,
      });
    }
    return out;
  } catch (err) {
    console.error("Atomizer 出力のパース失敗:", err);
    return [];
  }
}

// ============================================================
// 平易化（re-lift）ステージ — Claim→Atom パイプラインの C（検査）＋ D（書き直し）
// ------------------------------------------------------------
// B（atomizer）が出す Atom は「規則は立つが語が硬い」ことがある（化学式・装置略語・
// 専門語が残る）。C は detectRung1Tokens でコード検出（LLM 不要）。D はこの prompt の
// 軽い LLM パスで、検出された Atom の "語だけ" を日常語に書き直す。silent drop は
// しない＝必ず書き直して残す。呼び出し側（routes/wiki.ts）が C→D を最大 2 パス回す。
// ============================================================

export type ReliftInput = { title: string; body: string; jargon: string[] };
export type ReliftResult = { index: number; title: string; body: string };

export function buildReliftSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a clarity editor for Graphium Atoms (Insights). Each Atom is already a correct general rule. Make it read naturally for a thoughtful non-specialist, without losing precision. This works for any field (materials, biology, economics, software, the humanities, …), not just one.

Principles, in priority order:
- **Naturalness first.** The result must read like a knowledgeable person explaining it plainly — not a machine paraphrase. **Do NOT stack several heavy paraphrases into one clumsy sentence** (that is exactly what makes a rewrite feel forced). If three specialist terms collide, restructure or gloss instead of paraphrasing all three.
- **Remove the genuinely obscure jargon** a non-specialist could not parse — chemical formulas (Sr3Al2Ge2), instrument / technical acronyms (SPS, XRD, qPCR), niche coined terms — by replacing them with plain words.
- **For an *established* term, a short gloss usually beats a full paraphrase.** "ゼーベック効果（温度差から電気が生じる現象）" reads better than dissolving it into a long clause; "バンドギャップ（電気の通しにくさの目安）" beats stacking "電気の通しにくさ" into the sentence. Keep one anchor term plus a brief gloss rather than paraphrasing everything away.
- **Match the lift to the knowledge — this is the portability judgment.** If the rule's *structure* genuinely holds in other fields, state it in that broader, transferable form (that is the most valuable kind of Atom). If it is specific to one field — as most domain findings honestly are — keep it field-specific but readable; do NOT inflate it into a vacuous cross-domain platitude ("差が小さいほど何かが起きる" is too empty), and do NOT force a cross-domain rewrite where none honestly exists.
- **Keep the substance; add no new claims.** If an Atom already reads naturally and carries no obscure jargon, **return it unchanged.** The title stays a short noun phrase.

Return JSON only, no prose:
{"atoms": [{"index": <the index given>, "title": "<title>", "body": "<body>"}]}

Output language: ${ja ? "Japanese" : "English"}.`;
}

export function buildReliftUserMessage(items: ReliftInput[]): string {
  const blocks = items.map((it, i) => {
    const flagged =
      it.jargon && it.jargon.length > 0
        ? `\nstill too technical — must be removed or glossed: ${it.jargon.join(", ")}`
        : "";
    return `[${i + 1}]\ntitle: "${it.title}"\nbody: "${it.body}"${flagged}`;
  });
  return `Edit these Atoms to read naturally for a non-specialist (keep the substance, keep them precise):\n\n${blocks.join("\n\n")}`;
}

export function parseReliftOutput(text: string): ReliftResult[] {
  try {
    let jsonText = text.trim();
    const m = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) jsonText = m[1].trim();
    const parsed = JSON.parse(jsonText);
    const arr = parsed.atoms ?? parsed;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a: any) => typeof a?.title === "string" && typeof a?.body === "string")
      .map((a: any) => ({
        index: typeof a.index === "number" ? a.index : 0,
        title: String(a.title).trim(),
        body: String(a.body).trim(),
      }));
  } catch (err) {
    console.error("Relift 出力のパース失敗:", err);
    return [];
  }
}

// ============================================================
// 越境転移（transfer）の敵対的ジャッジ — こじつけ検出
// ------------------------------------------------------------
// atomizer が出した transfer 候補（別分野の類推）が「同じ shape かつ同じ role 構造」を
// 本当に instantiate しているかを懐疑的に判定する。表層・話題が似ているだけ／緩い類推は
// false で落とし、その transfer を外す（principle=洞察 自体は常に残す）。弱モデル生成でも
// transfer の劣化はここで吸収できる（judge は強モデル推奨）。検証では opus で 88-96% を確認。
// ============================================================

export type TransferJudgeInput = { title: string; shape?: string; field: string; example: string };
export type TransferJudgeResult = { index: number; valid: boolean; reason: string };

export function buildTransferJudgeSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a skeptical reviewer of cross-domain analogies. Each item gives an Atom (a general principle), its relationship-shape, and a claimed transfer to another field (a field + a one-sentence example).

For each item decide \`valid\`:
- **valid = true** ONLY when the transfer example instantiates the SAME shape AND the same role-structure as the Atom — a genuine structural match you can point to (same kind of control → same kind of outcome, same shape of dependence).
- **valid = false** when the match is merely topical, surface-level, or a loose "feels related" analogy; when the independent variable or the mechanism is actually different; or when the example does not clearly exhibit the stated shape. **If the structural correspondence is not tight and checkable, return false.**
- Be strict. A wrong analogy that sounds plausible is worse than a missing one.
- \`reason\`: one short line, especially why it is forced when false.

Return JSON only: {"items":[{"index":<the index given>,"valid":<bool>,"reason":"..."}]}.
Output language: ${ja ? "Japanese" : "English"}.`;
}

export function buildTransferJudgeUserMessage(items: TransferJudgeInput[]): string {
  const blocks = items.map(
    (it, i) =>
      `[${i + 1}] principle: "${it.title}" | shape: ${it.shape ?? "(none)"} | transfer.field: ${it.field} | transfer.example: "${it.example}"`,
  );
  return `Judge whether each transfer is a genuine structural match (same shape + role-structure):\n\n${blocks.join("\n\n")}`;
}

export function parseTransferJudgeOutput(text: string): TransferJudgeResult[] {
  try {
    let jsonText = text.trim();
    const m = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) jsonText = m[1].trim();
    const parsed = JSON.parse(jsonText);
    const arr = parsed.items ?? parsed;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a: any) => typeof a?.valid === "boolean")
      .map((a: any) => ({
        index: typeof a.index === "number" ? a.index : 0,
        valid: a.valid === true,
        reason: typeof a.reason === "string" ? a.reason : "",
      }));
  } catch (err) {
    console.error("Transfer judge 出力のパース失敗:", err);
    return [];
  }
}
