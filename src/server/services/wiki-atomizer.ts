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

import type { AtomType, EpistemicStatus } from "../../lib/document-types.js";
import { lowestEpistemicStatus, EPISTEMIC_STATUS_ORDER } from "../../lib/document-types.js";
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
  // procedureContext は意図的に持たない (PR-B4.5)。Atom は context-stripped。
  // Toulmin の backing / modalQualifier も Atom に持たない（Claim 層のみ）。
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

Run this **three-step domain-jargon checklist** on the title and body before emitting:

1. **Scan for surviving domain tokens.** Look in both the title and the body for any of:
   - **Proper nouns**: instrument / device names (SPS, GPT-4, Dr Sinter), library / framework / DB names (PostgreSQL, React, Redis, BlockNote), person names tied to a law / formula (Klemens-Callaway, Klein-Nishina, Bayes), project / standard / spec names (PROV-DM, OAuth, JIRA).
   - **Material / chemical specifics**: chemical formulas with digits (ZnSb, Bi2Te3, TiO2), bare two-letter element compounds without a digit (ZnSb, AlV, BiTe), single element symbols used as load-bearing subject ("Pt 担持", "Zn 蒸発").
   - **Abbreviations / acronyms**: 3+ letter all-caps (SPS, VACUUM, ORR, MHC, qPCR, siRNA, TDD, ZT, CI, TTL, MPS, Saga); compound acronyms (PROV-DM, gRPC).
   - **Domain jargon a non-specialist would not recognize**: 物理 / 材料系 ("単相化", "律速", "ローレンツ数", "デバイ温度", "ホットプレス", "ホール濃度", "パワーファクター", "格子熱伝導率", "点欠陥散乱", "焼結", "ゼーベック", "クライペーロン"); 生命科学系 ("ノックダウン", "トランスフェクション", "in vitro", "PCR"); ソフトウェア系 ("マイクロサービス", "クロスバリデーション", "シャーディング", "リードレプリカ").

   If even one such token is a load-bearing subject or object — that is, removing it would make the sentence empty — the Atom is rung-1 at best. Go to step 2.

2. **Lift the surviving token one more level.** Replace the entity with the category it belongs to:
   - "SPS" → "短時間の高温処理"
   - "VACUUM" → "裏で動く保守処理"
   - "ORR 活性" → "還元反応の起こりやすさ"
   - "siRNA トランスフェクション" → "遺伝子の働きを止める導入操作"
   - "Al3V 系合金" → "複数の元素でできた合金"
   - "ZnSb / Bi2Te3" → "電気を流しつつ熱は通しにくい材料" / "二種類の元素でできた化合物"
   - "Klemens-Callaway モデル" → "格子の振動から熱の伝わりを見積もる古典的なモデル"
   - "ローレンツ数" → "電気の流れやすさと熱の伝わりやすさの比"
   - "PROV-DM" → "由来を辿れるかたちで作業を記述する規格"
   - "ホール濃度" → "電気を運ぶ粒子の密度"
   - "ホットプレス" → "高温で押し固める処理"
   - "パワーファクター" → "電気エネルギーへの変換しやすさ"
   - "格子熱伝導率" → "熱が結晶の振動として伝わる効率"

   If you can produce a sentence that still names what is happening but reads naturally without the original token, you have rung-2. Re-run step 1; iterate until clean.

3. **If step 2 cannot be done honestly, drop the candidate.** "Honestly" means the lifted wording still says what the source Claims actually showed — not a generic platitude. If the only way to lift is to dilute the claim into meaninglessness, the right move is to leave the knowledge at the Claim layer and not emit an Atom. **An empty atoms array is better than an under-abstracted Atom.**

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

❌ **Bad — too specific (rung-0):**
> "SPS で ZnSb を 800℃ 5 分焼結したらほぼ単相になった"

⚠️ **Still off — rung-1 stop (plain wording, but domain-locked):**
> "SPS焼結で揮発成分が飛ぶと単相化しやすい"
>
> Why off: the **register is already plain**, so it *feels* like an Atom. But "SPS焼結" / "単相化" still anchor the sentence in metallurgy — a reader outside that domain cannot picture what acts on what. This is the most dangerous trap, because the wording quality hides that the abstraction level did not move. **Plain words alone do not earn an Atom; the domain entities must be lifted too.**

✅ **Good — rung-2 (plain *and* domain-lifted):**
> "短時間の高温処理で揮発しやすい成分がほどよく抜けると、均一な仕上がりに繋がります"
>
> Why good: every domain-anchor is replaced with a category-level term ("SPS焼結" → "短時間の高温処理", "亜鉛" → "揮発しやすい成分", "単相化" → "均一な仕上がり"). Subject ("短時間の高温処理") / relation ("揮発しやすい成分が抜ける") / effect ("均一な仕上がり") are all explicit *and* portable to other domains (a paper firing kiln, a coffee roast).

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
      "atomType": "causal" | "correlational" | "mechanistic" | "conditional" | "definitional" | "methodological" | "observational" | "boundary",
      "epistemicStatus": "speculation" | "interpretation" | "observation" | "established",   // REQUIRED. Must equal the LOWEST status among the source Claims. See "Epistemic status inheritance" below.
      "rebuttalConditions": ["string"]                                                       // OPTIONAL. Empty array unless 2+ source Claims share a similar rebuttal. See "Shared rebuttal propagation" below.
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
  - ✅ Right (observation preserved): "ある条件下で、植物の表面にだけ水滴が現れることが繰り返し観察されます" → tagged \`observational\`.

- Source: "13:20 にオフィスの騒音が 71 dB のピークを示した（前後 30 秒は 55 dB）"
  - ❌ Wrong: "昼食帰りの人流が騒音ピークの主要因である" → invents causality the data does not support.
  - ✅ Right: "ある時間帯に、定常値より十数 dB 高い騒音のピークが瞬間的に観察されます" → tagged \`observational\`.

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
  → Both share a "高温で逆転" pattern. Atom \`rebuttalConditions\` = ["処理温度が高すぎる領域ではこの効果は逆転することがあります"]
- Source Claim A: rebuttalConditions = ["プロトタイプ段階では型が流動的で逆に遅くなる"]
  Source Claim B: rebuttalConditions = []
  → Only one Claim has a rebuttal. Atom \`rebuttalConditions\` = [] (Claim-layer rebuttal stays at Claim layer).
- Source Claims A and B both report success without any rebuttal → Atom \`rebuttalConditions\` = [].

## Rules (strict)
- **Each Atom MUST cite >= 2 Claims** in \`sourceConceptIds\`. Use the EXACT id from the Claim list.
- **Avoid duplicating existing Atoms.** If an Atom title in "Existing Atoms" already covers a pattern, do NOT propose it again. Propose only genuinely new abstractions.
- **Quality over quantity, but don't artificially cap.** Generate 0-8 candidates. If the Claim set surfaces multiple distinct recurring patterns, emit each as its own Atom rather than bundling them. If the Claims share only narrow domain-bound details and you cannot lift them honestly, **return an empty list**. An empty list is better than an under-abstracted Atom, and 3 honest Atoms beat 6 forced ones.
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

  return `Scan the following ${concepts.length} Claim pages and factor out the recurring abstract ideas (Atoms) that span 2+ Claims.${statusLegend}\n\n${blocks.join("\n\n")}${existingNote}`;
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

      // Post-emit rung-1 guard. prompt 強化だけでは LLM が rung-1 を押し込むケース
      // (Al3V / Klemens-Callaway / PROV-DM など) が残るため、parse 後に programmatic
      // 検知して drop する。corpus-agnostic な pattern (化学式・3+char 略語・hyphenated
      // 人名物理式) に限定 — jargon-likeness の最終判定は LLM judge に委ねる。
      const rung1 = detectRung1Tokens(titleTrim, bodyTrim);
      if (rung1.length > 0) {
        console.warn(
          `[atomizer] dropped rung-1 atom candidate (tokens: ${rung1.slice(0, 5).join(", ")}): "${titleTrim}"`,
        );
        continue;
      }

      out.push({
        title: titleTrim,
        body: bodyTrim,
        derivedFromClaims: validIds,
        derivedFromConceptTitles: titles,
        confidence,
        atomType,
        epistemicStatus,
        rebuttalConditions,
      });
    }
    return out;
  } catch (err) {
    console.error("Atomizer 出力のパース失敗:", err);
    return [];
  }
}
