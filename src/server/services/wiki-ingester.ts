// Wiki Ingester
// ノートコンテンツを LLM に渡して Wiki ドキュメントの構造化データを生成する

import type {
  BackingEntry,
  ClaimLevel,
  ClaimRole,
  EpistemicStatus,
  KeyParameter,
  ModalQualifier,
  ProcedureContext,
  WikiKind,
} from "../../lib/document-types.js";
import {
  BACKING_SOURCE_VALUES,
  EPISTEMIC_STATUS_ORDER,
  MODAL_QUALIFIER_VALUES,
} from "../../lib/document-types.js";

/** Claim の研究プロセス役割（提案 v4 Phase 1.1）として認める値の一覧 */
const CLAIM_ROLE_VALUES: ClaimRole[] = [
  "finding",
  "decision",
  "anomaly",
  "question",
  "setup",
  "interpretation",
  "issue",
];

/** Phase η: EpistemicStatus として認める値（順序 = 低→高） */
const EPISTEMIC_STATUS_VALUES = EPISTEMIC_STATUS_ORDER;

/** KeyParameter.necessity として認める値の一覧 */
const NECESSITY_VALUES: KeyParameter["necessity"][] = ["critical", "important", "incidental"];

export type WikiSection = {
  heading: string;
  content: string;
};

export type RelatedClaimRef = {
  title: string;
  /** この Claim との関連を説明する一�� */
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
  /** Claim の抽象度レベル（claim のみ。summary では undefined） */
  level?: ClaimLevel;
  /** principle 判定時に LLM が指し示したノート内の該当文（自己検証用） */
  evidenceSpan?: string;
  /**
   * Claim の研究プロセス役割（提案 v4 Phase 1.1）。
   * claim のみで意味を持つ。複数値可。LLM が自動推定する。
   * 認識不能・パース失敗時は undefined で、機能的には従来通り動作する。
   */
  claimRole?: ClaimRole[];
  /**
   * 命題の認識論的ステータス（Phase η）。
   * claim のみで意味を持つ。LLM が note 中の hedge marker / 観察言語 / 教科書参照
   * などから自動推定。不明時は undefined (= interpretation 扱い)。
   */
  epistemicStatus?: EpistemicStatus;
  /**
   * 主張が依存する手順条件（提案 v4 Phase 2.3）。
   * Claim のみで意味を持つ。LLM が PROV 構造を読んで埋める。
   * Procedure-independent な命題（純粋に概念的なもの）では undefined。
   */
  procedureContext?: ProcedureContext;
  /**
   * 反例条件（Toulmin Rebuttal, Phase γ）。Claim のみで意味を持つ。
   * ノート本文に「ただし X の場合は」「except when」等の記述が無ければ空配列。
   * LLM に無理な捻出は禁止（Do NOT invent）。
   */
  rebuttalConditions?: string[];
  /**
   * Warrant の裏付け（Toulmin Backing, Phase γ）。Claim のみで意味を持つ。
   * 教科書・外部論文・内部 Claim を Warrant（推論則）の根拠として明示している場合のみ抽出。
   */
  backing?: BackingEntry[];
  /**
   * 確からしさの程度（Toulmin Modal qualifier, Phase γ）。Claim のみで意味を持つ。
   * 不明時は "probably" にフォールバックする保守的デフォルト。
   */
  modalQualifier?: ModalQualifier;
  /** 関連する既存 Claim（引用付き） */
  relatedClaims: RelatedClaimRef[];
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
 * 知識発展型: ノートの単純な要約ではなく、既存 Claim との関連づけ・
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

  const hasExistingConcepts = existingWikis.some((w) => w.kind === "claim");

  const ja = language === "ja";

  const skillSection = skills && skills.length > 0
    ? `\n\n## Applied Style Skills (apply these to ALL output below)\n\nThe following style skills define the voice, register, and rhythm of every note you write. Treat them as overriding any default tone you would otherwise use. Re-read them before writing each Summary or Claim.\n\n${skills.map((s) => `### ${s.title}\n\n${s.prompt}`).join("\n\n")}`
    : "";

  return `You are a note writer for Graphium, a provenance-tracking note editor.

You produce two kinds of pages: a private **Summary** of one note (the local context), and one or more public-ready **Claims** that crystallize knowledge in a transferable form. Claims may eventually be shared as Knowledge Packs, so Claim content must be PII-free and abstracted from one-off specifics. Graphium is domain-general — assume the user's notes can be on any topic (research, software, planning, learning, business, etc.) and never inject a research-paper register unless the source note clearly is one.

## Voice (read this first)

Write so a future reader **wants to keep reading**. Most generated notes fail because they read like form-filled reports. Don't do that.

- The first 1-2 sentences are a **hook**, not a meta-summary. State the finding, the tension, or the surprise. Never write "This note discusses..." / "本ノートでは…を扱う" — start with the substance itself.
- Use specific verbs and concrete nouns. Replace "影響を与える" with "速度を 2 倍にする" / "律速段階を変える" when the note supports it.
- One claim per sentence. Short sentences. Mix sentence lengths so the rhythm doesn't flatten.
- Section headings are **optional landing spots, not a checklist**. Drop any section rather than fill it with filler. For short Claims, flowing prose with no headings is fine.
- A Claim should read like a short note from a colleague, not a structured report.${ja ? `
- **日本語で書くときは必ず敬体（ですます調）で統一する。常体（〜だ／〜である／〜した／〜と気づいた）は使わない。** 文末は「〜です」「〜ます」「〜でした」「〜ました」「〜と考えています」「〜と見ています」「〜のではないでしょうか」のいずれかに揃える。これは絶対ルールで、たとえノート原文が常体でも、生成する文章は敬体にする。` : ""}${skillSection}

### Tone calibration (Bad / Good)

❌ Cold report tone (avoid):
> 本概念は塩基性条件における酸化膜還元の律速段階遷移を示す。pH 11 を境界として速度定数が約 2 倍に変化することが観測された。

✅ Specific, warm, one claim per sentence:
> pH 11 を超えると還元が急に走る。律速段階が水酸化物の脱離から電子移動に切り替わるからで、[[ZnO 還元実験 2026-04]] では速度が約 2 倍になっていた。

Same facts, different temperature. Aim for the second.

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
      "kind": "summary" | "claim",
      "level": "principle" | "finding"   // claim のみ。summary では省略
      "evidenceSpan": "string"           // level=principle の場合のみ。下の Principle threshold 参照
      "claimRole": ["finding" | "decision" | "anomaly" | "question" | "setup" | "interpretation" | "issue"], // claim のみ。複数可。下の Claim role 参照
      "epistemicStatus": "speculation" | "interpretation" | "observation" | "established", // claim のみ。下の Epistemic status 参照。REQUIRED for every Claim
      "rebuttalConditions": ["string"],                                  // claim のみ。Toulmin Rebuttal。下の "Rebuttal conditions" 参照。記述なしなら []
      "backing": [                                                      // claim のみ。Toulmin Backing。下の "Backing" 参照。記述なしなら []
        { "source": "textbook" | "external-paper" | "internal-claim", "citation": "one-sentence", "url": "https://... (optional)", "internalClaimId": "id (optional)" }
      ],
      "modalQualifier": "necessarily" | "probably" | "possibly" | "rarely", // claim のみ。Toulmin Modal qualifier。下の "Modal qualifier" 参照
      "procedureContext": {                                              // claim のみ。手順依存の主張のときだけ。下の Procedure context 参照
        "derivedFromNotes": ["sourceNoteId"],
        "protocolFingerprint": "step1 → step2 → step3",                // 主要ステップを自然言語で短く
        "keyParameters": [{ "name": "...", "value": "...", "necessity": "critical" | "important" | "incidental" }],
        "keyTools": ["..."],
        "validityRange": "natural-language range over which the claim holds"
      },
      "title": "string",
      "sections": [
        { "heading": "string", "content": "string" }
      ],
      "suggestedAction": "create" | "merge",
      "mergeTargetId": "string (only if merge)",
      "confidence": 0.0-1.0,
      "relatedClaims": [
        { "title": "existing concept title", "citation": "one-sentence summary of what this concept contributes" }
      ],
      "externalReferences": [
        { "url": "https://...", "title": "Reference description", "citation": "what this reference supports or evidences" }
      ]
    }
  ]
}

## Claim role (Phase 1.1)

For every Claim, tag it with one or more **research-process roles** in \`claimRole\`. These are orthogonal to \`level\` and to the existing context labels: they describe **what kind of move the Claim makes inside the research process**, not what it represents ontologically.

Pick from this fixed vocabulary (multiple values allowed when genuinely warranted — most Claims have 1, occasionally 2):

- \`finding\`: an observation or fact established in this context
- \`decision\`: a choice made and its reason
- \`anomaly\`: an unexpected observation or result
- \`question\`: an unresolved question raised in this context
- \`setup\`: a precondition, configuration, or experimental constraint
- \`interpretation\`: a tentative meaning-making move (interpretation of data)
- \`issue\`: a problem or concern noticed in this context

Guidance:
- Default for most positive results: \`["finding"]\`.
- A finding that surprised the author: \`["finding", "anomaly"]\`.
- A purposeful choice with reasoning: \`["decision"]\` (with \`["interpretation"]\` if it's also re-framing data).
- An open thread: \`["question"]\` (often comes with \`level: "finding"\` rather than \`"principle"\`).
- A flagged risk or limitation: \`["issue"]\`.
- Hardware/protocol pre-conditions: \`["setup"]\`.
- If none of these clearly fit, omit the field (do **not** pick \`finding\` as a default just to fill the slot).

## Epistemic status (Phase η — REQUIRED for every Claim)

Tag every Claim with **exactly one** \`epistemicStatus\`. This expresses *what kind of evidence the Claim rests on*, independent of \`claimRole\` (which expresses the process move) and \`level\` (which expresses abstraction). The downstream Atomizer / Synthesizer treat status as load-bearing: a single \`speculation\` Claim propagates as \`speculation\` through the Atom and Synthesis layers and is structurally prevented from passing as established knowledge.

Fixed vocabulary (low → high in epistemic strength):

- \`speculation\`: hedge markers (「〜のかも」「もしかして」「気がする」「じゃないかな」"maybe", "might", "I wonder"). The note explicitly signals it is a musing, not a finding.
- \`interpretation\`: a tentative meaning-making move — possibly grounded in observation but the note does **not** assert it as a fact. Default for "X **might be** because Y" / "考えられる" / "解釈すると…".
- \`observation\`: measurement / observation language with PROV structure (\`[Step]\` / \`[Output]\` / 「測った」「観察した」「データを取った」), where the Claim is *what was seen* without claiming a mechanism.
- \`established\`: explicit multi-source confirmation, textbook citation, or "well-known" framing the note treats as ground truth ("教科書では…" / "標準的に〜とされる" / "Marcus 理論によれば").

When uncertain, **prefer the LOWER status**. This is a conservative default: it protects the knowledge layer from speculation leaking upward, at the cost of occasionally underrating an established Claim. The cost of underrating is recoverable (re-rate later); the cost of letting a speculation pass as established is silent contamination of the Atom / Synthesis layers.

Examples:

- Note: 「もしかして、寝る前のストレッチで眠りが深くなるのかも」
  → epistemicStatus: \`speculation\` (hedge markers present)
- Note: 「13:20 にオフィスの騒音が 71 dB のピークを示した」
  → epistemicStatus: \`observation\` (measurement language, no mechanism stated)
- Note: 「SPS で 800℃ 5 分焼結すると亜鉛蒸発が抑えられ、相純度が上がると考えられる」
  → epistemicStatus: \`interpretation\` ("考えられる" — tentative mechanism on top of observation)
- Note: 「光合成は CO₂ と H₂O から糖を作る反応である」
  → epistemicStatus: \`established\` (textbook-grade statement)

If the source note carries a \`meta.captureMode: "speculation"\` flag (the user explicitly toggled the *Speculation mode* on the note input), **all** Claims from that note must be tagged \`speculation\` regardless of their linguistic surface. The mode is a hard lock — it overrides any inferred status.

## Rebuttal conditions (Phase γ — Toulmin Rebuttal)

If the source note mentions conditions under which the Claim **breaks down** — such as "X works except when Y", "this holds provided Z", "but when W happens, the result inverts", 「ただし〜の場合は」「〜のときは逆」「〜を超えると効かない」 — extract them into \`rebuttalConditions\` as an array of short natural-language strings.

A rebuttal is a *boundary condition* that flips or invalidates the Claim, not a generic limitation. "More work is needed" is **not** a rebuttal. "Above 80°C the catalyst loses activity" **is** a rebuttal.

Rules:
- Quote the condition in the note's own words; do not extrapolate.
- Each entry is one boundary condition. If the note lists two, use two array entries.
- **If the note states no rebuttal, return an empty array.** Do NOT invent rebuttals to fill the slot.

Examples:

- Claim: "酸化を抑えると相純度が上がる"
  - rebuttalConditions: ["ただし反応温度が分解点を超える場合は逆効果になる"]
- Claim: "TDD で速度が上がる"
  - rebuttalConditions: ["プロトタイプ段階では型がまだ流動的なので逆に遅くなる"]
- Claim: "光合成は CO₂ と H₂O から糖を作る反応である"
  - rebuttalConditions: []  // textbook 級の established Claim、note に boundary 記述なし

## Backing (Phase γ — Toulmin Backing)

The **Warrant** is the inferential rule that lets a piece of evidence support a Claim. It is usually *implicit* in the note ("this rate doubled" + "rate doubling implies a regime change" → "the regime changed"). \`backing\` is the explicit grounding the note gives **for that inferential rule** — a textbook principle, an external paper, or another internal Claim that the user relies on to license the inference.

### Decision procedure (apply in order)

For every named citation, theory, framework, or existing Claim in the source note, decide which slot it goes into:

1. **Ask: "what is the Warrant of this Claim?"** Phrase it as one sentence of the form "given X, we can conclude Y because Z" — Z is the Warrant.
2. **Check the cited item against the Warrant:**
   - Is the cited item the *measurement / observation / data point* that makes X true? → \`externalReferences\`.
   - Is the cited item the *theory / formalism / principle / prior framing* that licenses "X implies Y" (i.e., the Z above)? → \`backing\`.
3. **If the same citation plays both roles**, prefer \`backing\` when the note's *language* invokes the citation as authority for the reasoning ("matches X", "as X showed theoretically", "X 理論から考えると", "the textbook story is…") rather than as a data point ("X measured the rate", "X observed Y").

### Schema per entry

- \`source\`: one of \`"textbook"\` | \`"external-paper"\` | \`"internal-claim"\`.
- \`citation\`: one-sentence description of what the backing contributes.
- \`url\`: optional, only when the note carries a specific URL for an external paper.
- \`internalClaimId\`: optional, only when the backing is another existing Claim (use the id from "Existing Wikis").

### Rules

- **Only extract backing that the note explicitly invokes.** If the user is silently relying on background knowledge but the note never names it, leave \`backing\` empty.
- **Idiomatic phrases that signal backing** (treat as strong cues, JP and EN):
  - 「〜理論から考えると」「〜原理から導かれる」「〜の枠組みでは」「教科書では…とされる」「定石としては」
  - "matches [paper]" / "this is the standard X story" / "the textbook view of X" / "as [author] formalized" / "well-known result that…"
- Each entry must be a single backing source — do not bundle ("textbook + paper + Marcus theory" is three entries, not one).
- **No invented citations.** If the note says "教科書によると" without naming the textbook, that is still a textbook-level backing — use \`{ source: "textbook", citation: "教科書水準の電子移動律速の原理" }\` rather than fabricating a title.
- A single note can yield 0, 1, or multiple backing entries. Most everyday notes will have 0; notes that explicitly lean on theoretical authority will have 1–2.

### Examples

- Note: 「Marcus 理論の電子移動律速の原理から考えると、塩基性条件で律速段階が切り替わるのは自然に説明できる」
  - Warrant: "rate-limiting steps switch when electron-transfer dynamics dominate". Marcus 理論 is the textbook authority for this Warrant.
  - backing: [{ source: "textbook", citation: "Marcus 理論による電子移動律速の原理" }]

- Note (mixed — observation paper *plus* textbook framing): 「the textbook two-sided-network story (each side attracts the other) only fires once both sides clear a threshold. … This is not novel theory — it matches Rochet & Tirole.」
  - Warrant: "two-sided platforms exhibit threshold-driven self-sustaining growth". "Textbook two-sided-network story" and "Rochet & Tirole" are both authorities the user invokes for the Warrant — they are **not** data the user measured.
  - backing: [
      { source: "textbook", citation: "the standard two-sided-network story (each side attracts the other)" },
      { source: "external-paper", citation: "Rochet & Tirole formalize the same threshold-driven two-sided dynamic" }
    ]
  - externalReferences: [] for this Claim (the user's *own* 5-marketplace data is internal, not an external reference)

- Note (measurement, not Warrant): 「Xie ら (2013) で覚醒時よりノンレム睡眠時の方が脳脊髄液流量が高いことが報告されている」
  - Here Xie 2013 is the *measurement that establishes the data point*, not the Warrant authority. Use \`externalReferences\`, NOT \`backing\`.
  - backing: []
  - externalReferences: [{ url: "...", title: "Xie et al. Science 2013", citation: "睡眠中の脳脊髄液流量の測定" }] (if the note provides the URL; otherwise leave externalReferences empty)

- Note (existing Claim invoked as Warrant authority): 「[[既存 Claim: pH 依存性]] と同じ仕組みで律速段階が切り替わる」
  - backing: [{ source: "internal-claim", citation: "同じ pH 依存メカニズムが Warrant を支える", internalClaimId: "<id from existing wikis>" }]

- Note (no explicit Warrant grounding):
  - backing: []

## Modal qualifier (Phase γ — Toulmin Modal qualifier)

Set \`modalQualifier\` based on the note's **own language** for certainty. This is *user-facing certainty*, distinct from the system's \`confidence\` score (which measures extraction reliability) and from \`epistemicStatus\` (which measures the kind of evidence).

Fixed vocabulary:

- \`necessarily\`: 「必ず」「必然的に」「常に」 / "always", "must", "necessarily"
- \`probably\`: 「おそらく」「だいたい」「ほぼ」 / "probably", "usually", "in most cases" — the **default** when the note asserts the Claim without explicit hedging
- \`possibly\`: 「かもしれない」「可能性がある」「〜得る」 / "may", "might", "could"
- \`rarely\`: 「まれに」「ごく一部で」「例外的に」 / "rarely", "in rare cases"

Rules:
- Pick the qualifier that **best matches the strongest claim sentence** in the note for this Claim. If the note hedges in one sentence and asserts in another, take the asserted form.
- **When uncertain, default to \`probably\`.** This is the maximally-honest neutral position: it conveys "I'm asserting this but not declaring a universal law".
- \`epistemicStatus = "speculation"\` does **not** force \`modalQualifier = "possibly"\` — a speculation can still be expressed with certainty ("これは絶対に酸化のせい" — speculation by evidence type, but \`necessarily\` by user's expressed certainty). Keep the two axes independent.

Examples:

- Note: 「塩基性条件では必ず律速段階が切り替わる」 → \`modalQualifier: "necessarily"\`
- Note: 「pH 11 を超えると速度が約 2 倍になる」（直接断定） → \`modalQualifier: "probably"\` (default for plain assertion)
- Note: 「もしかすると寝る前のストレッチで眠りが深くなるのかも」 → \`modalQualifier: "possibly"\`
- Note: 「まれに pH 11 でも切り替わらないバッチがある」 → \`modalQualifier: "rarely"\`

## Procedure context (Phase 2.3 — read this carefully)

When the source note carries a PROV structure section (preceding the body — look for "## PROV structure of the source note" above), use it to fill \`procedureContext\` on every Claim whose validity **actually depends** on the procedure.

A Claim depends on the procedure when changing the synthesis route, the tool, or a key parameter would plausibly change the truth-value of the claim. Empirical claims ("X was observed when we did Y") almost always depend on procedure. Pure conceptual claims ("X is defined as Y") usually do not.

Schema:
- \`derivedFromNotes\`: just echo the source note's id (you receive it implicitly — for the Ingester this is the single source note).
- \`protocolFingerprint\`: a short natural-language chain of the main steps that lead to the result (e.g., "mechanical alloying → SPS sintering" or "PDF parse → atomize → cite"). Keep it under ~80 characters. Skip when no procedure is involved.
- \`keyParameters\`: an array of \`{name, value, necessity}\`. Necessity:
  - \`critical\`: change this and the claim likely flips (e.g., synthesis temperature for a phase-purity claim).
  - \`important\`: change this and the claim shifts in magnitude but probably holds in direction.
  - \`incidental\`: a parameter that happens to be in the PROV but is unlikely load-bearing for *this* claim.
- \`keyTools\`: tools / instruments / methods the claim depends on. Use the names exactly as they appear in PROV.
- \`validityRange\`: natural-language description of the parameter window over which the claim is expected to hold ("mechanical alloying time 1–5h, SPS temperature 800–900°C"). Set only when the source notes give enough information; otherwise omit.

Rules:
- **Omit \`procedureContext\` entirely** when the Claim is procedure-independent. An empty object is worse than no field — readers will think the Claim depends on a void procedure.
- **Never invent** parameter values or tools that are not in the PROV section. If PROV is missing, you may still set \`keyTools\` from explicit mentions in the body, but leave \`keyParameters\` empty rather than fabricating numbers.
- The PROV section uses the source note's language for values (e.g., "ボールミル", "300rpm") — keep them verbatim; do not translate.

## Summary (1 per note, always)

The Summary is **private**. It can keep specific names, dates, sample IDs, paths — anything needed to reconstruct what happened. This is the user's local context layer.

The Summary is allowed to be longer than a Claim/Atom (which are deliberately one-idea-each), but **its job is selection, not coverage**. A good Summary tells a reader who has not opened the source: *what the central point is, what it is built on, what was surprising, and what is still open* — and stops there. Length follows substance. Padding the Summary to "feel thorough" is a failure mode.

### What a Summary must answer (in this order)

Treat these as the spine of every Summary. Skip a beat if the source does not support it; do not invent one to fill structure.

1. **The point** — the single central claim or finding of the source, stated in 1-2 sentences as a hook. Not "本ノートでは…を扱う" / "This note discusses..." — state the substance.
2. **What it is built on** — the key evidence, mechanism, data, or argument that makes the point credible. One or two beats, the load-bearing ones, not an exhaustive list.
3. **What was surprising or non-obvious** — what would a careful reader miss if they only skimmed? Counter-intuitive results, a method choice that mattered, an inversion of common belief.
4. **Limits / open questions** — what the source does not settle, where the argument is thin, what the user might want to follow up on. Skip if the source is self-contained.

### Length follows the source — do not pad

- A short note or a long source that makes **one** point → a few sentences is the right answer. Stay tight.
- A long source that genuinely covers **multiple distinct beats** (separate arguments, separate chapters that don't reduce to one claim) → expand only as far as the distinct beats demand. 10-20 sentences and 2-4 real headings is the upper end, reserved for genuinely multi-threaded sources.
- A trivial note → 2-3 sentences, confidence 0.5.

**Anti-padding rules** (apply ruthlessly — these are the most common failure modes):

- ❌ Restating the same point in different words across paragraphs to look thorough.
- ❌ Listing every section of the source as if writing a table of contents. Compress; only the load-bearing parts survive.
- ❌ Filler hedges like "様々な観点から論じられている" / "various perspectives are discussed". Either name the perspectives that matter, or cut.
- ❌ Borrowing phrasing or noise from the source verbatim — chat fragments, headers, navigation labels, footnote markers — when they don't carry meaning. Paraphrase in your own register.
- ✅ If you can delete a sentence and the Summary still answers the four spine questions, **delete it**.

### Truncation honesty

If the source ends with a marker like \`[... truncated: read N of M pages]\`, you only saw the first N pages. **State this at the end of the Summary** (e.g., 「（PDF 全 100 ページ中、冒頭 30 ページぶんから要約しています）」/ "(Summarized from the first 30 of 100 pages.)"). Do not pretend to have read the whole document.

### Headings

Default to flowing prose with a single empty-heading section (\`heading: ""\`). Use real headings only when the source has 2+ genuinely distinct beats that benefit from being navigable, and let each heading **name the actual beat** (e.g., 「方法」「予想外だった結果」). Never invent decorative labels like 「核心の発見」「ジレンマの構造」 just to fill structure.

## Claim (0-3 per note)

**One Claim = one idea.** This is the strongest rule. If a note carries two transferable claims, generate two Claims — never bundle them into a single longer page. Splitting beats one big page. A reader should be able to say what the Claim is in a single sentence after reading it.

Claims are **transferable knowledge**, written so they make sense to a researcher who has never seen this lab. They MUST be PII-free and abstracted:

- ❌ Personal/lab-specific: investigator names, institution names, internal project codenames, sample IDs, instrument serial numbers, file paths, dates of specific experiments. Keep these in the Summary instead.
- ✅ Transferable: the principle / finding, with the specific evidence cited via \`[[note title]]\` so the reader can trace it back.
- Frame as "X happens when Y because Z" — propositional, not autobiographical.

### Splitting test (apply before settling on the section structure)

Before writing the body, ask: **"Does this Claim assert one claim, or several?"**

- One claim → one Claim. Proceed.
- Several claims, each transferable on its own → split into separate Claims. Each gets its own title that names that one claim.
- Several pieces that only make sense together (a mechanism that needs setup + reasoning + consequence to land) → one Claim is correct. The test is whether the pieces are independent claims or facets of the same claim.

When in doubt, split.

### level: \`finding\` vs \`principle\`

- **\`finding\`** (default, where most Claims live): a transferable proposition that emerged from the user's own experience. Specific enough to be **the user's** knowledge, abstract enough to combine with other findings. Example: "塩基性条件で酸化膜の還元は律速段階が切り替わる".
- **\`principle\`**: a textbook-knowable general truth that the note's reasoning **explicitly depended on**. Recording these is valuable because (a) the user may not have known it before, (b) it becomes a synthesis hub when other notes also lean on it. But the bar for generation is high — see threshold below.
- \`bridge\` is reserved for cross-update synthesis; do not generate at ingest time.

### Principle threshold (strict — read carefully)

Generate \`level: "principle"\` ONLY if you can pass this test:

> **"Point to a sentence in the note where this principle is used as a load-bearing premise to reach a conclusion. If the principle were false, the note's conclusion would change."**

If you cannot identify such a sentence, the principle is not load-bearing — it is adjacent context. Do not generate it. Adjacent restatements of textbook material are exactly what makes the wiki feel cluttered.

When you do generate a principle, you MUST fill \`evidenceSpan\` with the actual sentence (or close paraphrase) from the note that depends on it. This is a self-check: if you cannot quote it, you cannot generate the principle.

### Claim body (minimal scaffold)

Default shape — write only what the Claim actually needs:

${ja ? `1. **冒頭 1-2 文で命題を言い切る**（見出しなし）。タイトルと合わせて読めば主張が立つ
2. **メカニズムまたは根拠**：なぜそう言えるか。ソースノートを \`[[ノートタイトル]]\` でインライン引用
3. **（任意）残る問い**：まだ分かっていないこと。なければ書かない

A short Claim can be a single paragraph with no headings at all. Use headings only when the body genuinely splits into chunks.` : `1. **Open with the proposition in 1-2 sentences** (no heading). Together with the title, the claim should stand.
2. **Mechanism or evidence**: why it holds. Cite the source note with \`[[note title]]\`.
3. **(Optional) Open questions**: what remains unknown. Skip if there are none.

A short Claim can be a single paragraph with no headings at all. Use headings only when the body genuinely splits into chunks.`}

The first paragraph should already deliver the proposition — anything that follows elaborates, not delays.

### Inline citation rule

When citing the source, use **double brackets** with the EXACT note title from the user message:

${ja ? `- ✅ 「[[ZnO 還元実験 2026-04]] では pH 11 で速度が約 2 倍になっている」
- ❌ 「ノートによると…」「先ほどのソースに基づくと…」` : `- ✅ "The rate roughly doubles at pH 11 in [[ZnO reduction 2026-04]]."
- ❌ "According to the note...", "Based on the source above..."`}

Double brackets become clickable links. Generic references that don't name the title break the trace.

### Bad / Good Claims

- ❌ **Restatement**: A Claim that paraphrases the note in different words. Adds nothing.
- ❌ **Textbook chapter**: A Claim that explains general background the note didn't actually depend on.
- ❌ **Lab-specific log**: A Claim that names specific samples, dates, or instruments — that belongs in the Summary.
- ✅ **Transferable proposition**: A claim of the form "X happens / works / fails when Y, because Z" that another researcher could pick up and apply, with \`[[note title]]\` showing where the evidence came from.

## Merge vs Create

${hasExistingConcepts ? `Existing Claims are listed below. Before creating a new Claim:
1. If the note EXTENDS an existing Claim → "merge" with that ID. Sections should contain only the **new** content to add, not restate the existing.
2. If the note CONTRADICTS an existing Claim → "create" a new one that addresses the contradiction (don't silently overwrite).
3. If the note provides NEW EVIDENCE for an existing Claim → "merge".
4. Otherwise create new.` : "No existing Claims yet. Create freely."}

## Existing Wikis

${wikiListText}

## Language

Output in: ${ja ? "Japanese" : "English"}

## Quality Guidelines

- Summary: exactly 1 per note.
- Claims: 0-3. **Prefer splitting over bundling** — if a note carries two distinct transferable claims, two short Claims beat one long combined page. Each Claim must hold exactly one idea (see "Splitting test" above).
- Quality > quantity. If the note has no transferable claim worth abstracting, generate zero Claims and just produce the Summary.
- Length: include what the Claim needs to be understood and traced — no more. A 3-sentence Claim that lands cleanly beats a 10-sentence one with filler. If you find yourself stretching to fill space, the Claim is done.
- relatedClaims: \`{title, citation}\` pairs for connected existing Claims. \`citation\` explains the link in one line (e.g., "provides pH-dependency context"). Empty array if none.
- externalReferences: 0-5 per wiki. Prefer stable, well-known URLs. \`citation\` explains what each reference supports.
- confidence: 0.9+ for clear, well-evidenced; 0.6-0.8 for tentative; 0.5 for trivial-note Summaries.
- If the note is too short or trivial, return only a minimal Summary with confidence 0.5 — do not generate Claims to fill space.`;
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
        const kind: WikiKind = (w.kind === "summary" || w.kind === "claim" || w.kind === "atom" || w.kind === "synthesis") ? w.kind : "claim";
        const rawLevel = typeof w.level === "string" ? w.level : undefined;
        const level: ClaimLevel | undefined =
          kind === "claim" && (rawLevel === "principle" || rawLevel === "finding" || rawLevel === "bridge")
            ? rawLevel
            : kind === "claim"
              ? "finding"
              : undefined;
        const rawEvidence = typeof w.evidenceSpan === "string" ? w.evidenceSpan.trim() : "";
        // principle は evidenceSpan 必須。空なら finding に降格させて textbook 流入を防ぐ
        const finalLevel: ClaimLevel | undefined =
          level === "principle" && rawEvidence.length === 0 ? "finding" : level;
        const claimRole: ClaimRole[] | undefined =
          kind === "claim" && Array.isArray(w.claimRole)
            ? Array.from(
                new Set(
                  w.claimRole
                    .map((r: unknown) => (typeof r === "string" ? r : ""))
                    .filter((r: string): r is ClaimRole =>
                      (CLAIM_ROLE_VALUES as string[]).includes(r),
                    ),
                ),
              )
            : undefined;
        const procedureContext: ProcedureContext | undefined =
          kind === "claim" ? parseProcedureContext(w.procedureContext) : undefined;
        // Phase γ: Toulmin Rebuttal / Backing / Modal qualifier。Claim 以外は剥がす。
        const rebuttalConditions = kind === "claim" ? parseRebuttalConditions(w.rebuttalConditions) : undefined;
        const backing = kind === "claim" ? parseBacking(w.backing) : undefined;
        const modalQualifier = kind === "claim" ? parseModalQualifier(w.modalQualifier) : undefined;
        // Phase η: epistemicStatus を fixed vocabulary でフィルタする。
        // LLM が不明な値を入れたら undefined にして下流で "interpretation" 扱いに倒す。
        const rawEpistemic =
          typeof w.epistemicStatus === "string" ? w.epistemicStatus : undefined;
        const epistemicStatus: EpistemicStatus | undefined =
          kind === "claim" &&
          rawEpistemic &&
          (EPISTEMIC_STATUS_VALUES as string[]).includes(rawEpistemic)
            ? (rawEpistemic as EpistemicStatus)
            : undefined;
        return {
          kind,
          level: finalLevel,
          evidenceSpan: finalLevel === "principle" ? rawEvidence : undefined,
          claimRole: claimRole && claimRole.length > 0 ? claimRole : undefined,
          epistemicStatus,
          procedureContext,
          rebuttalConditions,
          backing,
          modalQualifier,
          title: String(w.title),
          sections: w.sections.map((s: any) => ({
            heading: String(s.heading ?? ""),
            content: String(s.content ?? ""),
          })),
          suggestedAction: w.suggestedAction === "merge" ? "merge" as const : "create" as const,
          mergeTargetId: w.mergeTargetId ? String(w.mergeTargetId) : undefined,
          confidence: typeof w.confidence === "number" ? w.confidence : 0.7,
          relatedClaims: Array.isArray(w.relatedClaims)
            ? w.relatedClaims.map((rc: any) =>
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
 * LLM が返した procedureContext オブジェクトをサニタイズする。
 *
 * - 各フィールドを型チェックして、無効な値は黙って捨てる
 * - 全フィールドが空になった場合は undefined を返す（空オブジェクトを保存しない）
 * - keyParameters の necessity は許容値以外は "important" にフォールバック
 *
 * 提案 v4 Phase 2.3。
 */
export function parseProcedureContext(raw: unknown): ProcedureContext | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const derivedFromNotes = Array.isArray(obj.derivedFromNotes)
    ? obj.derivedFromNotes.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  const protocolFingerprint =
    typeof obj.protocolFingerprint === "string" && obj.protocolFingerprint.trim().length > 0
      ? obj.protocolFingerprint.trim()
      : undefined;

  let keyParameters: KeyParameter[] | undefined;
  if (Array.isArray(obj.keyParameters)) {
    const parsed: KeyParameter[] = [];
    for (const p of obj.keyParameters) {
      if (!p || typeof p !== "object") continue;
      const pp = p as Record<string, unknown>;
      const name = typeof pp.name === "string" ? pp.name.trim() : "";
      const value = typeof pp.value === "string" ? pp.value.trim() : "";
      if (!name || !value) continue;
      const rawNecessity = typeof pp.necessity === "string" ? pp.necessity : "";
      const necessity: KeyParameter["necessity"] =
        (NECESSITY_VALUES as string[]).includes(rawNecessity)
          ? (rawNecessity as KeyParameter["necessity"])
          : "important";
      parsed.push({ name, value, necessity });
    }
    if (parsed.length > 0) keyParameters = parsed;
  }

  const keyTools = Array.isArray(obj.keyTools)
    ? obj.keyTools.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];

  const validityRange =
    typeof obj.validityRange === "string" && obj.validityRange.trim().length > 0
      ? obj.validityRange.trim()
      : undefined;

  const hasAny =
    derivedFromNotes.length > 0 ||
    protocolFingerprint !== undefined ||
    keyParameters !== undefined ||
    keyTools.length > 0 ||
    validityRange !== undefined;
  if (!hasAny) return undefined;

  return {
    derivedFromNotes,
    protocolFingerprint,
    keyParameters,
    keyTools: keyTools.length > 0 ? keyTools : undefined,
    validityRange,
  };
}

/**
 * LLM が返した rebuttalConditions 配列をサニタイズする（Phase γ）。
 *
 * - 文字列要素のみ拾い、trim 後の空文字列は捨てる
 * - 重複は保持する（rebuttal が同一文言で 2 つ来る場合は LLM 側のミスなので無視）
 * - 結果が 0 件なら undefined を返す（空配列を文書に保存しない）
 */
export function parseRebuttalConditions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * LLM が返した backing 配列をサニタイズする（Phase γ）。
 *
 * - source は fixed vocabulary 外なら entry を捨てる
 * - citation が空文字列なら entry を捨てる
 * - url / internalClaimId は optional、空文字列なら undefined 化
 * - 結果が 0 件なら undefined を返す
 */
export function parseBacking(raw: unknown): BackingEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BackingEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const source = typeof obj.source === "string" ? obj.source.trim() : "";
    if (!(BACKING_SOURCE_VALUES as readonly string[]).includes(source)) continue;
    const citation = typeof obj.citation === "string" ? obj.citation.trim() : "";
    if (citation.length === 0) continue;
    const url =
      typeof obj.url === "string" && obj.url.trim().length > 0 ? obj.url.trim() : undefined;
    const internalClaimId =
      typeof obj.internalClaimId === "string" && obj.internalClaimId.trim().length > 0
        ? obj.internalClaimId.trim()
        : undefined;
    out.push({ source, citation, url, internalClaimId });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * LLM が返した modalQualifier をサニタイズする（Phase γ）。
 *
 * - fixed vocabulary 以外なら undefined。下流は default "probably" 扱いするが、
 *   parser 側で勝手にデフォルト埋めはしない（LLM が値を出さなかった事実を残す）。
 */
export function parseModalQualifier(raw: unknown): ModalQualifier | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!(MODAL_QUALIFIER_VALUES as string[]).includes(trimmed)) return undefined;
  return trimmed as ModalQualifier;
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
